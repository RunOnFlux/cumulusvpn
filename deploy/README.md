# deploy

Flux app specs, registration/renewal scripts, image publishing.
Reference: [`../docs/02-flux-deployment.md`](../docs/02-flux-deployment.md).

## Run note (standalone package)

This directory is its own package (`@cumulusvpn/deploy`) — it is **not** a root workspace, so it
keeps its own `yarn.lock`. Node 20+, yarn 4.

```bash
cd deploy
yarn install                                  # installs the one dep (yaml) via node-modules linker

node scripts/generate.mjs --stage beta        # countries.yaml → specs/plain + specs/onchain
node scripts/generate.mjs --stage beta --check# also fetch eligible node counts (network, best-effort)
node scripts/validate.mjs                      # assert the v8 enterprise shape on every onchain spec

node directory/make-directory.mjs keygen                          # one-time: Ed25519 signing key (SECRET)
node directory/make-directory.mjs build --payment-address t1...   # assemble + sign → directory.signed.json
node directory/make-directory.mjs verify                          # check sig against embedded pubkey
```

Generated `specs/plain/*`, `specs/onchain/*`, `directory/*.key`, and `directory/directory.signed.json`
are all gitignored (they hold secrets or are build artifacts). `directory/directory.json` is the
committed **unsigned sample/template**.

## Enterprise apps (decided)

Every CumulusVPN spec is an **enterprise v8 app** with `datacenter: true`. This gives us three
things at once:

- **Datacenter-only placement** — instances land on KYC'd ArcaneOS datacenter nodes, not
  residential ones (better throughput, much better legal/abuse posture — see docs/06).
- **Private image** — pulled from `registry.cumulusvpn.com` via `repoauth` (enterprise-only).
- **Hidden deployment** — the `enterprise` field is an encrypted blob, so the image, env, and
  registry creds don't appear in the public marketplace/app list.

Honest tradeoffs (docs/08): enterprise nodes are fewer and cost more (+0.8 FLUX scope surcharge,
enterprise-owner whitelist required), and hiding the image is _deployment privacy_, not security —
the gateway source stays open, and anyone running our client still learns the endpoints.

## Two-layer specs

```
deploy/
  countries.yaml            # fleet manifest (source of truth): cc → geo, instances, sizing
  specs/
    template.json           # on-chain enterprise wrapper (reference)
    plain/template.json     # plaintext inner {contacts, components} (reference)
    plain/cumulus<cc>.json    # GENERATED, SECRET (gitignored): image + repoauth + env
    onchain/cumulus<cc>.json  # GENERATED: v8 wrapper; `enterprise` filled by encrypt.mjs
  scripts/
    generate.mjs   # countries.yaml → plain/ + onchain/  (--check queries eligible node counts)
    validate.mjs   # assert every onchain/<name> matches the v8 enterprise shape (pre-flight)
    encrypt.mjs    # plain/<name> + env secrets → encrypted `enterprise` blob in onchain/<name>
    register.sh    # verify → price → sign (ZelID) → /apps/appregister → pay w/ OP_RETURN hash
    renew.sh       # renew specs nearing expire, whole fleet; run from cron + alerting
    scale.sh       # bump a country's instances → regenerate → re-encrypt → re-register
    price-update.sh# retarget CVPN_PRICE_FLUX across the fleet on FLUX/USD drift (72h grace)
  directory/
    directory.json         # UNSIGNED sample/template (committed)
    make-directory.mjs     # keygen | build | sign | verify — Ed25519-signed directory.json (node:crypto)
    directory.key          # GENERATED, SECRET (gitignored): signing key; ship only the pubkey
    directory.signed.json  # GENERATED (gitignored): signed artifact served from cumulusvpn.com
```

## Pipeline

```
edit countries.yaml
  → node scripts/generate.mjs --stage beta --check      # writes plain/ + onchain/, warns on coverage
  → REGISTRY_AUTH=… PAYMENT_ADDRESS=t1… DIRECTORY_PUBKEY=… node scripts/encrypt.mjs cumulusvpnde
  → ./scripts/register.sh cumulusvpnde                      # sign + broadcast + pay
```

Fleet strategy and the scale-out ladder (Beta ~50 instances / 12 countries → GA ~200 / 30 →
Scale ~1000 / 60+) live in `../docs/02-flux-deployment.md`. Requires: private registry at
`registry.cumulusvpn.com`, and our owner ZelID on the Flux enterprise whitelist.

> Secrets never touch git: `plain/` and `onchain/` generated files are gitignored, and
> encrypt.mjs injects `repoauth`/addresses from the environment.
