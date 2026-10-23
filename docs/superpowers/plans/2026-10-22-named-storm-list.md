# Named Storm List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List every active tropical system on Earth (tropical depressions and storms, hurricanes, typhoons, cyclones) by its official name, show the name in the storm list and over the storm on the globe, and let any listed storm be selected. Also: each storm's past path colour-coded by intensity (off by default), plain control names in a tidy layout, and a sharp loop in Imagery mode.

**Architecture:** The hourly pipeline stops deciding by itself what counts as a storm. It reads the official active-storm lists from the warning centres instead: NHC for the Atlantic and the East and Central Pacific, and JTWC for the West Pacific, the Indian Ocean and the Southern Hemisphere. Each official storm becomes a candidate at its advisory position. Storms a GOES or Himawari satellite sees well get the real satellite close-up, loop and 3D views as now. Storms no satellite here sees (Indian Ocean, East Atlantic) are still listed and labelled on the globe, without imagery. If both feeds fail, the pipeline falls back to today's infrared detection and labels those storms "Unnamed system".

**Tech Stack:** Python 3.13 standard library only for the feeds (`urllib.request`, `json`, `re`). numpy/scipy pipeline as now. TypeScript, Vite and three.js page. pytest (pipeline) and vitest (page) as dev-only test tools.

**Spec:** omr's request in the project thread (2026-10-22): "list all storm [Tropical, Typhoons, Hurricanes, Cyclones] available, select any of them to see. Name of the storm should be mentioned in list and over the storm location." Added 22:17 UTC: "1 storm path track should show for each storm and off by default - color code checkpoints by intensity data. 2 controls labels should be Easy and Readable - 3D Storm, 3D Clouds Over? what does that mean anyway? 3. Controls should be aligned and well placed. 4. storm animation in imagery mode is so blurry... fix it" Current behaviour is in `docs/spec.md` and `README.md`.

## Global Constraints

- Names, positions, classifications and winds come only from the official feeds. Never invent or guess a name. A storm without an official match is "Unnamed system".
- Feeds: `https://www.nhc.noaa.gov/CurrentStorms.json` and `https://www.metoc.navy.mil/jtwc/rss/jtwc.rss` → the `.tcw` (JMV 3.0) file each RSS item links to. Both were reachable from the cloud sandbox on 2026-10-22, and GitHub Actions runners have open internet.
- Imagery stays real satellite imagery only. A storm without a good satellite view shows no picture, never a drawn one.
- The page must still work when the feeds are down. A feed failure must never fail the hourly run.
- No new runtime dependencies on the page and no new pipeline packages. `pytest` and `vitest` are dev-only.
- The official wind is labelled with its agency ("95 kt · JTWC"). The existing Dvorak-style figure stays labelled "unofficial".
- Path colours follow the Saffir–Simpson scale by official wind (kt): < 34 `#5ebaff` depression, 34–63 `#00faf4` storm, 64–82 `#ffffcc` cat 1, 83–95 `#ffe775` cat 2, 96–112 `#ffc140` cat 3, 113–136 `#ff8f20` cat 4, ≥ 137 `#ff6060` cat 5, and grey `#9aa3ad` when there is no official wind. The legend shows the same scale.
- The paths toggle stays off by default.
- Commits and PRs carry no Claude session links, session ids or "Requested by" lines.

## Review Focus

1. **One feed is down, times out or returns an HTML error page.** Storms from the other feed are still listed, and the run still succeeds. Covered by `test_active_storms_survives_failed_feed` (Task 1).
2. **A storm both centres warn on** (22E Vance appears in NHC and JTWC). It is listed once, with NHC's data. Covered by `test_active_storms_dedupes_nhc_and_jtwc` (Task 1).
3. **Southern-hemisphere and west-longitude positions** (`067S 0497E`, `098N 1013W`). They parse with the right signs. Covered by `test_parse_tcw_*` (Task 1).
4. **An official storm with no deep convection left** (post-tropical Josephine), where `track()` returns no fixes. It is still imaged from its advisory position and does not crash the run. Covered by `test_seed_fixes_without_ir_track` (Task 2).
5. **Zero official storms with a satellite view.** The page still loads, using the IR fallback, and the list still shows the storms without imagery. Covered by `test_choose_storms_falls_back_to_ir` (Task 2).
6. **History lines repeat once per wind-radius row** (in both `.tcw` and b-deck files). Each time appears once in `history`. Covered by `test_parse_tcw_history_dedupes` and `test_parse_bdeck` (Task 4).

