# Customizing

Turning the template into your app is mostly two files: `src/config.ts` for wording and `data/build.ts` for data. Everything else already works.

## 1. Config (`src/config.ts`)

| Setting | What it does |
| --- | --- |
| `id` | Prefix for browser storage (saved data, sound on/off). Change it per app so two apps on one domain don't share it. |
| `name`, `tagline`, `description` | The wordmark, the line under it, the page title, and the meta description. |
| `kinds` | What the hub, item, and node are called (`one` and `many`). These words appear on the card, the legend, the filters, and tooltips. |
| `link` | What an arc means, in words: `item` ("screened at") and `node` ("screened here"). They label the card rows and the arc key in the legend, so visitors know what a line between two pins says. |
| `demo` | `true` shows a "Demo data" badge and hides the "Data from …" time. Delete it or set `false` once your own data is in. |
| `dates` | `enabled`, `recentDays`, `latestDays`. Dates on items drive the recent window, the Latest list, and the pulse on fresh hubs. Set `enabled: false` if your items have no dates and those three parts are hidden. |
| `fanLimit`, `latestLimit` | How many items ring a selected hub, and how many rows the Latest list shows. |
| `refreshMinutes` | How often an open tab quietly checks for newer data. |
| `space` | The sky: `meteors`, `asteroids`, `satellites` (counts, `0` turns one off) and `milkyWay` (`true` or `false`). |
| `about`, `credit` | The About panel and the credit in the footer. |
| `copy` | Status and notice wording. |

Text in `about.rows[].html` is inserted as HTML. It is yours, not user data, so links are fine there. Everything that comes from your data is rendered as plain text.

## 2. Data (`data/build.ts`)

`buildDataset()` returns a `Dataset`, defined in `src/data.ts`:

```ts
{
  updatedAt: "2026-09-29T12:00:00Z",          // shown as "Data from …"
  hubs:  [{ id, name, lat?, lng?, place?, facts? }],
  items: [{ id, hub, name, date?, facts? }],   // hub is a hub id; date is YYYY-MM-DD
  nodes: [{ id, name, lat?, lng?, place?, facts? }],
  links: [{ item, node }],                     // selecting an item draws arcs to its nodes
}
```

- **Arcs.** An arc means "this item is linked to that node". Only draw arcs for a relationship you can name, then put that name in `config.link`. The sample's links are random.
- **Pins.** A hub or node is pinned only if it has both `lat` and `lng`. Without them it still appears in lists and search, and its card says "No pin".
- **Facts.** `facts` are the extra rows on a card: `[label, value]` or `[label, value, "https://link"]`. Only `https://` links are made clickable. The values `Yes` and `Open` show green and `No` shows dim.
- **Ids.** They only need to be unique within their own kind.

The dev server calls `buildDataset()` on every request to `/data.json`, so edits show up on refresh. `vite build` calls it once and saves the result as `dist/data.json`.

### Loading real data

From an API:

```ts
export async function buildDataset(): Promise<Dataset> {
  const res = await fetch("https://example.com/api/places.json");
  if (!res.ok) throw new Error(`upstream failed: ${res.status}`);
  const raw = await res.json();
  return {
    updatedAt: new Date().toISOString(),
    hubs: raw.orgs.map((o: any) => ({ id: o.slug, name: o.name, lat: o.lat, lng: o.lng, place: o.city })),
    items: raw.things.map((t: any) => ({ id: t.id, hub: t.org, name: t.title, date: t.published?.slice(0, 10) })),
    nodes: raw.sites.map((s: any) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    links: raw.usage.map((u: any) => ({ item: u.thing, node: u.site })),
  };
}
```

From a file in the repo:

```ts
import { readFile } from "node:fs/promises";

export async function buildDataset(): Promise<Dataset> {
  return JSON.parse(await readFile(new URL("./my-data.json", import.meta.url), "utf8"));
}
```

