import { describe, expect, it } from "vitest";
import { buildSeedDb } from "@/data/rules/seed";
import { SEED_ORDERS } from "@/data/orders";
import { caseHref } from "./rulesFormat";
import { diffInline } from "./diffInline";
import { countChanges, diffVersions } from "@/domain/rules/diff";
import { buildRuleCard, fmtShortDate, scheduledBanner, versionBadge } from "./ruleCard";

const db = buildSeedDb();
/** The newest published version of a policy (RAD-114 has three; the others have one). */
const current = (policyId: string) => db.versions.filter((v) => v.policyId === policyId).sort((a, b) => b.versionNumber - a.versionNumber)[0];
const card = (policyId: string) => buildRuleCard(current(policyId));

describe("rule card is derived from stored data", () => {
  const rows = (xs: Array<{ label: string; value: string }>) => xs.map((x) => [x.label, x.value]);

  it("Federation RAD-114 v3: insurer refs, properties per criterion, no invented exclusions", () => {
    const c = card("pol_rad114");
    expect(c.criteria.map((x) => [x.ref, x.label, x.failure])).toEqual([
      ["2a", "Symptoms ≥ 6 wks", "Clinical"],
      ["2b", "Conservative care ≥ 6 wks", "Fixable"],
      ["2c", "X-rays first", "Fixable"],
      ["2d", "No MRI in 12 mo", "Clinical"],
    ]);
    expect(rows(c.criteria[1].properties)).toEqual([
      ["Duration", "6 weeks"],
      ["Lookback", "6 months"],
      ["Response documented", "Required"],
    ]);
    expect(c.criteria[1].properties.some((p) => /Patient-reported/.test(p.value))).toBe(false);
    expect(c.criteria[1].excerpt).toMatch(/^b\. 6 weeks or more of conservative treatment/);
    expect(rows(c.policyProperties)).toEqual([
      ["Submit via", "API or Portal"],
      ["Attach", "Most recent office note, Documentation of conservative treatment"],
    ]);
    expect(c.exceptions.map((e) => [e.ref, e.label, e.waives])).toEqual([
      ["3", "Red flags", "Waives 2a, 2b, 2c"],
      ["2d", "Symptoms changed", "Waives 2d"],
    ]);
    expect(c.assumptionCount).toBe(0);
  });

  it("Ferengi MSK-207: plans and incomplete requests are policy properties; refs are (1) to (4)", () => {
    const c = card("pol_msk207");
    expect(c.criteria.map((x) => x.ref)).toEqual(["(1)", "(2)", "(3)", "(4)"]);
    expect(rows(c.criteria[1].properties)).toEqual([
      ["Duration", "4 weeks"],
      ["Accepted documentation", "PT notes, Clinic notes"],
      ["Not accepted", "Patient-reported"],
    ]);
    expect(rows(c.criteria[3].properties)).toContainEqual(["Same knee", "Yes"]);
    expect(rows(c.policyProperties)).toEqual([
      ["Plans", "Commercial HMO"],
      ["Joint", "Knee"],
      ["Submit via", "Portal"],
      ["Incomplete requests", "Resubmit as new"],
    ]);
    expect(c.policyProperties[1].assumption).toMatch(/lower-extremity joint/);
    expect(c.exceptions[0]).toMatchObject({ ref: "Exceptions", waives: "Waives (1), (2)" });
    expect(c.assumptionCount).toBe(1);
  });

  it("Andorian IMG-330: table row labels are the refs; inferred values carry their assumption", () => {
    const c = card("pol_img330");
    expect(c.criteria.map((x) => x.ref)).toEqual(["Duration of symptoms", "Conservative care", "Imaging first", "Repeat imaging"]);
    expect(rows(c.criteria[1].properties)).toEqual([
      ["Duration", "6 weeks"],
      ["Accepted documentation", "PT notes, Injection record, Clinic notes"],
    ]);
    const repeat = c.criteria[3].properties;
    expect(repeat.find((p) => p.key === "same_side")).toMatchObject({ value: "No", assumption: expect.stringMatching(/either one/) });
    expect(c.exceptions[0].properties[0].value).toBe("Trauma with weakness, Suspected full thickness rotator cuff tear, Dislocation, Suspected infection, History of cancer");
    expect(c.exceptions[0].assumption).toBeTruthy();
    expect(rows(c.policyProperties)).toEqual([["Submit via", "Portal"]]);
    expect(c.assumptionCount).toBe(2);
  });

  it("shows checked and unchecked properties alike, and flags which ones are checked", () => {
    const c = card("pol_rad114");
    expect(c.criteria.every((x) => x.properties.every((p) => p.checked))).toBe(true);
    expect(c.policyProperties.every((p) => !p.checked)).toBe(true);
  });

  it("version badge", () => {
    expect(versionBadge({ versionNumber: 3, derivedStatus: "active", effectiveFrom: "2026-01-01" })).toBe("v3 · Active since Jan 1, 2026");
    expect(versionBadge({ versionNumber: 2, derivedStatus: "scheduled", effectiveFrom: "2026-12-01" })).toBe("v2 · Starts Dec 1, 2026");
    expect(versionBadge(null)).toBe("No version");
  });
});

