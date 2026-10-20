import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { feature } from "topojson-client";
import { geoEquirectangular, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import world from "world-atlas/countries-110m.json";
import { Space, rimGlow, type SpaceOptions } from "./space";
import { badgeTexture, iconTexture, kindStyles, type Kind, type KindStyle, type KindStyles, type Tone } from "./icons";
import { THEME, hex } from "./theme";
import type { Topology } from "topojson-specification";

const RADIUS = 1.48;
const RING_OUTER = 0.05;
const FLIGHT_MS = 700;
/** Pins closer than this on screen merge into one cluster badge. */
const CLUSTER_PX = 26;
/** Ring radii in CSS pixels: items around their hub, and pins fanned around a point. */
const FAN_PX = 40;
const RING_MIN_PX = 26;
/** Room each pin needs on a ring around a selection. */
const SLOT_PX = 19;
/** Compact screens: below this width markers draw smaller. */
const SMALL_PX = 700;

export type { Kind, KindStyle, KindStyles, Tone } from "./icons";

export type Pin = {
  id: string;
  kind: Kind;
  label: string;
  tone: Tone;
  ripple: boolean;
  lat: number;
  lng: number;
  /** Items fan out around their hub instead of sitting on the map. */
  fan?: { index: number; count: number; hub: string };
  /** The selected place: never clustered, and nearby pins ring around it. */
  anchor?: boolean;
  /** Tracked but not drawn (a hub hidden while something else is selected). */
  ghost?: boolean;
};

/** A link between two pins; it follows them wherever layout() draws them. */
export type Arc = { from: { kind: Kind; id: string }; to: { kind: Kind; id: string } };


const TONE_SCALE: Record<Tone, number> = { focus: 1.3, related: 1, dim: 0.7 };

export function toVector(lat: number, lng: number, radius = RADIUS): THREE.Vector3 {
  const a = (lat * Math.PI) / 180;
  const b = (lng * Math.PI) / 180;
  return new THREE.Vector3(radius * Math.cos(a) * Math.cos(b), radius * Math.sin(a), -radius * Math.cos(a) * Math.sin(b));
}

function toLatLng(v: THREE.Vector3): { lat: number; lng: number } {
  const n = v.clone().normalize();
  return { lat: (Math.asin(n.y) * 180) / Math.PI, lng: (Math.atan2(-n.z, n.x) * 180) / Math.PI };
}

function earthTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = THEME.earth.sea;
  ctx.fillRect(0, 0, 2048, 1024);
  const topology = world as unknown as Topology;
  const countries = feature(topology, topology.objects.countries) as FeatureCollection<Geometry>;
  const projection = geoEquirectangular().scale(2048 / (2 * Math.PI)).translate([1024, 512]);
  const path = geoPath(projection, ctx);
  const land = THEME.earth.land;
  countries.features.forEach((country, i) => {
    ctx.beginPath();
    path(country);
    ctx.fillStyle = land[i % land.length];
    ctx.fill();
    ctx.strokeStyle = THEME.earth.border;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return tex;
}

/** A point on a ring of `radius` world units around `center`, lifted off the surface. */
function around(center: THREE.Vector3, index: number, count: number, radius: number, lift = 0.06): THREE.Vector3 {
  const up = center.clone().normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
  if (east.lengthSq() < 1e-4) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const ang = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 2;
  return up
    .multiplyScalar(RADIUS + lift)
    .addScaledVector(east, Math.cos(ang) * radius)
    .addScaledVector(north, Math.sin(ang) * radius);
}

const ARC_STEPS = 48;
/** Arcs draw out from their first end over this long, one after another. */
const ARC_MS = 650;
const ARC_STAGGER_MS = 70;

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
/** A small overshoot, so a marker pops in as its arc lands. */
const popIn = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2));

/** Redraw an arc between two marker positions: a raised great circle, or a short tether when they're close. */
function bend(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) {
  const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  const ua = a.clone().normalize();
  const ub = b.clone().normalize();
  const lift = Math.min(ua.angleTo(ub) * 0.18, 0.16);
  const ra = a.length();
  const rb = b.length();
  const p = new THREE.Vector3();
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS;
    p.copy(ua).lerp(ub, t).normalize().multiplyScalar(ra + (rb - ra) * t + Math.sin(Math.PI * t) * lift);
    attr.setXYZ(i, p.x, p.y, p.z);
  }
  attr.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}

