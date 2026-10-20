# Hurrix

**Tropical cyclones on a 3D globe, from real satellite imagery.**

![Imagery view: the satellite's true-colour picture of a typhoon east of the Philippines, draped on the globe](docs/media/imagery.png)

Hurrix takes the pictures that weather satellites send down every ten minutes and puts them on a globe you can spin. It finds the hurricanes and typhoons in those pictures by itself, follows each one back over the last two days, and lets you fly in and see the storm in 3D.

Nothing on the globe is drawn by hand. Every cloud you see is a pixel the satellite measured. The only modelled parts are the heights in the 3D views, which come from the cloud temperatures (more on that below).

This README is also the project's spec. It explains what data Hurrix uses, where that data comes from, how it turns into the pictures, and which libraries do the work. It's written for learners and developers alike: you don't need a meteorology background to follow it.

- [What you see](#what-you-see)
- [Where the data comes from](#where-the-data-comes-from)
- [How the data becomes a globe](#how-the-data-becomes-a-globe)
- [The 3D views, explained](#the-3d-views-explained)
- [Libraries and tools](#libraries-and-tools)
- [What Hurrix can't tell you (yet)](#what-hurrix-cant-tell-you-yet)
- [Run it](#run-it)
- [Refresh the satellite frame](#refresh-the-satellite-frame)
- [Project layout](#project-layout)
- [Glossary](#glossary)

## What you see

There are three views, picked from the bar at the bottom of the screen.

| View | What it shows |
| --- | --- |
| **Imagery** | The whole Earth as the satellites see it right now. Around the selected storm, a sharper close-up is laid on top: a true-colour photo (1 km per pixel) if it was daytime there, otherwise an infrared picture (2 km per pixel). |
| **3D cloud tops** | The storm's close-up with every pixel lifted to the height of its cloud top, so the tall thunderstorms around the eye stand up like mountains. |
| **3D storm** | The same storm as a soft, see-through 3D cloud you can fly around, lit by the sun. |

![3D cloud tops: each pixel lifted to its cloud-top height](docs/media/cloud-tops.png)
![3D storm: the cloud built up in 3D from the satellite frame](docs/media/storm.png)

There are also three ways to colour the clouds:

- **Visible** shows real colour, the way your eyes would see it from space. It only works in daylight, so the night side falls back to infrared in grey.
- **Infra** colours the clouds by temperature, like the weather maps on TV. Warm, low clouds are grey. Below −30 °C they run from blue through green, yellow and red to deep red at −75 °C. The colder the top, the higher and stronger the storm.
- **Blue** shows infrared clouds over a deep blue sea, which makes the storm's shape easy to read.

A few more controls:

- **Lighting:** *Studio* uses a fixed light that shows the 3D shapes clearly. *Real sun* puts the sun where it really was at the frame time, so half the globe is in night.
- **Track:** draws each storm's path over the last 48 hours. It's off at first.
- **Play:** runs the last 3 hours in 10-minute steps, using the real satellite frames.
- **Storm and Legend:** two tabs on the right edge. Each opens a panel (the storm's details, or what the colours mean) that slides back out of the way by itself.

On a phone the same page fits a portrait screen, with the panels as drawers on the right edge:

![On a phone: the storm card and legend are drawers on the right edge](docs/media/phone.png)

## Where the data comes from

Hurrix only uses open data that anyone can download, with no account or API key. Every satellite file comes from NOAA's public buckets on Amazon Web Services.

| | Source | What Hurrix takes from it | Link |
| --- | --- | --- | --- |
| 🛰️ | **GOES-19** (GOES-East, NOAA). Over the Americas and the Atlantic, parked above 75.2° W. | Infrared band 13, the cloud-top height product (ACHA), and visible bands 1–3 for true colour | [noaa-goes19 bucket](https://noaa-goes19.s3.amazonaws.com/index.html) · [NOAA Open Data on AWS](https://registry.opendata.aws/noaa-goes/) |
| 🛰️ | **GOES-18** (GOES-West, NOAA). Over the Eastern Pacific, parked above 137° W. | The same as GOES-19 | [noaa-goes18 bucket](https://noaa-goes18.s3.amazonaws.com/index.html) · [NOAA Open Data on AWS](https://registry.opendata.aws/noaa-goes/) |
| 🛰️ | **Himawari-9** (Japan Meteorological Agency, mirrored by NOAA). Over Asia, Australia and the Western Pacific, parked above 140.7° E. | Infrared band 13, and visible bands 1–3 for true colour | [noaa-himawari9 bucket](https://noaa-himawari9.s3.amazonaws.com/index.html) · [Himawari on AWS](https://registry.opendata.aws/noaa-himawari/) |
| 🌍 | **NASA Blue Marble and Black Marble**, as packaged in the three-globe examples (MIT). | The daytime Earth, city lights at night, land/water mask and terrain bumps under the clouds | [three-globe](https://github.com/vasturiano/three-globe) · [NASA Visible Earth](https://visibleearth.nasa.gov/collection/1484/blue-marble) |
| ☁️ | **three-globe's example cloud map** (MIT). | Archive clouds for the gap no satellite here covers (Europe, Africa, the Indian Ocean) | [three-globe on npm](https://www.npmjs.com/package/three-globe) |
| 🔤 | **IBM Plex Mono** (SIL Open Font Licence). | The typeface | [@fontsource/ibm-plex-mono](https://fontsource.org/fonts/ibm-plex-mono) |

The three satellites are *geostationary*: each one hangs over the same spot on the equator and photographs its whole half of the Earth (a "full disk") every 10 minutes. Between them they cover the Americas, the Pacific, Asia and Australia. Europe, Africa and the Indian Ocean are covered by Meteosat, which isn't on NOAA's open buckets, so Hurrix fills that area with archive clouds and the legend says so.

### The satellite bands, in plain words

A satellite camera doesn't take one picture; it takes one per *band*, each at a different wavelength of light.

- **Band 13 (10.4 µm, infrared)** sees heat, not light, so it works day and night. It measures how warm each cloud top is. Cold means high, because the air cools as you go up. Hurrix uses it for the global cloud layer, for finding storms, and for the 3D heights.
- **Bands 1, 2 and 3 (visible)** see reflected sunlight: blue, red, and green on Himawari, or a near-infrared "veggie" band on GOES. Mixed together they make a true-colour photo. GOES has no green band, so Hurrix makes one from the other three, the way CIMSS does: green = 0.45 × red + 0.1 × near-infrared + 0.45 × blue.
- **ACHA (GOES only)** is NOAA's own estimate of cloud-top height. Hurrix uses it where it exists, and its own estimate from band 13 everywhere else.

## How the data becomes a globe

The work is split in two. A **Python pipeline** downloads and processes one satellite time slot and saves the results as plain images and a small JSON file. The **web page** then loads those files and draws everything on the graphics card. The page never talks to NOAA directly, so it loads fast and works as a static site.

```
NOAA buckets ──► pipeline/ (Python) ──► public/data/ (JPG, PNG, JSON) ──► the page (three.js, WebGL)
```

The pipeline (`pipeline/run.sh`) runs these steps:

1. **Download** (`fetch.sh`). Grabs band 13 and ACHA from both GOES satellites, and the Himawari band 13 tiles, for one 10-minute slot. By default that's the slot 40 minutes ago, which NOAA has usually finished publishing.
2. **Stitch** (`reproject.py`). Each satellite sees the Earth from its own angle, so its pictures are curved discs. This step maps every disc onto one flat world map (4096 × 2048 pixels). Where two satellites overlap it prefers the one looking more straight down, and blends the seam.
3. **Export** (`export.py`). Saves the world map as `ir_global.jpg`, plus `ir_live_mask.png`, which marks where the data is live and where it's archive.
4. **Find and follow the storms** (`storms.py`):
   - It looks for big, solid cold cores: places where at least 85 % of the cloud tops within 150 km are colder than −53 °C.
   - It follows each candidate back in time every 3 hours, up to 48 hours. When it can, it fixes the centre on the *eye*, a warm spot ringed by cold cloud on every side. If there's no clear eye, it uses the middle of the coldest cloud mass and marks that fix as less certain.
   - It stops following when the centre loses its deep thunderstorms, or "jumps" faster than 35 knots, which no real storm does.
   - Only centres that hold together for at least 24 hours count as storms, which filters out ordinary thunderstorm clusters. It keeps up to four, strongest first.
   - For each storm it saves a close-up, a 2048 km square at 2 km per pixel, plus 18 frames covering the last 3 hours.
5. **True colour** (`visible.py`). For each storm it builds a 1 km true-colour close-up from the visible bands, plus a true-colour frame for each loop step. The brightness is corrected for the sun's angle, so a storm photographed at sunrise looks as bright as one at noon. A little of the blue haze the air adds is taken off. Night areas are left to infrared.

The close-ups use a *gnomonic* (tangent-plane) grid centred on the eye: a flat square that touches the globe at the storm's centre. All the 3D views reuse that same grid, so the photo, the heights and the 3D cloud line up pixel for pixel.

Everything about the frame goes into `public/data/meta.json`: the time, and for each storm its satellite, eye position, temperatures, size, motion, track and loop times.

### On the page

`src/hdr/scene.ts` builds the scene with three.js, and `src/hdr/glsl.ts` holds the shaders, the small programs that run on the graphics card for every pixel:

- **Earth:** Blue Marble by day and city lights by night, with the land/water mask and terrain bumps.
- **Clouds:** the stitched infrared layer on a shell just above the ground. Each pixel is turned back into a temperature, then into how thick and bright the cloud should look.
- **Atmosphere:** a faint blue rim that fades out softly toward space.
- **Imagery patch:** the storm's sharp close-up, draped over the globe and faded into the global clouds at its edges so there's no square seam.
- **HDR look:** the scene renders in high dynamic range, gets a gentle bloom glow, then is mapped to the screen with ACES tone mapping, the same curve film and games use.

`src/ui.ts` wires up the buttons, the panels, the loop player, the city labels and the colour legend.

## The 3D views, explained

Both 3D views start from one simple fact: **air gets colder as you go up**, by roughly 6.3 °C per kilometre in a tropical storm. So a cloud-top temperature can be turned into a height:

```
height (km) ≈ (27 °C − cloud-top temperature) ÷ 6.3      capped at 17.5 km
```

A −75 °C eyewall top comes out at about 16 km, which is right for a strong typhoon. Warm, low clouds stay near the ground.

- **3D cloud tops** turns the close-up into a surface. Each pixel is pushed up to its height, then the whole thing is stretched upward (the *Height ×* slider, 14× by default), because at true scale a 16 km storm on a 2000 km patch would look flat.
- **3D storm** fills a box above the storm with a cloud you can see through. For every pixel on screen, the graphics card steps a ray through the box (72 steps) and asks at each step how much cloud is there. The answer comes from the satellite pixel below: the top is the cloud-top height, the base is lower near the eye and higher further out, and a bit of noise, swirled around the eye like the real winds, breaks it into cloud texture. A few extra steps toward the sun work out the shadows.

The heights are a *model* built from real measurements. The satellite measures the top of the cloud; it can't see inside it. The 3D views show a believable shape that fits what was measured, not a scan of the storm's interior.

## Libraries and tools

| | Library | What it does here | Link |
| --- | --- | --- | --- |
| 🧊 | **three.js** 0.186 | Everything 3D: the globe, the cameras, the shaders. Its add-ons provide OrbitControls (drag to spin, scroll to zoom) and the post-processing chain (EffectComposer, RenderPass, UnrealBloomPass, OutputPass). | [threejs.org](https://threejs.org) |
| ⚡ | **Vite** 7 | Development server and build tool. Bundles the page into a static `dist/` folder you can host anywhere. | [vite.dev](https://vite.dev) |
| 🔷 | **TypeScript** 5.9 | The page's code, type-checked in strict mode. | [typescriptlang.org](https://www.typescriptlang.org) |
| 🔢 | **NumPy** | Arrays of satellite pixels and all the maths on them | [numpy.org](https://numpy.org) |
| 📐 | **SciPy** (`ndimage`) | Resampling pictures onto new grids, and the filters used to find eyes and cold cores | [scipy.org](https://scipy.org) |
| 📦 | **netCDF4** | Reading NOAA's satellite files, which are in the netCDF format scientists use | [unidata.github.io/netcdf4-python](https://unidata.github.io/netcdf4-python/) |
| 🖼️ | **Pillow** | Writing the JPG and PNG images the page loads | [python-pillow.github.io](https://python-pillow.github.io) |

There's no map library and no backend. The globe is written directly in three.js, and the data is static files.

## What Hurrix can't tell you (yet)

Hurrix is honest about its limits, so nobody mistakes it for an official forecast.

- **The intensity is an estimate.** The wind speed on the Storm card is a rough guess in the style of the Dvorak technique, based on how cold the eyewall is and how warm the eye is. It's labelled unofficial, and it is.
- **No names or official advisories.** Those come from the JTWC and NHC feeds, which aren't wired in yet.
- **Weak storms can be missed.** Hurrix finds storms from the pictures alone. A weak or messy storm without a solid cold core may not count.
- **A gap over Europe, Africa and the Indian Ocean.** That area needs Meteosat, so it shows archive clouds.
- **The 3D shapes are modelled** from cloud-top temperatures, as explained above.

## Run it

You need Node.js 20.19 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build the static site into dist/
```

## Refresh the satellite frame

`public/data` holds one saved frame. To replace it with the latest one you need Python 3:

```sh
python3 -m pip install -r pipeline/requirements.txt
npm run data                          # the slot 40 minutes ago
sh pipeline/run.sh 2026-10-20T05:40   # or a given 10-minute slot (UTC)
```

The downloads are large (a GOES full-disk visible file is about 200 MB), so the first run takes a while. Downloaded files are cached in `pipeline/frames`.

## Project layout

```
src/main.ts        start-up: loads the data, builds the globe, binds the controls
src/meta.ts        the frame and its storms, formatting, the intensity estimate, where the sun is
src/hdr/scene.ts   the three.js scene: HDR pipeline, Earth, clouds, atmosphere, track, imagery patch, 3D views, camera
src/hdr/glsl.ts    the shaders
src/ui.ts          buttons, panels, legend, loop player and labels
src/style.css      the page's look
pipeline/          the Python data refresh (see above)
public/data/       the saved frame the page loads
public/textures/   Earth and sky textures (three-globe examples, MIT; NASA Blue and Black Marble)
```

Design notes are in `docs/superpowers/specs/`. Licences are in `public/third-party-notices.txt` (`npm run notices` regenerates it).

## Glossary

- **Brightness temperature:** the temperature a satellite reads from the heat a cloud gives off. For thick clouds it's the temperature of the cloud top.
- **Eye / eyewall:** the calm, often clear centre of a strong storm, and the ring of tall thunderstorms around it where the strongest winds are.
- **Full disk:** a satellite's picture of its whole visible half of the Earth.
- **Geostationary:** an orbit 35,786 km up in which a satellite keeps pace with the Earth's spin, so it always sees the same area.
- **Gnomonic projection:** a way to flatten part of a globe onto a square that touches it at one point, here the storm's eye.
- **Dvorak technique:** the classic method forecasters use to estimate a storm's strength from satellite pictures.
- **Tone mapping (ACES):** squeezing a high-dynamic-range image into what a screen can show without blowing out the highlights.
