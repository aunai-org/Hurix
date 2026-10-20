import { Globe, type Arc, type Pin, type Tone } from "./globe";
import { config } from "./config";
import { fetchDataset, readSaved, save, type Dataset, type Fact, type HubRow, type ItemRow, type NodeRow } from "./data";
import { LOGO_SVG } from "./logo";
import { cueClear, cueCluster, cueLand, cueOpen, cuePing, cueSelect, cueTick, initSound, setSound, soundOn } from "./sound";

const K = config.kinds;
const DAY = 86_400_000;
/** Windows shorter than this fold the side panels when a card opens. */
const SHORT_PX = 640;
/** Narrower windows use the compact layout: capped rings, panels folded, the globe centred beside the card. */
const COMPACT_PX = 1000;
/** Narrower than this the card is a bottom sheet. */
const SHEET_PX = 600;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T;
const low = (text: string) => text.toLowerCase();

const statusEl = $("#status");
const clockEl = $("#clock");
const cardEl = $("#card");
const searchEl = $<HTMLInputElement>("#search");
const recentEl = $<HTMLButtonElement>("#recent");
const allEl = $<HTMLButtonElement>("#win-all");
const refreshEl = $<HTMLButtonElement>("#refresh");
const latestEl = $("#latest");
const latestPanel = $<HTMLDetailsElement>(".latest");
const filtersEl = $<HTMLDetailsElement>(".filters");
const appEl = $("#app");
const aboutEl = $("#about");
const aboutBtn = $<HTMLButtonElement>("#about-btn");
const soundEl = $<HTMLButtonElement>("#sound");

function setText(selector: string, value: string) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

/** Fills every piece of wording and the logo from src/config.ts, so the HTML holds only structure. */
function paintChrome() {
  document.title = `${config.name} — ${config.tagline}`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", config.description);
  $("#globe").setAttribute("aria-label", config.description);
  document.querySelectorAll(".logo-slot").forEach((slot) => (slot.innerHTML = LOGO_SVG));
  setText("#boot-name", config.name.toUpperCase());
  setText("#brand-name", config.name.toUpperCase());
  setText("#boot-msg", config.copy.loading);
  setText("#tagline", config.tagline);
  setText("#status", config.copy.loading);
  aboutBtn.setAttribute("aria-label", `About ${config.name}`);
  aboutBtn.title = `About ${config.name}`;
  refreshEl.title = config.copy.refreshTitle;
  refreshEl.setAttribute("aria-label", config.copy.refreshTitle);
  const find = `Find a ${low(K.hub.one)}`;
  searchEl.placeholder = find;
  searchEl.setAttribute("aria-label", find);
  setText("#recent-label", `${config.dates.recentDays} days`);
  setText("#lbl-hub", K.hub.one);
  setText("#lbl-item", K.item.one);
  setText("#lbl-node", `All ${low(K.node.many)}`);
  setText("#lbl-pulse", `Pulse ≤ ${config.dates.recentDays}d`);
  setText("#key-hub", K.hub.one);
  setText("#key-item", K.item.one);
  setText("#key-node", K.node.one);
  setText("#key-arc", `${low(K.item.one)} ${config.link.item} ${low(K.node.one)}`);
  $("#cat-node").title = `Show every ${low(K.node.one)}, not just the ones tied to your selection`;

  setText("#about-title", config.name);
  setText("#about-blurb", config.about.blurb);
  setText("#about-disclaimer", config.about.disclaimer);
  const rows = $("#about-rows");
  for (const row of config.about.rows) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = row.label;
    const dd = document.createElement("dd");
    dd.innerHTML = row.html;
    wrap.append(dt, dd);
    rows.append(wrap);
  }
  const demoBadge = $("#demo-badge");
  demoBadge.hidden = !config.demo;
  demoBadge.textContent = config.copy.demo;
  demoBadge.title = config.copy.demoTitle;
  const credit = $("#credit");
  credit.append(`${config.credit.label} `);
  if (config.credit.href) {
    const link = document.createElement("a");
    link.href = config.credit.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = config.credit.text;
    credit.append(link);
  } else {
    credit.append(config.credit.text);
  }

  // Without dates there is no recent window, no Latest list, and nothing to pulse.
  if (!config.dates.enabled) {
    $("#window").hidden = true;
    latestPanel.hidden = true;
    document.querySelector<HTMLElement>('[data-cat="pulse"]')!.hidden = true;
  }
}
paintChrome();
initSound(config.id);

