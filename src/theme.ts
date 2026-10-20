/**
 * Colours the 3D scene uses. The page's own colours live as CSS variables at the top of style.css;
 * keep `accent` and `node` in step with `--accent` and `--node` there.
 */
export const THEME = {
  /** The selection, pulses, and the highlight on the logo. */
  accent: "#f5a04a",
  /** Ordinary markers. */
  ink: "#f4f4f4",
  /** Markers that are on the map for orientation only. */
  dim: "#6b7178",
  /** Secondary markers (nodes) and the arcs that reach them. */
  node: "#9ecbff",
  /** Fill behind every marker icon. */
  plate: "#101114",
  /** Font for the numbers on cluster badges. */
  font: '"IBM Plex Mono", monospace',
  /** The globe's surface, drawn from country outlines. */
  earth: {
    sea: "#07080b",
    land: ["#1c1e22", "#26282d", "#141618", "#2e3136", "#101214"],
    border: "#8b8e95",
  },
} as const;

/** "#f5a04a" → 0xf5a04a, for three.js colours. */
export const hex = (css: string): number => parseInt(css.slice(1), 16);