/** Every arc looks the same, so they share one material; only their geometry is per arc. */
const ARC_MATERIAL = new THREE.LineBasicMaterial({ color: hex(THEME.node), transparent: true, opacity: 0.7 });

function arcLine(arc: Arc): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((ARC_STEPS + 1) * 3), 3));
  const line = new THREE.Line(geometry, ARC_MATERIAL);
  line.userData = { from: `${arc.from.kind}:${arc.from.id}`, to: `${arc.to.kind}:${arc.to.id}` };
  return line;
}

type Marker = THREE.Sprite & {
  userData: {
    id: string;
    kind: Kind;
    label: string;
    tone: Tone;
    home: THREE.Vector3;
    fan: { index: number; count: number; hub: string } | null;
    anchor: boolean;
    ghost: boolean;
    ring: THREE.Mesh | null;
  };
};

/** A hub and a node can share an id (an organisation that is both), so key by kind and id. */
const key = (m: Marker) => `${m.userData.kind}:${m.userData.id}`;

type Badge = THREE.Sprite & {
  userData: { center: THREE.Vector3; ids: string[]; label: string; ring: THREE.Mesh; tone: Tone; count: number };
};

export type GlobeOptions = {
  onPick: (id: string, kind: Kind) => void;
  /** A click on empty globe or space (not a drag). */
  onEmpty?: () => void;
  /** Per-kind names, sizes, colours, or a whole new icon. */
  kinds?: Partial<Record<Kind, Partial<KindStyle>>>;
  /** How much of the space backdrop to draw. */
  space?: SpaceOptions;
};

export class Globe {
  readonly ready: boolean;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private markers = new THREE.Group();
  private badges = new THREE.Group();
  private ripples = new THREE.Group();
  private arcs = new THREE.Group();
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private down: [number, number] | null = null;
  private onPick: (id: string, kind: Kind) => void;
  private onEmpty: () => void;
  private kinds: KindStyles;
  /** Hooks for sound: an arc landed, or a cluster badge opened. */
  onArcLand?: (order: number) => void;
  onClusterOpen?: () => void;
  private icons = new Map<string, THREE.CanvasTexture>();
  private markerMaterials = new Map<string, THREE.SpriteMaterial>();
  private ringPool: THREE.Mesh[] = [];
  private ringsUsed = 0;
  private ringGeometry = new THREE.RingGeometry(RING_OUTER * 0.8, RING_OUTER, 40);
  private scratch = new THREE.Vector3();
  private flight: { from: THREE.Quaternion; to: THREE.Quaternion; dir: THREE.Vector3; start: number; d0: number; d1: number } | null =
    null;
  /** A cluster that could not split by zooming, fanned out in place. */
  private spider: { center: THREE.Vector3; ids: string[]; dist: number; pivot?: string } | null = null;
  /** The ring around the current selection, as of the last frame. */
  private lastRing: { center: THREE.Vector3; ids: string[]; pivot: string } | null = null;
  /** Arcs already on screen; only new ones animate, so a re-render doesn't replay them. */
  private arcKeys = new Set<string>();
  private compact = false;
  /** Screen space covered by panels; the globe centres itself in what is left. */
  private inset = { left: 0, bottom: 0 };
  private shift = { x: 0, y: 0 };
  private tip: HTMLElement;
  private hover: [number, number] | null = null;

