import { describe, expect, it } from "vitest";
import rad114 from "@fixtures/rules/RAD-114.json";
import { criterionDisplayLabel } from "./displayLabel";

describe("criterion display label", () => {
  it("uses display_label when the rule sets one", () => {
    expect(criterionDisplayLabel(rad114.criteria.all[0])).toBe("Low back pain for 6+ weeks");
  });

  it("falls back to the criterion label", () => {
    expect(criterionDisplayLabel({ label: "Pain 4+ weeks" })).toBe("Pain 4+ weeks");
  });

  it("uses a plain default when both are missing", () => {
    expect(criterionDisplayLabel({})).toBe("Criterion");
  });
});