---

## File Structure

| File | Responsibility |
|---|---|
| `pipeline/advisories.py` (new) | Fetch and parse the NHC and JTWC feeds into one deduplicated list of official storms |
| `pipeline/tests/test_advisories.py` (new) | Parser tests against the real feeds captured on 2026-10-22 |
| `pipeline/tests/fixtures/` (new, already committed with this plan) | `CurrentStorms.json`, `jtwc.rss`, `wp2926.tcw`, `ep2226.tcw`, `sh0227.tcw` as served on 2026-10-22 22:08 UTC: Josephine (AL10, PTC), Vance (EP22, TS), Champi (WP29, Typhoon), Agueda (SH02, Tropical Cyclone) |
| `pipeline/tests/test_storms_select.py` (new) | Tests for choosing official vs. fallback storms |
| `pipeline/requirements-dev.txt` (new) | `pytest==8.4.2` |
| `pipeline/storms.py` (modify `main`, add 2 helpers) | Official storms drive the close-ups; `meta.others` lists unseen storms |
| `src/meta.ts` (modify) | New optional `Storm` fields and `Meta.others` |
| `src/names.ts` + `src/names.test.ts` (new) | Display name and subtitle for a storm (pure functions) |
| `src/ui.ts` (modify) | Named picker list, named globe labels, card title and official wind |
| `src/hdr/scene.ts` (modify) | `Globe.lookAt(lat, lon)` for storms without imagery |
| `index.html`, `src/style.css` (modify) | Picker as a vertical list |
| `pipeline/advisories.py` (Task 4) | Official past track with wind: the JTWC `.tcw` history block, and the NHC b-deck `https://ftp.nhc.noaa.gov/atcf/btk/b{al}{NN}{YYYY}.dat` |
| `src/hdr/scene.ts` track section (about lines 190–220) | Paths for every storm, dots coloured by wind |
| `src/intensity.ts` + test (new) | Wind → category and colour |
| `pipeline/visible.py:176-177`, `src/hdr/scene.ts` `setLoop` | Sharp loop |
| `index.html` toolbar, `src/style.css`, `src/ui.ts` hints | Control names and layout |
| `README.md`, `docs/spec.md` (modify) | Where names come from; the fallback |

---

### Task 1: Official storm feeds

**Files:**
- Create: `pipeline/advisories.py`, `pipeline/tests/test_advisories.py`, `pipeline/requirements-dev.txt`
- Fixtures: `pipeline/tests/fixtures/*` (already in the repo)

**Interfaces:**
- Produces, in `pipeline/advisories.py`:
  - `Official = dict` with keys `id: str` (basin + number, e.g. `"WP29"`, `"EP22"`, `"AL10"`, `"SH02"`), `name: str` (title case, e.g. `"Champi"`), `kind: str` (sentence case, e.g. `"Typhoon"`), `windKt: int | None`, `pressureMb: int | None`, `lat: float`, `lon: float` (−180..180), `agency: "NHC" | "JTWC"`, `advisory: str` ("YYYY-MM-DDTHH:MMZ").
  - `parse_nhc(doc: dict) -> list[Official]`
  - `parse_jtwc_rss(xml: str) -> list[tuple[str, str]]`, giving `(kind, tcw_url)` per warned storm
  - `parse_tcw(text: str, kind: str) -> Official`
  - `active_storms(get: Callable[[str], str] = http_get) -> list[Official]`: both feeds merged, NHC wins on the same `id`, strongest first (`windKt`, None last). Any exception from one feed is printed (`"advisories: <url> failed: <error>"`) and that feed contributes nothing.
  - `http_get(url: str) -> str`: `urllib.request.urlopen` with a 20 s timeout and a `User-Agent: hurrix (github.com/aunai-org/Hurrix)` header.