// Small screens start with the side panels folded, so the globe is what you see first.
if (window.innerHeight < SHORT_PX || window.innerWidth < COMPACT_PX) {
  latestPanel.open = false;
  filtersEl.open = false;
}

// ---- State ---------------------------------------------------------------------------------------------------------

let hubs: HubRow[] = [];
let items: ItemRow[] = [];
let nodes: NodeRow[] = [];
let hubById = new Map<string, HubRow>();
let itemById = new Map<string, ItemRow>();
let nodeById = new Map<string, NodeRow>();
let nodesByItem = new Map<string, string[]>();
let itemsByNode = new Map<string, string[]>();

let query = "";
let recentOnly = false;
let hubId: string | null = null;
let itemId: string | null = null;
let nodeId: string | null = null;
let updatedAt = "";
let notice = "";
/** Compact screens: a hub shows its nodes only after its card link asks for them. */
let revealFor: string | null = null;

type Category = "hub" | "item" | "node" | "pulse";
const show: Record<Category, boolean> = { hub: true, item: true, node: false, pulse: config.dates.enabled };

function useData(data: Dataset) {
  hubs = data.hubs;
  // Newest first, so lists and rings show the latest.
  items = [...data.items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  nodes = data.nodes;
  updatedAt = data.updatedAt ?? "";
  hubById = new Map(hubs.map((row) => [row.id, row]));
  itemById = new Map(items.map((row) => [row.id, row]));
  nodeById = new Map(nodes.map((row) => [row.id, row]));
  nodesByItem = new Map();
  itemsByNode = new Map();
  for (const link of data.links) {
    (nodesByItem.get(link.item) ?? nodesByItem.set(link.item, []).get(link.item)!).push(link.node);
    (itemsByNode.get(link.node) ?? itemsByNode.set(link.node, []).get(link.node)!).push(link.item);
  }
}

// ---- Data helpers --------------------------------------------------------------------------------------------------

const spot = (row: { lat?: number; lng?: number }) =>
  typeof row.lat === "number" && typeof row.lng === "number" ? { lat: row.lat, lng: row.lng } : null;

function age(date?: string): number {
  if (!date) return NaN;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) ? Date.now() - time : NaN;
}

function within(item: ItemRow, days: number): boolean {
  if (!config.dates.enabled) return false;
  const ms = age(item.date);
  return ms >= 0 && ms <= days * DAY;
}

const recent = (item: ItemRow) => within(item, config.dates.recentDays);

