# Hurrix: how it works

This is the full reference for Hurrix: what data it uses, where that data comes from, how it turns into the pictures on the globe, and which libraries do the work. It's written for learners and developers alike. You don't need a meteorology or graphics background; every term is explained the first time it shows up, and there's a [glossary](#glossary) at the end.

For a quick overview, screenshots and how to run it, see the [README](../README.md).

- [1. The big picture](#1-the-big-picture)
- [2. Where the data comes from](#2-where-the-data-comes-from)
- [3. The satellite bands, in plain words](#3-the-satellite-bands-in-plain-words)
- [4. The pipeline, step by step](#4-the-pipeline-step-by-step)
- [5. The files the page loads](#5-the-files-the-page-loads)
- [6. How the page draws the globe](#6-how-the-page-draws-the-globe)
- [7. The imagery styles](#7-the-imagery-styles)
- [8. The 3D views](#8-the-3d-views)
- [9. Camera and controls](#9-camera-and-controls)
- [10. Libraries and tools](#10-libraries-and-tools)
- [11. Limits](#11-limits)
- [12. Ideas for extending it](#12-ideas-for-extending-it)
- [Glossary](#glossary)

## 1. The big picture

Weather satellites photograph the Earth every ten minutes. Hurrix takes one of those moments, finds in it every tropical cyclone the official warning centres are tracking (hurricanes, typhoons and cyclones are the same kind of storm with different local names), and shows them on a 3D globe under their official names.

The work is split in two halves that only meet through files:

```
NOAA buckets ──► pipeline/ (Python) ──► public/data/ (JPG, PNG, JSON) ──► the page (TypeScript + three.js, WebGL)
   satellite files     download, stitch,       a few images and          draws the globe on the
   (netCDF)            find storms, cut        one JSON file             graphics card
                       close-ups
```

- The **pipeline** is a handful of Python scripts. It downloads satellite files, does the heavy number crunching once, and writes small, ready-to-draw images.
- The **page** is a static website. It never talks to NOAA itself; it just loads those images and draws them. That keeps it fast, and you can host it anywhere that serves files.

Nothing on the globe is drawn by hand. Every cloud is a pixel a satellite measured. The only modelled part is the height of the clouds in the 3D views, which is worked out from their temperature ([section 8](#8-the-3d-views)).

## 2. Where the data comes from

Hurrix only uses open data you can download without an account or API key. All satellite files come from NOAA's public buckets on Amazon Web Services (AWS), as part of the NOAA Open Data Dissemination programme.

| | Source | What Hurrix takes from it | Link |
| --- | --- | --- | --- |
| 🛰️ | **GOES-19** (GOES-East, NOAA), parked above 75.2° W. Sees the Americas and the Atlantic. | Infrared band 13 (`ABI-L2-CMIPF`, C13), cloud-top height (`ABI-L2-ACHAF`), visible bands 1–3 (C01–C03) | [noaa-goes19 bucket](https://noaa-goes19.s3.amazonaws.com/index.html) · [registry entry](https://registry.opendata.aws/noaa-goes/) |
| 🛰️ | **GOES-18** (GOES-West, NOAA), parked above 137° W. Sees the Eastern and Central Pacific. | The same products as GOES-19 | [noaa-goes18 bucket](https://noaa-goes18.s3.amazonaws.com/index.html) · [registry entry](https://registry.opendata.aws/noaa-goes/) |
| 🛰️ | **Himawari-9** (Japan Meteorological Agency, mirrored by NOAA), parked above 140.7° E. Sees Asia, Australia and the Western Pacific. | Infrared band 13 and visible bands 1–3, as `AHI-L2-FLDK-ISatSS` tiles | [noaa-himawari9 bucket](https://noaa-himawari9.s3.amazonaws.com/index.html) · [registry entry](https://registry.opendata.aws/noaa-himawari/) |
| 🌍 | **NASA Blue Marble and Black Marble**, as packaged in the three-globe examples (MIT). | Daytime Earth, city lights at night, land/water mask, terrain bumps | [three-globe](https://github.com/vasturiano/three-globe) · [NASA Visible Earth](https://visibleearth.nasa.gov/collection/1484/blue-marble) |
| ☁️ | **three-globe's example cloud map** (MIT). | Archive clouds for the area no satellite here covers | [three-globe on npm](https://www.npmjs.com/package/three-globe) |
| 🔤 | **IBM Plex Mono** (SIL Open Font Licence). | The typeface | [@fontsource/ibm-plex-mono](https://fontsource.org/fonts/ibm-plex-mono) |

The three satellites are *geostationary*: each hangs over one spot on the equator, 35,786 km up, and photographs its whole visible half of the Earth (a *full disk*) every 10 minutes. Together they cover the Americas, the Pacific, East Asia and Australia.

Europe, Africa and the Indian Ocean are covered by the European Meteosat satellites, which aren't on NOAA's open buckets. Hurrix fills that area with archive clouds and says so in the legend.

Storm names, official winds and past tracks come from the two warning centres, also without an account:

| | Source | What Hurrix takes from it | Link |
| --- | --- | --- | --- |
| 🌀 | **NHC** (US National Hurricane Center): Atlantic, Eastern and Central Pacific | The active storms (`CurrentStorms.json`) and each one's best track so far (`atcf/btk/bXXNNYYYY.dat`) | [CurrentStorms.json](https://www.nhc.noaa.gov/CurrentStorms.json) · [best tracks](https://ftp.nhc.noaa.gov/atcf/btk/) |
| 🌀 | **JTWC** (US Joint Typhoon Warning Center): West Pacific, Indian Ocean, Southern Hemisphere | The warning feed, and the JMV 3.0 `.tcw` file each warning links to: name, position, wind and past track | [jtwc.rss](https://www.metoc.navy.mil/jtwc/rss/jtwc.rss) |

**Getting the files.** Each bucket can be listed and downloaded over plain HTTPS. A listing is a URL like
`https://noaa-goes19.s3.amazonaws.com/?list-type=2&prefix=ABI-L2-CMIPF/2026/293/05/`
(year, day of year, hour), and a file is the bucket URL plus its key. No AWS tools are needed; the pipeline uses `curl` and Python's `urllib`.

## 3. The satellite bands, in plain words

A satellite camera takes one picture per *band*, each at a different wavelength of light.

| Band | Wavelength | What it sees | Resolution | Used for |
| --- | --- | --- | --- | --- |
| 13 | 10.4 µm (infrared) | Heat. Works day and night. | 2 km | The global cloud layer, finding storms, the 3D heights |
| 1 | 0.47 µm (blue) | Reflected sunlight | 1 km | True colour |
| 2 | 0.64 µm (red) | Reflected sunlight | 0.5 km | True colour (averaged down to 1 km) |
| 3 | 0.51 µm (green) on Himawari, 0.86 µm (near-infrared "veggie") on GOES | Reflected sunlight | 1 km | True colour |
| ACHA | product, not a band | NOAA's estimate of cloud-top height (GOES only) | 10 km | The global height map, where it exists |

**Infrared and temperature.** Band 13 doesn't measure light; it measures the heat a surface gives off, reported as a *brightness temperature* in kelvin. For a thick cloud that's the temperature of its top. The air gets colder the higher you go, so **cold means high**. The tallest storm clouds reach −80 °C (193 K); the ocean is around 27 °C (300 K).

**True colour on GOES.** GOES has no green band, so Hurrix makes one from the other three, the way CIMSS (the University of Wisconsin's satellite institute) does:

```
green = 0.45 × red + 0.10 × near-infrared + 0.45 × blue
```

## 4. The pipeline, step by step

`pipeline/run.sh` runs the whole chain for one 10-minute *slot*. By default it picks the slot 40 minutes ago, which NOAA has normally finished publishing.

### 4.1 Download (`fetch.sh`)

Downloads, for the slot:

- GOES-19 and GOES-18 band 13 full disk (`g19_c13.nc`, `g18_c13.nc`) and their cloud-top height (`g19_acha.nc`, `g18_acha.nc`);
- all Himawari-9 band 13 tiles (the Himawari disk comes as a grid of tiles, 550 × 550 pixels each at 2 km).

The files are in **netCDF**, a format scientists use for gridded data. Each holds the measured values plus a description of the satellite's view (its projection), which is what lets us work out where on Earth each pixel is.

### 4.2 Stitch (`reproject.py`)

Each satellite sees the Earth at an angle, so its picture is a curved disc and pixels near the edge are stretched. This step maps every disc onto one flat world map, 4096 × 2048 pixels in an *equirectangular* layout (longitude across, latitude down, about 10 km per pixel).

For every pixel of the world map it:

1. works out where each satellite would see that spot, using the satellite's projection;
2. picks the satellite that looks at it most directly, because that view is sharpest;
3. blends smoothly where two satellites overlap, so there's no seam.

It writes the stitched temperatures and a *coverage* map (how well any satellite sees each spot) to `stitched_4096.npz`.

### 4.3 Export (`export.py`)

Turns the stitched map into the images the page loads:

- `ir_global.jpg`, the global infrared layer. Where coverage is poor it fades into archive clouds.
- `ir_live_mask.png`, which marks live data versus archive, so the legend can tell you which is which.

### 4.4 Find and follow the storms (`advisories.py`, `storms.py`)

**Which storms.** `advisories.py` reads the active storms from the NHC and the JTWC (see [section 2](#2-where-the-data-comes-from)): name, kind (tropical storm, typhoon, hurricane…), official wind, pressure, position, advisory time and past track. A storm both centres warn on is kept once, from the NHC. A feed that's down is skipped and the run carries on.

1. **Who gets a close-up.** Each official storm gets the satellite with the most direct view. Up to eight of them, strongest first, get a close-up and a loop. Storms no satellite here sees well (the Meteosat gap) go into `others`: they're listed and labelled on the globe, with their path, but have no imagery.
2. **Where the centre is now.** The advisory is up to a few hours older than the frame, so the advisory position is carried forward along the official track to the frame time (at most 12 hours).
3. **Track back in the infrared**, to measure the storm and its motion. Step back in time every 3 hours, up to 48 hours. At each step, look near where the storm should be (extrapolated from the last two fixes) and find the centre:
   - An **eye** is a warm spot closed off by cold cloud on all sides. For each point, the code takes the coldest top in each of 8 directions 10–30 km out, then the warmest of those eight. If the point is much warmer than that ring, it's an eye.
   - If there's no clear eye, it uses the middle of the coldest cloud mass instead, and marks that fix as less certain.
   Tracking stops when the centre loses its deep thunderstorms (no tops colder than −33 °C nearby), when it leaves the satellite's view, or when it "jumps" faster than 35 knots. The infrared fixes are kept only if the newest one is a clear eye within 60 km of the official position; otherwise the official position is used.
4. **Fallback.** If no official storm can be imaged (both feeds down, or none in view), the storms are found in the pictures alone, unnamed: big, solid cold cores where at least 85 % of the cloud tops within 150 km are colder than −53 °C (220 K), between 4° and 38° from the equator, tracked back as above. Only centres that held together for at least `MIN_SPAN_H` hours (24 by default) count, which filters out ordinary thunderstorm clusters. This rule applies only to the fallback; official storms are always shown.
5. **Rank.** Official storms come strongest first by official wind; fallback ones by the coldest eyewall, with a bonus for a clear eye.
6. **Measure.** For each storm: eye temperature, eyewall temperature, eye diameter, the radius of the central cold cloud shield, and its motion over the last day.
7. **Cut the close-up and the loop.** A 2048 km square at 2 km per pixel (`storm_ir.png`, 1024 × 1024), plus up to 73 loop frames on the same grid (`loop/f00.jpg` onward): every 30 minutes from 24 hours back to 6 hours back, then every 10 minutes up to the frame. The page plays 6 hours from all the recent frames, and 12 or 24 hours from the 30-minute ones.

**The close-up grid.** Close-ups use a *gnomonic* (tangent-plane) projection centred on the eye: a flat square that touches the globe at the storm's centre. Straight lines in it are great circles on the globe, and distortion is tiny over 2000 km. All storm images (infrared, true colour, loop) use the same grid, so they line up pixel for pixel, and the 3D views reuse it too.

### 4.5 True colour (`visible.py`)

For each storm it builds a true-colour close-up at 1 km per pixel (`storm_vis.jpg`, 2048 × 2048), plus true-colour loop frames every 30 minutes over the last 6 hours wherever the storm was in daylight (`loop/v00.jpg` onward, 2048 × 2048, the same size as the still). While the 6-hour loop plays, the page holds each one sharp for three quarters of its 30 minutes and then dissolves quickly to the next underneath the 10-minute infrared frames; if night falls inside that span, the loop plays in infrared.

1. **Read only what's needed.** GOES visible files are large (band 2 is about 200 MB per full disk), so the code reads just the window around the storm. For Himawari it downloads only the tiles that cover the storm.
2. **Resample** each band onto the storm's close-up grid.
3. **Correct for the sun's angle.** A cloud lit by a low morning sun reflects less light than the same cloud at noon. Dividing by the cosine of the *solar zenith angle* (how far the sun is from straight overhead) evens that out. The divisor is clamped at 0.12 so sunrise and sunset don't blow up.
4. **Remove a little haze.** The air scatters blue light, which washes out the picture. A small amount is taken off, more where the sun is low and less on bright clouds.
5. **Tone curve.** A gentle gamma (1/1.9) makes it look natural on screen.

Where the sun was down, there's no visible picture, so the page shows infrared there instead. If any loop frame fails, the loop falls back to infrared.

### 4.6 The whole-globe loop (`globe.py`)

So that every cloud on the globe moves while the loop plays, not only the storm, this step stitches the whole world once an hour over the last 24 hours. It downloads the three satellites' full disks for each hour (Himawari's 88 tiles included), averages each satellite's 2 km pixels into 8 km blocks, and maps them onto a 2048 × 1024 world map the same way `reproject.py` does, with the same archive clouds in the Meteosat gap. The frames are written as `globe/g00.jpg` onward, and their times go into `meta.json` as `globeTimes`. The hours are stitched three at a time, in separate processes, and take a few minutes in all.

## 5. The files the page loads

Everything lives in `public/data/`:

| File | Size | What's in it |
| --- | --- | --- |
| `meta.json` | small | The frame time, the storms with a close-up, and the other active storms (`others`) |
| `ir_global.jpg` | 4096 × 2048 | Global infrared, as greyscale codes |
| `ir_live_mask.png` | 1024 × 512 | White where the data is live, black where it's archive |
| `storms/sN/storm_ir.png` | 1024 × 1024 | The storm's infrared close-up (2 km per pixel) |
| `storms/sN/storm_vis.jpg` | 2048 × 2048 | The storm's true-colour close-up (1 km per pixel), if it was daytime |
| `storms/sN/loop/fNN.jpg` | 1024 × 1024 | Infrared loop frames over the last 24 hours (30 minutes apart, 10 minutes in the last 6 hours) |
| `storms/sN/loop/vNN.jpg` | 2048 × 2048 | True-colour loop frames, every 30 minutes over the last 6 hours, daylight only |
| `globe/gNN.jpg` | 2048 × 1024 | Whole-globe infrared, once an hour over the last 24 hours (the frame itself is `ir_global.jpg`) |

**How temperatures are stored.** An image pixel holds 0–255, so infrared images store a *code* instead of a temperature:

```
code = (320 K − temperature) ÷ 140 K        stored as code × 255
temperature = 320 K − code × 140 K           what the shaders read back
```

That covers 180 K to 320 K (−93 °C to +47 °C), more than any real cloud or sea, at about 0.55 K per step.

**`meta.json`, one storm:**

```jsonc
{
  "id": "s1",
  "satellite": "Himawari-9",
  "eye": { "lat": 16.39, "lon": 134.5 },
  "eyeK": 290.1,          // eye temperature (kelvin)
  "ringK": 201.2,         // coldest ring around the eye: the eyewall tops
  "eyeDiameterKm": 50,
  "cdoRadiusKm": 231,     // radius of the central cold cloud shield
  "motion": { "kt": 11.1, "bearing": 297, "hours": 21 },
  "loopFrames": 73,
  "loopTimes": ["2026-10-20T02:50Z", "…"],
  "track": [["2026-10-18T23:40Z", 13.37, 139.74, 0], "…"],   // time, lat, lon, 1 if the eye was clear
  "visible": true,        // storm_vis.jpg exists
  "visTimes": ["2026-10-20T00:00Z", "…"],  // times of the true-colour loop frames, if any
  // from the official advisory (absent for a storm found by the fallback):
  "name": "Champi", "kind": "Typhoon", "agency": "JTWC", "agencyId": "29W",
  "windKt": 95, "pressureMb": null, "advisory": "2026-10-22T18:00Z",
  "history": [["2026-10-11T06:00Z", 9.5, 163.8, 15], "…"]   // official past track: time, lat, lon, wind (kt)
}
```

`others` lists the active storms without a close-up, with the same official fields plus `lat` and `lon`.

## 6. How the page draws the globe

The page is TypeScript, built by Vite. `src/main.ts` loads `meta.json`, builds the scene (`src/hdr/scene.ts`) and wires up the controls (`src/ui.ts`).

The drawing is done by **three.js** on top of **WebGL**, the browser's interface to the graphics card. Most of the look comes from *shaders*, small programs that run on the graphics card once per pixel. They live in `src/hdr/glsl.ts`.

### 6.1 The layers

From the inside out:

| Layer | Shader | What it does |
| --- | --- | --- |
| Earth | `EARTH` | Blue Marble by day, city lights at night, with the land/water mask and terrain bumps for relief |
| Clouds | `CLOUDS` | The global infrared layer on a shell just above the ground. Each pixel's code becomes a temperature, then an opacity (warm sea is clear, cold tops are solid) and a colour from the current style. Clouds cast a soft shadow on the ground. While the loop plays, it blends the two hourly globe frames either side of the moment, so the clouds move everywhere. |
| Imagery patch | `IMAGERY` | The selected storm's sharp close-up, draped over the globe (Satellite view only). Its edges fade into the global clouds, so there's no square seam. |
| Atmosphere | `ATMOSPHERE` | A faint blue rim that fades softly into space |
| Sky | `SKY` | The star background |
| Cloud heights | `CLOUD_TOPS` | A finely divided square whose points are lifted to the cloud-top height ([8.1](#81-cloud-heights)) |
| 3D storm | `VOLUME` | The see-through 3D cloud ([8.2](#82-3d-storm)) |

### 6.2 Light

- **Even** light comes from the upper left, slightly behind you, and follows the camera, so the 3D shapes always read clearly.
- **Real sun** puts the sun at the *subsolar point* (the spot on Earth where the sun was straight overhead) at the frame time, worked out from a simple solar ephemeris. The night side goes dark and city lights come on.

### 6.3 The HDR look

The scene is drawn in *high dynamic range*: colours can be brighter than white, as in real life. Then three post-processing passes run:

1. **Bloom** (`UnrealBloomPass`) adds a soft glow around the very brightest areas.
2. **Tone mapping** (ACES Filmic, the curve used in film and games) squeezes the bright range into what a screen can show without blowing out the highlights.
3. **Output** converts to the screen's colour space.

### 6.4 The interface

`src/ui.ts` handles the bar at the bottom (View, Colours, Light, Layers and Replay, each with a small caption; one row on a desktop, a two-column grid on a phone), the storm list, the city and storm labels (storms without a close-up are dimmed and fly the camera to them), and the two drawers on the right edge (Storm and Legend), which close by themselves after a few seconds. The legend's colour ramp is built from the same palette the shaders use.

**Paths.** With Paths on, each storm's official past track is drawn as a thin grey line with a dot at every checkpoint, coloured by the official wind then (`src/intensity.ts`): below 34 kt `#5ebaff` (depression), 34–63 `#00faf4` (tropical storm), then categories 1–5 at 64, 83, 96, 113 and 137 kt (`#ffffcc`, `#ffe775`, `#ffc140`, `#ff8f20`, `#ff6060`), and grey where there's no official wind.

## 7. The imagery styles

All three styles colour the same infrared measurements; True colour adds the true-colour photo where there's one.

- **True colour:** the true-colour photo around the selected storm, where it was daytime. Everywhere else, infrared in grey: warm is dark, cold is white.
- **Temperature:** the Windy-style temperature palette. Grey down to −30 °C, then blue, cyan, green, yellow, orange and red, to deep red at −75 °C and colder.
- **Soft blue:** infrared clouds over a deep blue sea. Cold cores are soft grey and edges are bright, so the storm's shape stands out.

Cloud opacity follows temperature in every style: anything warmer than about 13 °C (286 K) is clear, and it's fully solid by about −41 °C (232 K).

## 8. The 3D views

Both 3D views start from one fact: **air cools as you go up**, by about 6.3 °C per kilometre in a tropical storm. So a cloud-top temperature gives a height:

```
height (km) = (300 K − cloud-top temperature) ÷ 6.3      capped at 17.5 km, faded to 0 for warm, low cloud
```

A −75 °C (198 K) eyewall top comes out at about 16 km, which is right for a strong typhoon.

At true scale a 16 km storm on a 2000 km patch would look as flat as paper, so heights are stretched by the **Height ×** slider (14× by default).

### 8.1 Cloud heights

A square mesh, finely divided, laid over the storm's close-up grid. In the vertex shader each point reads the close-up and moves up to its height; the result is an opaque surface, like a terrain map of the cloud tops. Shading comes from the slope of that surface. It shows the shape of the tops clearly, but you can't see into or under it.

### 8.2 3D storm

A see-through cloud filling a box above the storm. It's drawn by **ray marching**: for each pixel on screen, the graphics card follows the line of sight through the box in 96 small steps and, at each step, asks how much cloud is there.

- **How much cloud?** The step's position is converted to kilometres east, north and up from the eye, and the infrared close-up is read at that spot. There's cloud between the cloud base and the cloud top: the top comes from the temperature as above; the base sits low near the eye and higher further out. A layer of 3D noise, swirled around the eye the way the real winds turn, breaks it into cloud texture.
- **Light and shadow.** At each cloudy step, four extra samples toward the sun tell how much cloud the light passes through first, which gives shadows inside the cloud. A little sky light fills the shadows.
- **Smoothing.** Each pixel starts its steps at a slightly different depth, which turns the stripes a fixed step would leave into a fine dither. The storm is drawn into its own buffer, and each pixel is averaged with its eight neighbours as it is laid over the scene, so the dither evens out instead of showing as grain while the detail stays sharp.

The heights are a **model** built from real measurements. The satellite sees the top of the cloud, not inside it. The 3D storm shows a believable shape that fits the measured tops; it isn't a scan of the storm's interior.

## 9. Camera and controls

- Drag to turn and scroll to zoom (three.js `OrbitControls`).
- In the Satellite view you spin the whole globe.
- In the 3D views, when you're close, you orbit around the storm's own vertical, and the camera can't drop below its horizon or into the globe.
- Also in the 3D views, a right-drag (two fingers on a touch screen) slides the view across the storm, up to most of the way to the edge of its close-up. With several storms, the picker on the Storm card (or a click on a storm's label) moves the 3D views to another storm. Scroll out and the pivot slides back to the Earth's centre, so the globe spins again.
- Switching view or storm flies the camera smoothly to a good starting angle.

## 10. Libraries and tools

| | Library | What it does here | Link |
| --- | --- | --- | --- |
| 🧊 | **three.js** 0.186 | Everything 3D: scene, camera, materials, shaders. Add-ons used: `OrbitControls`, `EffectComposer`, `RenderPass`, `ShaderPass`, `UnrealBloomPass`, `OutputPass`. | [threejs.org](https://threejs.org) |
| ⚡ | **Vite** 7 | Development server and build tool. Bundles the page into a static `dist/` folder. | [vite.dev](https://vite.dev) |
| 🔷 | **TypeScript** 5.9 | The page's code, type-checked in strict mode | [typescriptlang.org](https://www.typescriptlang.org) |
| 🔢 | **NumPy** | Arrays of satellite pixels and all the maths on them | [numpy.org](https://numpy.org) |
| 📐 | **SciPy** (`ndimage`) | Resampling onto new grids, and the filters used to find eyes and cold cores | [scipy.org](https://scipy.org) |
| 📦 | **netCDF4** | Reading NOAA's satellite files | [unidata.github.io/netcdf4-python](https://unidata.github.io/netcdf4-python/) |
| 🖼️ | **Pillow** | Writing the JPG and PNG images | [python-pillow.github.io](https://python-pillow.github.io) |

There's no map library, no game engine and no backend server. The globe is plain three.js, and the data is static files.

## 11. Limits

Hurrix is honest about what it doesn't know, so nobody mistakes it for an official forecast.

- **Official wind, unofficial estimate.** The Storm card shows the official wind from the latest advisory. Next to it, and alone for a storm found by the fallback, is a simplified Dvorak-style estimate: the colder the eyewall (and the warmer the eye), the stronger the storm. It ranges from about 65 to 155 knots, and it's labelled unofficial.
- **No forecasts.** Only the latest advisory and the past track are shown, not the forecast track or cone.
- **Weak storms can be missed when the feeds are down.** The fallback uses the pictures alone, so a weak or disorganised storm without a solid cold core may not count.
- **A gap over Europe, Africa and the Indian Ocean**, which needs Meteosat. That area shows archive clouds, and storms there are listed without a close-up.
- **One moment in time.** The page shows the frame the pipeline last ran on, not a live stream.
- **The 3D shapes are modelled** from cloud-top temperatures ([section 8](#8-the-3d-views)).

## 12. Ideas for extending it

- **Add Meteosat** (EUMETSAT) to close the gap over Europe, Africa and the Indian Ocean. `reproject.py` would need its projection, and `storms.py` a `SATS` entry.
- **Add forecast tracks** from the same NHC and JTWC files.
- **Run the pipeline on a schedule** (for example every 30 minutes) and publish `public/data` with the site, so the globe stays current.
- **More loop history**, using the same close-up grid.

## Glossary

- **Brightness temperature:** the temperature a satellite reads from the heat a surface gives off. For a thick cloud it's the temperature of its top.
- **Dvorak technique:** the classic method forecasters use to estimate a storm's strength from satellite pictures.
- **Equirectangular:** a flat world map where longitude runs across and latitude runs down, evenly spaced.
- **Eye / eyewall:** the calm, often clear centre of a strong storm, and the ring of tall thunderstorms around it where the winds are strongest.
- **Full disk:** a geostationary satellite's picture of its whole visible half of the Earth.
- **Geostationary:** an orbit 35,786 km up where a satellite keeps pace with the Earth's spin, so it always sees the same area.
- **Gnomonic projection:** a way to flatten part of a globe onto a square that touches it at one point, here the storm's eye.
- **HDR (high dynamic range):** drawing with colours that can be brighter than white, then fitting them to the screen at the end.
- **netCDF:** a file format for gridded scientific data, used by NOAA for satellite products.
- **Ray marching:** drawing a see-through volume by stepping along each line of sight and adding up what's there.
- **Shader:** a small program that runs on the graphics card for every pixel or point.
- **Solar zenith angle:** how far the sun is from straight overhead. 0° at noon in the tropics, 90° at sunset.
- **Subsolar point:** the spot on Earth where the sun is straight overhead at a given moment.
- **Tone mapping (ACES):** squeezing a high-dynamic-range image into what a screen can show without blowing out the highlights.
