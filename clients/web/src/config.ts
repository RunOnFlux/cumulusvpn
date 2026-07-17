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

// localStorage key under which the in-browser WireGuard keypair is persisted so
// the payment code stays stable across the Connect and Upgrade pages.
export const KEYPAIR_STORAGE_KEY = 'cvpn.keypair.v1';

// localStorage key for the theme override ('light' | 'dark'); absent = system.
export const THEME_STORAGE_KEY = 'cvpn.theme';
