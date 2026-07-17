# App + tray icons

`tauri.conf.json` expects the standard icon set here. Generate it from a single
1024×1024 source with:

```
yarn tauri icon path/to/logo.png
```

which produces `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico`, and platform tray assets.

<!-- POC: icons are not committed; run `yarn tauri icon` before `tauri build`. -->
