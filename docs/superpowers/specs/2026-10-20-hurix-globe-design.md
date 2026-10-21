# Hurrix globe: design

Status: draft for review. Prototype: https://claude.ai/artifact/NtiW18UckQG2V6cTA53ZzL

## Goal

Show active tropical cyclones on a 3D globe using real satellite imagery, not drawn graphics. The look should be HDR and production-grade. A three-way switch changes how the selected storm is shown:

1. **Imagery.** Live infrared (10.4 µm) from Himawari-9, GOES-18 and GOES-19, stitched into one global cloud layer over the Earth. The storm's track is drawn from eye fixes.
2. **3D cloud tops.** The storm's 2 km satellite frame, with each pixel lifted to the height its brightness temperature implies.
3. **3D storm.** A volumetric cloud built from the same frame, plus wind tracers from a parametric (Holland) wind profile, with an optional wind-speed cutaway.

## What the user asked for

- Satellite imagery and storm data on a round globe, like Windy.
- A switch to 3D: either a hurricane modelled from real data, or the imagery itself made 3D. They want all three views.
- Ultra, HDR visuals. Real satellite imagery only, never rendered stand-ins.

## Architecture

```
pipeline/ (Python, scheduled)   NOAA open data on AWS ──► public/data/{meta.json, ir_global.jpg, ir_live_mask.png, storm_ir.png, loop/*.jpg}
browser                         public/data + public/textures ──► src/hdr/* (three.js) ──► src/ui.ts (card, controls, labels)
```

- **pipeline/fetch.sh** downloads one 10-minute slot: GOES-19/18 band 13 and cloud-top height, plus Himawari-9 band 13 tiles.
- **pipeline/reproject.py** maps each geostationary disc to an equirectangular grid. It uses whichever satellite views each point from the highest angle, and blends across the seams.
- **pipeline/storms.py** finds every storm with a solid cold core that holds together for a day, and tracks each one back up to 48 h in 3-hour steps with the satellite that sees it best. An eye fix needs a warm spot closed off by cold tops; otherwise it uses the centre of the cold cloud mass and marks that fix as such. Each storm gets a 2 km close-up on the 3D views' tangent grid.
- **pipeline/export.py** writes the global IR textures; storms.py writes each storm's close-up, a 3-hour loop at 10-minute steps, and its entry in `meta.json` (eye, motion, eye and ring temperatures, cloud-shield radius, track).
- **src/hdr/** holds the renderer: an HDR half-float pipeline with ACES tone mapping and bloom. Its parts are the Earth (Blue Marble day, city lights, ocean glint, bump, cloud shadows), the IR cloud shell, the atmosphere rim, the track, the cloud-top height field, the volume ray-marcher, and the wind tracers.
- **src/ui.ts** fills the card from `meta.json` and runs the mode, palette, lighting, loop, height and cutaway controls.

## Honesty rules

- Intensity is a rough Dvorak-style estimate from the eye and ring temperatures, and is always labelled unofficial.
- Storm names and official advisories need JTWC/NHC feeds. The UI says so until those feeds are wired in.
- Meteosat (Europe, Africa, Indian Ocean) isn't on NOAA's open buckets, so that gap shows archival clouds. The UI says so.

## Out of scope for this first PR

- Official tracks, forecast cones and wind radii from NHC/JTWC.
- Scheduled data refresh in CI. The pipeline runs by hand for now.

## Testing

- `npm run build` (tsc + vite) must pass.
- The pipeline is checked by running it against a live slot and looking at the output.
- The renderer is checked by a headless screenshot of all three modes (SwiftShader).
