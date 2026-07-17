# Bundled sidecar binaries

Tauri resolves external binaries by **target-triple suffix**. The userspace
`wireguard-go` tunnel goes here, one per platform you build for:

```
wireguard-go-x86_64-apple-darwin
wireguard-go-aarch64-apple-darwin
wireguard-go-x86_64-pc-windows-msvc.exe
wireguard-go-x86_64-unknown-linux-gnu
```

`tauri.conf.json` references it as `binaries/wireguard-go`; the CLI picks the
matching triple at build time (`externalBin`). At runtime the Rust tunnel layer
resolves it (`CVPN_WIREGUARD_GO` override → next to the app exe → this dir) and
spawns it — see `src/tunnel/wggo.rs::resolve_wireguard_go`.

## Building / vendoring

Run the fetch script — it builds `wireguard-go` from a pinned upstream commit
with the Go toolchain (pure Go, `CGO_ENABLED=0`, so cross-compiles need no C
toolchain) and drops the binary here with the right triple suffix:

```
scripts/fetch-wireguard-go.sh                      # host triple
scripts/fetch-wireguard-go.sh x86_64-unknown-linux-gnu   # cross-build
```

Build every triple you ship before `yarn tauri build`, or the bundler fails with
`resource path binaries/wireguard-go-<triple> doesn't exist`.

## Licence

`wireguard-go` is **MIT-licensed** (© Jason A. Donenfeld / WireGuard LLC). The
full text is written next to the binary as `wireguard-go.LICENSE` by the fetch
script. MIT permits redistribution inside our installers.

The committed `wireguard-go-*` binaries and `wireguard-go.LICENSE` are build
outputs of `scripts/fetch-wireguard-go.sh`; regenerate rather than edit.
