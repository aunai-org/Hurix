import { describe, expect, it } from "vitest";
import { stormSub, stormTitle } from "./names";

describe("stormTitle", () => {
  it("puts the kind before the name", () => {
    expect(stormTitle({ name: "Champi", kind: "Typhoon" })).toBe("Typhoon Champi");
    expect(stormTitle({ name: "Josephine", kind: "Post-tropical cyclone" })).toBe("Post-tropical cyclone Josephine");
  });
  it("never invents a name", () => expect(stormTitle({})).toBe("Unnamed system"));
});

describe("stormSub", () => {
  it("lists number, official wind and agency", () => {
    expect(stormSub({ agencyId: "29W", windKt: 95, agency: "JTWC" })).toBe("29W · 95 kt · JTWC");
    expect(stormSub({ agencyId: "AL10", windKt: null, agency: "NHC" })).toBe("AL10 · NHC");
  });
  it("says when there is no advisory", () => expect(stormSub({})).toBe("from satellite only"));
});
