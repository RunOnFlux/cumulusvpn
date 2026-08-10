/**
 * HTTP surface. Routes are thin — verification and grant logic live in the
 * rails; this file owns validation, rate limits, the response envelope, and
 * raw-body capture (Stripe signatures are over the exact received bytes).
 *
 * Webhook endpoints return 200 even for payloads we ignore or have already
 * processed — a non-2xx makes Stripe/Apple/Google retry forever. Only
 * verification failures (forged payloads) get 4xx.
 */
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createHash, timingSafeEqual } from 'node:crypto';

import type { Config } from './config.js';
import { isValidPaymentCode } from './codes.js';
import { err, ok } from './envelope.js';
import type { PaymentsRepo } from './db/payments.js';
import type { SubscriptionsRepo } from './db/subscriptions.js';
import {
  displayCode,
  generateCode,
  normalizeCode,
  RedeemError,
  type VoucherStatus,
  type VouchersRepo,
} from './db/vouchers.js';
import { zatsForDays } from './grants.js';
import { InvalidAttemptBreaker } from './breaker.js';
import { Alerter } from './worker/alerts.js';
import { StripeRail } from './rails/stripe.js';
import { AppleRail } from './rails/apple.js';
import { GoogleRail } from './rails/google.js';
import type { ChainClient } from './flux/chain.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export interface ServerDeps {
  readonly cfg: Config;
  readonly payments: PaymentsRepo;
  readonly subs: SubscriptionsRepo;
  readonly vouchers: VouchersRepo;
  readonly chain: ChainClient;
  readonly treasuryAddress: string;
}

export interface BuiltServer {
  readonly app: FastifyInstance;
  readonly alerter: Alerter;
}

