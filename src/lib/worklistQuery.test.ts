import { describe, expect, it } from "vitest";
import { parseWorklistUrl, serializeWorklistUrl } from "@/lib/worklistQuery";

describe("worklist query", () => {
  it("round-trips tab, filters, search, sort and page", () => {
    const state = {
      view: "clinical" as const,
      status: null,
      reason: "Missing docs",
      insurer: "Federation Health",
      policy: null,
      hideWaiting: true,
      slotAtRisk: true,
      q: "Kirk",
      sort: "received" as const,
      dir: "desc" as const,
      page: 2,
    };
    const params = serializeWorklistUrl(state, "admin");
    expect(params.toString()).toBe(
      "tab=clinical&reason=Missing+docs&insurer=Federation+Health&waiting=hidden&risk=slot&q=Kirk&sort=-received&page=3",
    );
    expect(parseWorklistUrl(params, "admin")).toEqual(state);
  });

  it("leaves the persona default queue off the url", () => {
    const params = serializeWorklistUrl(
      {
        view: "admin",
        status: null,
        reason: null,
        insurer: null,
        policy: null,
        hideWaiting: false,
        slotAtRisk: false,
        q: "",
        sort: "appointment",
        dir: "asc",
        page: 0,
      },
      "admin",
    );
    expect(params.toString()).toBe("");
    expect(parseWorklistUrl(params, "admin").view).toBe("admin");
    expect(parseWorklistUrl(params, "clinical").view).toBe("clinical");
  });
});