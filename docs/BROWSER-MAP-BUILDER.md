# Building iGPSPORT maps in the browser: feasibility and design

**Question:** can MapMyRideGPS turn fresh OpenStreetMap data (a Geofabrik `.osm.pbf` extract) into BiNavi-format Mapsforge maps entirely in the browser, with no Java, no server and no install?

**Short answer:** yes, it's possible. The community tools use **Osmosis plus the Mapsforge map writer**, and that Java pipeline can't run as-is in a page. Doing the same job in the browser is a matter of engineering effort and memory management, not a hard limit. This document corrects the earlier note in `FEATURE-GAP.md` that called it impossible.

_Status: design only, no code yet. Written 2026-11-26._

---

## 1. What the build pipeline actually does

The community pipeline (TKlerx/fernandoglatz `script.sh`):

```
osmosis --read-pbf-fast file=<country>.osm.pbf
        --bounding-polygon file=<country>.poly
        --tag-transform file=tag-igpsport-transform.xml     # 12 rules, e.g. path/footway → cycleway
        --bounding-box …
        --mapfile-writer file=out.map type=ram|hd
             zoom-interval-conf=13,13,13,14,14,14
             tag-conf-file=tag-igpsport.xml                 # 21 tags kept
```

| Step | Work | Difficulty in a browser |
|---|---|---|
| 1. Read PBF | protobuf blocks, zlib-compressed: nodes, ways, relations | **Easy**: JS/WASM PBF readers exist |
| 2. Clip to polygon / bbox | point-in-polygon on nodes, cut ways | Easy |
| 3. Tag transform + filter | rewrite and keep about 21 tags | **Trivial**: just a lookup table |
| 4. Build way geometries | look up every node of every way (node ID → lat/lon) | **The hard part:** memory (see §3) |
| 5. Assemble multipolygons | water, forests and landuse from relations | Medium |
| 6. Tile and simplify | assign POIs/ways to zoom-13/14 tiles; Douglas-Peucker per zoom level | Medium |
| 7. Write the Mapsforge v3 binary | header, tag tables, tile index, sub-files; VBE-encoded deltas | Medium. The spec is public and we already **read** these headers (`lib/mapsforge.ts`) |
| 8. Package for iGPSPORT | name `CC0000<YYMMDD><geo>.map`, vendor flag `0x80000003`, manifests | **Already done** in this app |

Steps 7 and 8 are where we're closest: the app already parses Mapsforge headers, encodes the 12-character area code (checked on the PT/ES/FR files), and writes all three manifests.

## 2. Three ways to get there

### Option A: run the existing Java in the browser (fastest to try)

- **CheerpJ** (Java bytecode → WebAssembly/JS) can run unmodified JARs in a page. Load `osmosis` plus `mapsforge-map-writer-0.27.0-jar-with-dependencies.jar` and call the writer with the iGPSPORT tag files.
- **Pros:** the same output as the community tools, and very little code.
- **Cons:**
  - large download (the JVM runtime plus JARs, tens of MB);
  - slow, perhaps 3–10× native;
  - memory limits: `type=ram` needs several GB for Portugal, and `type=hd` needs file I/O that CheerpJ maps onto a virtual file system;
  - CheerpJ's licence must be checked for this use.
- **Verdict:** a good **spike** to prove that the output renders on the BiNavi, using a tiny region first. Probably not the final architecture.

### Option B: a native port compiled to WebAssembly (best performance)

