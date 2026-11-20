import { describe, expect, it } from "vitest";
import type { Property, ValidationIssue } from "@/domain/rules/types";
import { applyCheck, issueSummary, issuesAt, moveItem, newCriterion, newProperty, newWaiver, propertyKey, triggerFromText, valueTypeOf } from "./ruleForm";

describe("properties", () => {
  const p = (over: Partial<Property> = {}): Property => ({ key: "duration", label: "Duration", value: "6 weeks", ...over });

  it("adds a property from a label, a value type and an optional check", () => {
    expect(newProperty({ label: "Lookback", valueType: "number", op: null, fact: null }, [])).toEqual({ key: "lookback", label: "Lookback", value: 1 });
    const checked = newProperty({ label: "Lookback", valueType: "text", op: "within_months", fact: "mri" }, [p({ key: "lookback" })]);
    expect(checked).toMatchObject({ key: "lookback_2", value: 1, unit: "months", check: { op: "within_months", fact: "mri" } });
    expect(newProperty({ label: "Accepted", valueType: "list", op: null, fact: null }, []).value).toEqual([]);
  });

  it("reshapes the value only when the check needs another type, and keeps it otherwise", () => {
    expect(applyCheck(p(), "min_weeks")).toMatchObject({ value: 1, unit: "weeks", check: { op: "min_weeks", fact: "symptom_onset" } });
    expect(applyCheck(p({ value: 4, unit: "weeks" }), "min_weeks", "conservative_treatment")).toMatchObject({ value: 4, check: { fact: "conservative_treatment" } });
    expect(applyCheck(p({ value: "Knee X-ray" }), "present", "xray")).toMatchObject({ value: "Knee X-ray" });
    expect(applyCheck(p(), "same_side").value).toBe(true);
    expect(valueTypeOf(applyCheck(p(), "source_in"))).toBe("list");
  });

  it("removing a check keeps the value and drops the check", () => {
    const off = applyCheck(p({ value: 6, unit: "weeks", check: { op: "min_weeks", fact: "symptom_onset" } }), null);
    expect(off).toEqual({ key: "duration", label: "Duration", value: 6, unit: "weeks" });
  });

  it("keys are slugs of the label and never collide", () => {
    expect(propertyKey("Same knee", [])).toBe("same_knee");
    expect(propertyKey("", [])).toBe("property");
    expect(propertyKey("Lookback", [p({ key: "lookback" }), p({ key: "lookback_2" })])).toBe("lookback_3");
  });
});

describe("new rows", () => {
  let n = 0;
  const id = () => `id${n++}`;

  it("starts an empty criterion with a fresh key, no reference and no properties", () => {
    const a = newCriterion("v1", [], id);
    expect(a).toMatchObject({ ref: "", excerpt: "", properties: [], displayLabel: "", sortOrder: 0, failureType: "fixable" });
    const b = newCriterion("v1", [a], id);
    expect(b.key).not.toBe(a.key);
    expect(b.sortOrder).toBe(1);
  });

  it("starts a waiver that needs a clinician, with nothing waived", () => {
    expect(newWaiver("v1", [], id)).toMatchObject({ evaluationMode: "human_review", triggers: [], waivesCriterionKeys: [], assumption: null });
  });
});

describe("helpers", () => {
  it("moves items without mutating, and ignores out-of-range moves", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(list, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 3)).toBe(list);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("slugs triggers", () => {
    expect(triggerFromText("  Suspected infection! ")).toBe("suspected_infection");
    expect(triggerFromText("")).toBe("");
  });

  it("matches issues by path prefix, not by substring", () => {
    const issue = (path: string): ValidationIssue => ({ code: "x", path, message: path });
    const all = [issue("criteria.a"), issue("criteria.a.properties.duration.value"), issue("criteria.ab.key"), issue("exceptions.a")];
    expect(issuesAt(all, "criteria.a").map((i) => i.path)).toEqual(["criteria.a", "criteria.a.properties.duration.value"]);
    expect(issuesAt(all, "criteria.a", { exact: true })).toHaveLength(1);
  });

  it("summarises issues in one line", () => {
    expect(issueSummary(0, 0)).toBe("");
    expect(issueSummary(1, 0)).toBe("1 error blocks publishing");
    expect(issueSummary(2, 1)).toBe("2 errors block publishing · 1 warning");
  });
});
