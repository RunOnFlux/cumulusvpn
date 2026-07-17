# Security Policy

CumulusVPN is a privacy product — a security bug here can expose users. We take
reports seriously and appreciate coordinated disclosure.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email **security@cumulusvpn.com** (or **info@cumulusvpn.com** until the security
alias is live). Include:

- what the issue is and where (component + file/endpoint if known),
- how to reproduce it, and
- the impact you think it has.

If you want to encrypt the report, ask for our PGP key in a first (contentless)
message and we'll reply with it.

We aim to acknowledge within **72 hours** and to keep you updated as we work a
fix. Please give us a reasonable window to remediate before any public
disclosure; we're happy to credit you (or keep you anonymous — your choice).

## Scope

In scope — anything that could compromise user privacy, traffic, or funds:

- the **gateway** (`gateway/`): WireGuard handling, the exit forwarder, the
  entitlement/chain scanner, the control API (enroll/status/info), rate limiting;
- the **clients** (`clients/`): key generation and storage, config building,
  discovery + directory-signature verification, the payment flow;
- the **deploy** tooling and app specs (`deploy/`): anything that could let a
  malicious spec or image reach the fleet.

Out of scope: findings that require a already-compromised device or OS; issues in
third-party dependencies (report those upstream — e.g. wireguard-go,
wireguard-apple, gVisor — though we still want to know); and the documented,
labeled pre-launch gaps (see the README banner and `docs/`).

## What we do and don't hold

By design there is **no user database, no accounts, and no traffic or connection
logging** — so there is very little to leak or subpoena. Payment is a public
on-chain fact keyed to a WireGuard public key; identity is the key itself. This
posture is part of the product, and reports that undermine it are especially
valuable.

## Please avoid

Testing that harms users or third parties: no traffic interception of other
users, no DoS/load testing against live gateways, no attacks on Flux node
operators' machines, and no automated scanning that degrades the network. Use
your own keys and your own test deployment.
