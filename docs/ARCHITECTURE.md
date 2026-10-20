# Architecture

A static Vite + TypeScript page with three.js for the globe. No framework. The browser loads only files from its own origin.

```
build:   data/build.ts ──► dist/data.json                  (vite.config.ts writes it; dev serves it live)
browser: /data.json ──► useData() ──► render() ──► globe.show(pins, arcs)
                          │                └─► card, counts, Latest list
                          └─ saved copy in localStorage: painted first, replaced when fresh data arrives
```

## What is on the map

`render()` in `src/app.ts` decides, from the selection:

| Selected | On the map |
| --- | --- |
| Nothing | Hubs, plus every node if "All nodes" is on |
| A hub | That hub with its newest items ringed around it. Its nodes appear on request in compact layouts, and straight away otherwise |
| An item | Its hub, and its nodes joined to the hub by arcs |
| A node | The node, and the hubs it is linked to |

Everything outside that context is dropped, except that other hubs stay as invisible "ghosts" so that clearing the selection can bring them back where they were.

## The globe (`src/globe.ts`)

- **Fixed pixel sizes.** Markers keep the same size on screen at every zoom. Pins on the far side of the Earth are hidden and can't be clicked.
- **Clustering** happens in screen space every frame. Pins that land within a few pixels merge into a numbered badge. One click on a badge zooms in and fans its pins out. Zooming out re-stacks them.
- **The selection's ring.** Pins near a selected hub or node are placed on a ring just outside its item ring, so nothing hides underneath it.
- **Arcs** are rebuilt every frame between wherever their two ends are drawn, and animate from the first end. Only new arcs animate, so a redraw doesn't replay them.
- **Materials are reused.** Markers share one material per icon style, pulse rings come from a pool, and badges persist. Disposing and recreating them on every click made three.js delete and recompile shader programs each time (about 36 compiles in 20 clicks in Modex), so don't.
- **Layout for small screens.** `setLayout()` shifts the view so the globe is centred in the space the card leaves free, and shrinks markers on narrow windows.

## The sky (`src/space.ts`)

Everything is procedural, with no image files: a blurred Milky Way texture plus a separate crisp layer of band stars, two star layers, two shooting-star line segments that spawn in view, a few low-poly rocks, satellites on a ring that always faces the camera (so they circle the globe instead of crossing it), and a rim glow shader that fades to nothing at its outer edge.

## Responsive rules (`src/app.ts`)

| Window | Behaviour |
| --- | --- |
| Under 1000px wide | Compact: side panels start folded and fold again when a card opens, rings are capped, and the globe centres beside the card |
| Under 600px wide | The card is a bottom sheet |
| Under 640px tall | Side panels fold when a card opens |

## Performance

- The draw loop does nothing while the tab is hidden.
- Shooting stars, asteroids and satellite motion stop when the system asks for reduced motion.
- The renderer runs at a pixel ratio of 1.

## Security

- The page's Content Security Policy (`public/_headers`) allows only its own origin, and there are no inline scripts or styles.
- Data is rendered as text, and card links must start with `https://`.
- `config.about.rows[].html` is the one place HTML is inserted. It is authored by you, not loaded from data.
