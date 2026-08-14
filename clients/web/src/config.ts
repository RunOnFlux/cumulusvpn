/**
 * Build-time constants for the CumulusVPN web client.
 *
 * The directory public key is shipped in every client and is the root of trust
 * for gateway discovery: the signed `directory.json` (live, cached, or bundled)
 * must verify against it before any endpoint is trusted. See docs/10.
 */

// Ed25519 directory signing pubkey (base64), matching `sign_pubkey` in the
// signed directory artifact produced by deploy/directory/make-directory.mjs.
// POC: a real release pins the production key here and rotates via app update.
export const DIRECTORY_PUBKEY = '1e+42nEpmdjf/cAHs+yE2E2iwmAADpWiLy1VMepsKKw=';

// Path the signed directory is served from (this app hosts it at /directory.json).
export const DIRECTORY_URL = '/directory.json';

// Approximate USD reference shown next to the FLUX price. Cosmetic only — the
// canonical price is `price_flux` from the signed directory (chain-anchored).
export const PRICE_USD_APPROX = '$0.99';

// Fiat (card) subscription prices. Display-only — the authoritative prices
// live in Stripe; keep in sync with the bridge's STRIPE_PRICE_* products.
// Fiat costs more than FLUX deliberately: it absorbs processor fees plus the
// treasury payout that settles the entitlement on-chain (docs/18).
export const PRICE_USD_MONTHLY = '$1.99';
export const PRICE_USD_ANNUAL = '$14.99';

// Payments-bridge origin (Stripe checkout, payment status). docs/18.
export const BRIDGE_URL = 'https://pay.cumulusvpn.com';

// localStorage key for a payment-code override handed in via #/upgrade?code=…
// (the desktop app deep-links here with ITS code so the payment credits the
// desktop key, not the browser's). Persisted across the Stripe redirect.
export const PAY_CODE_OVERRIDE_STORAGE_KEY = 'cvpn.paycode.override.v1';

// localStorage key for the unix-seconds timestamp of the last checkout we
// started. The post-return status poll ignores bridge payments created
// before it — a renewing subscriber's PREVIOUS confirmed payment must not
// flash an instant (false) "Confirmed!" for the checkout they just made.
export const PAY_CHECKOUT_STARTED_STORAGE_KEY = 'cvpn.paycheckout.started.v1';

// localStorage key for `{ [payment code]: checkout session id }` of completed
// card purchases. The session id is the ONLY capability that opens a Stripe
// billing portal (cancel / change card / switch plan): there are no accounts,
// and the payment code cannot authorize it — gateways receive the pubkey it is
// derived from, so operators could open their own users' portals. Keyed by
// code because the desktop hand-off (`?code=`) manages a different device's
// subscription from the same browser. Lost with the browser profile, which is
// why Stripe's receipt emails stay the documented fallback.
export const PAY_PORTAL_SESSIONS_STORAGE_KEY = 'cvpn.payportal.sessions.v1';

// localStorage key under which the in-browser WireGuard keypair is persisted so
// the payment code stays stable across the Connect and Upgrade pages.
export const KEYPAIR_STORAGE_KEY = 'cvpn.keypair.v1';

// localStorage key for the gateway behind the last issued .conf (ip + server
// pubkey + country + issue time). Lets a return visit detect that the gateway
// was replaced — the one failure a static .conf can neither survive nor report,
// since the stock WireGuard client has no control channel.
export const ISSUED_CONFIG_STORAGE_KEY = 'cvpn.issued.v1';

// localStorage key for the theme override ('light' | 'dark'); absent = system.
export const THEME_STORAGE_KEY = 'cvpn.theme';

// localStorage key for the chosen UI locale; absent = detect from the browser.
export const LOCALE_STORAGE_KEY = 'cvpn.locale';
