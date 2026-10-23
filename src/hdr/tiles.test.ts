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