If `buildDataset()` throws, or returns no hubs, **the build fails on purpose**, so your host keeps serving the last good deploy instead of an empty globe.

If your source has its own licence, add its notice to `scripts/notices.mjs` and credit it in `config.ts` (`credit` and `about.rows`).

## 3. Look

**Colours.** The 3D scene reads `src/theme.ts`, and the page reads the CSS variables at the top of `src/style.css`. Two are shared, so change them in both places:

| `theme.ts` | `style.css` | Used for |
| --- | --- | --- |
| `accent` | `--accent` | The selection, pulses, the logo's highlight |
| `node` | `--node` | Nodes and the arcs that reach them |

**Marker shapes.** `src/icons.ts` draws the three defaults (hexagon network, diamond, ring). To change one, pass a `draw` function where the globe is created in `src/app.ts`:

```ts
kinds: {
  hub: {
    name: [low(K.hub.one), low(K.hub.many)],
    px: 24,                                   // size in CSS pixels
    draw: (g, color) => {                     // 96×96 canvas; stroke and fill are already set
      g.beginPath();
      g.arc(48, 48, 34, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    },
  },
  …
}
```

The small legend icons in `index.html` are separate SVGs, so update them to match.

**Logo and favicon.** `src/logo.ts` is the logo (drawn in the text colour) and `public/favicon.svg` is the same mark on a dark tile.

**The sky.** `config.space` sets counts. Colours and behaviour are in `src/space.ts`: `STREAK_BRIGHTNESS`, the rim glow (`GLOW_SCALE` and `strength` in `rimGlow`), and the Milky Way band.

## 4. Sound

`src/sound.ts` synthesizes every cue, so there are no audio files. Sound is off until the visitor turns it on, and the choice is remembered. The cues and where they play:

| Cue | When |
| --- | --- |
| `cueOpen` | A hub card opens |
| `cueSelect` | An item is chosen |
| `cuePing` | A node is chosen |
| `cueLand` | An arc reaches a node (each one a little higher) |
| `cueCluster` | A cluster badge opens |
| `cueClear` | The selection is cleared |
| `cueTick` | Filters, panels, and buttons |

To change a sound, edit its function. `tone()` plays one note and `blips()` plays a short run of them.

## Keeping data fresh

The data is a static file, so it is as fresh as the last build. To refresh it on a schedule, trigger a rebuild from GitHub Actions. On Cloudflare Pages, add a deploy hook (Settings → Builds → Deploy hooks), store its URL as a repository secret named `DEPLOY_HOOK`, and add `.github/workflows/rebuild.yml`:

```yaml
name: Rebuild
on:
  schedule:
    - cron: "0 */12 * * *"
  workflow_dispatch:
permissions: {}
jobs:
  rebuild:
    runs-on: ubuntu-latest
    steps:
      - run: curl --fail --silent --show-error -X POST "${{ secrets.DEPLOY_HOOK }}"
```

GitHub runs scheduled workflows only from the default branch. Leave this file out until the secret exists, or the schedule will fail every 12 hours.

Open tabs check for newer data every `refreshMinutes`. The refresh button checks straight away and briefly says "Up to date" if there is nothing new.

## Size

The engine was proven on Modex with 428 items, 195 nodes and about 4,800 links. The app does plain lookups on each render, so a few thousand items should be fine. Beyond that, look at `hubItems` and `nodesServing` in `src/app.ts` first.

## Moving changes between an app and the template

Modex and this template share the same engine. The files map one to one: `globe.ts`, `space.ts`, `sound.ts`, `style.css`, and the layout logic in `app.ts` (Modex's `main.ts`). The naming differs: Modex's lab, model, and provider are the template's hub, item, and node, and the cue names changed (`cueCard` is `cueOpen`, `cueModel` is `cueSelect`, `cueProvider` is `cuePing`). When you improve the engine in one, carry the change over by hand using that mapping.
