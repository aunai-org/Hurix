import { describe, expect, it } from "vitest";
import { hold } from "./loop";

describe("hold", () => {
  it("keeps each frame sharp for the first 75 % of its slot", () => {
    expect(hold(0)).toBe(0);
    expect(hold(0.5)).toBe(0);
    expect(hold(0.75)).toBe(0);
  });
  it("then dissolves to the next frame", () => {
    expect(hold(0.875)).toBeCloseTo(0.5);
    expect(hold(1)).toBe(1);
  });
});
