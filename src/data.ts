/**
 * The shape of the data the app draws. This is the contract: produce a Dataset in data/build.ts and the
 * globe, cards, filters, and lists all work. Three kinds of thing, and how they relate:
 *
 *   hub  ──owns──►  item  ──linked to──►  node
 *  (a pin)        (fans out      (a pin elsewhere,
 *                  around its     joined to the item
 *                  hub)           by an arc)
 *
 * In the sample data: studios own releases, and releases are linked to the festivals that screened them.
 */

/** One line on a card: a label, a value, and optionally an https link. "Yes" and "Open" show green, "No" dim. */
export type Fact = [label: string, value: string, href?: string];

export type HubRow = {
  id: string;
  name: string;
  /** Pinned on the globe only when both coordinates are present. */
  lat?: number;
  lng?: number;
  /** Shown on the card and in lists, like "Oslo, Norway". */
  place?: string;
  /** Extra rows on the card. */
  facts?: Fact[];
};

export type ItemRow = {
  id: string;
  /** The id of the hub that owns this item. */
  hub: string;
  name: string;
  /** YYYY-MM-DD. Drives the recent window, the Latest list, and pulses. Optional if config.dates.enabled is false. */
  date?: string;
  facts?: Fact[];
};

export type NodeRow = {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  place?: string;
  facts?: Fact[];
};

/** An item is linked to a node; selecting the item draws an arc from its hub to each linked node. */
export type LinkRow = { item: string; node: string };

export type Dataset = {
  /** ISO time the data was built or fetched; shown as "Data from …" in the top bar. */
  updatedAt: string;
  hubs: HubRow[];
  items: ItemRow[];
  nodes: NodeRow[];
  links: LinkRow[];
};

/** Where the built dataset is served from. vite.config.ts writes it at build time and serves it in dev. */
export const DATA_URL = "/data.json";

function valid(value: unknown): value is Dataset {
  const d = value as Dataset | null;
  return !!d && Array.isArray(d.hubs) && Array.isArray(d.items) && Array.isArray(d.nodes) && Array.isArray(d.links);
}

/** The last good dataset, kept in this browser so a return visit paints at once and works offline. */
export function readSaved(appId: string): Dataset | null {
  try {
    const raw = localStorage.getItem(`${appId}:data`);
    const data = raw ? (JSON.parse(raw) as unknown) : null;
    return valid(data) && data.hubs.length ? data : null;
  } catch {
    return null;
  }
}

export function save(appId: string, data: Dataset) {
  try {
    localStorage.setItem(`${appId}:data`, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the app still works, it just won't paint instantly next time.
  }
}

/** Fetches the dataset. `force` asks the browser to revalidate instead of reusing its HTTP cache. */
export async function fetchDataset(force = false): Promise<Dataset> {
  const res = await fetch(DATA_URL, force ? { cache: "no-cache" } : undefined);
  if (!res.ok) throw new Error(`data request failed: ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!valid(data)) throw new Error("data.json is not a Dataset");
  return data;
}
