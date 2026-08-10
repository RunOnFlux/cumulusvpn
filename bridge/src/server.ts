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

import type { Config } from './config.js';
import { isValidPaymentCode } from './codes.js';
import { err, ok } from './envelope.js';
import type { PaymentsRepo } from './db/payments.js';
import type { SubscriptionsRepo } from './db/subscriptions.js';
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
  readonly chain: ChainClient;
  readonly treasuryAddress: string;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
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
      ? new StripeRail(cfg.stripe, cfg.priceZats, deps.payments, deps.subs, app.log)
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
            },
          },
        },
      },
      async (req, reply) => {
        const { payment_code, plan } = req.body as {
          payment_code: string;
          plan: 'monthly' | 'annual';
        };
        if (!isValidPaymentCode(payment_code)) {
          return badRequest(
            reply,
            'bad_code',
            'payment_code is not a valid CumulusVPN payment code',
          );
        }
        const session = await stripe.createCheckout(payment_code, plan);
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
            months: outcome.months,
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
            months: outcome.months,
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
            months: r.months,
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
    if (req.headers.authorization !== `Bearer ${d.cfg.adminToken}`) {
      return reply.code(401).send(err(401, 'unauthorized', 'bad token'));
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

  return app;
}
