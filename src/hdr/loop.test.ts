import { describe, expect, it } from "vitest";
import { blendFor, fadeFor, hold } from "./loop";

describe("blendFor", () => {
  it("slides evenly through the slot when the pair has motion", () => {
    expect(blendFor(0.5, true)).toBe(0.5);
  });
  it("blendFor falls back to hold without flow", () => {
    expect(blendFor(0.5, false)).toBe(0);
    expect(blendFor(0.9, false)).toBe(hold(0.9));
  });
});

describe("fadeFor", () => {
  it("dissolves only through the middle of a sliding slot, so one frame is on screen most of the time", () => {
    expect(fadeFor(0.2, true)).toBe(0);
    expect(fadeFor(0.5, true)).toBeCloseTo(0.5);
    expect(fadeFor(0.8, true)).toBe(1);
  });
  it("is the hold-then-fade without motion", () => {
    expect(fadeFor(0.9, false)).toBe(hold(0.9));
  });
});
