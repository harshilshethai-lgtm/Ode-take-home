import { describe, expect, it } from "vitest";
import { deriveStatus, versionFor } from "./versionStatus";

type V = Parameters<typeof versionFor<TestVersion>>[0][number];
interface TestVersion {
  policyId: string;
  status: "draft" | "published" | "archived";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  versionNumber: number;
}

const v = (n: number, from: string | null, to: string | null, status: TestVersion["status"] = "published", policyId = "p1"): V => ({
  policyId,
  status,
  effectiveFrom: from,
  effectiveTo: to,
  versionNumber: n,
});

// v1: Jan 1 - Jun 30. v2: Jul 1 onward.
const history = [v(1, "2026-01-01", "2026-06-30"), v(2, "2026-07-01", null)];

describe("versionFor", () => {
  it("resolves the version whose range contains the date, ends inclusive", () => {
    const at = (d: string) => versionFor(history, "p1", d)?.versionNumber ?? null;
    expect(at("2025-12-31")).toBeNull(); // day before the first effective date
    expect(at("2026-01-01")).toBe(1); // the effective date itself
    expect(at("2026-01-02")).toBe(1);
    expect(at("2026-06-30")).toBe(1); // last day of v1 (effectiveTo is inclusive)
    expect(at("2026-07-01")).toBe(2); // the day v2 takes over
    expect(at("2030-01-01")).toBe(2); // open-ended
  });

  it("is the day before / of / after for a version published to start later", () => {
    const next = [...history, v(3, "2026-12-01", null)];
    const stopped = [v(1, "2026-01-01", "2026-06-30"), v(2, "2026-07-01", "2026-11-30"), v(3, "2026-12-01", null)];
    const at = (list: V[], d: string) => versionFor(list, "p1", d)?.versionNumber;
    expect(at(stopped, "2026-11-30")).toBe(2);
    expect(at(stopped, "2026-12-01")).toBe(3);
    // v3 is only a rule for dates from Dec 1; before that, v2 (open-ended in `next`) still governs
    expect(at(next, "2026-11-30")).toBe(2);
  });

  it("ignores drafts, archived versions, other policies and versions with no start date", () => {
    const list = [v(1, "2026-01-01", null, "draft"), v(2, "2026-01-01", null, "archived"), v(3, "2026-01-01", null, "published", "other"), v(4, null, null)];
    expect(versionFor(list, "p1", "2026-05-01")).toBeNull();
  });

  it("prefers the later-starting version if data ever overlaps", () => {
    const overlap = [v(1, "2026-01-01", null), v(2, "2026-03-01", null)];
    expect(versionFor(overlap, "p1", "2026-04-01")?.versionNumber).toBe(2);
    expect(versionFor(overlap, "p1", "2026-02-01")?.versionNumber).toBe(1);
  });
});

describe("deriveStatus at the boundaries", () => {
  it("flips on the day, not before", () => {
    const sched = v(2, "2026-07-01", null);
    expect(deriveStatus(sched, "2026-06-30")).toBe("scheduled");
    expect(deriveStatus(sched, "2026-07-01")).toBe("active");
    const old = v(1, "2026-01-01", "2026-06-30");
    expect(deriveStatus(old, "2026-06-30")).toBe("active");
    expect(deriveStatus(old, "2026-07-01")).toBe("superseded");
  });
});
