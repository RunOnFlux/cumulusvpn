# CI/CD — CumulusVPN monorepo

GitHub Actions pipelines for the monorepo. Three workflows: two continuous
integration (TypeScript/JS and Go) and one release pipeline for the gateway
container image.

## Workflows

### `ci-ts.yml` — TypeScript / JavaScript CI

Runs on push to `main` and on pull requests that touch `clients/**`,
`deploy/**`, or the shared root config (`package.json`, `yarn.lock`,
`tsconfig*.json`, `.prettierrc`, `.prettierignore`, `.yarnrc.yml`).

- **`workspaces`** — a matrix over the three root Yarn workspaces
  (`@cumulusvpn/core`, `@cumulusvpn/web`, `@cumulusvpn/desktop`). One immutable
  install (`yarn install --immutable`) is shared, then per package:
  `format:check → lint → typecheck → test → build`.
- **`mobile`** — `clients/mobile` is a **standalone** React Native package with
  its own `yarn.lock` (not a root workspace). Installs independently and runs
  `format:check → lint → tsc --noEmit → test`. No bundler/build step in CI —
  store builds happen on native runners.
- **`deploy`** — `deploy/` is likewise standalone. Pure Node (`.mjs`), so it
  runs `lint → format:check → test` (no typecheck/build).

Node 22, Corepack-pinned Yarn 4.5.0, Yarn cache keyed per lockfile.

### `ci-gateway.yml` — Go CI

Runs on push to `main` and PRs touching `gateway/**`. Go 1.25.

- **`gateway`** — `gofmt -l` (fails if anything is unformatted), `go vet`,
  `go build ./...`, then `go test ./... -race -covermode=atomic` with a coverage
  summary.
- **`golangci`** — `golangci-lint` as an **advisory** job (`continue-on-error`),
  so deeper static analysis is visible but never blocks a merge.

### `gateway-image.yml` — Gateway image → GHCR (public)

Builds `gateway/Dockerfile` and publishes to the **GitHub Container Registry**,
`ghcr.io/runonflux/cumulusvpn-gateway` — **no external secrets** (uses the
built-in `GITHUB_TOKEN` via `packages: write`).

Triggers & tags:
- **push to `main`** (paths `gateway/**`) → `:latest` + `:sha-<short>`
- **tag** `vX.Y.Z` or `gateway-vX.Y.Z` → `:X.Y.Z` (+ `:X.Y`) and `:latest`
- **pull request** → build only, no push (smoke test)

One-time setup: make the GHCR **package public** (repo/org → Packages → the
package → visibility → Public) so Flux nodes pull it without auth. The app spec
then just references `ghcr.io/runonflux/cumulusvpn-gateway:<tag>` — `repoauth`
stays empty. Currently `linux/amd64` (the Flux fleet is overwhelmingly x86-64);
add `linux/arm64` to `platforms:` once the Dockerfile is confirmed cross-arch.

## What CD is — and is NOT — automated

| Stage                                 | Automated?                        | Where                                     |
| ------------------------------------- | --------------------------------- | ----------------------------------------- |
| Lint / type / test / build (TS + Go)  | ✅ CI on every push/PR            | `ci-ts.yml`, `ci-gateway.yml`             |
| Build + publish gateway image to GHCR | ✅ push to main / tag             | `gateway-image.yml`                       |
| **Deploy / register gateway on Flux** | ❌ **manual**                     | `deploy/scripts` (see `deploy/README.md`) |

On-chain **register/deploy to the Flux network is deliberately manual**: it
requires a funded wallet and signing key, which CI never holds. Run it by hand
from `deploy/scripts` after the image is published. See `deploy/README.md`.

> Actions must be unblocked for any of this to run. On a **private** repo,
> GitHub bills Actions minutes — if the org's billing/spending-limit is blocked,
> **no job starts** (this is why the first runs failed). Fix org
> **Settings → Billing & plans**, or make the repo public (free unlimited Actions).

## Running the same checks locally

```bash
# All TypeScript workspaces (format:check + lint + typecheck + test):
yarn check

# Gateway:
cd gateway && gofmt -l . && go vet ./... && go test ./... -race
```
