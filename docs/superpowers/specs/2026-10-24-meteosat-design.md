# Meteosat over Europe, Africa and the Indian Ocean — design

**Status:** for review · 2026-10-24 · data source chosen by omr: EUMETSAT's public map service (no account)

## 1. What we're building, and why

Today Hurrix shows live clouds from GOES-19, GOES-18 and Himawari-9. Between about 30° W and 80° E (Europe, Africa, the
Indian Ocean) it shows archival clouds, and storms there (for example Agueda 02S) are listed without imagery.

This change adds two Meteosat satellites so the whole ring is live:

| Satellite | Sits above | Sees | Layer on the map service | Every |
|---|---|---|---|---|
| **Meteosat-12** (MTG-I1, FCI) | 0° | Europe, Africa, the eastern Atlantic | `mtg_fd:ir105_hrfi` (10.5 µm) | 10 min |
| **Meteosat-9** (MSG, SEVIRI, Indian Ocean service) | 45.5° E | the Middle East, the Indian Ocean | `msg_iodc:ir108` (10.8 µm) | 15 min |

**Done means:**
- The globe shows live cloud everywhere geostationary satellites see, with no archival band in the middle.
- The replay, the HD tiles and the 24 h globe replay use Meteosat in that area too.
- Official storms there get the same close-up, eye fix, path, loop and sliding replay as the others.
- Meteosat-12 storms, and Indian Ocean storms west of about 65° E, also get true colour in daylight.
- The global cloud-top height map is filled across the middle, from Meteosat's height product.

## 2. Source and calibration

**Service.** EUMETView WMS, `https://view.eumetsat.int/geoserver/ows`.
- It's public and needs no key. Both layers take a `TIME` parameter that goes back years, so loops and the 24 h globe can ask for past slots.
- Requests use `EPSG:4326` (WMS 1.3.0 axis order is lat,lon) and PNG.
- Measured on 2026-10-24: a 1024² request takes 3–6 s, and four in parallel finish in about 8 s. Sizes above 4096 px are refused.

**From pixels to temperature.** The service sends 8-bit images, not temperatures, so each satellite gets a calibration table: grey or count value → brightness temperature in K.

- **Meteosat-12.** We ask for the raw count with an identity style (`SLD_BODY`, a 0→black / 255→white ramp). The count is about linear in temperature, at roughly 0.43 K per step, from about 195 K up to about 304 K. Count 0 means no data.
- **Meteosat-9.** This layer is stored as RGB and rejects a custom style, so we read the default grey (dark is warm). It isn't linear, and it bottoms out near 205 K: anything colder shows as 205 K.
- **How the tables are made.** A script, `python3 meteosat.py calibrate`, quantile-matches each layer against the satellite that overlaps it:
  - Meteosat-12 against GOES-19, over 55–25° W;
  - Meteosat-9 against Himawari-9, over 80–110° E.
  It uses several slots across a day and night, and writes `pipeline/meteosat_cal.json`: 256 values per satellite, monotonic, checked into the repo.
- **Accepted limit.** Cold tops below about 205 K over the Indian Ocean (and below about 195 K under Meteosat-12) look flatter than in GOES or Himawari. Their shape and the eye still show.

**Credit.** EUMETSAT's terms require the credit "© EUMETSAT". It goes:
- in the satellite line at the top of the page,
- in the storm card's source line when a storm is imaged by Meteosat,
- in `third-party-notices.txt`,
- in the README.

## 3. Pipeline

**New module: `pipeline/meteosat.py`.** It owns everything specific to the map service:

- `SATS = {"meteosat12": {...}, "meteosat9": {...}}`. Each entry holds the layer, sub-satellite longitude (0.0 and 45.5), cadence in minutes (10 and 15), whether it takes the raw style, and its display name.
- `slot(sat, when) -> datetime`: the latest time on that satellite's cadence at or before `when`.
- `fetch(sat, when, lat0, lat1, lon0, lon1, w, h) -> np.ndarray`:
  - returns brightness temperature, float32, NaN where there's no data;
  - splits anything over 2048 px into pieces;
  - retries each request 3 times;
  - caches the result as `.npz` under `frames/<sat>/`.
- `class GridDisc`: a regular lat/lon raster with the same `sample(lat, lon)` interface as `storms.Disc`, so the close-up, loop and track code don't need to know where an image came from.
- `disc(sat, when, lat, lon) -> GridDisc`: about 2 km pixels over the box that the 2048 km close-up around (lat, lon) needs.
- `world(sat, when, w, h) -> GridDisc`: the satellite's whole view at a given grid size, for the stitched map, the globe frames and the HD tiles.

