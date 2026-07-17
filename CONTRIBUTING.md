# Contributing to CumulusVPN

Thanks for your interest! CumulusVPN is an open, decentralized VPN that runs on
the [Flux network](https://runonflux.io). It's **pre-launch and in active
development** — the apps build and the gateway is tested, but there's no live
network yet (see the README banner). Contributions, issues, and ideas are
welcome.

## Repository layout (monorepo)

| Path         | What                                                             | Stack                    |
| ------------ | --------------------------------------------------------------- | ------------------------ |
| `gateway/`   | Userspace WireGuard exit gateway + chain scanner + control API  | Go                       |
| `clients/`   | `core-ts` shared logic · `web` · `desktop` (Tauri) · `mobile` (RN) | TypeScript / Rust / native |
| `deploy/`    | Flux v8 app specs + generate/encrypt/register tooling           | Node (ESM)               |
| `docs/`      | Architecture, payments, multi-hop, the byte-level API contract  | —                        |
| `brand/`     | Icon + wordmark masters and generated assets                    | SVG / PNG                |

Start with `docs/01-architecture.md` and `docs/10-api-contract.md` — the API
contract is the byte-level source of truth every component conforms to.

## Dev setup

Requires **Node 22 + Yarn 4** (Corepack), **Go 1.25+**, and (for native builds)
Rust, Xcode, and the Android SDK.

```bash
# TypeScript workspaces (core-ts, web, desktop):
yarn install
yarn check                 # format:check + lint + typecheck + test across workspaces

# Mobile (standalone):
cd clients/mobile && yarn install && npx tsc --noEmit && yarn test

# Gateway:
cd gateway && gofmt -l . && go vet ./... && go test ./...
```

## Before you open a PR

Every change must pass the same gates CI runs:

- **TypeScript:** `format:check` (Prettier), `lint` (ESLint), `typecheck` (tsc,
  strict), `test` (Vitest/Jest), `build`.
- **Go:** `gofmt` clean, `go vet`, `go build ./...`, `go test ./...`.
- **Exact dependency versions** — no `^` or `~` ranges (repo policy).
- If you change client↔gateway behavior, update `docs/10-api-contract.md` and
  keep both sides in sync (the gateway is the reference).

Keep PRs focused, write a clear description, and add tests for new logic. For
anything security-sensitive (crypto, the forwarder, entitlements, key handling),
see [`SECURITY.md`](SECURITY.md) and flag it in the PR.

## Licensing

Contributions are accepted under the repository's [MIT license](LICENSE). By
opening a PR you agree your contribution is licensed under the same terms.
Third-party vendored code (e.g. `clients/mobile/ios/vendor/wireguard-apple`)
keeps its own license — don't relicense it.
