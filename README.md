# MapMyRideGPS

Manage and update the maps on an **iGPSPORT BiNavi** cycling GPS, straight from your browser. There's nothing to install.

- **Live app:** https://jorgois.github.io/MapMyRideGPS/ (after the Pages workflow has deployed it)
- **Browser:** desktop Chrome or Edge. The app uses the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API), which Firefox and Safari don't support.

> **Unofficial project.** MapMyRideGPS isn't affiliated with, endorsed by or supported by iGPSPORT. "iGPSPORT" and "BiNavi" are trademarks of their owner. Writing to your GPS is at your own risk, so **always keep the backup** the app makes.

## What it does

- **Reads your GPS:** model, firmware, installed regions and their dates, the data source of each map, storage use, and a world map of what's installed.
- **Checks for updates:** compares against iGPSPORT's official map catalog, filtered to the format your device uses (V3 for the BiNavi).
- **Installs updates:** one click downloads, unpacks and installs a region, and updates all three manifest files the GPS checks.
- **Backs up first:** makes a verified backup on your computer before every change. You can skip it if you already have one.
- **Restores backups:** the Restore tab puts a whole backup, or chosen countries, back on the GPS.
- **Cleans up:** removes regions you don't need, checks and repairs the manifests, and removes leftovers from interrupted installs.
- **Speaks your language:** English and European Portuguese.

## Privacy

- **Your files stay on your computer.** Everything runs in your browser. The app has no server, account or analytics.
- **Network requests:**
  - the iGPSPORT catalog (`prod.en.igpsport.com`);
  - map ZIP downloads, through your configured proxy (see below);
  - OpenStreetMap tiles for the world map.
- **Saved settings:** the chosen folders and settings are kept in your browser (IndexedDB / localStorage). **Settings → Clear saved data** removes them.

## Using it

1. Connect the BiNavi by USB and open the app in Chrome or Edge.
2. Press **Connect GPS** and select the `BINAVI` drive (or its `iGPSPORT` folder).
3. Choose a backup folder **on your computer** (not on the GPS).
4. Press **Update** on a region, review the plan and start.

**Be patient.** The BiNavi uses USB 1.1 (about 0.8 MB/s), so a country takes 5–15 minutes. Don't unplug the GPS or let the computer sleep. On macOS, stop Spotlight indexing the GPS first: `sudo mdutil -i off /Volumes/BINAVI`.

## Downloads and the proxy

iGPSPORT's map files are hosted on Aliyun OSS, which doesn't allow downloads from web pages (no CORS headers). So:

- **Local dev:** the Vite dev server proxies `/oss/*` automatically.
- **GitHub Pages:** deploy the small Cloudflare Worker in [`cloudflare/`](cloudflare/) and set its URL as the repo variable `DOWNLOAD_PROXY`, or enter it in the app. The worker only forwards map ZIPs from that one host, and only for the listed origins.
- **No proxy:** download the ZIP yourself and drop it on the app. The app shows a guide.

## Development

Requirements: Docker (or Node 22).

```sh
docker compose up        # dev server on http://localhost:5173
docker run --rm -v "$PWD/app":/w -w /w node:22-alpine sh -c "npm ci && npm test && npm run build"
```

See [`app/README.md`](app/README.md) for the code layout, [`PROJECT.md`](PROJECT.md) for device findings, and [`docs/`](docs/) for the feature roadmap and design notes.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Licence

[Apache-2.0](LICENSE).

- **Map data** © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the ODbL.
- **Official map packages** belong to iGPSPORT and are downloaded from iGPSPORT's servers; this project doesn't redistribute them.
- Prior work: [fernandoglatz/igpsport-map-updater](https://github.com/fernandoglatz/igpsport-map-updater) and [TKlerx/igpsport-map-updater](https://github.com/TKlerx/igpsport-map-updater).
