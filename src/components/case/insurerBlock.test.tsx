// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InsurerBlock } from "./InsurerBlock";
import type { InsurerPanelModel } from "@/domain/insurer/view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function panel(patch: Partial<InsurerPanelModel>): InsurerPanelModel {
  return {
    insurerName: "Federation Health",
    plan: "PPO",
    channelLabel: "API",
    reference: "FH-100",
    submittedLabel: "Mon 11/9 · 4:00 PM",
    submittedBy: "System",
    latestLabel: "Approved",
    latestRaw: "approved",
    lastCheckedLabel: "Mon 11/9 · 4:00 PM",
    nextCheckLabel: null,
    approval: { number: "FH-100", cpt: "72148", units: "1", validFrom: "2026-11-16", validTo: "2027-02-14", matched: true },
    sent: [{ label: "Office note", pages: "1, 2" }],
    packetUrl: "packet://case/as-sent",
    timeline: [{ id: "1", kind: "submission", time: "Mon 11/9 · 4:00 PM", channel: "API", result: "Sent" }],
    appeal: null,
    ...patch,
  };
}

function render(model: InsurerPanelModel) {
  act(() => {
    root.render(<InsurerBlock panel={model} onCheckNow={() => {}} onFileAppeal={() => {}} onCloseDenied={() => {}} />);
  });
}

describe("insurer block", () => {
  it("renders an approved order", () => {
    render(panel({}));
    const text = host.textContent ?? "";
    expect(text).toContain("Insurer");
    expect(text).toContain("API");
    expect(text).toContain("Federation Health");
    expect(text).toContain("FH-100");
    expect(text).toContain("72148");
    expect(text).toContain("Office note");
    expect(text).toContain("Packet as sent");
    expect(text).toContain("Approved");
    expect(host.querySelector("[aria-label='Approval matches']")).toBeTruthy();
  });

  it("renders a pended order", () => {
    render(panel({
      channelLabel: "Portal automation",
      latestLabel: "Pended",
      latestRaw: "clinical review",
      approval: null,
      timeline: [{ id: "1", kind: "status", time: "Tue 11/10 · 2:00 PM", channel: "Portal automation", result: "Pended", screenshotUrl: "portal-shot://1" }],
    }));
    expect(host.textContent).toContain("Pended");
    expect(host.textContent).toContain("clinical review");
    expect(host.textContent).toContain("Screenshot");
    expect(host.textContent).toContain("Portal automation");
  });

  it("renders a failed check", () => {
    render(panel({
      latestLabel: "Unknown",
      latestRaw: "please hold",
      approval: null,
      timeline: [{ id: "1", kind: "status", time: "Tue 11/10 · 2:00 PM", channel: "Portal automation", result: "Failed", error: "Page changed", screenshotUrl: "portal-shot://err" }],
    }));
    expect(host.textContent).toContain("Page changed");
    expect(host.querySelector(".text-bad")?.textContent).toBe("Page changed");
  });

  it("renders a denial with the appeal draft", () => {
    render(panel({
      latestLabel: "Denied",
      latestRaw: "insufficient conservative therapy",
      approval: null,
      appeal: { reason: "insufficient conservative therapy", deadline: "Nov 20", daysLeft: "11 days left", draft: "Please reconsider the request.", reference: null },
    }));
    expect(host.textContent).toContain("insufficient conservative therapy");
    expect(host.textContent).toContain("11 days left");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("Please reconsider");
    expect(host.textContent).toContain("File appeal");
    expect(host.textContent).toContain("Close as denied");
  });
});
