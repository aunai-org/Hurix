# HD Cloud Tiles and Sliding Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Add an **HD** switch that loads sharper, about 2.4 km cloud tiles around where you are looking when you zoom in. (B) Make the replay slide the clouds along their real motion between frames, instead of fading one frame into the next.

**Architecture:**
- **Pipeline.** `reproject.py` is split into reusable `load_sats()` and `stitch(LON, LAT, sats)`. A new `tiles.py` stitches the world at 16384 × 8192 in latitude bands and cuts it into 512 px tiles. A new `flow.py` uses OpenCV's DIS optical flow on each pair of consecutive replay frames (storm IR, storm true colour, globe) and writes a small motion PNG per pair.
- **Page.** The cloud-shell shader samples a 6 × 6-tile "HD window" atlas when HD is on, you are zoomed in and the replay is paused. Every replay shader warps frame A forward and frame B back along the motion field before blending them. Where no motion file exists, it falls back to today's hold-then-fade.

**Tech Stack:** Python 3.13 (numpy, scipy, netCDF4, Pillow, opencv-python-headless 4.12.0.88), three.js + Vite + TypeScript, vitest, pytest.

**Spec:** omr's request in the project thread, 2026-10-23 13:12–13:16 UTC: "add a switch for 2 and implement 3 if we can". These refer to the two Windy techniques in my 13:12 reply:
- (2) "Map tiles instead of one big picture: zooming in loads sharper tiles for just that area."
- (3) "Computed in-between frames … clouds slide instead of fading, so it stays sharp and smooth."

## Global Constraints

- The hourly GitHub Actions run (`scripts/refresh-live.sh`) must never fail because of tiles or flow. A failure in `tiles.py` or `flow.py` prints a line and the run carries on without that layer.
- The HD switch is off by default. Its label is **HD**. Its tooltip reads "Load sharper cloud tiles (about 2.4 km) around where you look when you zoom in".
- Tile grid: 32 columns × 16 rows of 512 px (world 16384 × 8192). Tile `r_c` is row `r` from the north, column `c` from 180° W. Files are `data/tiles/{r}_{c}.jpg`, IR code JPEG at quality 85, same coding as `ir_global.jpg`. Tiles are skipped where live coverage is zero.
- `meta.json` gains `"tiles": {"cols": 32, "rows": 16, "size": 512, "have": ["r_c", ...]}` and `"flow": {"ir": 48, "vis": 64, "globe": 16}`. The flow numbers are the maximum displacement in source pixels that the 8-bit encoding covers.
- Motion files:
  - Storm IR: `loop/mNN.png`, motion from `fNN` to `fNN+1`.
  - Storm true colour: `loop/wNN.png`, from `vNN` to `vNN+1`.
  - Globe: `globe/mNN.png`, from `gNN` to `gNN+1`. The last one goes from the last `g` frame to `ir_global.jpg`.
  - Grids are 128 × 128 for storms and 256 × 128 for the globe.
  - RGB PNG, with R = 128 + dx/max·127 and G = 128 + dy/max·127. dx and dy are in source pixels, with dy pointing down the image.
- The page works unchanged with an old `meta.json` that has no `tiles` or `flow`: no HD tiles, and the replay holds then fades as today.
- Requirements pin `opencv-python-headless==4.12.0.88`.

## Review Focus

1. **The window crosses the dateline** (camera at 179° E): the atlas wraps columns and the shader's inside-window test uses `fract`. Covered by `windowRect wraps across the dateline` (Task 3).
2. **Window at the poles**: the window rows clamp to the grid and never index row −1 or row 16. Covered by `tileWindow clamps rows near the pole` (Task 3).
3. **A replay pair with no motion file** (a frame skipped, or `flow.py` failed): that pair falls back to hold-then-fade. Covered by `blendFor falls back to hold without flow` (Task 5).
4. **Motion larger than the encoding range** (a fast storm, or the 30-min gap in the 24 h replay): it clips at ±max instead of wrapping around. Covered by `test_encode_clips` (Task 2).
5. **HD on while the replay plays**: tiles are hidden, because they show only the latest frame. Checked in Task 4's Playwright step.

---

### Task 1: Reusable stitching and the tile pyramid

**Files:**
- Modify: `pipeline/reproject.py` (split into functions; the CLI output `stitched_{W}.npz` stays the same)
- Create: `pipeline/tiles.py`, `pipeline/tests/test_tiles.py`
- Modify: `pipeline/run.sh` (run `tiles.py "$D"` after `export.py`, with `|| echo "tiles: skipped"`)

**Interfaces:**
- Produces:
  - `reproject.grid(lon_deg: ndarray, lat_deg: ndarray) -> (LON, LAT)` in radians.
  - `reproject.load_sats(here) -> list` of satellite sources.
  - `reproject.stitch(LON, LAT, sats) -> (bt, ht, cov)`.
  - `tiles.tile_lonlat(r, c, cols=32, rows=16, size=512) -> (lon_deg, lat_deg)` 1-D pixel-centre arrays.
  - `tiles.main(out_dir)` writes the tiles and returns the `have` list. It also updates `meta.json["tiles"]` when `meta.json` exists.

