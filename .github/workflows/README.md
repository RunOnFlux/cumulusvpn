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

### `release-gateway.yml` — Gateway image release

Triggers on tags matching `gateway-v*` (e.g. `gateway-v0.1.0`) and on manual
`workflow_dispatch` (optional `version` input).

- **`build`** — reproducible multi-stage Docker build from `gateway/Dockerfile`
  (`CGO_ENABLED=0`, `-trimpath`, `-buildvcs=false`, stripped `-buildid=`, and a
  `SOURCE_DATE_EPOCH` pinned to the commit time so the digest is deterministic).
  Always runs; uploads the image as a workflow artifact.
- **`push`** — pushes `registry.cumulusvpn.com/cumulusvpn-gateway:<version>` and
  `:latest`, **gated behind repository secrets** `REGISTRY_USER` /
  `REGISTRY_TOKEN`. If those secrets are absent (forks, untrusted PRs) the job
  **no-ops with a clear notice** — the image is built but not published.

## What CD is — and is NOT — automated

| Stage                                      | Automated?                                                    | Where                                     |
| ------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------- |
| Lint / type / test / build (TS + Go)       | ✅ CI on every push/PR                                        | `ci-ts.yml`, `ci-gateway.yml`             |
| Build gateway image                        | ✅ on `gateway-v*` tag / dispatch                             | `release-gateway.yml` (`build`)           |
| Publish image to `registry.cumulusvpn.com` | ⚠️ only when `REGISTRY_USER` + `REGISTRY_TOKEN` secrets exist | `release-gateway.yml` (`push`)            |
| **Deploy / register gateway on Flux**      | ❌ **manual**                                                 | `deploy/scripts` (see `deploy/README.md`) |

On-chain **register/deploy to the Flux network is deliberately manual**: it
requires a funded wallet and signing key, which CI never holds. Run it by hand
from `deploy/scripts` after the image is published. See `deploy/README.md`.

### Required secrets (optional — for publishing only)

| Secret           | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `REGISTRY_USER`  | Username for `registry.cumulusvpn.com`       |
| `REGISTRY_TOKEN` | Password/token for `registry.cumulusvpn.com` |

Set them under **Settings → Secrets and variables → Actions**. Without them CI
and the image build still pass; only the registry push is skipped.

## Running the same checks locally

```bash
# All TypeScript workspaces (format:check + lint + typecheck + test):
yarn check

# Gateway:
cd gateway && gofmt -l . && go vet ./... && go test ./... -race
```
