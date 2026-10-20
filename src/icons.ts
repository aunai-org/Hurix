import * as THREE from "three";
import { THEME } from "./theme";

/**
 * The three kinds of thing on the globe:
 * - hub: pinned on the map; its items fan out around it when it is selected.
 * - item: belongs to a hub and is not a place itself; it rings its hub.
 * - node: pinned elsewhere on the map, and linked to items by arcs.
 */
export type Kind = "hub" | "item" | "node";

/**
 * focus: the selection. related: tied to the selection (or everything when nothing is selected).
 * dim: on the map for orientation only.
 */
export type Tone = "focus" | "related" | "dim";

/** Draws one icon on a 96×96 canvas. Stroke and fill styles are already set for the tone; `color` is the tone's colour. */
export type DrawIcon = (g: CanvasRenderingContext2D, color: string, tone: Tone) => void;

export type KindStyle = {
  /** Singular and plural, used in cluster tooltips ("2 hubs"). */
  name: [string, string];
  /** Marker size in CSS pixels, whatever the zoom. */
  px: number;
  /** Colour when the marker is neither selected nor dimmed. */
  color: string;
  draw: DrawIcon;
};

export type KindStyles = Record<Kind, KindStyle>;

/** A hexagon with a three-node network inside. */
const drawHub: DrawIcon = (g, color, tone) => {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const x = 48 + Math.cos(a) * 38;
    const y = 48 + Math.sin(a) * 38;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.stroke();
  const nodes: [number, number][] = [
    [48, 30],
    [33, 57],
    [63, 57],
  ];
  g.lineWidth = tone === "focus" ? 4 : 3;
  g.beginPath();
  g.moveTo(...nodes[0]);
  g.lineTo(...nodes[1]);
  g.lineTo(...nodes[2]);
  g.closePath();
  g.stroke();
  g.fillStyle = color;
  for (const [x, y] of nodes) {
    g.beginPath();
    g.arc(x, y, 6.5, 0, Math.PI * 2);
    g.fill();
  }
};

/** A diamond. */
const drawItem: DrawIcon = (g) => {
  g.beginPath();
  g.moveTo(48, 14);
  g.lineTo(80, 48);
  g.lineTo(48, 82);
  g.lineTo(16, 48);
  g.closePath();
  g.fill();
  g.stroke();
};

/** A ring with a dot. */
const drawNode: DrawIcon = (g, color) => {
  g.beginPath();
  g.arc(48, 48, 28, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(48, 48, 8, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
};

export const DEFAULT_KINDS: KindStyles = {
  hub: { name: ["hub", "hubs"], px: 22, color: THEME.ink, draw: drawHub },
  item: { name: ["item", "items"], px: 16, color: THEME.ink, draw: drawItem },
  node: { name: ["node", "nodes"], px: 18, color: THEME.node, draw: drawNode },
};

/** The defaults with any per-kind changes applied: names, sizes, colours, or a whole new icon. */
export function kindStyles(overrides: Partial<Record<Kind, Partial<KindStyle>>> = {}): KindStyles {
  return {
    hub: { ...DEFAULT_KINDS.hub, ...overrides.hub },
    item: { ...DEFAULT_KINDS.item, ...overrides.item },
    node: { ...DEFAULT_KINDS.node, ...overrides.node },
  };
}

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function context(): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas is unavailable");
  return { canvas, g };
}

/** One marker icon for a kind and tone, as a texture. */
export function iconTexture(style: KindStyle, tone: Tone): THREE.CanvasTexture {
  const { canvas, g } = context();
  const color = tone === "focus" ? THEME.accent : tone === "dim" ? THEME.dim : style.color;
  g.strokeStyle = color;
  g.fillStyle = THEME.plate;
  g.lineWidth = tone === "focus" ? 7 : tone === "dim" ? 3 : 4;
  style.draw(g, color, tone);
  return texture(canvas);
}

/** A round badge with the number of pins it stands for. */
export function badgeTexture(count: number, tone: Tone): THREE.CanvasTexture {
  const { canvas, g } = context();
  const color = tone === "dim" ? THEME.dim : THEME.ink;
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.fillStyle = THEME.plate;
  g.fill();
  g.lineWidth = tone === "dim" ? 3 : 4;
  g.strokeStyle = color;
  g.stroke();
  g.beginPath();
  g.arc(48, 48, 32, 0, Math.PI * 2);
  g.lineWidth = 1.5;
  g.globalAlpha = 0.5;
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.font = `600 ${count > 9 ? 34 : 40}px ${THEME.font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(count), 48, 51);
  return texture(canvas);
}
