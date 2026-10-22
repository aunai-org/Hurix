import { expect, it } from "vitest";
import { category, CATEGORIES } from "./intensity";

it("sorts a wind into its Saffir–Simpson band", () => {
  expect(category(33).key).toBe("td");
  expect(category(34).key).toBe("ts");
  expect(category(64).key).toBe("c1");
  expect(category(95).color).toBe("#ffe775");
  expect(category(137).key).toBe("c5");
});

it("greys out a checkpoint without an official wind", () => {
  expect(category(null).color).toBe("#9aa3ad");
  expect(category(null).label).toBe("No official wind");
});

it("lists every band once for the legend", () => expect(CATEGORIES.map((c) => c.key)).toEqual(["td", "ts", "c1", "c2", "c3", "c4", "c5", "na"]));
