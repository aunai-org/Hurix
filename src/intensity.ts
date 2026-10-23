// Saffir–Simpson bands by official 1-minute wind (kt), in the colours storm track maps conventionally use. The page
// colours each path checkpoint with these, and the legend lists them.

export interface Category { key: "na" | "td" | "ts" | "c1" | "c2" | "c3" | "c4" | "c5"; label: string; color: string; min: number }

export const CATEGORIES: Category[] = [
  { key: "td", label: "Tropical depression", color: "#5ebaff", min: 0 },
  { key: "ts", label: "Tropical storm", color: "#00faf4", min: 34 },
  { key: "c1", label: "Category 1", color: "#ffffcc", min: 64 },
  { key: "c2", label: "Category 2", color: "#ffe775", min: 83 },
  { key: "c3", label: "Category 3", color: "#ffc140", min: 96 },
  { key: "c4", label: "Category 4", color: "#ff8f20", min: 113 },
  { key: "c5", label: "Category 5", color: "#ff6060", min: 137 },
  { key: "na", label: "No official wind", color: "#9aa3ad", min: Infinity },
];

export function category(kt: number | null | undefined): Category {
  if (kt == null) return CATEGORIES[CATEGORIES.length - 1];
  return CATEGORIES.slice(0, -1).reduce((c, b) => (kt >= b.min ? b : c));
}
