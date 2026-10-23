// The HD window: an n x n block of the pipeline's cloud tiles around where the camera looks. Tile "r_c" is row r from
// the north and column c from 180 W; the window wraps across the dateline but stops at the poles.

export type TileGrid = { cols: number; rows: number; size: number; have: string[] };

/** The window's top-left tile, so (lat, lon) sits in its middle. */
export function tileWindow(lat: number, lon: number, g: TileGrid, n = 6): { r0: number; c0: number } {
  const row = ((90 - lat) / 180) * g.rows;
  const col = ((lon + 180) / 360) * g.cols;
  const r0 = Math.min(Math.max(Math.round(row - n / 2), 0), g.rows - n);
  const c0 = (((Math.round(col - n / 2)) % g.cols) + g.cols) % g.cols;
  return { r0, c0 };
}

/** The window in the globe's UV (v up): [u0, v0, du, dv]. u0 + du can pass 1; the shader wraps it with fract. */
export function windowRect(r0: number, c0: number, g: TileGrid, n = 6): [number, number, number, number] {
  return [c0 / g.cols, 1 - (r0 + n) / g.rows, n / g.cols, n / g.rows];
}

/** The window's tiles the pipeline wrote, with i the row and j the column inside the window. */
export function windowTiles(r0: number, c0: number, g: TileGrid, n = 6): { id: string; i: number; j: number }[] {
  const have = new Set(g.have);
  const out: { id: string; i: number; j: number }[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const id = `${r0 + i}_${(c0 + j) % g.cols}`;
      if (have.has(id)) out.push({ id, i, j });
    }
  return out;
}