describe("evaluation trace links to the worklist case", () => {
  it("resolves an order number to the case id, and to nothing when it is not on the worklist", () => {
    const order = SEED_ORDERS.find((o) => o.orderNumber)!;
    expect(caseHref(order.orderNumber!)).toBe(`/case/${order.id}`);
    expect(caseHref(order.orderNumber!, "doc_1")).toBe(`/case/${order.id}?doc=doc_1`);
    expect(caseHref("ORD-00000")).toBeNull();
  });
});

describe("scheduled banner", () => {
  it("says when and how much, in the same year as short dates", () => {
    expect(fmtShortDate("2026-03-01", "2026-11-09")).toBe("Mar 1");
    expect(fmtShortDate("2027-03-01", "2026-11-09")).toBe("Mar 1, 2027");
    expect(scheduledBanner({ versionNumber: 4, effectiveFrom: "2027-03-01" }, 2, "2026-11-09")).toBe("v4 takes effect Mar 1, 2027 · 2 changes");
    expect(scheduledBanner({ versionNumber: 4, effectiveFrom: "2026-12-01" }, 1, "2026-11-09")).toBe("v4 takes effect Dec 1 · 1 change");
  });
});

describe("diff helpers", () => {
  const ver = (n: number) => db.versions.find((v) => v.id === `ver_rad114_${n}`)!;

  it("counts the seeded history: v1 to v2 adds X-rays, v2 to v3 widens one lookback", () => {
    const d12 = diffVersions(ver(1), ver(2));
    expect(d12.criteria.find((c) => c.kind === "added")?.label).toMatch(/x-ray/i);
    const d23 = diffVersions(ver(2), ver(3));
    const changed = d23.criteria.filter((c) => c.kind === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].changes).toContainEqual(expect.objectContaining({ label: "Lookback", from: "3 months", to: "6 months" }));
    expect(countChanges(d23)).toBeGreaterThanOrEqual(1);
    expect(countChanges(diffVersions(ver(3), ver(3)))).toBe(0);
  });

  it("marks only the changed value in bold: numbers word by word, lists item by item", () => {
    const n = diffInline("4", "6");
    expect(n.to).toEqual([{ text: "6", kind: "add" }]);
    expect(n.from).toEqual([{ text: "4", kind: "del" }]);
    const l = diffInline("72148, 72149", "72148, 72149, 72150");
    expect(l.to.filter((s) => s.kind === "add").map((s) => s.text)).toEqual(["72150"]);
    expect(l.from.every((s) => s.kind === "same")).toBe(true);
    const r = diffInline("72148, 72149", "72148");
    expect(r.from.filter((s) => s.kind === "del").map((s) => s.text)).toEqual(["72149"]);
  });
});