function ago(date: string): string {
  const days = Math.floor(age(date) / DAY);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

const dateLine = (item: ItemRow) => (!item.date ? "No date" : recent(item) ? `${item.date} · ${ago(item.date)}` : item.date);

function hubItems(id: string): ItemRow[] {
  return items.filter((item) => item.hub === id && (!recentOnly || recent(item)));
}

function nodesFor(id: string): NodeRow[] {
  return (nodesByItem.get(id) ?? []).map((nodeKey) => nodeById.get(nodeKey)).filter((row): row is NodeRow => !!row);
}

function nodesServing(list: ItemRow[]): NodeRow[] {
  const ids = new Set<string>();
  for (const item of list) for (const nodeKey of nodesByItem.get(item.id) ?? []) ids.add(nodeKey);
  return [...ids].map((nodeKey) => nodeById.get(nodeKey)).filter((row): row is NodeRow => !!row);
}

const clock = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---- The globe -----------------------------------------------------------------------------------------------------

const globe = new Globe($("#globe"), {
  space: config.space,
  kinds: {
    hub: { name: [low(K.hub.one), low(K.hub.many)] },
    item: { name: [low(K.item.one), low(K.item.many)] },
    node: { name: [low(K.node.one), low(K.node.many)] },
  },
  onPick: (id, kind) => {
    if (kind === "hub") {
      hubId = id;
      itemId = null;
      nodeId = null;
      const place = spot(hubById.get(id) ?? {});
      if (place) globe.focus(place.lat, place.lng);
      cueOpen();
    } else if (kind === "item") {
      itemId = id;
      nodeId = null;
      cueSelect();
    } else {
      nodeId = id;
      cuePing();
      const place = spot(nodeById.get(id) ?? {});
      if (place) globe.focus(place.lat, place.lng);
    }
    render();
  },
  onEmpty: () => {
    // Clicking empty globe drops the selection and closes the card.
    if (!hubId && !itemId && !nodeId) return;
    revealFor = null;
    cueClear();
    hubId = null;
    itemId = null;
    nodeId = null;
    render();
  },
});
globe.onArcLand = cueLand;
globe.onClusterOpen = cueCluster;

function pickItem(item: ItemRow) {
  cueSelect();
  hubId = item.hub;
  itemId = item.id;
  nodeId = null;
  const place = spot(hubById.get(item.hub) ?? {});
  if (place) globe.focus(place.lat, place.lng);
  render();
}

/** Turn and zoom the globe so a hub and its mapped nodes are all in view. */
function frameNodes(hub: HubRow, mapped: NodeRow[]) {
  const spots = [spot(hub), ...mapped.map((row) => spot(row))].filter((s): s is NonNullable<typeof s> => s !== null);
  globe.frame(spots);
}

/**
 * Context decides what is on the map:
 * nothing selected → hubs (plus every node when "All nodes" is on);
 * hub → nodes linked to its items; item → its nodes, joined to the hub by arcs;
 * node → the hubs it is linked to. Everything outside the context is dimmed or hidden.
 */
function render() {
  const q = query.trim().toLowerCase();
  const shownHubs = hubs.filter((hub) => {
    if (q && !low(hub.name).includes(q) && !low(hub.id).includes(q)) return false;
    if (recentOnly && !hubItems(hub.id).length) return false;
    return spot(hub) !== null;
  });
  const visible = shownHubs.flatMap((hub) => hubItems(hub.id));
  const openHub = (hubId && hubById.get(hubId)) || null;
  const openItem = (itemId && itemById.get(itemId)) || null;
  const openNode = (nodeId && nodeById.get(nodeId)) || null;
  const itemNodes = openItem ? nodesFor(openItem.id) : [];

  let relatedHubs: Set<string> | null = null;
  let relatedNodes: NodeRow[] = [];
  if (openItem) {
    relatedHubs = new Set([openItem.hub]);
    relatedNodes = itemNodes;
  } else if (openNode) {
    const linked = new Set(itemsByNode.get(openNode.id) ?? []);
    relatedHubs = new Set(visible.filter((item) => linked.has(item.id)).map((item) => item.hub));
    relatedNodes = [openNode];
  } else if (openHub) {
    relatedHubs = new Set([openHub.id]);
    relatedNodes = !compact() || revealFor === openHub.id ? nodesServing(hubItems(openHub.id)) : [];
  }
  const selecting = relatedHubs !== null;

  const pins: Pin[] = [];
  for (const hub of show.hub ? shownHubs : []) {
    const place = spot(hub);
    if (!place) continue;
    const focus = hub.id === hubId && !itemId && !nodeId;
    const tone: Tone = focus ? "focus" : !selecting || relatedHubs?.has(hub.id) ? "related" : "dim";
    pins.push({
      id: hub.id,
      kind: "hub",
      label: hub.name,
      anchor: hub.id === hubId && !nodeId,
      // Other hubs step off the map while something is selected; clearing the selection brings them back.
      ghost: tone === "dim",
      tone,
      lat: place.lat,
      lng: place.lng,
      ripple: show.pulse && (focus || (tone !== "dim" && hubItems(hub.id).some(recent))),
    });
  }

  const pinned = new Map(relatedNodes.map((row) => [row.id, row]));
  if (show.node) for (const row of nodesServing(visible)) if (!pinned.has(row.id)) pinned.set(row.id, row);
  const relatedNodeIds = new Set(relatedNodes.map((row) => row.id));
  const arcs: Arc[] = [];
  for (const row of pinned.values()) {
    const place = spot(row);
    if (!place) continue;
    const tone: Tone = row.id === nodeId ? "focus" : !selecting || relatedNodeIds.has(row.id) ? "related" : "dim";
    if (tone === "dim") continue;
    pins.push({
      id: row.id,
      kind: "node",
      label: row.name,
      anchor: row.id === nodeId,
      tone,
      lat: place.lat,
      lng: place.lng,
      ripple: show.pulse && tone === "focus",
    });
    if (openItem && relatedNodeIds.has(row.id)) {
      arcs.push({ from: { kind: "hub", id: openItem.hub }, to: { kind: "node", id: row.id } });
    }
  }

  const hubHome = openHub ? spot(openHub) : null;
  const spawned = hubHome && show.item ? hubItems(openHub!.id).slice(0, config.fanLimit) : [];
  // An older selected item still gets a place in the ring.
  if (openItem && spawned.length && openItem.hub === openHub?.id && !spawned.includes(openItem)) {
    spawned[spawned.length - 1] = openItem;
  }
  spawned.forEach((item, index) => {
    const tone: Tone = item.id === itemId ? (nodeId ? "related" : "focus") : itemId ? "dim" : "related";
    pins.push({
      id: item.id,
      kind: "item",
      label: item.name,
      tone,
      lat: hubHome!.lat,
      lng: hubHome!.lng,
      fan: { index, count: spawned.length, hub: item.hub },
      ripple: show.pulse && tone === "focus",
    });
  });

  globe.show(pins, arcs);
  paintCard(openHub, openItem, itemNodes, openNode);
  paintCounts(shownHubs, [...pinned.values()]);
  paintLatest(q);
  fitPanels();
}

// ---- Lists and counts ----------------------------------------------------------------------------------------------

function paintCounts(shownHubs: HubRow[], pinnedNodes: NodeRow[]) {
  const fresh = items.filter(recent).length;
  setText("#count-all", String(items.length));
  setText("#count-recent", String(fresh));
  setText("#count-hub", String(shownHubs.length));
  setText("#count-item", String(recentOnly ? fresh : items.length));
  setText("#count-node", String(pinnedNodes.filter((row) => spot(row)).length));
  setText("#count-pulse", String(fresh));
  if (!clockHold) clockEl.textContent = stampText();
  if (!globe.ready) statusEl.textContent = config.copy.noWebGL;
  else if (notice) statusEl.textContent = notice;
  else statusEl.textContent = `${hubs.length} ${low(K.hub.many)} · ${items.length} ${low(K.item.many)} · ${nodes.length} ${low(K.node.many)}`;
}

/** Latest lists recent items: `latestDays` by default, `recentDays` when the recent window is on. */
function paintLatest(q: string) {
  if (!config.dates.enabled) return;
  const days = recentOnly ? config.dates.recentDays : config.dates.latestDays;
  const rows = (show.item ? items : [])
    .filter((item) => item.date && within(item, days))
    .filter((item) => !q || low(item.hub).includes(q) || low(hubById.get(item.hub)?.name ?? "").includes(q))
    .slice(0, config.latestLimit);
  setText("#latest-count", String(rows.length));
  setText("#latest-window", `${days} days`);
  latestEl.replaceChildren();
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = show.item ? `Nothing in the last ${days} days.` : `${K.item.many} are hidden.`;
    latestEl.append(li);
    return;
  }
  for (const item of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("on", item.id === itemId);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name;
    const by = document.createElement("span");
    by.className = "by";
    by.textContent = hubById.get(item.hub)?.name ?? item.hub;
    const date = document.createElement("span");
    date.className = "date";
    date.textContent = dateLine(item);
    button.append(name, by, date);
    button.addEventListener("click", () => pickItem(item));
    const li = document.createElement("li");
    li.append(button);
    latestEl.append(li);
  }
}

