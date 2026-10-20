# Hurix

**Tropical cyclones on a 3D globe, from real satellite imagery.**

![Imagery view: live infrared over the West Pacific, with a super typhoon east of the Philippines](docs/media/imagery.png)

Hurix shows the live infrared view of the Earth from three geostationary satellites (Himawari-9, GOES-18 and GOES-19), stitched into one cloud layer over a Blue Marble globe. It finds the active tropical cyclones, tracks each one back up to 48 hours, and lets you pick a storm and switch it into 3D.

| View | What it shows |
| --- | --- |
| **Imagery** | The stitched 10.4 µm infrared on the globe, with the eye track. Enhanced colours mark the coldest, highest tops. |
| **3D cloud tops** | The storm's own 2 km frame, each pixel lifted to the height its temperature implies (about 6.3 K per km). |
| **3D storm** | A volumetric cloud built from the same frame, with wind tracers from a Holland wind profile and a wind-speed cutaway. |

![3D cloud tops](docs/media/cloud-tops.png)
![3D storm](docs/media/storm.png)

A 3-hour loop at 10-minute steps plays the real frames. Lighting can follow the real sun at the frame time, or a studio key light.

## Honesty

- Intensity is a rough Dvorak-style estimate from the eye and eyewall temperatures, and is labelled as unofficial.
- The storm's name and official advisories need the JTWC or NHC feeds, which aren't wired in yet.
- Meteosat isn't on NOAA's open buckets, so Europe, Africa and the Indian Ocean show archival clouds. The legend says so.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build the static site into dist/
```

## Refresh the satellite frame

`public/data` holds one baked frame. To replace it with the latest one:

```sh
python3 -m pip install -r pipeline/requirements.txt
npm run data                          # the slot 40 minutes ago
sh pipeline/run.sh 2026-10-20T05:40   # or a given 10-minute slot (UTC)
```

The pipeline reads NOAA's open data on AWS (no account needed) and writes `public/data`:

- `fetch.sh` downloads GOES-19/18 band 13 and cloud-top height, and the Himawari-9 band 13 tiles.
- `reproject.py` maps each satellite's disc onto one equirectangular grid, preferring the satellite with the best view and blending the seams.
- `export.py` writes the global IR layer.
- `storms.py` finds the storms and cuts each one's close-up:
  - Candidates are places in the global map with a large, solid cold core (at least 85 % of tops colder than −53 °C within 150 km).
  - Each candidate is tracked back every 3 hours with the satellite that sees it best. An eye fix needs a warm spot closed off by cold tops on all sides; otherwise the centre of the cold cloud mass is used and marked. Tracking stops when the centre loses its deep convection or jumps faster than 35 kt.
  - Only centres that hold together for at least 24 hours count as storms, so passing thunderstorm clusters drop out. Up to four storms are kept, strongest first.
  - Each close-up is a 2048 km square at 2 km, resampled onto the same tangent-plane grid the 3D views use, plus a 3-hour loop at 10-minute steps.

Without the NHC and JTWC advisory feeds this is satellite-only detection: a weak or disorganised storm without a solid core can be missed, and names and official intensities aren't shown.

## Layout

```
src/main.ts        start-up
src/meta.ts        the frame and its storms, formatting, the Dvorak-style estimate, the subsolar point
src/hdr/scene.ts   three.js scene: HDR pipeline with ACES and bloom, Earth, clouds, atmosphere, track, 3D views
src/hdr/glsl.ts    shaders
src/ui.ts          card, legend, controls, loop and labels
pipeline/          the data refresh
public/textures/   Earth textures (three-globe examples, MIT; NASA Blue and Black Marble)
```

Design notes are in `docs/superpowers/specs/`. Licences are in `public/third-party-notices.txt` (`npm run notices` regenerates it).
