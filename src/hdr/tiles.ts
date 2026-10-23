// The HD window: an n x n block of the pipeline's cloud tiles around where the camera looks. Tile "r_c" is row r from
// the north and column c from 180 W; the window wraps across the dateline but stops at the poles.

/** dir: the tiles' folder under data/, named after their frame, so a page left open never mixes in a later run's tiles. */
export type TileGrid = { cols: number; rows: number; size: number; have: string[]; dir?: string };

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

/** Where tile id is, relative to the site root. */
export const tileUrl = (g: TileGrid, id: string) => `data/${g.dir ?? "tiles"}/${id}.jpg`;

type Ctx<I> = { clearRect(x: number, y: number, w: number, h: number): void; drawImage(img: I, x: number, y: number): void };
type Canvas<I> = { width: number; height: number; getContext(kind: "2d"): Ctx<I> | null };

/**
 * The HD window's tiles drawn into one n x n atlas. The canvas is made the first time the window is pointed somewhere,
 * so nobody who leaves HD off pays for it. Moving the window redraws the tiles already loaded straight away, in their
 * new places, and asks for an upload together with the new rect, so the GPU never shows tiles under the wrong rect.
 */
export class HDAtlas<I extends { close?(): void }> {
  canvas: Canvas<I> | null = null;
  key = ""; r0 = 0; c0 = 0;
  private ctx: Ctx<I> | null = null;
  private loaded = new Map<string, I>();  // least recently used first
  private loading = new Map<string, Promise<I | null>>();
  private ticket = 0;
  private dirty = false;
  /** The window moved: the next upload can't wait. */
  urgent = false;

  constructor(private g: TileGrid, private make: (w: number, h: number) => Canvas<I>, private load: (id: string) => Promise<I>,
    private n = 6, private cap = 54) {}

  /** Points the window at (lat, lon). It moves only once the view is a whole tile away from the window's centre. */
  point(lat: number, lon: number) {
    const next = tileWindow(lat, lon, this.g, this.n);
    if (this.key) {
      if (next.r0 === this.r0 && next.c0 === this.c0) return;
      const row = ((90 - lat) / 180) * this.g.rows - (this.r0 + this.n / 2);
      const col = ((((lon + 180) / 360) * this.g.cols - (this.c0 + this.n / 2)) % this.g.cols + 1.5 * this.g.cols) % this.g.cols - this.g.cols / 2;
      if ((next.r0 === this.r0 || Math.abs(row) < 1) && (next.c0 === this.c0 || Math.abs(col) < 1)) return;
    }
    if (!this.canvas) {
      this.canvas = this.make(this.n * this.g.size, this.n * this.g.size);
      this.ctx = this.canvas.getContext("2d");
    }
    this.r0 = next.r0; this.c0 = next.c0; this.key = `${next.r0}_${next.c0}`;
    const ticket = ++this.ticket, tiles = windowTiles(this.r0, this.c0, this.g, this.n);
    this.ctx!.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = this.urgent = true;
    const missing = tiles.filter((t) => {
      const img = this.loaded.get(t.id);
      if (!img) return true;
      this.loaded.delete(t.id); this.loaded.set(t.id, img);  // recently used
      this.draw(img, t.i, t.j);
      return false;
    });
    const worker = async () => {
      for (let t = missing.shift(); t; t = missing.shift()) {
        const img = await this.fetch(t.id);
        if (ticket !== this.ticket) return;  // the window moved on while this tile loaded
        if (img) { this.draw(img, t.i, t.j); this.dirty = true; }
      }
    };
    for (let k = 0; k < 6; k++) void worker();
  }

  /** What to upload now, if anything: the rect the atlas holds. */
  take(): { rect: [number, number, number, number] } | null {
    if (!this.dirty) return null;
    this.dirty = this.urgent = false;
    return { rect: windowRect(this.r0, this.c0, this.g, this.n) };
  }

  private draw(img: I, i: number, j: number) { this.ctx!.drawImage(img, j * this.g.size, i * this.g.size); }

  private fetch(id: string) {
    let p = this.loading.get(id);
    if (!p) {
      p = this.load(id).then((img) => { this.keep(id, img); return img; }, () => null).finally(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return p;
  }

  private keep(id: string, img: I) {
    this.loaded.set(id, img);
    const inWindow = new Set(windowTiles(this.r0, this.c0, this.g, this.n).map((t) => t.id));
    for (const [old, im] of this.loaded) {
      if (this.loaded.size <= this.cap) break;
      if (inWindow.has(old)) continue;
      this.loaded.delete(old); im.close?.();
    }
  }
}
