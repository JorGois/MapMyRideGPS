# MapMyRideGPS

A web app for managing the maps on a cycling GPS unit and keeping them updated to the latest version published online.

## Decisions so far
- **Device:** iGPSPORT BiNavi
- **Platform:** a web app that runs entirely in the browser, with no backend
- **Device access:** the File System Access API, which works in Chrome and Edge only. The user selects the device's mounted folder.
- **Map source:** OpenStreetMap-based builds
- **Regions:** Portugal and Spain for now. New regions must be easy to add.
- **Storage:** on the device only. App settings are stored in the browser (IndexedDB).

## Planned features
1. Connect: the user picks the GPS folder, and the app finds the maps folder and the map files.
2. Inventory: list the installed maps with region, version or date, and size.
3. Check for updates: compare the installed maps against the latest builds online.
4. Update: download the new map, back up the old one (optional), and write it to the device.
5. Region catalogue: config-driven, so new regions can be added later.

## Device findings (BiNavi, inspected 2026-11-26)
- Mounts as USB mass storage at `/Volumes/BINAVI`, which means the File System Access API can reach it.
- `iGPSPORT/Maps/`: about 11 GB, 163 files. Every file is a standard **Mapsforge binary OSM** file (`mapsforge-map-writer-0.16`, Mercator).
  - There are 3 files per country, all starting with a 2-letter code (`PT`, `ES`, ...):
    - `XX0000<YYMMDD><hash>.map`: the base map. For example, `PT00002412212M02C80FW07V` → build date 2024-12-21.
    - `XX00A0<YYMMDD><hash>.map`: a secondary layer (probably POI/names). Dated the same way.
    - `XX0000C.map`: contour lines (`ele=` tags). This file has no date in its name.
- The device keeps 3 manifests for each folder, one line per file in `NAME:value` form:
  - `map_size_list.cfg`: starts with `MAP_NUM:<count>` and `MAP_VER:101`, then gives each file's size in bytes.
  - `map_checksum_list.txt`: each file's **unsigned sum of all its bytes**. Verified on `PT0000C.map`.
  - `map_md5_list.cfg`: an MD5 that does NOT match the file on disk. It is probably the MD5 of the downloaded package.
- `iGPSPORT/Router/`: about 14 GB of proprietary routing graphs. Each country has 5 files, `XX0000{E,N,R,S,W}.rtd`, with the same 3 manifests.
- The map theme is configured in `Maps/map_theme.cfg` and `Maps/map_highcontrast.cfg`.

## Implications
- An update means: replace the PT/ES files, then rewrite the size/checksum/md5 entries in the manifests (and the count).
- The browser can compute sizes and byte sums while streaming each file.

## Online sources (researched 2026-11-26)
- **Official catalog:** `GET https://prod.en.igpsport.com/service/web/api/Map/MapInfoList?mapVersionId=<id>&language=en`. It returns CORS headers, so the browser can call it. Response: `{code:0, data:[tree of {name, subList, mapVersion, mapSize, mapPathUrl}]}`.
  - With `mapVersionId=1f504832-9c67-11ef-a0af-000c29d603cc`, Portugal (`PT0000.zip`) and the Spanish regions (`ES0100`…`ES1900`) come back with version **20260420**.
  - That package holds only `Maps/PT0000<date><geo>.map`. It has no `00A0` layer, no contours and no Router. It is most likely the catalog for older devices (BSC300/iGS630), not the BiNavi one.
  - The ZIP downloads (`qw20191008.oss-us-west-1.aliyuncs.com`) send **no CORS headers**, so a page running only in the browser cannot download them.
- **Community tool:** [TKlerx/igpsport-map-updater](https://github.com/TKlerx/igpsport-map-updater) (Apache-2.0) builds Mapsforge maps from OSM using Osmosis + mapsforge-writer (Java). It has experimental BiNavi support and reuses the official `.rtd` files. Filename format: `CC` + 4-digit product + `YYMMDD` (OSM data date) + a 12-char base36 zoom-13 tile bbox.
- On boot, the device's log prints "map file count is same, no need to clean!", which suggests it checks the manifests.

## Open questions
- The `mapVersionId` for the BiNavi. It could be captured from the iGPSPORT app's traffic.
- Download path: we need a CORS proxy (for example a Cloudflare Worker) or a small local helper.
- Building OSM maps needs Java/Osmosis, which can't run in a browser. It would have to run on a server or as a local CLI.

## How to run
- Dev server, no local Node needed: `docker compose up -d`, then open http://localhost:5173 in **Chrome or Edge**.
- Tests: `docker run --rm -v "$PWD/app":/w -w /w node:22-alpine npm test`
- Build: the same command with `npm run build` → `app/dist/`. It's a static site, so any static host works.

## Hosting on GitHub Pages
- `.github/workflows/pages.yml` builds `app/` and deploys it on every push to `main`. In the repo settings, set Pages → Source to "GitHub Actions".
- One-click download needs a proxy. Deploy `cloudflare/worker.js` (`npx wrangler deploy`, free tier). Then either set the repo variable `DOWNLOAD_PROXY` to the worker URL, or paste the URL into the app's "Download proxy" panel.
- Without a proxy, everything else works and maps are installed by downloading the ZIP manually.

## Code map (`app/src`)
- `lib/manifest.ts`: parses and writes the device manifests (byte-identical round trip, verified on the real BiNavi files).
- `lib/filenames.ts`: decodes map and router filenames (country, product, kind, OSM date, replacement slot).
- `lib/device.ts`: File System Access: connect, list files, read and write manifests, stream files while computing size, byte-sum and MD5.
- `lib/download.ts`: one-click download through the `/oss` proxy (set up in `vite.config.ts`) into browser storage (OPFS). For a hosted build, point `VITE_DOWNLOAD_PROXY` at a proxy such as a Cloudflare Worker.
- `lib/catalog.ts`: the official iGPSPORT catalog (sources are config-driven, so more can be added).
- `lib/ops.ts`: install plan (ZIP or loose .map/.rtd), backup, install, remove regions, manifest health check and repair.
- `lib/mapsforge.ts`: reads Mapsforge headers (build date, bounding box, generator, format version and the BiNavi vendor flag `0x80000003`).
- `MapView.tsx`: Leaflet world map showing the area each installed region covers.
- `App.tsx`: the UI. Device inventory, online catalog sorted newest first, download guide, drop-to-install, removal.

## Rules
- Every install or update backs up the replaced files and manifests first. If no backup folder is set, the user is asked to pick one, and nothing is written until they do.

## Next steps
- [ ] Field test: install the 20260420 PT map (with a backup) and confirm the BiNavi renders it.
- [ ] Find the BiNavi-specific catalog `mapVersionId`, which would bring contours and routing.
- [ ] Third-party source: guide for building maps with TKlerx/igpsport-map-updater, then dropping the result in.
