# MapMyRideGPS: missing features and ideas

This compares MapMyRideGPS with the community **igpsport-map-updater** projects, then lists ideas of our own.

Projects reviewed (all Apache-2.0):

- [fernandoglatz/igpsport-map-updater](https://github.com/fernandoglatz/igpsport-map-updater): a Java desktop app, last pushed 2026-11-24.
- [TKlerx/igpsport-map-updater](https://github.com/TKlerx/igpsport-map-updater): a CLI and scripts fork, with experimental BiNavi packaging.
- [xyuelin/igpsport-map-updater](https://github.com/xyuelin/igpsport-map-updater): a fork of TKlerx, with the BiNavi experimental README.

_Last updated: 2026-11-26._

---

## 1. What we already do that they don't

| Feature | MapMyRideGPS | Community tools |
|---|---|---|
| Runs in the browser, nothing to install | ✅ | ❌ (Java app / CLI) |
| Writes straight to the device and updates all 3 manifests (size, byte-sum, MD5) | ✅ | ❌ (copy by hand) |
| Verified backup that is mandatory by default, with a skip option | ✅ | ❌ (README advice only) |
| Restore from a backup (Restore tab) | ✅ | ❌ |
| Installs routing (`.rtd`) and contours from official packages | ✅ | ❌ (main `.map` only) |
| Removes regions to free space | ✅ | ❌ |
| Storage bar with "after this change" preview | ✅ | ❌ |
| Manifest health check and repair | ✅ | ❌ |
| One-click official download (with proxy) | ✅ | ✅ (desktop) |
| Detects the device model and shows only matching catalogs | ✅ | ✅ |
| World map of installed coverage | ✅ (online OSM tiles) | ✅ (offline) |
| English + Portuguese UI | ✅ | ❌ |

---

## 2. Features they have that we're missing

### High value

1. **Building maps from fresh OpenStreetMap data.** _Source: both projects._
   - **How they do it:** download a [Geofabrik](https://download.geofabrik.de/) `.osm.pbf` extract, then run Osmosis with the Mapsforge writer (`mapsforge-map-writer-0.27.0`) and an iGPSPORT tag profile.
   - **The tag profile:** 21 supported tags and 12 transformations. For example, footways, paths and sidewalks become cycleway, and motorway becomes trunk. They write `zoom-interval-conf=13,13,13,14,14,14`.
   - **The build tooling:** memory and threads are tuned automatically, a build that runs out of memory is retried in disk mode, and downloads are resumed and cached.
   - **Why we can't just copy it:** Osmosis is Java and needs a lot of memory, so it can't run in the browser **unchanged**. A browser build is possible (Java compiled to WebAssembly, a WASM port, or pure TypeScript with disk-backed indexes); see [`BROWSER-MAP-BUILDER.md`](BROWSER-MAP-BUILDER.md).
   - **Other options:**
     - (a) A Docker image (`docker run mapmyridegps/builder PT`) whose output is dropped into the app.
     - (b) A scheduled cloud job (GitHub Actions) that publishes ready-made BiNavi-format packages. Check the ODbL attribution and licence terms first.
     - (c) A local helper the web app talks to.
   - **Data:** in this format, OSM data from November 2026 against the official June 2026 release.
2. **Matching each installed map to an OSM region.** _Source: fernandoglatz._
   - **How:** decode the 12-character area code in the filename (zoom-13 tile box) and compare it with region outlines from openstreetmap.fr, Geofabrik and OSM boundaries, giving a confidence score.
   - **Review:** the user can review or override each match. Confirmed matches are saved (`maps.csv`).
   - **Why it matters:** this is the prerequisite for item 1 (which extract rebuilds which file).
   - **We already have:** the area-code decoding (checked against the real Portugal, Spain and France files) and the bounding box from the map headers.
3. **The catalog-per-product table.** _Source: fernandoglatz `Product.java`._
   - **What it is:** every iGPSPORT model mapped to its catalog ID. V1 = `1f504832-…` (BSC300/iGS630), V2 = `20a0bbc3-9c67-11ef-a0af-000c29d603cc` (models not yet confirmed), V3 = `a959751a-21b5-44a3-b713-bc12ebb208ef` (BiNavi / BiNavi Air).
   - **Todo:** copy the full table, add V2 and all models to `BUILTIN_SOURCES[].models`.
4. **Refusing unsupported devices with a clear reason.** _Source: fernandoglatz._
   - **What:** detect the **BiNavi Ultra** (`.imap` format, not Mapsforge), devices with no maps, and unknown formats, and show why they aren't supported instead of failing later.
   - **Folders:** skip `Backup` folders found on the device.

### Medium value

5. **Side-by-side map viewer.** _Source: fernandoglatz._ It renders the original and the new map next to each other, with panning and zooming locked together.
   - **Idea for us:** render the Mapsforge files in the browser to preview a map before installing it, for example with a Mapsforge JS renderer or a WASM build.
   - **Why it matters:** it would answer the question "will this map look right?" without risky device tests (see the OpenAndroMaps test in §4).
6. **An offline world map.** _Source: fernandoglatz (Natural Earth, bundled)._ Ours loads tiles from tile.openstreetmap.org.
   - **Idea:** bundle a small Natural Earth GeoJSON (about 100 KB) as the fallback when offline or when the tile server is blocked.
7. **A per-product catalog picker that greys out installed regions.** _Source: fernandoglatz._
   - **We have:** status pills and the "Only regions on my GPS" filter.
   - **Missing:** greying out what's installed, and caching downloaded originals between sessions.
8. **Patching the map header's `created_by` and checking the tag profile.** _Source: TKlerx `patch_mapsforge_header.py`, igs630 profile._
   - **Why:** some devices crash on maps with an unexpected header or tag set. TKlerx keeps a stricter "igs630" profile and copies the original `created_by` (`mapsforge-map-writer-0.16.Q`).
   - **Useful for us:** a pre-install check that warns when a map's tag counts or header look unlike the device's own maps. We already compare the vendor flag (`0x80000003`).
9. **Package manifests.** _Source: TKlerx `package_maps.py`._ Each generated ZIP contains `MANIFEST.txt` (generator commit, input files, maps included). Useful for traceability in our backups too.

### Low value / not applicable

10. **Self-update and installers** for Windows, Linux and macOS. _Source: fernandoglatz._ Not needed: a web app is always up to date.

---

## 3. Our own ideas

### Reliability (the BiNavi links at USB 1.1, 12 Mb/s, and has dropped off twice during long transfers)

- **Resumable, chunked install.**
  - **How:** write in 8–16 MB chunks with checkpoints in IndexedDB. If the device disconnects, resume from the last verified chunk instead of starting over.
  - **Order:** switch the manifests only after every file of a package is verified.
- **Read-back verification:** after writing, re-read the file from the device and compare its byte-sum and MD5 with what we sent. It's slow over USB 1.1, so make it optional ("Verify after install").
- **Connection watchdog:** if no progress for 60 s, show "the GPS stopped responding, unplug and replug it" with a **Resume** button.
- **Install one country at a time** from multi-country selections, with a summary at the end.
- **"Pre-flight" check:**
  - enough free space, including the backup on the computer;
  - device battery level, if readable from `System/device_log.txt`;
  - GPS screen-awake advice.

### Usability

- **Update all:** one button to update every installed region that has a newer version, as a queue with an overall progress bar and time estimate.
- **Notifications:**
  - a browser notification when an install finishes and the tab is in the background;
  - optionally a PushNotification-style reminder when new catalog versions appear (check weekly).
- **Changelog per region:** "your map: 2024-12-21 → available: 2026-06-20", plus size difference and what's included (contours or routing).
- **Restore improvements:**
  - **Restore last backup** in one click straight after an install;
  - an automatic "undo" that keeps the last backup handle per region;
  - deleting old backups from within the app.
- **Region picker on the world map:** click any country, including ones not installed, to see and install the catalog map. This needs catalog bounding boxes, which could come from the V3 package filenames.
- **Spain sub-regions:** suggest the whole-country package vs. individual regions depending on free space.
- **Guided first run:** a 3-step wizard (connect GPS → choose backup folder → check updates).
- **More languages:** Spanish, French, German (the BiNavi is popular in Europe). The i18n structure is ready.
- **Accessibility:** keyboard navigation in the plan and tables, `aria-live` for progress, colour-blind-safe status colours on the map.

### Device insight

- **Device panel:**
  - firmware version (already read from `Device.bin`), map format version, total maps and routing size, and the date of the oldest map;
  - a link to iGPSPORT firmware notes.
- **Parse `System/device_log.txt`:** show map load errors after an install ("map file count is same, no need to clean!" shows the device checks the manifests), to confirm the GPS accepted the new maps.
- **The unexplained MD5:** the device's `map_md5_list.cfg` doesn't match file MD5s. Investigate whether it's the MD5 of the package ZIP entry, and whether writing the file MD5 has any effect, by comparing the V3 package against what the iGPSPORT app writes.
- **Disk usage discrepancy:** macOS reports 2.9 GB used, but the files add up to 25 GB. Find out what the BiNavi really stores, so the free-space estimate can be trusted.

### Distribution

- **GitHub Pages + Cloudflare Worker:** the workflow and worker are ready (`.github/workflows/pages.yml`, `cloudflare/worker.js`). Deploy and set `DOWNLOAD_PROXY`.
- **PWA:** installable app with an offline shell; catalog cached for offline browsing.
- **Shareable "map recipe":** export a list of regions and sources as JSON to set up a second device or a friend's identically.

---

## 4. Lessons from testing on the device (2026-11-26)

- **Format:** the BiNavi's preloaded maps are Mapsforge **v3 with the vendor flag** (`0x80000003`). The V1 catalog serves plain v3, and OpenAndroMaps / mapsforge.org serve **v5** (about 10× bigger, with a different tag set). Only the **V3 catalog** matches.
- **OpenAndroMaps test:** abandoned. The 780 MB copy stalled after about 36 MB had actually reached the device, and the BiNavi then disconnected. Lesson: big transfers need resumable writes (see §3).
- **Chrome:** `FileSystemFileHandle.move()` is refused on USB drives. Write directly to the final name; Chrome's `.crswap` swap file already makes the write safe.
- **macOS** writes `._*` AppleDouble files on FAT drives. Remove them after every write, so the GPS never sees `._X.map`.
- **Backups must go on the computer.** A backup on the GPS itself failed (0-byte copy) and doesn't protect anything.

---

## 5. Suggested next steps

1. Resumable, chunked install with a connection watchdog (§3), since the device is unreliable for large transfers.
2. The full product→catalog table, including V2, plus refusing unsupported devices (§2.3, §2.4).
3. "Update all" queue and "Restore last backup" shortcut.
4. Deploy to GitHub Pages with the Cloudflare Worker.
5. Spike: a Docker-based OSM → BiNavi builder (§2.1), checked on the device with a small region (e.g. Ceuta, 61 KB) before trying Portugal.
