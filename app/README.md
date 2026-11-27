# MapMyRideGPS: web app

React 19 + TypeScript + Vite. Runs entirely in the browser. See the [main README](../README.md) for what it does and how to use it.

## Commands

```sh
npm ci
npm run dev      # http://localhost:5173 (proxies /oss/* to iGPSPORT's map storage)
npm test         # vitest
npm run build    # type-check and build into dist/
```

There's no local Node? Use Docker from the repo root: `docker compose up`.

## Code map

| File | Purpose |
|---|---|
| `src/App.tsx` | Main UI: connect, installed regions, install and update, catalog, settings |
| `src/RestoreTab.tsx` | Restore tab: find backups and choose what to restore |
| `src/PlanView.tsx`, `src/InstallConfirm.tsx` | Install / restore plan and the confirmation dialog |
| `src/MapView.tsx` | Leaflet world map of installed regions |
| `src/i18n.ts` | English and Portuguese strings. `t()` returns plain text; `tHtml()` escapes variables for HTML |
| `src/sound.ts` | Audio cues |
| `src/lib/device.ts` | Reading and writing the GPS: open device, list files, manifests, write/copy with checks, leftovers |
| `src/lib/ops.ts` | Install planning, backup, install, remove, health check and repair |
| `src/lib/manifest.ts` | The `map_size_list` / `checksum` / `md5` manifest formats |
| `src/lib/filenames.ts` | iGPSPORT file naming (country, slot, date, area code) |
| `src/lib/mapsforge.ts` | Mapsforge map header parser |
| `src/lib/catalog.ts` | Official catalogs (V1/V3), sources, device detection |
| `src/lib/download.ts` | Proxy settings and downloads into browser storage (OPFS) |
| `src/lib/restore.ts` | Finding backup sets |
| `src/lib/settings.ts` | Saved folder handles and settings |

## Security notes for contributors

- Use `tHtml()` whenever a translation goes into `dangerouslySetInnerHTML`. Values such as folder names come from the user's disk.
- Never write backups to the GPS (`isOnDevice` refuses this), and keep backups mandatory by default.
- The production CSP lives in `vite.config.ts`. If you add a new network host, add it there.
