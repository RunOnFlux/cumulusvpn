/**
 * Operator alerting — plain webhook POSTs (Discord/Slack-compatible
 * `{ text, content }` body), throttled per condition so a stuck queue pages
 * once every 6 h, not once per retry.
 */
import type { FastifyBaseLogger } from 'fastify';

const THROTTLE_MS = 6 * 3600 * 1000;

export class Alerter {
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Fire-and-forget an alert, at most once per THROTTLE window per kind. */
  async alert(kind: string, message: string): Promise<void> {
    this.log.warn({ kind }, `alert: ${message}`);
    if (!this.webhookUrl) {
      return;
    }
    const last = this.lastSent.get(kind) ?? 0;
    if (Date.now() - last < THROTTLE_MS) {
      return;
    }
    this.lastSent.set(kind, Date.now());
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `[cumulusvpn-bridge] ${message}`,
          content: `[cumulusvpn-bridge] ${message}`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      this.log.error({ err: e }, 'alert webhook delivery failed');
    }
  }
}