- [ ] **Step 1: Write the failing tests.** In `test_tiles.py`:
  - `test_tile_lonlat_corners`: `tile_lonlat(0, 0)` gives lon[0] = −180 + 360/16384/2 and lat[0] = 90 − 180/8192/2. `tile_lonlat(15, 31)` gives lon[−1] = 180 − 360/16384/2 and lat[−1] = −90 + 180/8192/2. Both have length 512.
  - `test_tile_lonlat_matches_global_grid`: `tile_lonlat(7, 16)` lon[0] equals the 16384 global grid's lon[16·512].
- [ ] **Step 2: Run** `python3 -m pytest pipeline/tests/test_tiles.py -q`. Expected: FAIL (no module `tiles`).
- [ ] **Step 3: Refactor `reproject.py`.**
  - `load_sats` reads each satellite's arrays once: GOES-19 and GOES-18 C13 + ACHA, plus the Himawari tiles.
  - `stitch` holds today's best-view blend for any LON/LAT grid. The module-level script runs only under `if __name__ == "__main__"`.
  - Then implement `tiles.py`. For each of the 16 rows it stitches the 16384 × 512 band. It blends the archival clouds like `export.py` (archival alpha bilinear-resized to the band). It saves each tile with any coverage > 0 and writes the `have` list into meta.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then run `python3 -W ignore pipeline/reproject.py 4096` against the cached frame and check that `stitched_4096.npz` is byte-identical in `bt` (np.array_equal with NaNs equal) to the copy saved before the refactor.
- [ ] **Step 5:** Run `tiles.py` on a test data folder. Expected: about 300–512 tiles, total < 30 MB, peak RSS < 3 GB (`/usr/bin/time -v`), time < 3 min.
- [ ] **Step 6: Commit** "Stitch the world in 2.4 km tiles for HD zoom".

### Task 2: Motion between replay frames

**Files:**
- Create: `pipeline/flow.py`, `pipeline/tests/test_flow.py`
- Modify: `pipeline/requirements.txt` (`opencv-python-headless==4.12.0.88`), `pipeline/run.sh` (run `flow.py "$D"` last, with `|| echo "flow: skipped"`)

**Interfaces:**
- Produces:
  - `flow.motion(a: ndarray[uint8], b: ndarray[uint8], grid: tuple[int, int]) -> ndarray[float32, (gh, gw, 2)]`: dx, dy in source pixels, from a to b.
  - `flow.encode(f, max_px) -> PIL.Image` and `flow.decode(img, max_px) -> ndarray`.
  - `flow.interpolate(a, b, f_full, t) -> ndarray`: the shader's math in numpy, used by tests.
  - `flow.main(out_dir)` writes the m/w files and `meta["flow"]`.

- [ ] **Step 1: Write the failing tests.**
  - `test_motion_finds_a_shift`: two 256² images with a Gaussian blob (σ 12 px) at (100, 120) and then at (106, 116). The median motion in the blob region is (6, −4) ± 1.
  - `test_encode_round_trip`: within max/127.
  - `test_encode_clips`: dx = 3·max decodes to +max.
  - `test_interpolate_moves_the_blob_halfway`: at t = 0.5 the peak is within 1 px of (103, 118) and its value is ≥ 0.9 of the original peak. A plain cross-fade gives two half-height peaks.
