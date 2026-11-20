import { describe, expect, it } from "vitest";
import {
  boxForQuote,
  citeLabel,
  missingCopy,
  pageLabel,
  pageSlots,
  pdfPageForFax,
  policyAttachment,
  sectionText,
  viewerSections,
} from "./packetView";

describe("fax page map", () => {
  it("shifts Scott's later pages because fax page 4 never arrived", () => {
    expect(pdfPageForFax("scott", 4)).toBeNull();
    expect(pdfPageForFax("scott", 5)).toBe(4);
    expect(citeLabel("scott", "Fax", 4)).toBe("fax p.5");
    expect(citeLabel("kirk", "EHR print", 3)).toBe("p.3");

    const slots = pageSlots("scott", "Fax", 5);
    expect(slots).toHaveLength(6);
    expect(slots[3]?.missing?.detail).toContain("PT progress notes");
    expect(missingCopy(slots[3]!)).toBe(
      "Fax page 4 of 6 not received · PT progress notes, Utopia Planitia Rehab (per cover sheet)",
    );
    expect(pageLabel(slots[4]!, 6, 5)).toBe("PDF p.4 · fax p.5 of 6");
  });

  it("lists Scott's cover sheet, including the missing PT notes", () => {
    const text = viewerSections("scott", "Fax", []).map(sectionText);
    expect(text).toEqual([
      "Cover p.1",
      "Request form p.2",
      "Office note p.3",
      "[missing] PT notes p.4",
      "X-ray p.5",
      "Note p.6",
    ]);
  });

  it("keeps a highlight box for a scanned quote", () => {
    const box = boxForQuote("scott", 4, "XR KNEE RIGHT 3 VIEWS, 09/24/2026");
    expect(box.w).toBeGreaterThan(0);
    expect(box.y).toBeLessThan(0.3);
  });

  it("opens the applied policy on its own page", () => {
    expect(policyAttachment("MSK-207 rev 3", "fixtures/policies/insurer-policy-excerpts.pdf#page=2")).toMatchObject({
      id: "policy",
      title: "MSK-207",
      page: 2,
    });
    expect(policyAttachment("No policy", null)).toBeNull();
  });
});
