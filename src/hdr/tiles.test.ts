import { describe, expect, it } from "vitest";
import { tileWindow, windowRect, windowTiles, type TileGrid } from "./tiles";

const all = (cols: number, rows: number) => Array.from({ length: rows * cols }, (_, k) => `${Math.floor(k / cols)}_${k % cols}`);
const grid: TileGrid = { cols: 32, rows: 16, size: 512, have: all(32, 16) };

describe("HD tile window", () => {
  it("tileWindow centres the view", () => {
    expect(tileWindow(0, 0, grid)).toEqual({ r0: 5, c0: 13 });
  });
  it("tileWindow clamps rows near the pole", () => {
    expect(tileWindow(89, 0, grid).r0).toBe(0);
    expect(tileWindow(-89, 0, grid).r0).toBe(10);
  });
  it("windowRect wraps across the dateline", () => {
    const { r0, c0 } = tileWindow(0, 179, grid);
    expect(c0).toBe(29);
    const [u0, v0, du, dv] = windowRect(r0, c0, grid);
    expect(u0).toBeCloseTo(29 / 32);
    expect(v0).toBeCloseTo(1 - 11 / 16);
    expect(du).toBeCloseTo(6 / 32);
    expect(dv).toBeCloseTo(6 / 16);
    const cols = windowTiles(r0, c0, grid).filter((t) => t.i === 0).map((t) => [t.j, Number(t.id.split("_")[1])]);
    expect(cols).toEqual([[0, 29], [1, 30], [2, 31], [3, 0], [4, 1], [5, 2]]);
  });
  it("windowTiles skips missing tiles", () => {
    const some: TileGrid = { ...grid, have: ["5_13", "6_14"] };
    expect(windowTiles(5, 13, some)).toEqual([{ id: "5_13", i: 0, j: 0 }, { id: "6_14", i: 1, j: 1 }]);
  });
});

import { HDAtlas, tileUrl } from "./tiles";

// a canvas stand-in that records what is drawn where
const fakeCanvas = () => {
  const drawn: [string, number, number][] = [];
  let made = 0;
  const make = (w: number, h: number) => {
    made++;
    return { width: w, height: h, getContext: () => ({ clearRect: () => drawn.splice(0), drawImage: (img: { id: string }, x: number, y: number) => drawn.push([img.id, x, y]) }) };
  };
  return { drawn, make, made: () => made };
};
type Img = { id: string; close?(): void };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("HDAtlas", () => {
  it("creates its canvas only when first pointed somewhere", () => {
    const f = fakeCanvas();
    const atlas = new HDAtlas<Img>(grid, f.make, async (id) => ({ id }));
    expect(f.made()).toBe(0);
    atlas.point(0, 0);
    expect(f.made()).toBe(1);
  });
  it("a small drift doesn't move the window", () => {
    const atlas = new HDAtlas<Img>(grid, fakeCanvas().make, async (id) => ({ id }));
    atlas.point(0, 0);
    const key = atlas.key;
    atlas.point(0, 360 / 32 * 0.8);  // 0.8 of a tile east: rounding alone would move it
    expect(atlas.key).toBe(key);
    atlas.point(0, 360 / 32 * 1.2);
    expect(atlas.key).not.toBe(key);
  });
  it("moving the window redraws loaded tiles at once, in their new places, and asks for an upload with the new rect", async () => {
    const f = fakeCanvas();
    const atlas = new HDAtlas<Img>(grid, f.make, async (id) => ({ id }));
    atlas.point(0, 0); await flush(); atlas.take();
    atlas.point(0, 360 / 32 * 1.2);  // one column east: 5 of 6 columns are shared
    const up = atlas.take();
    expect(up?.rect).toEqual(windowRect(5, 14, grid));
    expect(f.drawn).toContainEqual(["5_14", 0, 0]);  // was at column 1, now at column 0, drawn before any await
    expect(f.drawn.length).toBe(30);
  });
  it("a tile that arrives after the window moved on is not drawn", async () => {
    const f = fakeCanvas();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const atlas = new HDAtlas<Img>(grid, f.make, async (id) => { await gate; return { id }; });
    atlas.point(0, 0);
    atlas.point(60, 120);
    release(); await flush(); await flush();
    expect(f.drawn.every(([id]) => windowTiles(atlas.r0, atlas.c0, grid).some((t) => t.id === id))).toBe(true);
  });
  it("closes tiles it evicts", async () => {
    const closed: string[] = [];
    const atlas = new HDAtlas<Img>(grid, fakeCanvas().make, async (id) => ({ id, close: () => closed.push(id) }), 6, 40);
    atlas.point(0, 0); await flush();
    atlas.point(0, 90); await flush();
    expect(closed.length).toBeGreaterThan(0);
  });
});

describe("tileUrl", () => {
  it("reads the tiles from their frame's folder", () => {
    expect(tileUrl({ ...grid, dir: "tiles/20261023T1310" }, "5_13")).toBe("data/tiles/20261023T1310/5_13.jpg");
    expect(tileUrl(grid, "5_13")).toBe("data/tiles/5_13.jpg");
  });
});