- [ ] **Step 2: Run** `python3 -m pytest pipeline/tests/test_flow.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `motion`: `cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)` on the full-res uint8 images, then area-resize to `grid` with `cv2.resize(..., interpolation=cv2.INTER_AREA)`.
  - `interpolate`: `A(p − t·F(p))·(1 − t) + B(p + (1 − t)·F(p))·t` with bilinear `cv2.remap`.
  - `main`: for each storm, writes `mNN` for consecutive `fNN` and `wNN` for consecutive `vNN`, and the globe `mNN` (the last pair ends at `ir_global.jpg` resized to 2048 × 1024). Each storm is in its own try/except.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5:** Run `flow.py` on test data. Expected: under 2 minutes for 3 storms, and the motion files total < 3 MB.
- [ ] **Step 6: Commit** "Motion fields between replay frames".

### Task 3: HD window maths (page)

**Files:**
- Create: `src/hdr/tiles.ts`, `src/hdr/tiles.test.ts`

**Interfaces:**
- Produces:
  - `type TileGrid = { cols: number; rows: number; size: number; have: string[] }`.
  - `tileWindow(lat: number, lon: number, g: TileGrid, n = 6): { r0: number; c0: number }`, the window's top-left tile, so (lat, lon) sits in the middle.
  - `windowRect(r0: number, c0: number, g: TileGrid, n = 6): [u0, v0, du, dv]` in global UV, with v up.
  - `windowTiles(r0, c0, g, n = 6): { id: string; i: number; j: number }[]`, only the tiles in `have`. `i` and `j` are the column and row inside the window.

- [ ] **Step 1: Write the failing tests:**
  - `tileWindow centres the view`: at lat 0, lon 0 it gives `{r0: 5, c0: 13}`.
  - `tileWindow clamps rows near the pole`: at lat 89 → r0 0; at lat −89 → r0 10.
  - `windowRect wraps across the dateline`: at lon 179, c0 is 29 and u0 is 29/32. Tiles with j = 3..5 map to columns 0..2.
  - `windowTiles skips missing tiles`.
- [ ] **Step 2: Run** `npx vitest run src/hdr/tiles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `src/hdr/tiles.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** with Task 4.

### Task 4: HD switch on the page

**Files:**
- Modify: `src/hdr/glsl.ts` (CLOUDS: uniforms `hd`, `hdRect`, `hdOn`), `src/hdr/scene.ts` (atlas canvas 3072², loader, `setHD(on)` on Globe), `src/meta.ts` (`tiles?: TileGrid`), `index.html` (Layers group: `<button id="hd">HD</button>` next to Paths), `src/ui.ts` (toggle)

**Interfaces:**
- Consumes: Task 3's functions, and `meta.tiles`.
- Produces: `Globe.setHD(on: boolean): void`.

- [ ] **Step 1: Shader.**
  - In CLOUDS, `irAt(vUv)` is replaced by `cloudCode(vUv)`.
  - `cloudCode` returns `mix(irAt(uv), texture2D(hd, d / hdRect.zw).r, a)` when `hdOn > 0.5` and `d = vec2(fract(uv.x − hdRect.x), uv.y − hdRect.y)` lies inside `[0, hdRect.zw)`. Here `a` is the atlas texel's alpha, which is 1 where a tile has loaded.
  - The Earth's cloud shadows stay on the base map.
- [ ] **Step 2: Scene.**
  - Each frame, `hdOn = hd && !playing && camera distance < 2.0 && meta.tiles`.
  - When the window from `tileWindow(camera sub-point)` changes, clear the atlas canvas, then fetch and draw that window's tiles (at most 6 concurrent fetches; stale responses are dropped by a ticket). Set `needsUpdate` and update `hdRect`.
- [ ] **Step 3: UI.** Add `#hd` (aria-pressed false; tooltip per Global Constraints). Hide the button when `meta.tiles` is missing.
- [ ] **Step 4: Verify** with `npm test` and `npm run build`. Then take Playwright shots on the test data with HD off and on, at 1440 × 900, zoomed in with `--wheel`:
  - The HD shot must be visibly sharper. The Laplacian ratio HD/off from `scripts/sharpness.py` should be ≥ 1.3.
  - With the replay playing, the HD shot equals the off shot (tiles hidden).
- [ ] **Step 5: Commit** "HD switch: sharper cloud tiles when zoomed in".

### Task 5: Sliding replay on the page

**Files:**
- Modify: `src/hdr/glsl.ts` (shared `FLOW` chunk, plus `codeAt`, `irAt` and `visAt` in IMAGERY, CLOUD_TOPS, the 3D storm volume and the globe shaders), `src/hdr/scene.ts` (load the m/w motion textures with the frames, and set `frameFlow`/`visFlow`/`irFlow` with their `*FlowMax` uniforms), `src/hdr/loop.ts` + `src/hdr/loop.test.ts` (new), `src/meta.ts` (`flow?: { ir: number; vis: number; globe: number }`)

**Interfaces:**
- Consumes: Task 2's file names and encoding, and `meta.flow`.
- Produces: `blendFor(f: number, hasFlow: boolean): number` in `src/hdr/loop.ts`. It returns `f` with motion, and `hold(f)` without. `hold` moves here from `scene.ts`, and `hold.test.ts` moves with it.

- [ ] **Step 1: Write the failing test** `loop.test.ts`: `blendFor(0.5, true)` is 0.5, `blendFor(0.5, false)` is 0, and `blendFor(0.9, false)` equals `hold(0.9)`.
- [ ] **Step 2: Run** `npx vitest run src/hdr/loop.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `loop.ts`.**
  - Add the GLSL helper `vec2 flowAt(sampler2D m, vec2 uv, vec2 maxUv)`, which decodes `(rg·255 − 128)/127·maxUv` and flips y for texture space.
  - Sample A at `uv − t·F` and B at `uv + (1 − t)·F`, mixed by t.
  - With no motion file, bind a 1×1 neutral (128, 128) texture, which gives zero motion.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Verify.** In numpy, mid-pair `flow.interpolate` on Vance's real 30-min true-colour pair keeps ≥ 0.9 of the still's sharpness. Then a Playwright replay on the test data shows no console errors, and the 16 replay shots keep a sharpness ratio ≥ 0.85 against the paused still.
- [ ] **Step 6: Commit** "Replay slides clouds along their motion".

### Task 6: Docs and ship

- [ ] README (controls: HD; replay slides) and `docs/spec.md` (new pipeline steps `tiles.py` and `flow.py`, the `data/tiles` and `m/w` files, the meta fields).
- [ ] Run `python3 -m pytest pipeline/tests -q && npm test && npm run build`. Expected: all pass.
- [ ] Do a full pipeline run into a scratch folder. Report the time and size added: tiles ≈ MB, flow ≈ MB, total run time vs. 9 min.
- [ ] Commit, final review, then push and open the PR.