// ---- The card ------------------------------------------------------------------------------------------------------

/** The rows on a card come from the data (`facts`), with a few computed ones for counts and links. */
function paintCard(hub: HubRow | null, item: ItemRow | null, itemNodes: NodeRow[], openNode: NodeRow | null) {
  const node = item ? (itemNodes.find((row) => row.id === nodeId) ?? null) : openNode;
  cardEl.hidden = !hub && !item && !node;
  if (cardEl.hidden) return;
  const body = $("#card-body");
  body.replaceChildren();
  const kind = (label: string, id: string) => {
    setText("#card-id", label.toUpperCase());
    setText("#card-sub", `inspect ${low(label)} ${id}`);
  };
  const extra = (facts?: Fact[]) => facts?.forEach(([label, value, href]) => addFact(body, label, value, href));

  if (node) {
    const linked = (itemsByNode.get(node.id) ?? []).map((key) => itemById.get(key)).filter((row): row is ItemRow => !!row);
    const owners = [...new Set(linked.map((row) => hubById.get(row.hub)?.name).filter(Boolean))];
    kind(K.node.one, node.id);
    setText("#card-name", node.name);
    setText("#card-when", `${linked.length} ${low(linked.length === 1 ? K.item.one : K.item.many)} ${config.link.node}`);
    if (item) addFact(body, "For", item.name);
    addFact(body, K.hub.many, owners.join(" · ") || "—");
    addFact(body, "Place", node.place ?? "No pin");
    extra(node.facts);
  } else if (item && hub) {
    const mapped = itemNodes.filter((row) => spot(row));
    const summary = `${itemNodes.length} · ${mapped.length} on map`;
    kind(K.item.one, item.id);
    setText("#card-name", item.name);
    setText("#card-when", dateLine(item));
    addFact(body, K.hub.one, hub.name);
    const arcLabel = config.link.item[0].toUpperCase() + config.link.item.slice(1);
    if (mapped.length) addFact(body, arcLabel, summary, () => frameNodes(hub, mapped));
    else addFact(body, arcLabel, summary);
    extra(item.facts);
  } else if (hub) {
    const own = hubItems(hub.id);
    const fresh = own.filter(recent).length;
    const served = nodesServing(own);
    const mapped = served.filter((row) => spot(row));
    const summary = `${served.length} · ${mapped.length} on map`;
    kind(K.hub.one, hub.id);
    setText("#card-name", hub.name);
    setText("#card-when", `${own.length} ${low(own.length === 1 ? K.item.one : K.item.many)}${fresh ? ` · ${fresh} in ${config.dates.recentDays} days` : ""}`);
    addFact(body, "Place", hub.place ?? "No pin");
    if (own[0]) addFact(body, "Newest", own[0].name);
    if (mapped.length) {
      addFact(body, K.node.many, summary, () => {
        revealFor = hub.id;
        render();
        frameNodes(hub, mapped);
      });
    } else {
      addFact(body, K.node.many, summary);
    }
    extra(hub.facts);
  }
}