  constructor(private root: HTMLElement, options: GlobeOptions) {
    this.onPick = options.onPick;
    this.onEmpty = options.onEmpty ?? (() => {});
    this.kinds = kindStyles(options.kinds);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(1.2, 0.8, 6.6);
    this.tip = document.createElement("div");
    this.tip.className = "tip";
    this.tip.hidden = true;
    this.root.append(this.tip);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(1);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.root.append(this.renderer.domElement);
      this.ready = true;
    } catch {
      this.ready = false;
      return;
    }
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.55;
    this.controls.minDistance = 3.1;
    this.controls.maxDistance = 9;
    this.controls.addEventListener("start", () => {
      this.flight = null;
    });
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 40, 28),
      new THREE.MeshPhongMaterial({ map: earthTexture(this.renderer), specular: 0x111111, shininess: 4 }),
    );
    this.scene.add(globe);
    this.scene.add(new THREE.AmbientLight(0xc8c8cc, 1.05));
    const sun = new THREE.DirectionalLight(0xf2f2f4, 1.15);
    sun.position.set(-3, 1.6, 4.2);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x3a3d44, 0.4);
    fill.position.set(3.4, -1.2, -2.8);
    this.scene.add(fill);
    this.scene.add(rimGlow(RADIUS));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const space = new Space(this.scene, this.camera, RADIUS, still, options.space);
    this.scene.add(this.arcs, this.ripples, this.markers, this.badges);
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      this.down = [event.clientX, event.clientY];
    });
    canvas.addEventListener("pointerup", (event) => this.pick(event));
    canvas.addEventListener("pointermove", (event) => {
      this.hover = event.buttons ? null : [event.clientX, event.clientY];
    });
    // Scrolling out re-stacks an open fan-out, even at the zoom limit where the camera cannot move further.
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (event.deltaY > 0) this.spider = null;
      },
      { passive: true },
    );
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
    });
    this.resize();
    window.addEventListener("resize", () => this.resize());
    let last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      // A hidden tab draws nothing, which saves battery and keeps the effects from piling up.
      if (document.hidden) {
        last = performance.now();
        return;
      }
      const now = performance.now();
      space.update(Math.min((now - last) / 1000, 0.05));
      last = now;
      this.fly(now);
      this.offsetView();
      this.controls?.update();
      this.layout(now / 1000);
      this.hoverTip();
      this.renderer?.render(this.scene, this.camera);
    };
    loop();
  }

  show(pins: Pin[], arcs: Arc[]) {
    this.clear();
    const present = new Set(pins.map((pin) => `${pin.kind}:${pin.id}`));
    if (pins.some((pin) => pin.anchor)) {
      // A new selection rings its own neighbours; an older fan-out would leave some of them clustered on top of it.
      this.spider = null;
    } else if (this.spider) {
      // Keep an open fan-out while its pins are still on the map.
      const ids = this.spider.ids.filter((id) => present.has(id));
      this.spider = ids.length > 1 ? { ...this.spider, ids } : null;
    } else if (this.lastRing && !pins.some((pin) => pin.anchor)) {
      // The selection was cleared: keep its neighbours fanned out rather than merging them back.
      const ids = this.lastRing.ids.filter((id) => present.has(id));
      if (ids.length > 1) this.spider = { ...this.lastRing, ids, dist: this.camera.position.length() };
    }
    for (const pin of pins) {
      // A fanned item's home is its hub; layout() rings it around that point.
      this.add(pin, toVector(pin.lat, pin.lng, RADIUS + (pin.kind === "node" ? 0.05 : 0.02)));
    }
    const now = performance.now();
    const next = new Set<string>();
    let order = 0;
    for (const arc of arcs) {
      const line = arcLine(arc);
      const id = `${line.userData.from}>${line.userData.to}`;
      next.add(id);
      const settled = this.arcKeys.has(id);
      line.userData.born = settled ? -Infinity : now + order * ARC_STAGGER_MS;
      line.userData.order = settled ? -1 : order++;
      line.userData.landed = settled;
      this.arcs.add(line);
    }
    this.arcKeys = next;
  }

  /** Turn the globe to face a place. Keeps the current zoom unless a distance is given. */
  focus(lat: number, lng: number, distance?: number) {
    const from = this.camera.position.clone().normalize();
    const to = toVector(lat, lng, 1).normalize();
    const d0 = this.camera.position.length();
    this.flight = {
      from: new THREE.Quaternion(),
      to: new THREE.Quaternion().setFromUnitVectors(from, to),
      dir: from,
      start: performance.now(),
      d0,
      d1: distance ?? d0,
    };
  }

  /** Compact layout (small screens): capped rings, smaller markers, and a globe centred in the free area. */
  setLayout(compact: boolean, inset: { left: number; bottom: number }) {
    this.compact = compact;
    this.inset = compact ? inset : { left: 0, bottom: 0 };
  }

  private markerScale(): number {
    return this.compact && (this.renderer?.domElement.clientWidth ?? 1000) < SMALL_PX ? 0.85 : 1;
  }

  /** Ease the view offset toward the free area so a panel never sits on the selection. */
  private offsetView() {
    const w = Math.max(this.root.clientWidth, 1);
    const h = Math.max(this.root.clientHeight, 1);
    const tx = -this.inset.left / 2;
    const ty = this.inset.bottom / 2;
    if (Math.abs(tx - this.shift.x) < 0.5 && Math.abs(ty - this.shift.y) < 0.5 && tx === this.shift.x && ty === this.shift.y) return;
    this.shift.x += (tx - this.shift.x) * 0.15;
    this.shift.y += (ty - this.shift.y) * 0.15;
    if (Math.abs(tx - this.shift.x) < 0.5) this.shift.x = tx;
    if (Math.abs(ty - this.shift.y) < 0.5) this.shift.y = ty;
    if (this.shift.x === 0 && this.shift.y === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, this.shift.x, this.shift.y, w, h);
  }

  /** Turn and zoom so every given place is in view. */
  frame(spots: { lat: number; lng: number }[]) {
    if (!spots.length) return;
    const dirs = spots.map((spot) => toVector(spot.lat, spot.lng, 1));
    const center = dirs.reduce((sum, dir) => sum.add(dir), new THREE.Vector3());
    if (center.lengthSq() < 1e-6) center.copy(dirs[0]);
    center.normalize();
    const spread = Math.max(...dirs.map((dir) => dir.angleTo(center)));
    const min = this.controls?.minDistance ?? 3.1;
    const max = this.controls?.maxDistance ?? 9;
    const distance = Math.min(max, Math.max(min, RADIUS + 2.2 + spread * 5.5));
    const { lat, lng } = toLatLng(center);
    this.spider = null;
    this.focus(lat, lng, distance);
  }

  private fly(now: number) {
    if (!this.flight) return;
    const k = Math.min((now - this.flight.start) / FLIGHT_MS, 1);
    const ease = 1 - Math.pow(1 - k, 3);
    const turn = this.flight.from.clone().slerp(this.flight.to, ease);
    const dist = this.flight.d0 + (this.flight.d1 - this.flight.d0) * ease;
    this.camera.position.copy(this.flight.dir).applyQuaternion(turn).setLength(dist);
    if (k === 1) this.flight = null;
  }

  /**
   * Every frame: fixed pixel sizes, far-side hiding, and screen-space clustering.
   * Clusters only form among pins of the same tone, and never include the selection.
   */
  private layout(t: number) {
    const cam = this.camera.position;
    const height = Math.max(this.renderer?.domElement.clientHeight ?? 1, 1);
    const width = Math.max(this.renderer?.domElement.clientWidth ?? 1, 1);
    const perPx = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / height;
    const horizon = RADIUS * RADIUS;
    const facing = (at: THREE.Vector3) => this.scratch.copy(at).setLength(RADIUS).dot(cam) - horizon > 0;
    const worldSize = (at: THREE.Vector3, px: number) => px * perPx * at.distanceTo(cam);

    // Rings scale with the window: tighter on small screens, capped on large ones.
    const unit = Math.min(Math.max(Math.min(width, height) / 800, 0.6), 1);
    const ringPx = (n: number) => Math.max(RING_MIN_PX, 10 + n * 5) * unit;
    const fanPx = (n: number) => (FAN_PX + n * 1.5) * unit;
    const screen = (at: THREE.Vector3) => {
      const p = this.scratch.copy(at).project(this.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };

    // Zooming out closes a fan-out, but not while a flight is still carrying the camera in.
    // A fan-out measures from the closest zoom since it opened, so zooming out from there always re-stacks it.
    if (this.spider && !this.flight) {
      this.spider.dist = Math.min(this.spider.dist, cam.length());
      if (cam.length() > this.spider.dist + 0.35) this.spider = null;
    }
    const spun = new Map<string, THREE.Vector3>();
    if (this.spider) {
      const { center, ids, pivot } = this.spider;
      const rim = ids.filter((id) => id !== pivot);
      const r = worldSize(center, ringPx(rim.length));
      if (pivot) spun.set(pivot, center.clone().setLength(RADIUS + 0.02));
      rim.forEach((id, i) => spun.set(id, around(center, i, rim.length, r, 0.05)));
    }

    const markers = this.markers.children as Marker[];
    // The selection's neighbours ring around it, just outside its item ring, so nothing hides under it.
    // Remember that ring, plus any hidden hubs beside it: clearing the selection leaves them fanned out.
    this.lastRing = null;
    const anchor = markers.find((m) => m.userData.anchor && facing(m.userData.home));
    if (anchor && !spun.has(key(anchor))) {
      const at = screen(anchor.userData.home);
      const close = (m: Marker) => {
        const p = screen(m.userData.home);
        return Math.hypot(p.x - at.x, p.y - at.y) <= CLUSTER_PX;
      };
      const candidates = markers.filter(
        (m) => m !== anchor && !m.userData.fan && !spun.has(key(m)) && facing(m.userData.home) && close(m),
      );
      const near = candidates.filter((m) => !m.userData.ghost);
      const fanCount = markers.filter((m) => m.userData.fan).length;
      // Big enough that every neighbour gets its own slot, and never inside the item ring.
      const slots = (near.length * SLOT_PX) / (2 * Math.PI);
      const ringR = Math.max(fanCount ? fanPx(fanCount) + 16 * unit : ringPx(near.length), slots);
      const r = worldSize(anchor.userData.home, ringR);
      near.forEach((m, i) => spun.set(key(m), around(anchor.userData.home, i, near.length, r, 0.05)));
      if (candidates.length) {
        this.lastRing = { center: anchor.userData.home.clone(), pivot: key(anchor), ids: [key(anchor), ...candidates.map(key)] };
      }
    }

    const loose: { m: Marker; x: number; y: number }[] = [];
    // Place map pins first, so a fanned item can ring its hub where the hub is drawn.
    const drawn = new Map<string, THREE.Vector3>();
    const ordered = [...markers.filter((m) => !m.userData.fan), ...markers.filter((m) => m.userData.fan)];
    for (const m of ordered) {
      const d = m.userData;
      if (d.fan) {
        const center = drawn.get(`hub:${d.fan.hub}`) ?? d.home;
        const r = worldSize(center, fanPx(d.fan.count));
        m.position.copy(around(center, d.fan.index, d.fan.count, r));
      } else {
        m.position.copy(spun.get(key(m)) ?? d.home);
        drawn.set(key(m), m.position);
      }
      // Ghosts are hubs hidden while something is selected: tracked, never drawn.
      m.visible = !d.ghost && facing(d.fan ? d.home : m.position);
      if (m.visible && !d.fan && !d.anchor && d.tone !== "focus" && !spun.has(key(m))) {
        loose.push({ m, ...screen(m.position) });
      }
    }

    // Greedy clustering: hubs seed first so a hub city reads as a hub cluster.
    loose.sort((a, b) => (a.m.userData.kind === "hub" ? 0 : 1) - (b.m.userData.kind === "hub" ? 0 : 1));
    const groups: Marker[][] = [];
    const taken = new Set<Marker>();
    for (const seed of loose) {
      if (taken.has(seed.m)) continue;
      const group = [seed.m];
      taken.add(seed.m);
      for (const other of loose) {
        if (taken.has(other.m) || other.m.userData.tone !== seed.m.userData.tone) continue;
        if (Math.hypot(other.x - seed.x, other.y - seed.y) <= CLUSTER_PX) {
          group.push(other.m);
          taken.add(other.m);
        }
      }
      if (group.length > 1) groups.push(group);
    }

    const pool = this.badges.children as Badge[];
    groups.forEach((group, i) => {
      for (const m of group) m.visible = false;
      const center = new THREE.Vector3();
      for (const m of group) center.add(m.position.clone().normalize());
      center.setLength(RADIUS + 0.06);
      const tone = group[0].userData.tone;
      const names = group.map((m) => m.userData.label);
      const counts = (["hub", "item", "node"] as Kind[])
        .map((kind) => {
          const n = group.filter((m) => m.userData.kind === kind).length;
          return n ? `${n} ${this.kinds[kind].name[n > 1 ? 1 : 0]}` : "";
        })
        .filter(Boolean)
        .join(" · ");
      const label = [counts, names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "")].join("\n");
      const b = pool[i] ?? this.newBadge();
      b.visible = true;
      b.position.copy(center);
      b.userData.center = center;
      b.userData.ids = group.map(key);
      b.userData.label = label;
      if (b.userData.tone !== tone || b.userData.count !== group.length) {
        b.userData.tone = tone;
        b.userData.count = group.length;
        b.material.map = this.badgeTex(group.length, tone);
        b.material.opacity = tone === "dim" ? 0.6 : 1;
        b.material.needsUpdate = true;
      }
      // A cluster pulses once when anything inside it pulses.
      b.userData.ring.visible = group.some((m) => m.userData.ring);
      b.userData.ring.position.copy(center);
      b.userData.ring.lookAt(center.clone().multiplyScalar(2));
      const px = 26 * (tone === "dim" ? 0.8 : 1) * this.markerScale();
      const size = worldSize(center, px);
      b.scale.set(size, size, 1);
      this.pulse(b.userData.ring, size, t, 0);
    });
    for (let i = groups.length; i < pool.length; i++) {
      pool[i].visible = false;
      pool[i].userData.ring.visible = false;
    }

    // Arcs grow out from their first end; each marker pops in as its arc lands. Settled arcs cost nothing extra.
    const now = t * 1000;
    const landing = new Map<string, number>();
    for (const line of this.arcs.children as THREE.Line[]) {
      const elapsed = now - (line.userData.born as number);
      const grow = Math.min(Math.max(elapsed / ARC_MS, 0), 1);
      line.geometry.setDrawRange(0, Math.round(easeOut(grow) * (ARC_STEPS + 1)));
      if (!line.userData.landed && elapsed >= ARC_MS * 0.8) {
        line.userData.landed = true;
        this.onArcLand?.(line.userData.order as number);
      }
      if (grow < 1 || elapsed < ARC_MS * 1.2) {
        landing.set(line.userData.to as string, Math.min(Math.max((elapsed - ARC_MS * 0.8) / 260, 0), 1));
      }
    }

    for (const m of markers) {
      const d = m.userData;
      const arrive = landing.get(key(m));
      const size =
        worldSize(m.position, this.kinds[d.kind].px * TONE_SCALE[d.tone] * this.markerScale()) * (arrive === undefined ? 1 : popIn(arrive));
      m.scale.set(size, size, 1);
      if (d.ring) {
        d.ring.visible = m.visible;
        d.ring.position.copy(m.position);
        d.ring.lookAt(m.position.clone().multiplyScalar(2));
        this.pulse(d.ring, size, t, d.ring.userData.phase as number);
      }
    }

    if (this.arcs.children.length) {
      const byKey = new Map(markers.map((m) => [key(m), m]));
      for (const line of this.arcs.children as THREE.Line[]) {
        const from = byKey.get(line.userData.from as string);
        const to = byKey.get(line.userData.to as string);
        line.visible = !!from && !!to;
        // A clustered end is hidden; draw to where it really is, which sits under its badge.
        if (from && to) bend(line, from.position, to.visible ? to.position : to.userData.home);
      }
    }
  }

  private pulse(ring: THREE.Mesh, size: number, t: number, phase: number) {
    const k = ((t + phase) % 1.6) / 1.6;
    ring.scale.setScalar((size / 2 / RING_OUTER) * (1 + k * 1.6));
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
  }

  private hoverTip() {
    if (!this.hover || !this.renderer) {
      this.tip.hidden = true;
      this.renderer?.domElement.style.setProperty("cursor", "");
      return;
    }
    const hit = this.hitAt(this.hover[0], this.hover[1]);
    const label = hit ? (hit.userData.label as string) : "";
    this.renderer.domElement.style.cursor = hit ? "pointer" : "";
    if (!label) {
      this.tip.hidden = true;
      return;
    }
    const rect = this.root.getBoundingClientRect();
    if (this.tip.textContent !== label) this.tip.textContent = label;
    this.tip.style.left = `${this.hover[0] - rect.left + 14}px`;
    this.tip.style.top = `${this.hover[1] - rect.top + 14}px`;
    this.tip.hidden = false;
  }

  private hitAt(x: number, y: number): THREE.Object3D | null {
    if (!this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const targets = [...this.badges.children, ...this.markers.children].filter((o) => o.visible);
    return this.ray.intersectObjects(targets, false)[0]?.object ?? null;
  }

  /**
   * Drop this frame's markers and arcs, but keep materials, pulse rings and badges for reuse.
   * Disposing every material on each selection left each shader program briefly unused, so three.js
   * deleted and recompiled it on every click (a stall, and dead programs piling up until GC).
   */
  private clear() {
    for (const line of this.arcs.children as THREE.Line[]) line.geometry.dispose();
    this.arcs.clear();
    this.markers.clear();
    for (const ring of this.ringPool) ring.visible = false;
    this.ringsUsed = 0;
  }

  private tex(kind: Kind, tone: Tone): THREE.CanvasTexture {
    const key = `${kind}:${tone}`;
    const cached = this.icons.get(key);
    if (cached) return cached;
    const made = iconTexture(this.kinds[kind], tone);
    this.icons.set(key, made);
    return made;
  }

  private badgeTex(count: number, tone: Tone): THREE.CanvasTexture {
    const key = `badge:${count}:${tone}`;
    const cached = this.icons.get(key);
    if (cached) return cached;
    const made = badgeTexture(count, tone);
    this.icons.set(key, made);
    return made;
  }

  private makeRing(color: number): THREE.Mesh {
    const ring = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.userData.phase = Math.random();
    this.ripples.add(ring);
    return ring;
  }

  /** A pulse ring for a marker, reused across selections (each keeps its own material for its own fade). */
  private ring(color: number): THREE.Mesh {
    const ring = this.ringPool[this.ringsUsed] ?? this.ringPool[this.ringPool.push(this.makeRing(color)) - 1];
    this.ringsUsed++;
    (ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    ring.userData.phase = Math.random();
    return ring;
  }

  /** One shared material per icon style; position and size live on each sprite, not the material. */
  private markerMaterial(kind: Kind, tone: Tone): THREE.SpriteMaterial {
    const key = `${kind}:${tone}`;
    let material = this.markerMaterials.get(key);
    if (!material) {
      material = new THREE.SpriteMaterial({
        map: this.tex(kind, tone),
        transparent: true,
        opacity: tone === "dim" ? 0.6 : 1,
        depthTest: false,
        depthWrite: false,
      });
      this.markerMaterials.set(key, material);
    }
    return material;
  }

  private newBadge(): Badge {
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false })) as Badge;
    b.renderOrder = 2;
    b.userData = { center: new THREE.Vector3(), ids: [], label: "", ring: this.makeRing(hex(THEME.ink)), tone: "related", count: 0 };
    this.badges.add(b);
    return b;
  }

  private add(pin: Pin, home: THREE.Vector3) {
    const sprite = new THREE.Sprite(this.markerMaterial(pin.kind, pin.tone)) as Marker;
    sprite.position.copy(home);
    sprite.renderOrder = pin.tone === "focus" ? 5 : pin.kind === "node" ? 4 : pin.kind === "item" ? 3 : 1;
    sprite.userData = {
      id: pin.id,
      kind: pin.kind,
      label: pin.label,
      tone: pin.tone,
      home,
      fan: pin.fan ?? null,
      anchor: pin.anchor === true,
      ghost: pin.ghost === true,
      ring: pin.ripple ? this.ring(hex(pin.tone === "focus" ? THEME.accent : THEME.ink)) : null,
    };
    this.markers.add(sprite);
  }

  private resize() {
    const w = Math.max(this.root.clientWidth, 1);
    const h = Math.max(this.root.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(w, h, false);
  }

  private pick(event: PointerEvent) {
    if (!this.renderer || !this.down) return;
    if (Math.hypot(event.clientX - this.down[0], event.clientY - this.down[1]) > 8) return;
    const hit = this.hitAt(event.clientX, event.clientY);
    if (!hit) {
      // A click on the globe or space (not a drag) clears the selection.
      this.onEmpty();
      return;
    }
    if (this.badges.children.includes(hit)) {
      const { center, ids } = (hit as Badge).userData;
      this.openCluster(center, ids);
    } else {
      this.onPick(hit.userData.id as string, hit.userData.kind as Kind);
    }
  }

  /** Zoom toward a cluster; once zoom can't split it, fan its pins out in place. */
  private openCluster(center: THREE.Vector3, ids: string[]) {
    const dist = this.camera.position.length();
    const min = this.controls?.minDistance ?? 3.1;
    const { lat, lng } = toLatLng(center);
    this.onClusterOpen?.();
    // One click: zoom in and fan the group out together.
    const target = Math.max(min, RADIUS + (dist - RADIUS) * 0.55);
    this.focus(lat, lng, target);
    this.spider = { center: center.clone(), ids, dist: target };
  }
}
