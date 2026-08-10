/**
 * Global brute-force breaker for voucher redemption: when too many
 * INVALID-code attempts (codes that don't exist / are revoked — the only
 * outcomes a guesser can produce) arrive within the window, the endpoint
 * closes for everyone for a cooldown and the operator is paged. Legitimate
 * failures on real codes (expired/exhausted/already_redeemed) never count.
 *
 * In-process state is correct here: the bridge is single-instance by design
 * (same reasoning as the SQLite queue).
 */
export class InvalidAttemptBreaker {
  private attempts: number[] = [];
  private openUntil = 0;

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly cooldownMs: number,
    private readonly onTrip: () => void,
  ) {}

  /** True while the breaker is open (endpoint should refuse with 429). */
  isOpen(now = Date.now()): boolean {
    return now < this.openUntil;
  }

  /** Record one invalid-code attempt; trips the breaker at the threshold. */
  recordInvalid(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    this.attempts = this.attempts.filter((t) => t > cutoff);
    this.attempts.push(now);
    if (this.attempts.length > this.maxAttempts && !this.isOpen(now)) {
      this.openUntil = now + this.cooldownMs;
      this.attempts = [];
      this.onTrip();
    }
  }
}