- [ ] **Step 1: Write the failing tests** in `pipeline/tests/test_advisories.py` (`FIX = pathlib.Path(__file__).parent / "fixtures"`; import with `sys.path.insert(0, str(FIX.parent.parent))`):
  - `test_parse_nhc`: `parse_nhc(json.load(FIX/"CurrentStorms.json"))` gives ids `["AL10", "EP22"]`, Josephine `kind == "Post-tropical cyclone"`, `windKt == 55`, `pressureMb == 988`, `lat == 40.0`, `lon == -65.8`; Vance `kind == "Tropical storm"`.
  - `test_parse_jtwc_rss`: kinds `["Typhoon", "Tropical storm", "Tropical cyclone"]` and URLs ending `wp2926.tcw`, `ep2226.tcw`, `sh0227.tcw`. (The SH item's closing tag is a malformed `<b>`, so the parser must not depend on `</b>`.)
  - `test_parse_tcw_champi`: `id "WP29"`, `name "Champi"`, `lat 21.9`, `lon 124.3`, `windKt 95`, `advisory "2026-10-22T18:00Z"`, `agency "JTWC"`.
  - `test_parse_tcw_southern_hemisphere`: Agueda `id "SH02"`, `lat == -6.7`, `lon == 49.7`, `windKt 50`.
  - `test_parse_tcw_west_longitude`: Vance from `ep2226.tcw` has `lon < 0` and `id "EP22"`.
  - `test_active_storms_dedupes_nhc_and_jtwc`: with a fake `get` serving the fixtures by URL suffix, the ids are exactly `{"WP29", "AL10", "EP22", "SH02"}`; `WP29` (95 kt) is first and `SH02` (50 kt) last; `EP22` appears once with `agency == "NHC"`.
  - `test_active_storms_survives_failed_feed`: fake `get` raises `OSError` for the NHC URL → result is the three JTWC storms (EP22 from JTWC), no exception.

- [ ] **Step 2: Run them and see them fail**

Run: `pip install -r pipeline/requirements-dev.txt && python3 -m pytest pipeline/tests/test_advisories.py -q`
Expected: errors, `No module named 'advisories'`.

- [ ] **Step 3: Implement `pipeline/advisories.py`**

  These choices aren't pinned by the tests:
  - NHC `classification` → kind: `TD` Tropical depression, `STD` Subtropical depression, `TS` Tropical storm, `STS` Subtropical storm, `HU` Hurricane (Major hurricane when `intensity` ≥ 96), `PTC` Post-tropical cyclone, `PC` Potential tropical cyclone, anything else Tropical cyclone. NHC `id` `"al102026"` → `"AL10"`.
  - JTWC RSS: regex `([A-Za-z ]+?)\s+(\d\d[A-Z])\s+\(([^)]+)\)\s+Warning` on each item's description, plus the first `https://…\.tcw` href in the same item. Items without a warning (for example "Significant Tropical Weather Advisories") are skipped. Kind is sentence case with runs of whitespace collapsed ("Super Typhoon" → "Super typhoon").
  - TCW: line 3 is `YYYYMMDDHH NNB NAME …` and the first line starting `T000` is `T000 DDDH DDDDH WWW …`, in tenths of a degree with hemisphere letters. JTWC basin letter → prefix: `W` WP, `E` EP, `C` CP, `L` AL, `A`/`B` IO, `S`/`P` SH.

- [ ] **Step 4: Run the tests and see them pass**

Run: `python3 -m pytest pipeline/tests/test_advisories.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Commit**: `git add pipeline/advisories.py pipeline/tests pipeline/requirements-dev.txt && git commit -m "Read the active storms from NHC and JTWC"`

---

### Task 2: Official storms drive the pipeline

**Files:**
- Modify: `pipeline/storms.py` (`main` at about lines 302–356; `MAX_STORMS` at line 20)
- Create: `pipeline/tests/test_storms_select.py`

**Interfaces:**
- Consumes: `advisories.active_storms() -> list[Official]` (Task 1).
- Produces, in `pipeline/storms.py`:
  - `seed_fixes(off: Official, fixes: list[dict], frame: datetime) -> list[dict]`: returns `fixes` if non-empty, else `[{"t": frame as "%Y-%m-%dT%H:%MZ", "lat": off["lat"], "lon": off["lon"], "eyeK": 0.0, "ringK": 0.0, "eyeClear": False}]`.
  - `choose(officials: list[Official], sees: Callable[[float, float], str | None]) -> tuple[list[Official], list[Official]]`: splits into `(imaged, others)`. `sees(lat, lon)` returns a satellite key or None (`view_cos < 0.3`). `imaged` is capped at `MAX_STORMS`; the overflow goes to `others`.
  - `meta.json` additions. Each `storms[i]` gains `name`, `kind`, `agencyId` (e.g. `"29W"`, or `"AL10"` for NHC), `agency`, `windKt`, `pressureMb`, `advisory`. These are all absent for IR-fallback storms. A new top-level `others: [{name, kind, agencyId, agency, windKt, lat, lon}]` is always present, possibly empty.
- `MAX_STORMS` → `8`.

- [ ] **Step 1: Write the failing tests** in `pipeline/tests/test_storms_select.py`:
  - `test_seed_fixes_without_ir_track`: `seed_fixes(off, [], frame)` has length 1, with the official lat and lon and `t == "2026-10-22T20:40Z"` for `frame = datetime(2026, 10, 22, 20, 40)`. `seed_fixes(off, [fix], frame) == [fix]`.
  - `test_choose_splits_unseen`: with `sees` returning None for `lon` between 40 and 100, Agueda goes to `others` and the other three go to `imaged`.
  - `test_choose_caps_at_max`: 10 seen officials → 8 imaged and 2 others.
  - `test_choose_storms_falls_back_to_ir`: `choose([], sees) == ([], [])`. (`main` then runs the old IR path. This test pins that `choose` doesn't invent anything.)

  Importing `storms` pulls in numpy, scipy and netCDF4, so run these tests with `pip install -r pipeline/requirements.txt` first.

- [ ] **Step 2: Run them and see them fail**

Run: `python3 -m pytest pipeline/tests/test_storms_select.py -q`
Expected: `AttributeError: module 'storms' has no attribute 'seed_fixes'`.

- [ ] **Step 3: Implement it.** Add the two helpers, then change `main`:
  1. `officials = advisories.active_storms()`, then `imaged, others = choose(officials, lambda la, lo: (s := best_sat(la, lo)) if view_cos(la, lo, SATS[s]) >= 0.3 else None)`.
  2. If `imaged` is non-empty, each one becomes `{"sat": …, "fixes": seed_fixes(off, track(sat, frame, off["lat"], off["lon"]), frame), "off": off}`, with **no** `MIN_SPAN_H` check. Otherwise run the existing candidates and `MIN_SPAN_H` loop unchanged. This keeps the IR fallback.
  3. Keep the existing sort only for the fallback. Official storms keep `active_storms` order (strongest first).
  4. When writing `meta_storms`, merge the official fields from `s.get("off")`. `agencyId` is the JTWC number (`"29W"`) when the agency is JTWC, else the `id`.
  5. Write `meta["others"]` from `others`.
  6. `SystemExit("no storms found…")` stays, for when both official imaged storms and the fallback are empty.

  The close-up is centred on the last fix, as today. With `seed_fixes`, that's the advisory position.

- [ ] **Step 4: Run the tests and see them pass**

Run: `python3 -m pytest pipeline/tests -q`
Expected: `11 passed`.

- [ ] **Step 5: Real run.** `FRAME=<slot 40 min ago> python3 -W ignore pipeline/storms.py /tmp/out` after `sh pipeline/fetch.sh` and `reproject.py`, or push and use the Actions run.
Expected: the log lists every official storm, `meta.json` has `name` on each storm and Agueda-like storms under `others`.

- [ ] **Step 6: Commit**: `git commit -am "Close-ups for every officially warned storm; IR detection only as a fallback"`

---

### Task 3: Names on the page

**Files:**
- Create: `src/names.ts`, `src/names.test.ts`
- Modify: `src/meta.ts`, `src/ui.ts`, `src/hdr/scene.ts`, `index.html`, `src/style.css`, `package.json` (`"test": "vitest run"`, devDependency `vitest@^3.2.4`)

**Interfaces:**
- Consumes: the `meta.json` fields from Task 2.
- Produces:
  - In `src/meta.ts`, `Storm` gains optional `name?: string; kind?: string; agencyId?: string; agency?: "NHC" | "JTWC"; windKt?: number | null; pressureMb?: number | null; advisory?: string`. It also adds `export interface OtherStorm { name: string; kind: string; agencyId: string; agency: string; windKt: number | null; lat: number; lon: number }`, and `Meta.others: OtherStorm[]`, which `loadMeta` defaults to `[]`.
  - In `src/names.ts`: `stormTitle(s: { name?: string; kind?: string }): string` and `stormSub(s: { agencyId?: string; windKt?: number | null; agency?: string }): string`.
  - In `src/hdr/scene.ts`, the `Globe` interface gains `lookAt(lat: number, lon: number): void`, which flies to the zoomed-out globe view centred on that point (reuse `flyTo`).

- [ ] **Step 1: Write the failing test** in `src/names.test.ts`:
  - `stormTitle({ name: "Champi", kind: "Typhoon" }) === "Typhoon Champi"`
  - `stormTitle({ name: "Josephine", kind: "Post-tropical cyclone" }) === "Post-tropical cyclone Josephine"`
  - `stormTitle({}) === "Unnamed system"`
  - `stormSub({ agencyId: "29W", windKt: 95, agency: "JTWC" }) === "29W · 95 kt · JTWC"`
  - `stormSub({ agencyId: "AL10", windKt: null, agency: "NHC" }) === "AL10 · NHC"`
  - `stormSub({}) === "from satellite only"`

- [ ] **Step 2: Run it and see it fail**

Run: `npm install && npm test`
Expected: `Failed to resolve import "./names"`.

- [ ] **Step 3: Implement `src/names.ts`.**

- [ ] **Step 4: Run it and see it pass**

Run: `npm test`
Expected: `6 passed`.

- [ ] **Step 5: Wire the UI** in `src/ui.ts`:
  - **Picker (`#stormpick`):** always shown, as a vertical list. One button per `meta.storms` entry, `stormTitle` on the first line and `stormSub` small below, which selects it as today. Then one row per `meta.others` entry with the same text plus "· no satellite view", which calls `globe.lookAt(lat, lon)` and doesn't change the selected storm. Order: imaged storms, then others.
  - **Globe labels:** storm buttons read `stormTitle(s)` instead of `"1 · Typhoon"`. Each `others` entry gets a label at `ll2v(lat, lon, 1.02)` with class `label storm off` (dimmed, which calls `globe.lookAt` on click).
  - **Card (`fillCard`):** `card-title` = `stormTitle(st)`; `card-eyebrow` = `${basin} · ${agency} advisory ${hhmm}` when `st.agency` is set, else today's text. `vmax` = `${windKt} kt · ${agency}` when `windKt` is set, else today's Dvorak text, which stays marked unofficial.
  - **CSS:** `.storm-pick` becomes a column list (full width, left-aligned rows, 2-line buttons). `.label.storm.off { opacity: .45 }`.

- [ ] **Step 6: Check it**

Run: `npm run build` (type check). Then `npm run dev` with the Task 2 `meta.json` copied to `public/data`, and take a Playwright screenshot at 1440×900 and 390×844.
Expected: the build is clean. The list shows every storm by name. The labels sit over each storm. Clicking an "others" row turns the globe to it.

- [ ] **Step 7: Commit**: `git commit -am "Name every storm in the list and over its position on the globe"`

---

### Task 4: Official past track with intensity

**Files:** modify `pipeline/advisories.py`, `pipeline/tests/test_advisories.py`, `pipeline/storms.py`; fixture `pipeline/tests/fixtures/bal102026.dat` (already committed, fetched 2026-10-22).

**Interfaces:**
- `Official` gains `history: list[tuple[str, float, float, int | None]]` = `(time "YYYY-MM-DDTHH:MMZ", lat, lon, windKt)`, oldest first, one entry per time.
- `parse_tcw` fills it from the block of lines matching `^\d{10} +\d{2,3}[NS] *\d{3,4}[EW] +\d+` (storm number, YYMMDDHH, position, wind; each time is repeated once per radius row). `parse_bdeck(text: str) -> list[tuple[...]]` reads the `BEST` rows (comma-separated: basin, number, YYYYMMDDHH, …, lat `250N`, lon `700W`, vmax kt). `active_storms` fetches the b-deck for each NHC storm, and a failed b-deck fetch leaves `history = [(advisory, lat, lon, windKt)]`.
- `meta.json`: each storm and each `others` entry gains `history` (same tuples as JSON arrays). The existing IR `track` stays for fallback storms.

- [ ] **Step 1: Failing tests.**
  - `test_parse_tcw_history_dedupes`: Champi's history starts `("2026-10-11T06:00Z", 9.5, 163.8, 15)`, ends `("2026-10-22T18:00Z", 21.9, 124.3, 95)`, and has no repeated times.
  - `test_parse_bdeck`: Josephine's history has no repeated times, its last entry's wind is 55, and every `lon < 0`.
  - `test_active_storms_history_survives_bdeck_failure`: the fake `get` fails only for `/btk/` → Josephine `history` has length 1.
- [ ] **Step 2:** `python3 -m pytest pipeline/tests -q` → the new tests fail.
- [ ] **Step 3:** Implement. In `storms.py`, copy `off["history"]` into each storm's and each other's meta.
- [ ] **Step 4:** `python3 -m pytest pipeline/tests -q` → all pass.
- [ ] **Step 5: Commit**: "Official past track with wind for every storm"

### Task 5: Paths for every storm, coloured by intensity

**Files:** create `src/intensity.ts`, `src/intensity.test.ts`; modify `src/meta.ts` (`history?: [string, number, number, number | null][]` on `Storm` and `OtherStorm`), `src/hdr/scene.ts` (track section, about lines 190–220), `index.html` + `src/ui.ts` (legend rows), `src/style.css`.

**Interfaces:**
- `category(kt: number | null): { key: "na" | "td" | "ts" | "c1" | "c2" | "c3" | "c4" | "c5"; label: string; color: string }`, using the thresholds and colours in Global Constraints. Labels: "No official wind", "Tropical depression", "Tropical storm", "Category 1" … "Category 5".

- [ ] **Step 1: Failing test** `src/intensity.test.ts`: `category(33).key === "td"`, `category(34).key === "ts"`, `category(64).key === "c1"`, `category(95).color === "#ffe775"`, `category(137).key === "c5"`, `category(null).color === "#9aa3ad"`.
- [ ] **Step 2:** `npm test` → fails (no module).
- [ ] **Step 3:** Implement `category`. In `scene.ts`, build the path for **every** storm and every `others` entry from `history` when present, else from the IR `track`. The line is a thin neutral tube (`#c8ccd2` at 0.5 opacity). Each checkpoint is a dot in `category(wind).color`, and the newest is 1.6× larger. All of it lives in `trackGroup`, whose visibility stays tied to the paths toggle (default off). Keep the pulse on imaged storms.
- [ ] **Step 4:** Add a legend block "Storm path · official wind" with the 8 swatches, shown only while paths are on.
- [ ] **Step 5:** `npm test && npm run build` → pass. Screenshot with paths on: each storm has a path, dots change colour along Champi's path (blue → cyan → yellow → orange as it strengthened).
- [ ] **Step 6: Commit**: "Storm paths for every storm, coloured by official intensity"

### Task 6: Sharp loop in Imagery mode

**Cause found while planning:** the default Imagery style plays true-colour loop frames cut at **1024 px** (`pipeline/visible.py:176`), half the resolution of the 2048 px still. They are 30 minutes apart, and `setLoop` cross-fades them continuously (`visMix`, and `frameMix` for infrared), so every in-between moment shows two images on top of each other.

**Files:** modify `pipeline/visible.py:176-177`, `src/hdr/scene.ts` (`setLoop`), and add `scripts/sharpness.py`.

**Interfaces:** `hold(f: number): number` in `src/hdr/scene.ts` is `smoothstep(0.75, 1, f)`. It's used for `frameMix`, `visMix` and `irMix`, so each frame is held sharp for 75 % of its slot, then dissolves quickly.

- [ ] **Step 1: Measure first.** `scripts/sharpness.py A.png B.png` prints the variance of the Laplacian over the centre 400×400 px of each image, and their ratio. Take Playwright screenshots at 1440×900 in Imagery mode of the still and of the loop paused halfway between two frames (`setLoop(k + 0.5)`).
Expected now: a ratio well below 0.85.
- [ ] **Step 2:** `visible.py` saves loop frames at the full `NV` (2048 px), `quality=90`, with no resize.
- [ ] **Step 3:** Apply `hold` in `setLoop`.
- [ ] **Step 4:** Re-measure. Expected: loop/still ratio ≥ 0.85 at a mid-frame, and the playback looks steady in a 6 h screen recording. The deploy grows by about 0.5 MB per true-colour frame. Check that the largest file is still well under 25 MiB.
- [ ] **Step 5: Commit**: "Play the loop sharp: full-resolution true-colour frames, hold then dissolve"

### Task 7: Plain control names and a tidy toolbar

Use `design:ux-copy` for the final wording and `design:design-critique` on before and after screenshots at 1440×900 and 390×844. The proposal below is the starting point:

| Today | New | Shown as |
|---|---|---|
| Imagery · 3D cloud tops · 3D storm | **Satellite · Cloud heights · 3D storm** | group caption "View" |
| Visible · Infra · Blue | **True colour · Temperature · Soft blue** | caption "Colours" |
| Studio · Real sun | **Even light · Real sun** | caption "Light" |
| Track | **Paths** (toggle) | caption "Layers" |
| ▶ 6 h 12 h 24 h | unchanged | caption "Replay" |
| Height × | **Height ×** shown only in Cloud heights and 3D storm | — |

The hint for each view says in one sentence what it shows. Cloud heights: "the satellite picture raised by how high each cloud top is". 3D storm: "the storm's clouds built as a 3D volume you can turn around".

**Layout:**
- Every group has a 10 px uppercase caption above it, left-aligned.
- All buttons are 36 px tall, with the same padding and a 12 px gap between groups.
- Desktop: one row, with the time readout right-aligned.
- Phone (≤ 600 px): a 2-column grid. View takes the full width. Colours and Light share a row. Then Layers and Replay, with time on its own line. Nothing wraps mid-group.
- The storm list (Task 3) sits in the Storm drawer, not the toolbar.

**Files:** `index.html` (toolbar markup), `src/style.css` (`.bar`, `.seg`, captions, the phone media query), `src/ui.ts` (`hints()` wording, height slider visibility).

- [ ] **Step 1:** Before screenshots, run `design:design-critique` on them, and fold its layout findings into the spec above.
- [ ] **Step 2:** Implement the markup, CSS and copy.
- [ ] **Step 3:** `npm run build`. After screenshots at both sizes. Check all groups line up, nothing is clipped at 360 px wide, keyboard focus order runs left to right, and the `aria-label`s match the new names.
- [ ] **Step 4: Commit**: "Plain control names and an aligned toolbar"

---

### Task 8: Ship

**Files:** modify `README.md` (data section) and `docs/spec.md` (storm detection section).

- [ ] **Step 1:** Document the sources (NHC `CurrentStorms.json`, JTWC RSS and `.tcw`), what "others" means (warned storms outside the GOES and Himawari view), and the IR fallback. State that `MIN_SPAN_H` now only applies to the fallback.
- [ ] **Step 2:** Run `python3 -m pytest pipeline/tests -q && npm test && npm run build`. Expected: everything passes.
- [ ] **Step 3:** Commit, push the branch and open a PR. After merge, check the first Actions run log ("advisories:" lines, the storm names) and https://hurrix.pages.dev.