export async function buildServer(deps: ServerDeps): Promise<BuiltServer> {
  const { cfg } = deps;
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Webhook bodies carry receipts/tokens; never log them.
      redact: ['req.headers.authorization', 'req.headers["stripe-signature"]'],
    },
    disableRequestLogging: true,
    trustProxy: true,
  });

  const d = {
    ...deps,
    stripe: cfg.stripe
      ? new StripeRail(cfg.stripe, cfg.priceZats, deps.payments, deps.subs, deps.vouchers, app.log)
      : undefined,
    apple: cfg.apple
      ? new AppleRail(cfg.apple, cfg.priceZats, deps.payments, deps.subs, app.log)
      : undefined,
    google: cfg.google
      ? new GoogleRail(cfg.google, cfg.priceZats, deps.payments, deps.subs, app.log)
      : undefined,
  };

  // JSON parser that keeps the raw bytes for signature verification.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      const parseErr = new Error('invalid JSON body') as Error & { statusCode: number };
      parseErr.statusCode = 400;
      done(parseErr, undefined);
    }
  });

  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

  const badRequest = (reply: FastifyReply, name: string, message: string): FastifyReply =>
    reply.code(400).send(err(400, name, message));

  /**
   * Bearer ADMIN_TOKEN gate for /internal endpoints. Constant-time via
   * fixed-length SHA-256 digests (same approach as the dashboard worker) —
   * a plain string compare short-circuits and leaks a timing side-channel.
   */
  const adminDigest = createHash('sha256').update(`Bearer ${cfg.adminToken}`).digest();
  const requireAdmin = (
    req: { headers: { authorization?: string | undefined } },
    reply: FastifyReply,
  ): boolean => {
    const given = createHash('sha256')
      .update(req.headers.authorization ?? '')
      .digest();
    if (!timingSafeEqual(given, adminDigest)) {
      void reply.code(401).send(err(401, 'unauthorized', 'bad token'));
      return false;
    }
    return true;
  };

  const alerter = new Alerter(cfg.alertWebhookUrl, app.log);

  // ---- Voucher redemption ----
  // Global breaker: >50 invalid-code attempts in 10 min closes the endpoint
  // for 15 min for everyone and pages the operator — combined with 31^10
  // code entropy and the per-IP limit, online brute force is hopeless.
  const redeemBreaker = new InvalidAttemptBreaker(50, 10 * 60_000, 15 * 60_000, () => {
    void alerter.alert('voucher-bruteforce', 'voucher redeem breaker tripped: invalid-code flood');
  });

  app.post(
    '/v1/voucher/redeem',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['payment_code', 'code'],
          properties: {
            payment_code: { type: 'string', minLength: 20, maxLength: 40 },
            code: { type: 'string', minLength: 4, maxLength: 40 },
          },
        },
      },
    },
    async (req, reply) => {
      const { payment_code, code } = req.body as { payment_code: string; code: string };
      if (redeemBreaker.isOpen()) {
        return reply.code(429).send(err(429, 'rate_limited', 'too many attempts; try again later'));
      }
      if (!isValidPaymentCode(payment_code)) {
        return badRequest(reply, 'bad_code', 'payment_code is not a valid CumulusVPN payment code');
      }
      const canonical = normalizeCode(code);
      if (canonical === null) {
        redeemBreaker.recordInvalid();
        return reply.code(404).send(err(404, 'invalid', 'unknown code'));
      }
      const voucher = deps.vouchers.byCanonicalCode(canonical);
      // Revoked reads as unknown — don't leak which codes ever existed.
      if (!voucher || voucher.status === 'revoked') {
        redeemBreaker.recordInvalid();
        return reply.code(404).send(err(404, 'invalid', 'unknown code'));
      }
      if (voucher.type === 'stripe_discount') {
        // Not consumed here: the discount is applied (and counted) at
        // checkout / invoice settlement. Expiry still reads honestly.
        if (voucher.expires_at !== null && voucher.expires_at <= Math.floor(Date.now() / 1000)) {
          return reply.code(410).send(err(410, 'expired', 'this code has expired'));
        }
        if (voucher.redemption_count >= voucher.max_redemptions) {
          return reply.code(410).send(err(410, 'exhausted', 'this code has been fully used'));
        }
        return reply.send(ok({ type: 'stripe_discount', percent_off: voucher.value }));
      }
      if (voucher.expires_at !== null && voucher.expires_at <= Math.floor(Date.now() / 1000)) {
        return reply.code(410).send(err(410, 'expired', 'this code has expired'));
      }
      if (voucher.redemption_count >= voucher.max_redemptions) {
        return reply.code(410).send(err(410, 'exhausted', 'this code has been fully used'));
      }
      if (voucher.value % 30 !== 0 && !cfg.dayGrantsEnabled) {
        // Fleet not yet on the pro-rata rule — a day grant settled now would
        // vanish on old gateways. Creation gate should prevent this.
        return reply
          .code(503)
          .send(
            err(503, 'temporarily_unavailable', 'this code cannot be redeemed yet; try again soon'),
          );
      }
      try {
        deps.vouchers.redeemGrant(voucher, payment_code);
      } catch (e) {
        if (e instanceof RedeemError) {
          const status = e.reason === 'already_redeemed' ? 409 : 410;
          return reply
            .code(status)
            .send(err(status, e.reason, `code ${e.reason.replace('_', ' ')}`));
        }
        throw e;
      }
      req.log.info({ voucher: voucher.id, campaign: voucher.campaign }, 'voucher redeemed');
      return reply.send(ok({ type: 'grant_days', days: voucher.value, state: 'pending' }));
    },
  );

  // ---- Stripe ----
  if (d.stripe) {
    const stripe = d.stripe;
    app.post(
      '/v1/stripe/checkout',
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          body: {
            type: 'object',
            required: ['payment_code', 'plan'],
            properties: {
              payment_code: { type: 'string', minLength: 20, maxLength: 40 },
              plan: { type: 'string', enum: ['monthly', 'annual'] },
              voucher: { type: 'string', minLength: 4, maxLength: 40 },
            },
          },
        },
      },
      async (req, reply) => {
        const { payment_code, plan, voucher } = req.body as {
          payment_code: string;
          plan: 'monthly' | 'annual';
          voucher?: string;
        };
        if (!isValidPaymentCode(payment_code)) {
          return badRequest(
            reply,
            'bad_code',
            'payment_code is not a valid CumulusVPN payment code',
          );
        }
        // Optional discount code: resolved against OUR vouchers before Stripe
        // ever sees it — uniform error taxonomy with the redeem endpoint.
        let promoId: string | undefined;
        if (voucher !== undefined) {
          const canonical = normalizeCode(voucher);
          const row = canonical === null ? undefined : deps.vouchers.byCanonicalCode(canonical);
          if (
            !row ||
            row.status === 'revoked' ||
            row.type !== 'stripe_discount' ||
            !row.stripe_promo_id
          ) {
            return reply.code(404).send(err(404, 'invalid', 'unknown discount code'));
          }
          if (row.expires_at !== null && row.expires_at <= Math.floor(Date.now() / 1000)) {
            return reply.code(410).send(err(410, 'expired', 'this code has expired'));
          }
          if (row.redemption_count >= row.max_redemptions) {
            return reply.code(410).send(err(410, 'exhausted', 'this code has been fully used'));
          }
          promoId = row.stripe_promo_id;
        }
        const session = await stripe.createCheckout(payment_code, plan, promoId);
        return reply.send(ok({ url: session.url, session_id: session.sessionId }));
      },
    );

    app.post('/v1/stripe/webhook', { config: { rateLimit: false } }, async (req, reply) => {
      const signature = req.headers['stripe-signature'];
      if (typeof signature !== 'string' || !req.rawBody) {
        return badRequest(reply, 'bad_signature', 'missing Stripe-Signature');
      }
      try {
        const outcome = await stripe.handleWebhook(req.rawBody, signature);
        req.log.info({ outcome }, 'stripe webhook');
        return reply.send(ok({ received: true }));
      } catch (e) {
        req.log.warn({ err: e }, 'stripe webhook rejected');
        return badRequest(reply, 'bad_signature', 'webhook signature verification failed');
      }
    });
  }

  // ---- Apple ----
  if (d.apple) {
    const apple = d.apple;
    app.post(
      '/v1/apple/verify',
      {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          body: {
            type: 'object',
            required: ['payment_code', 'signed_transaction'],
            properties: {
              payment_code: { type: 'string', minLength: 20, maxLength: 40 },
              signed_transaction: { type: 'string', minLength: 100, maxLength: 100_000 },
            },
          },
        },
      },
      async (req, reply) => {
        const { payment_code, signed_transaction } = req.body as {
          payment_code: string;
          signed_transaction: string;
        };
        if (!isValidPaymentCode(payment_code)) {
          return badRequest(
            reply,
            'bad_code',
            'payment_code is not a valid CumulusVPN payment code',
          );
        }
        const outcome = await apple.verifyPurchase(payment_code, signed_transaction);
        if (!outcome.accepted) {
          return reply.code(422).send(err(422, 'verify_failed', outcome.reason));
        }
        return reply.send(
          ok({
            accepted: true,
            days: outcome.days,
            months: outcome.days === undefined ? undefined : Math.floor(outcome.days / 30),
            state: 'pending',
            sandbox: outcome.sandbox === true,
          }),
        );
      },
    );

    app.post('/v1/apple/notifications', { config: { rateLimit: false } }, async (req, reply) => {
      const body = req.body as { signedPayload?: string };
      if (typeof body?.signedPayload !== 'string') {
        return badRequest(reply, 'bad_payload', 'missing signedPayload');
      }
      const outcome = await apple.handleNotification(body.signedPayload);
      req.log.info({ outcome }, 'apple notification');
      if (outcome === 'notification:verification_failed') {
        return badRequest(reply, 'bad_payload', 'notification verification failed');
      }
      return reply.send(ok({ received: true }));
    });
  }

  // ---- Google ----
  if (d.google) {
    const gp = d.google;
    app.post(
      '/v1/google/verify',
      {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          body: {
            type: 'object',
            required: ['payment_code', 'purchase_token'],
            properties: {
              payment_code: { type: 'string', minLength: 20, maxLength: 40 },
              purchase_token: { type: 'string', minLength: 20, maxLength: 4000 },
            },
          },
        },
      },
      async (req, reply) => {
        const { payment_code, purchase_token } = req.body as {
          payment_code: string;
          purchase_token: string;
        };
        if (!isValidPaymentCode(payment_code)) {
          return badRequest(
            reply,
            'bad_code',
            'payment_code is not a valid CumulusVPN payment code',
          );
        }
        const outcome = await gp.verifyPurchase(payment_code, purchase_token);
        if (!outcome.accepted) {
          return reply.code(422).send(err(422, 'verify_failed', outcome.reason));
        }
        return reply.send(
          ok({
            accepted: true,
            days: outcome.days,
            months: outcome.days === undefined ? undefined : Math.floor(outcome.days / 30),
            state: 'pending',
            test: outcome.test === true,
          }),
        );
      },
    );

    app.post('/v1/google/rtdn', { config: { rateLimit: false } }, async (req, reply) => {
      const auth = req.headers.authorization;
      const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (!bearer || !(await gp.verifyOidcToken(bearer))) {
        return reply.code(401).send(err(401, 'unauthorized', 'invalid Pub/Sub OIDC token'));
      }
      const body = req.body as { message?: { data?: string } };
      if (typeof body?.message?.data !== 'string') {
        return badRequest(reply, 'bad_payload', 'missing Pub/Sub message data');
      }
      const outcome = await gp.handleRtdn(body.message.data);
      req.log.info({ outcome }, 'google rtdn');
      return reply.send(ok({ received: true }));
    });
  }

  // ---- Status / ops ----
  app.get(
    '/v1/payment/:code/status',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      if (!isValidPaymentCode(code)) {
        return badRequest(reply, 'bad_code', 'not a valid CumulusVPN payment code');
      }
      const rows = d.payments.byCode(code);
      return reply.send(
        ok({
          code,
          payments: rows.map((r) => ({
            rail: r.rail,
            days: r.days,
            months: Math.floor(r.days / 30),
            status: r.status,
            txid: r.txid,
            created_at: r.created_at,
          })),
        }),
      );
    },
  );

  app.get('/v1/health', async (_req, reply) => {
    const q = d.payments.queueStats();
    return reply.send(ok({ ok: true, queue_depth: q.pending + q.broadcast }));
  });

  app.get('/internal/treasury', { config: { rateLimit: false } }, async (req, reply) => {
    if (!requireAdmin(req, reply)) {
      return reply;
    }
    const q = d.payments.queueStats();
    const balanceZats = await d.chain.balanceZats(d.treasuryAddress).catch(() => -1);
    const balanceFlux = balanceZats < 0 ? null : balanceZats / 1e8;
    return reply.send(
      ok({
        treasury_address: d.treasuryAddress,
        balance_flux: balanceFlux,
        pending_payments: q.pending,
        broadcast_payments: q.broadcast,
        pending_flux_needed: q.pendingZats / 1e8,
        oldest_unsettled_age_s: q.oldestUnsettledAge,
        low_balance: balanceFlux !== null && balanceFlux < d.cfg.minTreasuryFlux,
      }),
    );
  });

  // ---- Voucher admin (dashboard proxies here with the bridge admin token) ----
  app.get('/internal/vouchers', { config: { rateLimit: false } }, async (req, reply) => {
    if (!requireAdmin(req, reply)) {
      return reply;
    }
    const q = req.query as { campaign?: string; status?: string; limit?: string; offset?: string };
    const status: VoucherStatus | undefined =
      q.status === 'active' || q.status === 'revoked' ? q.status : undefined;
    const rows = deps.vouchers.list({
      ...(q.campaign !== undefined ? { campaign: q.campaign } : {}),
      ...(status !== undefined ? { status } : {}),
      limit: Math.min(Number(q.limit) || 100, 500),
      offset: Number(q.offset) || 0,
    });
    return reply.send(
      ok({ vouchers: rows.map((v) => ({ ...v, display_code: displayCode(v.code) })) }),
    );
  });

  app.post('/internal/vouchers', { config: { rateLimit: false } }, async (req, reply) => {
    if (!requireAdmin(req, reply)) {
      return reply;
    }
    const b = req.body as {
      type?: string;
      value?: number;
      count?: number;
      code?: string;
      campaign?: string;
      max_redemptions?: number;
      per_code_limit?: number;
      expires_at?: number | null;
    };
    if (b.type !== 'grant_days' && b.type !== 'stripe_discount') {
      return badRequest(reply, 'bad_request', "type must be 'grant_days' or 'stripe_discount'");
    }
    const value = Number(b.value);
    if (!Number.isInteger(value) || value < 1) {
      return badRequest(reply, 'bad_request', 'value must be a positive integer');
    }
    if (b.type === 'grant_days' && value > 360) {
      return badRequest(reply, 'bad_request', 'grant value is capped at 360 days');
    }
    const campaign = b.campaign ?? '';
    if (!/^[\w][\w .:-]{0,39}$/.test(campaign) && campaign !== '') {
      return badRequest(
        reply,
        'bad_request',
        'campaign must be 1-40 chars: letters, digits, space, . : - _',
      );
    }
    const maxRedemptions = b.max_redemptions === undefined ? 1 : Number(b.max_redemptions);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100_000) {
      return badRequest(reply, 'bad_request', 'max_redemptions must be an integer 1..100000');
    }
    const perCodeLimit = b.per_code_limit === undefined ? 1 : Number(b.per_code_limit);
    if (!Number.isInteger(perCodeLimit) || perCodeLimit < 0 || perCodeLimit > 1000) {
      return badRequest(reply, 'bad_request', 'per_code_limit must be an integer 0..1000');
    }
    if (b.type === 'stripe_discount') {
      if (value > 100) {
        return badRequest(reply, 'bad_request', 'percent_off is capped at 100');
      }
      if (!d.stripe) {
        return reply
          .code(409)
          .send(err(409, 'stripe_disabled', 'the Stripe rail is not configured on this bridge'));
      }
    }
    // Vouchers MINT treasury FLUX: the fleet must honor day grants first.
    if (b.type === 'grant_days' && value % 30 !== 0 && !cfg.dayGrantsEnabled) {
      return reply
        .code(409)
        .send(
          err(
            409,
            'day_grants_disabled',
            'day-granular vouchers need the gateway fleet on the pro-rata rule (DAY_GRANTS_ENABLED)',
          ),
        );
    }
    const hasVanity = typeof b.code === 'string' && b.code.length > 0;
    const count = Number(b.count ?? (hasVanity ? 1 : NaN));
    if (hasVanity && count !== 1) {
      return badRequest(reply, 'bad_request', 'a vanity code creates exactly one voucher');
    }
    if (!hasVanity && (!Number.isInteger(count) || count < 1 || count > 1000)) {
      return badRequest(reply, 'bad_request', 'count must be 1..1000');
    }
    let codes: string[];
    if (hasVanity) {
      const canonical = normalizeCode(b.code!);
      if (canonical === null) {
        return badRequest(
          reply,
          'bad_request',
          'vanity code must be 6-20 chars from the unambiguous alphabet (no 0/O/1/I/L)',
        );
      }
      if (b.type === 'grant_days' && canonical.length < 8) {
        return badRequest(reply, 'bad_request', 'grant vanity codes must be at least 8 chars');
      }
      if (deps.vouchers.byCanonicalCode(canonical)) {
        return reply.code(409).send(err(409, 'exists', 'this code already exists'));
      }
      codes = [canonical];
    } else {
      codes = Array.from({ length: count }, () => generateCode());
    }
    const expiresAt = b.expires_at ? Number(b.expires_at) : null;
    let stripeIds: { couponId: string; promoIds: string[] } | undefined;
    if (b.type === 'stripe_discount') {
      stripeIds = await d.stripe!.provisionDiscount(
        value,
        campaign,
        codes,
        maxRedemptions,
        expiresAt,
      );
    }
    const rows = deps.vouchers.createBatch(
      { type: b.type, value, campaign, maxRedemptions, perCodeLimit, expiresAt },
      codes,
      stripeIds,
    );
    // Treasury liability estimate. Discount vouchers ALSO settle on-chain
    // (the discounted invoice grants the full plan) — surface the worst
    // case (every redemption an annual plan) so a 100%-off campaign is
    // never an unpriced mint; fiat revenue offsets it except at 100% off.
    const projectedZats =
      b.type === 'grant_days'
        ? rows.length * maxRedemptions * zatsForDays(cfg.priceZats, value)
        : rows.length * maxRedemptions * zatsForDays(cfg.priceZats, 360);
    req.log.info({ count: rows.length, type: b.type, value, campaign }, 'vouchers created');
    return reply.send(
      ok({
        codes: rows.map((v) => displayCode(v.code)),
        ids: rows.map((v) => v.id),
        projected_cost_flux: projectedZats / 1e8,
      }),
    );
  });

  app.post(
    '/internal/vouchers/:id/revoke',
    { config: { rateLimit: false } },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) {
        return reply;
      }
      const id = Number((req.params as { id: string }).id);
      const existing = deps.vouchers.byId(id);
      if (!existing) {
        return reply.code(404).send(err(404, 'not_found', 'no such voucher'));
      }
      if (existing.stripe_promo_id && d.stripe) {
        await d.stripe.deactivatePromo(existing.stripe_promo_id).catch((e) => {
          req.log.warn({ err: e, voucher: id }, 'stripe promo deactivation failed');
        });
      }
      const row = deps.vouchers.revoke(id)!;
      // Documented: settled chain grants cannot be clawed back — this only
      // stops future redemptions.
      return reply.send(ok({ id: row.id, status: row.status }));
    },
  );

  app.get('/internal/vouchers/stats', { config: { rateLimit: false } }, async (req, reply) => {
    if (!requireAdmin(req, reply)) {
      return reply;
    }
    const q = req.query as { campaign?: string };
    return reply.send(ok({ campaigns: deps.vouchers.stats(q.campaign) }));
  });

  app.setErrorHandler(
    (error: { statusCode?: number; validation?: unknown; message?: string }, req, reply) => {
      if (reply.statusCode === 429 || error.statusCode === 429) {
        return reply.code(429).send(err(429, 'rate_limited', 'too many requests'));
      }
      if (error.validation || error.statusCode === 400) {
        return reply.code(400).send(err(400, 'bad_request', error.message ?? 'invalid request'));
      }
      req.log.error({ err: error }, 'unhandled route error');
      return reply.code(500).send(err(500, 'internal', 'internal error'));
    },
  );

  return { app, alerter };
}