function addFact(root: HTMLElement, label: string, value: string, target?: string | (() => void)) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  if (value === "Yes" || value === "Open") dd.className = "yes";
  else if (value === "No") dd.className = "no";
  if (typeof target === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fact-link";
    button.textContent = `${value} ↗`;
    button.addEventListener("click", target);
    dd.append(button);
  } else if (target?.startsWith("https://")) {
    // Only https links, so a data file can't smuggle in a javascript: URL.
    const link = document.createElement("a");
    link.href = target;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = value;
    dd.append(link);
  } else {
    dd.textContent = value;
  }
  row.append(dt, dd);
  root.append(row);
}

// ---- Responsive layout ---------------------------------------------------------------------------------------------

const compact = () => window.innerWidth < COMPACT_PX;
const sheet = () => window.innerWidth < SHEET_PX;

/**
 * Short or narrow windows can't fit the card and both panels. When a selection opens the card there,
 * fold the side panels; the person can still reopen them.
 */
let lastCard = "";
function fitPanels() {
  const tight = window.innerHeight < SHORT_PX || compact();
  const card = cardEl.hidden ? "" : `${hubId}|${itemId}|${nodeId}`;
  appEl.dataset.card = card ? "open" : "closed";
  if (tight && card && card !== lastCard) {
    filtersEl.open = false;
    latestPanel.open = false;
  }
  lastCard = card;
  capCard();
  placeGlobe();
}

/** Compact screens: centre the globe in the space the card leaves free. */
function placeGlobe() {
  const box = cardEl.hidden ? null : cardEl.getBoundingClientRect();
  const inset = !box ? { left: 0, bottom: 0 } : sheet() ? { left: 0, bottom: box.height } : { left: box.right, bottom: 0 };
  globe.setLayout(compact(), inset);
}

/** The card and the filters share the left edge; the card stops above the filters. */
function capCard() {
  if (sheet()) {
    // Bottom sheet: its height comes from CSS.
    cardEl.style.maxHeight = "";
    return;
  }
  const room = filtersEl.getBoundingClientRect().top - cardEl.getBoundingClientRect().top - 10;
  cardEl.style.maxHeight = `${Math.max(room, 120)}px`;
}

// ---- Loading -------------------------------------------------------------------------------------------------------

/** While set, the top-bar time shows a short message instead of the data time. */
let clockHold = 0;
/** The "Data from …" line. Sample data has no real time to show, so demo mode leaves it blank. */
function stampText() {
  return updatedAt && !config.demo ? config.copy.stamp(clock(new Date(updatedAt))) : "";
}
function flashClock(message: string) {
  window.clearTimeout(clockHold);
  clockEl.textContent = message;
  clockHold = window.setTimeout(() => {
    clockHold = 0;
    clockEl.textContent = stampText();
  }, 3500);
}