- Write the pipeline in **Rust** (or C++), compile to WASM, run it in a **Web Worker**, and stream data through **OPFS** (the browser's private file system) so it never has to fit in memory.
- **Building blocks:**
  - Rust: `osmpbf` (PBF reading) and `geo` (simplification, clipping), plus our own Mapsforge v3 writer (about 1–2k lines, following the spec).
  - C++: `libosmium` already compiles to WASM, with its node-location index on disk.
- **Pros:** fast (near-native), memory-safe, scales to Spain (about 1.3 GB of PBF).
- **Cons:** the most engineering, plus a Rust/WASM toolchain in the repo. The writer must reproduce the BiNavi's flavour exactly (vendor flag, tag set, zoom intervals).

### Option C: pure TypeScript (simplest stack)

- Write everything in TypeScript in a Web Worker: `pbf` / `osm-pbf-parser` for reading, `fflate` for zlib, and our own tiling and writer code.
- **Pros:** one language, no toolchain, easiest to maintain in this codebase.
- **Cons:** 2–5× slower than WASM; the node index must still be on disk (OPFS) for anything bigger than a small country.
- **Verdict:** fine for **Portugal-sized** regions and small areas. Spain would be slow but possible.

## 3. The real problem: memory (and how to solve it)

- **The problem:** to draw a way, you need the coordinates of all its nodes, and the PBF stores nodes and ways separately.
  - **Portugal:** about 30–40 M nodes × 8 bytes (two int32 microdegrees) = **240–320 MB** if indexed by ID in a typed array. That's feasible in memory.
  - **Spain:** about 150 M+ nodes = **1.2 GB+**. That exceeds comfortable memory for a tab.
- **The fix, as used by osmium/Osmosis "hd" mode:**
  1. **Pass 1:** stream the PBF and keep only the node IDs referenced by **kept** ways. The tag filter drops most ways (buildings, for example), which typically shrinks the node set 3–5×.
  2. **Pass 2:** stream the nodes again and write `id → lat/lon` into a **sorted, disk-backed index in OPFS**, using `FileSystemSyncAccessHandle` (fast synchronous reads and writes in a worker).
  3. **Pass 3:** stream the ways, resolve their coordinates from the index, clip, simplify and write them to per-tile temporary files.
  4. **Pass 4:** concatenate the tiles into the final `.map` file, with the index and header.
- Browser storage quotas allow several GB per site on desktop Chrome, and `navigator.storage.persist()` keeps the data from being evicted.
- **Memory64 (WASM)** in recent Chrome lifts the 4 GB WASM address limit, which helps Option B.

## 4. Estimated cost and effort

| | Portugal (≈ 350 MB PBF) | Spain (≈ 1.3 GB PBF) |
|---|---|---|
| Geofabrik download (needs the proxy: Geofabrik sends no CORS headers) | 1–3 min | 5–10 min |
| Build, Option B (WASM) | ≈ 2–5 min | ≈ 10–20 min |
| Build, Option C (TS) | ≈ 5–15 min | ≈ 30–60 min |
| Peak OPFS usage | ≈ 1–2 GB | ≈ 5–8 GB |
| Copy to the BiNavi (USB 1.1, ≈ 0.8 MB/s) | ≈ 2–4 min (80–170 MB) | ≈ 6–12 min |

All figures are estimates and need measuring in the spike.

**Rough development effort:**

- **Spike A** (CheerpJ + existing JARs, tiny region): **1–3 days**.
- **Option C MVP** (roads, paths, water, place names; no multipolygons): **2–3 weeks**.
- **Option B full** (multipolygons, contours excluded, Spain-scale): **4–8 weeks**.

## 5. What we'd still not generate

- **Routing `.rtd` files** are iGPSPORT's proprietary routing graph; the format is undocumented. The community tools **reuse the official ones**, and so would we.
  - **Consequence:** fresh map data, but navigation keeps using the last official routing data. That's fine for display; turn-by-turn may lag behind new roads.
- **Contours (`XX0000C.map`):** elevation data changes rarely. Reuse the official ones, or later generate from SRTM/Copernicus DEM, which is a separate project.
- **Extra layer (`00A0`):** its exact content still has to be worked out from the official files (likely points of interest and landuse). Until then, keep the official one.

## 6. Risks and open questions

1. **Will the BiNavi render our output?**
   - **Risk:** it expects a vendor-flagged v3 (`0x80000003`), `created_by = mapsforge-map-writer-0.16.Q`, specific tags and zoom intervals, and it may need a matching extra layer.
   - **Mitigation:** byte-compare our output against the official V3 files on a small region (Ceuta, 61 KB, or Andorra), then test on the device with the app's verified backup and Restore tab.
2. **Can the BiNavi take the transfer?** It disconnected during a 780 MB write. Generated maps must be **no larger** than the official ones, so keep the official tag profile and simplification. That also argues for the resumable installs in `FEATURE-GAP.md` §3.
3. **Geofabrik downloads** need a proxy because Geofabrik doesn't allow browser downloads. The proxy also has to respect their usage policy: rate limits, and no hot-linking at scale.
4. **Licensing.** OSM data is **ODbL**, so generated maps need "© OpenStreetMap contributors". Personal use is fine; redistributing built maps (for example a shared cache) brings share-alike obligations. The Mapsforge writer and Osmosis are LGPL, which matters only if we bundle them (Option A).
5. **Mobile and low-RAM laptops** may hit OPFS quota or memory limits. Detect this up front with `navigator.storage.estimate()` and `deviceMemory`, and suggest a smaller region.

## 7. Recommended path

1. **Spike (Option A, 1–3 days):**
   - Build Ceuta or Andorra with CheerpJ and the community JARs and tag files, in the browser.
   - Patch the header to the vendor-flagged v3 / `0.16.Q` `created_by`.
   - Install it with the app (backup + restore) and **confirm the BiNavi renders it**.
   - If it doesn't render, stop: the format, not the browser, is the blocker.
2. **If it renders, choose between Options B and C** based on spike timings for Portugal.
3. **Build the MVP** behind an "Experimental: build from OpenStreetMap" source in the Sources panel:
   - region picker → Geofabrik download → build in a worker with progress → the normal install plan with backup and the existing manifests.
   - Reuse the official contours, extra layer and routing from the V3 package.
4. **Later:**
   - incremental updates (Geofabrik daily diffs);
   - custom areas (draw a box on the world map);
   - "light" profiles to save device space.

---

### References

- Mapsforge binary map file format spec: https://github.com/mapsforge/mapsforge/blob/master/docs/Specification-Binary-Map-File.md
- Mapsforge map writer and tag configuration: https://github.com/mapsforge/mapsforge/tree/master/mapsforge-map-writer
- Community pipeline: [TKlerx/igpsport-map-updater](https://github.com/TKlerx/igpsport-map-updater) (`script.sh`, `tag-igpsport*.xml`), [fernandoglatz/igpsport-map-updater](https://github.com/fernandoglatz/igpsport-map-updater)
- Geofabrik downloads: https://download.geofabrik.de/
- OPFS / `FileSystemSyncAccessHandle`: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- CheerpJ: https://cheerpj.com/
