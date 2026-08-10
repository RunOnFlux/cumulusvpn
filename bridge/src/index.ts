/**
 * Boot: config -> db -> rails -> server -> workers. Fails fast on any
 * config gap; the treasury WIF is decoded once and only the derived address
 * ever leaves this scope.
 */
import { loadConfig } from './config.js';
import { openDb } from './db/db.js';
import { PaymentsRepo } from './db/payments.js';
import { SubscriptionsRepo } from './db/subscriptions.js';
import { ChainClient } from './flux/chain.js';
import { treasuryKeyFromWif } from './flux/tx.js';
import { buildServer } from './server.js';
import { Alerter } from './worker/alerts.js';
import { startBroadcaster } from './worker/broadcaster.js';
import { startConfirmer } from './worker/confirmer.js';
import { startLoop } from './worker/loop.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const payments = new PaymentsRepo(db);
const subs = new SubscriptionsRepo(db);
const chain = new ChainClient(cfg.explorerUrl, cfg.explorerFallbackUrl);
const key = treasuryKeyFromWif(cfg.treasuryWif);

const app = await buildServer({ cfg, payments, subs, chain, treasuryAddress: key.address });

const alerter = new Alerter(cfg.alertWebhookUrl, app.log);
const workers = [
  startBroadcaster({
    chain,
    payments,
    key,
    paymentAddress: cfg.paymentAddress,
    feeZats: cfg.feeZats,
    alerter,
    log: app.log,
  }),
  startConfirmer(chain, payments, app.log),
  // Treasury monitor: low balance + stuck queue, every 10 minutes.
  startLoop('monitor', 10 * 60 * 1000, app.log, async () => {
    const q = payments.queueStats();
    if (q.oldestUnsettledAge !== null && q.oldestUnsettledAge > 3600) {
      await alerter.alert(
        'stuck-queue',
        `oldest unconfirmed payment is ${Math.round(q.oldestUnsettledAge / 60)} min old (${q.pending} pending, ${q.broadcast} broadcast)`,
      );
    }
    const balance = await chain.balanceZats(key.address).catch(() => null);
    if (balance !== null && balance / 1e8 < cfg.minTreasuryFlux) {
      await alerter.alert(
        'low-balance',
        `treasury balance ${(balance / 1e8).toFixed(2)} FLUX below minimum ${cfg.minTreasuryFlux}`,
      );
    }
  }),
];

const shutdown = async (): Promise<void> => {
  for (const w of workers) {
    w.stop();
  }
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info(
  {
    rails: { stripe: !!cfg.stripe, apple: !!cfg.apple, google: !!cfg.google },
    treasury: key.address,
  },
  'cumulusvpn-bridge up',
);
