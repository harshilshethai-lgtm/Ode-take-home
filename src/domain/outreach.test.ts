import { describe, expect, it } from "vitest";
import { SEED_ORDERS } from "@/data/orders";
import { composeFax, outreachFor } from "./outreach";

const order = (id: string) => SEED_ORDERS.find((item) => item.id === id)!;

describe("fax outreach", () => {
  it("stays off a complete case, a rule gap, and a criterion the record already fails", () => {
    expect(outreachFor(order("case-1-kirk"))).toBeNull();
    expect(outreachFor(order("case-19-kira"))).toBeNull();
    expect(outreachFor(order("case-10-riker"))).toBeNull();
  });

  it("hides once the case leaves review", () => {
    expect(outreachFor({ ...order("case-2-scott"), status: "processing" })).toBeNull();
  });

  it("asks Utopia Planitia for Scott's missing PT notes, not the X-ray already on file", () => {
    const brief = outreachFor(order("case-2-scott"))!;
    expect(brief.partyName).toBe("Utopia Planitia Rehab");
    expect(brief.banner).toContain("MSK-207");
    const letter = composeFax(brief, brief.items.map((item) => item.id), "", "Jasmine Reyes", "Mon, Nov 9", false);
    expect(letter.regarding).toContain("ORD-58242");
    expect(letter.paragraphs.join(" ")).toContain("patient's own report does not count");
    expect(letter.paragraphs.join(" ")).toContain("do not resend it");
    expect(letter.asks.join(" ")).toContain("PT progress notes");
    expect(letter.asks.join(" ")).not.toContain("X-ray");
  });

  it("tells McCoy to order an X-ray and release the slot, and does not chase a report", () => {
    const brief = outreachFor(order("case-3-sulu"))!;
    const letter = composeFax(brief, ["xray", "pt", "reorder", "slot"], "", "Jasmine Reyes", "Mon, Nov 9", false);
    const text = `${letter.paragraphs.join(" ")} ${letter.asks.join(" ")}`;
    expect(text).toContain("3 weeks");
    expect(text.toLowerCase()).toContain("shoulder x-ray");
    expect(text).toContain("11/16");
    expect(text.toLowerCase()).not.toContain("chase");
  });

  it("asks Crusher's office for page 3 only", () => {
    const brief = outreachFor(order("case-12-crusher"))!;
    const letter = composeFax(brief, ["visit"], "", "Jasmine Reyes", "Mon, Nov 9", false);
    const text = letter.paragraphs.join(" ");
    expect(text).toContain("page 3");
    expect(text).toContain("Do not resend the PT note");
  });

  it("will not invent a clinic or a number for La Forge's smeared fax", () => {
    const brief = outreachFor(order("case-13-laforge"))!;
    expect(brief.fax).toBe("");
    expect(brief.partyName).toBe("Clinic that sent this fax");
    expect(brief.items.map((item) => item.label)).toEqual(["Therapy line", "X-ray report", "Member ID"]);
    const letter = composeFax(brief, ["member"], "", "Jasmine Reyes", "Mon, Nov 9", false);
    expect(letter.asks).toEqual(["The member ID."]);
    expect(letter.paragraphs.join(" ")).toContain("were not guessed");
  });

  it("tells Bashir-Mora to send Nog's discharge and not Rom's page", () => {
    const brief = outreachFor(order("case-15-nog"))!;
    const letter = composeFax(brief, ["discharge"], "", "Jasmine Reyes", "Mon, Nov 9", false);
    expect(letter.paragraphs.join(" ")).toContain("Rom");
    expect(letter.paragraphs.join(" ")).toContain("04/02/2001");
    expect(letter.paragraphs.join(" ")).toContain("Do not resend Rom's page");
    expect(letter.asks).toHaveLength(1);
  });

  it("asks Bashir-Mora which knee to authorize for O'Brien", () => {
    const brief = outreachFor(order("case-17-obrien"))!;
    expect(brief.fax).toBe("(410) 555-0109");
    const letter = composeFax(brief, ["side"], "Call before noon", "Jasmine Reyes", "Mon, Nov 9", true);
    expect(letter.paragraphs[0]).toContain("follow-up");
    expect(letter.paragraphs.join(" ")).toContain("cannot be amended");
    expect(letter.asks).toEqual([
      "Written confirmation of the knee: left, as the form says, or right, as the visit and the X-ray say.",
      "Call before noon",
    ]);
  });

  it("asks which plan is active for Sisko, not for more clinical notes", () => {
    const brief = outreachFor(order("case-18-sisko"))!;
    const letter = composeFax(brief, brief.items.map((item) => item.id), "", "Jasmine Reyes", "Mon, Nov 9", false);
    expect(letter.paragraphs.join(" ")).toContain("BHP-4471-0315-01");
    expect(letter.paragraphs.join(" ")).toContain("Coverage does not");
    expect(letter.asks.join(" ")).not.toContain("therapy");
  });

  it("asks Promenade to resend a packet nobody could read", () => {
    const brief = outreachFor(order("case-20-odo"))!;
    expect(brief.fax).toBe("555-0148");
    const letter = composeFax(brief, ["packet"], "", "Jasmine Reyes", "Mon, Nov 9", false);
    expect(letter.paragraphs.join(" ")).toContain("nothing was guessed");
    expect(letter.regarding).toContain("Unmatched");
  });
});