/**
 * Fetch the dataset. Quiet loads (the background refresh) leave the UI alone unless the data changed;
 * a failed fetch keeps whatever is on screen and says it is the saved copy.
 */
async function load(options: { quiet?: boolean; force?: boolean } = {}) {
  if (!options.quiet) {
    statusEl.textContent = config.copy.loading;
    refreshEl.classList.add("spin");
    refreshEl.disabled = true;
  }
  try {
    const data = await fetchDataset(options.force);
    const changed = data.updatedAt !== updatedAt;
    if (options.force && !changed) flashClock(config.copy.upToDate);
    const before = notice;
    if (data.hubs.length) {
      useData(data);
      save(config.id, data);
    }
    notice = "";
    if (!options.quiet || changed || notice !== before) render();
  } catch {
    notice = hubs.length ? config.copy.offline(updatedAt ? clock(new Date(updatedAt)) : "") : config.copy.failed;
    render();
  }
  refreshEl.classList.remove("spin");
  refreshEl.disabled = false;
  appEl.dataset.state = "ready";
}

// ---- Controls ------------------------------------------------------------------------------------------------------

function setWindow(onlyRecent: boolean) {
  recentOnly = onlyRecent;
  recentEl.setAttribute("aria-pressed", String(recentOnly));
  recentEl.classList.toggle("on", recentOnly);
  allEl.setAttribute("aria-pressed", String(!recentOnly));
  allEl.classList.toggle("on", !recentOnly);
  if (hubId && !hubItems(hubId).length) {
    hubId = null;
    itemId = null;
    nodeId = null;
  }
  render();
}

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  render();
});
document.querySelectorAll<HTMLButtonElement>(".legend button[data-cat]").forEach((button) => {
  button.addEventListener("click", () => {
    const cat = button.dataset.cat as Category;
    show[cat] = !show[cat];
    cueTick();
    button.classList.toggle("on", show[cat]);
    button.setAttribute("aria-pressed", String(show[cat]));
    // Drop selections that the hidden category would leave dangling.
    if (!show.item) {
      itemId = null;
      nodeId = null;
    }
    render();
  });
});
recentEl.addEventListener("click", () => {
  cueTick();
  setWindow(true);
});
allEl.addEventListener("click", () => {
  cueTick();
  setWindow(false);
});
refreshEl.addEventListener("click", () => {
  cueTick();
  void load({ force: true });
});
document.querySelectorAll(".panel summary").forEach((summary) => summary.addEventListener("click", cueTick));
$("#card-close").addEventListener("click", () => {
  cueClear();
  if (nodeId) nodeId = null;
  else if (itemId) itemId = null;
  else hubId = null;
  render();
});

function showAbout(open: boolean) {
  if (aboutEl.hidden === !open) return;
  aboutEl.hidden = !open;
  aboutBtn.setAttribute("aria-expanded", String(open));
  cueTick();
}
aboutBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  showAbout(aboutEl.hidden);
});
$("#about-close").addEventListener("click", () => showAbout(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") showAbout(false);
});
// A click anywhere outside the panel closes it, the globe included.
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (!aboutEl.hidden && !aboutEl.contains(target) && !aboutBtn.contains(target)) showAbout(false);
});

function paintSound() {
  const on = soundOn();
  soundEl.setAttribute("aria-pressed", String(on));
  soundEl.setAttribute("aria-label", on ? "Sound on" : "Sound off");
  soundEl.title = on ? "Sound on" : "Sound off";
}
soundEl.addEventListener("click", () => {
  setSound(!soundOn());
  paintSound();
});
paintSound();

filtersEl.addEventListener("toggle", capCard);
window.addEventListener("resize", () => {
  capCard();
  render();
});

// ---- Start ---------------------------------------------------------------------------------------------------------

/** Starts the app: paint the saved data at once if there is any, then fetch fresh data and keep it current. */
export function start() {
  const saved = readSaved(config.id);
  if (saved) {
    useData(saved);
    appEl.dataset.state = "ready";
    render();
  }
  void load({ quiet: !!saved });
  setInterval(() => {
    if (!document.hidden) void load({ quiet: true });
  }, config.refreshMinutes * 60_000);
}