**Wiring into what exists:**
- **`storms.py`.**
  - `SATS` / `SAT_NAMES` gain the two Meteosats. `best_sat` and `sat_for` then pick them on their own, because view geometry comes from `view_cos` with the sub-satellite longitude.
  - `closeup()` routes Meteosat to `meteosat.disc`.
  - Loop times follow the satellite's cadence: `loop_times(frame, step)`. Meteosat-9 uses 15 min over the last 6 h and 30 min before that, ending at `slot(frame)`. This keeps the page's 30-minute grid and `flow.replay_pairs` working unchanged.
  - Loop frames for Meteosat are fetched 4 at a time.
- **`reproject.py`.** `load_sats` adds the two Meteosats as lat/lon sources. `view()` handles them by sampling the grid and taking `view_cos` for the weight. The blend rule (the best view wins, feathered with the runner-up at the seams) stays as it is.
- **`globe.py`.** The `COS` stack and `stitch()` gain the two Meteosats, with `near()` using each one's own cadence.
- **`tiles.py`.** It goes through `R.stitch`, so it gets Meteosat at 2.4 km automatically. The Meteosat part comes from about 16 requests of 2048² per satellite, fetched 4 at a time.
- **`visible.py`.** True colour comes from `mtg_fd:rgb_truecolour`, which is already an RGB image, so it needs no calibration.
  - Meteosat-12 storms get it.
  - So do Meteosat-9 storms that Meteosat-12 still sees at view cosine ≥ 0.3 (the western Indian Ocean, to about 65° E).
  - Meteosat-9 has no true-colour layer of its own, so storms further east show infrared only, as Himawari storms do at night.
- **Cloud-top height.** `msg_fes:cth` and `msg_iodc:cth` (every 15 min) only come as a coloured picture, and the colour scale isn't published. Decoding it:
  - `python3 meteosat.py calibrate` also builds `cth` in `meteosat_cal.json`: a colour → height (km) table. It's made by matching `msg_fes:cth` against GOES-19 ACHA over 55–25° W, taking the median ACHA height per colour bucket (RGB quantised to 4 bits per channel, buckets with fewer than 50 samples dropped).
  - It also records the colours that mean "no cloud" or "no data".
  - `meteosat.cth(sat, when, …)` decodes a request with that table.
  - For Meteosat-12's area, the height comes from `msg_fes:cth`. That's Meteosat-10 or -11 at 0°: the height is a different satellite's product, but the same place and time.
  - `reproject.py` uses these heights where GOES ACHA has none, so the global height map is filled across the middle.
  - The calibration check prints the median difference against ACHA, which should come out under about 1 km. If decoding fails, heights there stay NaN as now: the 3D views work out heights from temperature, as they do for Himawari.

**Failure handling.**
- Meteosat is an extra, so a run never fails because of it.
- If a Meteosat fetch fails for the main map, that satellite is left out and the area falls back to archival clouds as it does today. The run logs `meteosat9: skipped (<reason>)`.
- A storm whose Meteosat close-up fails goes to `others`, as any storm does today.

**Time.** About +5–8 min per run, mostly storm loops and HD tiles. Runs take about 20 min now, so they'd take about 25–28, well inside the hour.

## 4. Page

- **Satellite line:** "LIVE IR · Himawari-9 · GOES-18 · GOES-19 · Meteosat-12 · Meteosat-9 © EUMETSAT".
- **Legend:** the "archival clouds … Meteosat isn't in this feed yet" hint goes. Where coverage is still missing (the poles), the existing grey archival treatment explains itself.
- **Storm card:** the source line names the Meteosat satellite and adds "© EUMETSAT".
- The front end needs no logic changes: storms carry their own `satellite` and `loopTimes`, and the replay reads times from them.
- **Docs:** `docs/spec.md` (sources table, §11 limits, the "Add Meteosat" note), the README data line and the limits paragraph.

## 5. Testing

**Unit tests (pytest, no network):**
- `slot()` on both cadences;
- the calibration table is monotonic and maps known counts to the fitted K;
- the cloud-top height decoder maps table colours to their heights, and returns NaN for "no cloud" and for unknown colours;
- `GridDisc.sample` with bilinear sampling, NaN outside, wrap at ±180;
- request building: lat,lon axis order, the identity style only for Meteosat-12, splitting large requests;
- `loop_times` at a 15-minute step keeps the 30-minute grid;
- `stitch()` with a fake lat/lon source fills the middle gap.

**Calibration check:** the calibrate script prints the residual against the overlapping satellite. It should come out under about 3 K median.

**End to end:** a full local run with today's data. Coverage in `stitched_4096.npz` should be about 1 between 70° S and 70° N. An Indian Ocean or Africa storm, if one is active, should get a close-up and a loop. The run log should show no "skipped" lines.

**On screen:** Playwright screenshots of the globe over Africa and the Indian Ocean, before and after.

## 6. Not in this change

- EUMETSAT Data Store (raw files): the later upgrade if the calibrated values ever fall short.
- Meteosat-9 natural colour: it's false colour (green land, cyan ice clouds), and it would clash with the true colour everywhere else.
- Rapid-scan Europe.
- INSAT-3D and FY-4.
