import { describe, expect, it, beforeEach } from "vitest";
import { AuthState, createOrder, markScanCompleted, readAudits, readEffects, readOrder, transitionOrder } from "@/domain/priorAuth/store";
import { businessHoursBetween } from "@/domain/timeRisk";
import { resetScripts, scriptOrder, mockAdapter, apiAdapter, type MockStep } from "./adapters";
import { withConfig } from "./config";
import { scriptedEpic } from "./epic";
import { appendInteraction, readInteractions } from "./log";
import { approvalMismatches } from "./match";
import { NORMALIZED_LABEL, normalizeStatus } from "./normalize";
import { redactPhi } from "./phi";
import { memorySecrets } from "./secrets";
import { submitOnPortal, type PortalPage } from "./portalScript";
import { decisionScanAtRisk, nextStatusCheck } from "./schedule";
import { INSURER_CONFIG } from "./config";
import {
  applyEpicChange,
  checkNow,
  closeAsDenied,
  fileAppeal,
  lookupEligibility,
  lookupExisting,
  recordPeerOutcome,
  runDueChecks,
  SCAN_RISK_MESSAGE,
  submitToInsurer,
  watchApprovalExpiry,
  watchScanRisk,
} from "./runner";
import type { ApprovalOffer, TrackedOrder } from "./types";
import { buildInsurerPanel } from "./view";

const NOW = new Date("2026-11-09T16:00:00");
const system = { kind: "system" as const };
const nurse = { kind: "user" as const, id: "nurse-1", role: "nurse" as const, permissions: ["cancel" as const] };

beforeEach(() => resetScripts());

function offer(patch: Partial<ApprovalOffer> = {}): ApprovalOffer {
  return { number: "A-1", cpt: "72148", validFrom: "2026-11-16", validTo: "2027-02-14", units: 1, side: null, ...patch };
}

function tracked(patch: Partial<TrackedOrder> = {}): TrackedOrder {
  return {
    id: patch.id ?? "ord-1",
    insurerName: "Federation Health",
    plan: "PPO",
    cpt: "72148",
    side: null,
    units: 1,
    facility: null,
    provider: null,
    scanAt: "2026-11-18T14:30:00",
    urgent: false,
    policyId: "RAD-114",
    policyText: "Conservative care must be documented.",
    criteria: [{ id: "duration", label: "Symptom duration", result: "MET", quote: "8 weeks of pain", page: 1 }],
    attachments: [{ docId: "Office note", name: "Office note.pdf", pages: [1, 2] }],
    phi: ["James Kirk", "HH-0017001"],
    appealRound: 1,
    ...patch,
  };
}

function park(state: AuthState, order: TrackedOrder, where: "submitted" | "portal" | "approved" = "submitted") {
  if (where === "portal") {
    return createOrder(state, {
      id: order.id,
      status: "NEEDS_ADMIN_REVIEW",
      reason: "PORTAL_UPLOAD",
      channel: "portal",
      detail: { n: 4, insurer: order.insurerName, k: 1 },
      now: NOW,
    });
  }
  if (where === "approved") {
    return createOrder(state, {
      id: order.id,
      status: "APPROVED",
      reason: "LINKED_EXISTING",
      channel: "api",
      approval: { number: "FH-YAR", cpt: "72148", validFrom: "2026-11-01", validTo: "2027-02-14" },
      detail: { number: "FH-YAR", cpt: "72148", validFrom: "Nov 1", validTo: "Feb 14" },
      now: NOW,
    });
  }
  return createOrder(state, {
    id: order.id,
    status: "SUBMITTED",
    reason: "INITIAL_REQUEST",
    channel: order.insurerName.includes("Andorian") || order.insurerName.includes("Ferengi") ? "portal" : "api",
    detail: { insurer: order.insurerName, channel: "API", date: "Nov 9", ref: "TEMP", time: "4:00 PM" },
    now: NOW,
  });
}

describe("normalization", () => {
  it("maps each insurer's raw text, and unknown text stays unknown", () => {
    for (const name of Object.keys(INSURER_CONFIG)) {
      expect(normalizeStatus(name, "in review")).toBe("IN_REVIEW");
      expect(normalizeStatus(name, "approved")).toBe("APPROVED");
      expect(normalizeStatus(name, "please hold")).toBe("UNKNOWN");
      expect(NORMALIZED_LABEL.UNKNOWN).toBe("Unknown");
    }
  });
});

describe("outcomes", () => {
  it("keeps received and in review submitted while the reason updates", async () => {
    const state = new AuthState();
    const order = tracked({ id: "await" });
    park(state, order);
    scriptOrder(order.id, [
      { op: "submit", reference: "FH-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "in review" },
    ]);
    const sent = await submitToInsurer(state, order, NOW);
    expect(sent).toMatchObject({ status: "SUBMITTED", reason: "AWAITING_DECISION" });
    const reviewed = await checkNow(state, order, NOW);
    expect(reviewed).toMatchObject({ status: "SUBMITTED", reason: "AWAITING_DECISION" });
    expect(String(reviewed.detail.normalized)).toBe("In review");
  });

  it("moves every other normalized answer to the stated status and reason", async () => {
    const rows: Array<{ raw: string; note?: string; items?: string; status: string; reason: string; approval?: ApprovalOffer }> = [
      { raw: "pended", note: "need the PT notes", status: "SUBMITTED", reason: "PENDED_BY_INSURER" },
      { raw: "more info needed", items: "ophthalmology exam notes", status: "NEEDS_ADMIN_REVIEW", reason: "MORE_INFO_REQUESTED" },
      { raw: "peer-to-peer", status: "NEEDS_CLINICAL_REVIEW", reason: "PEER_TO_PEER" },
      { raw: "denied", note: "not medically necessary", status: "NEEDS_CLINICAL_REVIEW", reason: "DENIED_DECIDE_APPEAL" },
      { raw: "partially approved", approval: offer({ cpt: "72148" }), status: "NEEDS_ADMIN_REVIEW", reason: "APPROVAL_MISMATCH" },
      { raw: "approved", approval: offer({ cpt: "78816" }), status: "NEEDS_ADMIN_REVIEW", reason: "APPROVAL_MISMATCH" },
      { raw: "approved", approval: offer(), status: "APPROVED", reason: "NEW" },
    ];
    for (const row of rows) {
      const state = new AuthState();
      const order = tracked({ id: row.raw, cpt: row.raw === "approved" && row.approval?.cpt === "78816" ? "78815" : "72148" });
      park(state, order);
      scriptOrder(order.id, [
        { op: "submit", reference: `R-${row.raw}`, raw: "accepted" },
        { op: "status", raw: "received" },
        { op: "status", raw: row.raw, note: row.note, items: row.items, approval: row.approval, phone: "(415) 555-0199", deadline: "2026-11-12" },
      ]);
      await submitToInsurer(state, order, NOW);
      const next = await checkNow(state, order, NOW);
      expect(next, row.raw).toMatchObject({ status: row.status, reason: row.reason });
    }
  });

  it("treats an unmapped answer as a failed check", async () => {
    const state = new AuthState();
    const order = tracked({ id: "unknown" });
    park(state, order);
    scriptOrder(order.id, [
      { op: "submit", reference: "U-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "please hold" },
    ]);
    await submitToInsurer(state, order, NOW);
    const next = await checkNow(state, order, NOW);
    expect(next).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "STATUS_CHECK_FAILED" });
  });
});

describe("approval match and write-back", () => {
  const base = tracked();

  it("flags each mismatch type", () => {
    const config = INSURER_CONFIG["Federation Health"];
    const tied = { ...config, tiesFacility: true, tiesProvider: true };
    expect(approvalMismatches({ ...base, cpt: "78815" }, offer({ cpt: "78816" }), config).map((item) => item.type)).toEqual(["cpt"]);
    expect(approvalMismatches({ ...base, side: "Left" }, offer({ side: "Right" }), config).map((item) => item.type)).toEqual(["side"]);
    expect(approvalMismatches(base, offer({ validTo: "2026-11-17" }), config).map((item) => item.type)).toEqual(["dates"]);
    expect(approvalMismatches({ ...base, facility: "Site A" }, offer({ facility: "Site B" }), tied).map((item) => item.type)).toContain("facility");
    expect(approvalMismatches({ ...base, provider: "McCoy" }, offer({ provider: "Pulaski" }), tied).map((item) => item.type)).toContain("provider");
    expect(approvalMismatches({ ...base, units: 2 }, offer({ units: 1 }), config).map((item) => item.type)).toEqual(["units"]);
    expect(approvalMismatches({ ...base, cpt: "72149" }, offer({ cpt: "72148" }), config)).toEqual([]);
  });

  it("does not approve until Epic reads the write back", async () => {
    const state = new AuthState();
    const order = tracked({ id: "write" });
    park(state, order);
    scriptOrder(order.id, [
      { op: "submit", reference: "W-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "approved", approval: offer({ number: "W-1" }) },
    ]);
    const epic = scriptedEpic(3);
    await submitToInsurer(state, order, NOW, { epic });
    const next = await checkNow(state, order, NOW, { epic });
    expect(epic.writes).toBe(3);
    expect(next.status).not.toBe("APPROVED");
    expect(next).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "WRITEBACK_FAILED" });
    expect(readAudits(state, { orderId: order.id }).some((row) => row.toStatus === "APPROVED")).toBe(false);
  });

  it("approves when the third write succeeds", async () => {
    const state = new AuthState();
    const order = tracked({ id: "retry-write" });
    park(state, order);
    scriptOrder(order.id, [
      { op: "submit", reference: "W-2", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "approved", approval: offer({ number: "W-2" }) },
    ]);
    const epic = scriptedEpic(2);
    await submitToInsurer(state, order, NOW, { epic });
    const approved = await checkNow(state, order, NOW, { epic });
    expect(epic.writes).toBe(3);
    expect(approved).toMatchObject({ status: "APPROVED", reason: "NEW" });
  });
});

describe("status checks", () => {
  it("retries timeouts, then escalates, and escalates page and auth failures immediately", async () => {
    const state = new AuthState();
    const order = tracked({ id: "retry" });
    park(state, order);
    scriptOrder(order.id, [
      { op: "submit", reference: "S-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "error", errorType: "timeout", message: "timed out" },
      { op: "error", errorType: "timeout", message: "timed out" },
      { op: "error", errorType: "timeout", message: "timed out HH-0017001 James Kirk" },
    ]);
    const external: string[] = [];
    await submitToInsurer(state, order, NOW, { external: { write: (line) => external.push(line) } });
    const first = await checkNow(state, order, NOW, { external: { write: (line) => external.push(line) } });
    expect(first.status).toBe("SUBMITTED");
    const second = await checkNow(state, order, NOW, { external: { write: (line) => external.push(line) } });
    expect(second.status).toBe("SUBMITTED");
    const third = await checkNow(state, order, NOW, { external: { write: (line) => external.push(line) } });
    expect(third).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "STATUS_CHECK_FAILED" });
    expect(external.join(" ")).not.toContain("HH-0017001");
    expect(external.join(" ")).not.toContain("James Kirk");
    expect(readInteractions(state, order.id).some((row) => row.rawResponse.includes("James Kirk"))).toBe(true);

    const page = new AuthState();
    const pended = tracked({ id: "page" });
    park(page, pended);
    scriptOrder(pended.id, [
      { op: "submit", reference: "P-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "error", errorType: "page_changed", message: "the form moved" },
    ]);
    await submitToInsurer(page, pended, NOW);
    expect(await checkNow(page, pended, NOW)).toMatchObject({ reason: "STATUS_CHECK_FAILED" });

    const auth = new AuthState();
    const locked = tracked({ id: "auth" });
    park(auth, locked);
    scriptOrder(locked.id, [
      { op: "submit", reference: "A-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "error", errorType: "auth_failed", message: "Sign-in failed" },
    ]);
    await submitToInsurer(auth, locked, NOW);
    expect(await checkNow(auth, locked, NOW)).toMatchObject({ reason: "STATUS_CHECK_FAILED" });
  });

  it("alerts the ops lead when a portal script fails for several orders", async () => {
    const state = new AuthState();
    for (const id of ["p1", "p2"]) {
      const order = tracked({ id, insurerName: "Andorian Life" });
      park(state, order, "portal");
      scriptOrder(id, [
        { op: "submit", reference: id, raw: "uploaded" },
        { op: "status", raw: "received" },
        { op: "error", errorType: "page_changed", message: "layout changed" },
      ]);
      await submitToInsurer(state, order, NOW);
      await checkNow(state, order, NOW);
    }
    expect(readEffects(state).some((effect) => effect.type === "ops_lead_alert")).toBe(true);
  });
});

describe("re-approval and scan risk", () => {
  it("reopens an approval only for an Epic change before the scan", () => {
    const state = new AuthState();
    const order = tracked({ id: "yar", scanAt: "2026-11-18T14:30:00" });
    const created = park(state, order, "approved");
    const moved = applyEpicChange(state, order.id, "scan_outside_approval", "scan date moved outside approval", NOW, "2027-03-10T09:00:00");
    expect(moved).toMatchObject({ status: "PROCESSING", step: "COVERAGE" });
    expect(readAudits(state, { orderId: order.id }).at(-1)?.reason).toBe("Re-approval needed: scan date moved outside approval");
    const closed = new AuthState();
    park(closed, tracked({ id: "done" }), "approved");
    markScanCompleted(closed, "done", NOW);
    expect(() => applyEpicChange(closed, "done", "cpt_side_or_facility_changed", "CPT changed", NOW)).toThrow(/scan is already complete/);
    const bare = new AuthState();
    park(bare, tracked({ id: "bare" }), "approved");
    expect(() =>
      transitionOrder(bare, "bare", "PROCESSING", {
        actor: system,
        expectedVersion: readOrder(bare, "bare").statusVersion,
        reason: null,
        step: "COVERAGE",
        now: NOW,
      }),
    ).toThrow(/Epic change/);
    expect(created.status).toBe("APPROVED");
  });

  it("flags a scan 24 business hours out without leaving submitted", () => {
    const state = new AuthState();
    const order = tracked({ id: "risk" });
    park(state, order);
    const soon = new Date("2026-11-13T08:00:00");
    const scan = new Date("2026-11-13T16:00:00");
    expect(businessHoursBetween(soon, scan)).toBeLessThanOrEqual(24);
    expect(decisionScanAtRisk("SUBMITTED", scan, soon)).toBe(true);
    expect(decisionScanAtRisk("SUBMITTED", new Date("2026-11-18T14:30:00"), NOW)).toBe(false);
    const watched = watchScanRisk(state, order.id, scan.toISOString(), soon);
    expect(watched).toEqual({ atRisk: true, notified: true });
    expect(readOrder(state, order.id).status).toBe("SUBMITTED");
    expect(SCAN_RISK_MESSAGE).toBe("hold or move?");
    expect(readEffects(state).some((effect) => effect.type === "scheduling_notified")).toBe(true);
  });

  it("warns scheduling before an approval expires and leaves the status", () => {
    const state = new AuthState();
    park(state, tracked({ id: "expire" }), "approved");
    const warned = watchApprovalExpiry(state, "expire", new Date("2027-02-10T12:00:00"));
    expect(warned).toBe(true);
    expect(readOrder(state, "expire").status).toBe("APPROVED");
  });
});

describe("adapters", () => {
  it("refuses a Ferengi submission when any criterion is unclear", async () => {
    const state = new AuthState();
    const order = tracked({
      id: "unclear",
      insurerName: "Ferengi Benefit Group",
      criteria: [{ id: "therapy", label: "Therapy", result: "UNCLEAR" }],
    });
    park(state, order, "portal");
    scriptOrder(order.id, [{ op: "submit", reference: "NOPE", raw: "should not send" }]);
    await expect(mockAdapter(INSURER_CONFIG["Ferengi Benefit Group"]).submit({
      orderId: order.id,
      insurerId: order.insurerName,
      urgent: false,
      criteria: order.criteria,
      attachments: order.attachments,
      cpt: order.cpt,
      side: null,
      units: 1,
      scanDate: order.scanAt,
      policyId: order.policyId,
    })).rejects.toThrow(/cannot be amended/);
    await expect(submitToInsurer(state, order, NOW)).rejects.toThrow(/cannot be amended/);
    expect(readInteractions(state, order.id)).toEqual([]);
  });

  it("checks an API schema and confirms receipt", async () => {
    const state = new AuthState();
    const order = tracked({ id: "schema" });
    park(state, order);
    const transport = {
      async post(path: string) {
        if (path === "/submit") return { reference: "API-1", status: "received" };
        if (path === "/status") return { reference: "API-1", status: "received" };
        return {};
      },
    };
    const sent = await submitToInsurer(state, order, NOW, {
      configs: withConfig("Federation Health", { mode: "real" }),
      adapters: { "Federation Health": apiAdapter(INSURER_CONFIG["Federation Health"], transport) },
    });
    expect(sent.reason).toBe("AWAITING_DECISION");
    expect(readInteractions(state, order.id).some((row) => row.kind === "status_check" && row.normalized === "RECEIVED")).toBe(true);
    await expect(apiAdapter(INSURER_CONFIG["Federation Health"], { async post() { return { nope: true }; } }).submit({
      orderId: "x",
      insurerId: "Federation Health",
      urgent: false,
      criteria: [],
      attachments: [],
      cpt: "72148",
      side: null,
      units: 1,
      scanDate: null,
      policyId: null,
    })).rejects.toThrow(/schema/);
  });

  it("keeps the portal password out of the result", async () => {
    const seen: string[] = [];
    const page: PortalPage = {
      async goto() {},
      async fill(_selector, value) { seen.push(value); },
      async click() {},
      async setFiles(_selector, files) { expect(files.map((file) => file.name)).toEqual(["Office note.pdf", "X-ray.pdf"]); },
      async textContent() { return "REF-9"; },
      async screenshot() { return new Uint8Array([1, 2, 3]); },
    };
    const result = await submitOnPortal(page, memorySecrets({ andorian: { username: "ada", password: "secret-pass" } }), {
      url: "https://portal.local",
      credentialsKey: "andorian",
      attachments: [
        { docId: "Office note", name: "Office note.pdf", pages: [1] },
        { docId: "X-ray", name: "X-ray.pdf", pages: [2] },
      ],
    });
    expect(result.reference).toBe("REF-9");
    expect(JSON.stringify(result)).not.toContain("secret-pass");
    expect(seen).toContain("secret-pass");
  });

  it("appends interactions and requires a portal screenshot", () => {
    const state = new AuthState();
    const first = appendInteraction(state, {
      orderId: "o",
      insurerId: "Federation Health",
      kind: "submission",
      channel: "api",
      attempt: 1,
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      outcome: "ok",
      rawResponse: "ok",
      actor: "system",
    });
    first.rawResponse = "changed";
    const { id: _ignored, ...stored } = first;
    appendInteraction(state, { ...stored, rawResponse: "second", attempt: 2 });
    expect(_ignored).toBeTruthy();
    const rows = readInteractions(state, "o");
    expect(rows.map((row) => row.rawResponse)).toEqual(["ok", "second"]);
    expect(() =>
      appendInteraction(state, {
        orderId: "o",
        insurerId: "Andorian Life",
        kind: "submission",
        channel: "portal_automation",
        attempt: 1,
        startedAt: NOW.toISOString(),
        finishedAt: NOW.toISOString(),
        outcome: "ok",
        rawResponse: "ok",
        actor: "system",
      }),
    ).toThrow(/screenshot/);
  });
});

describe("appeals and peer-to-peer", () => {
  it("files an appeal only from the denial, then can close it", async () => {
    const state = new AuthState();
    const order = tracked({ id: "appeal", insurerName: "Andorian Life" });
    park(state, order, "portal");
    scriptOrder(order.id, [
      { op: "submit", reference: "AN-1", raw: "uploaded" },
      { op: "status", raw: "received" },
      { op: "status", raw: "denied", note: "insufficient conservative therapy", deadline: "2026-11-20" },
      { op: "appeal", reference: "AN-1-A", raw: "appeal received" },
      { op: "status", raw: "approved", approval: offer({ number: "AN-WIN", cpt: "72148" }) },
    ]);
    await submitToInsurer(state, order, NOW);
    const denied = await checkNow(state, order, NOW);
    expect(denied).toMatchObject({ status: "NEEDS_CLINICAL_REVIEW", reason: "DENIED_DECIDE_APPEAL" });
    expect(String(denied.detail.draft)).toContain("insufficient conservative therapy");
    expect(readEffects(state).some((effect) => effect.type === "rules_admin_task" && effect.detail.includes("RAD-114"))).toBe(true);
    const filed = await fileAppeal(state, order, String(denied.detail.draft), NOW);
    expect(filed).toMatchObject({ status: "SUBMITTED", reason: "APPEAL" });
    const won = await checkNow(state, order, NOW);
    expect(won).toMatchObject({ status: "APPROVED", reason: "APPEAL_WON" });

    const closed = new AuthState();
    const other = tracked({ id: "close", insurerName: "Andorian Life" });
    park(closed, other, "portal");
    scriptOrder(other.id, [
      { op: "submit", reference: "AN-2", raw: "uploaded" },
      { op: "status", raw: "received" },
      { op: "status", raw: "denied", note: "not necessary", deadline: "2026-11-20" },
    ]);
    await submitToInsurer(closed, other, NOW);
    await checkNow(closed, other, NOW);
    expect(closeAsDenied(closed, other.id, NOW, nurse)).toMatchObject({ status: "DENIED", reason: "NO_APPEAL" });
  });

  it("records a peer-to-peer approval", async () => {
    const state = new AuthState();
    const order = tracked({ id: "peer", urgent: true });
    park(state, order);
    scriptOrder(order.id, [
      { op: "submit", reference: "P2P", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "peer-to-peer", phone: "(415) 555-0142", deadline: "2026-11-12" },
    ]);
    await submitToInsurer(state, order, NOW);
    const asked = await checkNow(state, order, NOW);
    expect(asked).toMatchObject({ status: "NEEDS_CLINICAL_REVIEW", reason: "PEER_TO_PEER" });
    const approved = await recordPeerOutcome(state, order, "approved", offer({ number: "P2P-OK" }), NOW);
    expect(approved).toMatchObject({ status: "APPROVED", reason: "NEW" });
  });
});

describe("schedules", () => {
  it("checks APIs every 4 hours and portals at 08:00 and 14:00 on business days", () => {
    const after = new Date("2026-11-10T15:00:00");
    expect(nextStatusCheck(INSURER_CONFIG["Federation Health"], after).getHours()).toBe(19);
    const portal = nextStatusCheck(INSURER_CONFIG["Andorian Life"], after);
    expect(portal.getDate()).toBe(12);
    expect(portal.getHours()).toBe(8);
  });

  it("runs a check that is due", async () => {
    const state = new AuthState();
    const order = tracked({ id: "due" });
    park(state, order);
    scriptOrder(order.id, [
      { op: "submit", reference: "DUE", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "in review" },
    ]);
    await submitToInsurer(state, order, NOW);
    await runDueChecks(state, [order], new Date(NOW.getTime() + 5 * 36e5));
    expect(readOrder(state, order.id).detail.normalized).toBe("In review");
  });
});

describe("mock scenarios", () => {
  it("plays the ten insurer stories through to the expected status", async () => {
    const kirk = await play("kirk", tracked({ id: "kirk" }), [
      { op: "submit", reference: "FH-KIRK", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "in review" },
      { op: "status", raw: "approved", approval: offer({ number: "FH-KIRK" }) },
    ]);
    expect(kirk.final).toMatchObject({ status: "APPROVED", reason: "NEW" });

    const janeway = await play("janeway", tracked({ id: "janeway", urgent: true }), [
      { op: "submit", reference: "FH-J", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "approved", approval: offer({ number: "FH-J" }) },
    ], { checks: 1 });
    expect(janeway.final).toMatchObject({ status: "APPROVED", reason: "NEW" });

    const chakotay = await play("chakotay", tracked({ id: "chakotay", insurerName: "Ferengi Benefit Group", cpt: "73721" }), [
      { op: "submit", reference: "FB-1", raw: "uploaded" },
      { op: "status", raw: "received" },
      { op: "status", raw: "clinical review" },
      { op: "status", raw: "approved", approval: offer({ number: "FB-1", cpt: "73721" }) },
    ], { start: "portal", checks: 2 });
    expect(chakotay.reasons).toContain("PENDED_BY_INSURER");
    expect(chakotay.final).toMatchObject({ status: "APPROVED", reason: "NEW" });
    expect(chakotay.rows.some((row) => row.channel === "portal_automation" && row.screenshotUrl && row.scriptVersion)).toBe(true);

    const tuvok = await play("tuvok", tracked({ id: "tuvok", insurerName: "Vulcan Science Mutual", cpt: "70553" }), [
      { op: "submit", reference: "V-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "more info needed", items: "ophthalmology exam notes" },
    ]);
    expect(tuvok.final).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "MORE_INFO_REQUESTED" });

    const picard = await play("picard", tracked({ id: "picard", insurerName: "Klingon Assurance", cpt: "78815" }), [
      { op: "submit", reference: "K-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "approved", approval: offer({ number: "K-1", cpt: "78816" }) },
    ]);
    expect(picard.final).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "APPROVAL_MISMATCH" });

    const worf = await play("worf", tracked({ id: "worf", insurerName: "Andorian Life", cpt: "73221" }), [
      { op: "submit", reference: "W-1", raw: "uploaded" },
      { op: "status", raw: "received" },
      { op: "error", errorType: "page_changed", message: "page changed" },
      { op: "error", errorType: "page_changed", message: "page changed" },
      { op: "error", errorType: "page_changed", message: "page changed" },
    ], { start: "portal", checks: 1 });
    expect(worf.final).toMatchObject({ status: "NEEDS_ADMIN_REVIEW", reason: "STATUS_CHECK_FAILED" });

    const state = new AuthState();
    const bashir = tracked({ id: "bashir", insurerName: "Andorian Life", cpt: "73221" });
    park(state, bashir, "portal");
    scriptOrder(bashir.id, [
      { op: "submit", reference: "B-1", raw: "uploaded" },
      { op: "status", raw: "received" },
      { op: "status", raw: "denied", note: "insufficient conservative therapy", deadline: "2026-11-20" },
      { op: "appeal", reference: "B-1-A", raw: "appeal received" },
      { op: "status", raw: "approved", approval: offer({ number: "B-WIN", cpt: "73221" }) },
    ]);
    await submitToInsurer(state, bashir, NOW);
    const denied = await checkNow(state, bashir, NOW);
    expect(denied.reason).toBe("DENIED_DECIDE_APPEAL");
    await fileAppeal(state, bashir, "Please reconsider.", NOW);
    const won = await checkNow(state, bashir, NOW);
    expect(won).toMatchObject({ status: "APPROVED", reason: "APPEAL_WON" });

    const daxState = new AuthState();
    const dax = tracked({ id: "dax", urgent: true });
    park(daxState, dax);
    scriptOrder(dax.id, [
      { op: "submit", reference: "D-1", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "peer-to-peer", phone: "(415) 555-0100", deadline: "2026-11-11" },
    ]);
    await submitToInsurer(daxState, dax, NOW);
    expect((await checkNow(daxState, dax, NOW)).reason).toBe("PEER_TO_PEER");
    expect(await recordPeerOutcome(daxState, dax, "approved", offer({ number: "D-OK" }), NOW)).toMatchObject({ status: "APPROVED", reason: "NEW" });

    const yar = new AuthState();
    park(yar, tracked({ id: "yar" }), "approved");
    expect(applyEpicChange(yar, "yar", "scan_outside_approval", "scan date moved outside approval", NOW, "2027-03-10T09:00:00").status).toBe("PROCESSING");

    const failed = await play("write-fail", tracked({ id: "write-fail" }), [
      { op: "submit", reference: "WF", raw: "accepted" },
      { op: "status", raw: "received" },
      { op: "status", raw: "approved", approval: offer({ number: "WF" }) },
    ], { epicFailures: 3 });
    expect(failed.final.status).not.toBe("APPROVED");
    expect(failed.final.reason).toBe("WRITEBACK_FAILED");

    const panel = buildInsurerPanel({
      insurerName: "Federation Health",
      plan: "PPO",
      channel: "api",
      interactions: kirk.rows,
      approval: { number: "FH-KIRK", cpt: "72148", validFrom: "2026-11-16", validTo: "2027-02-14", units: 1 },
      matched: true,
      packetUrl: "packet://kirk/as-sent",
      nextCheckAt: null,
    });
    expect(panel?.reference).toBe("FH-KIRK");
    expect(panel?.sent[0]?.label).toBe("Office note");
  });
});

async function play(
  _name: string,
  order: TrackedOrder,
  steps: MockStep[],
  options: { start?: "submitted" | "portal"; checks?: number; epicFailures?: number } = {},
) {
  const state = new AuthState();
  park(state, order, options.start ?? "submitted");
  scriptOrder(order.id, steps);
  const epic = scriptedEpic(options.epicFailures ?? 0);
  await submitToInsurer(state, order, NOW, { epic });
  const reasons = [readOrder(state, order.id).reason];
  const checks = options.checks ?? steps.filter((step) => step.op === "status" || step.op === "error").length - 1;
  for (let i = 0; i < checks; i += 1) {
    await checkNow(state, order, NOW, { epic });
    reasons.push(readOrder(state, order.id).reason);
  }
  return { final: readOrder(state, order.id), reasons, rows: readInteractions(state, order.id) };
}

describe("lookups are interactions", () => {
  it("logs eligibility and an existing approval", async () => {
    const state = new AuthState();
    const order = tracked({ id: "look" });
    park(state, order);
    scriptOrder(order.id, [
      { op: "eligibility", raw: "eligible", eligible: true },
      { op: "existing", raw: "none", approval: null },
    ]);
    await lookupEligibility(state, order, NOW);
    await lookupExisting(state, order, NOW);
    expect(readInteractions(state, order.id).map((row) => row.kind)).toEqual(["eligibility", "existing_approval"]);
  });
});

describe("phi", () => {
  it("redacts names and record numbers for external logs only", () => {
    expect(redactPhi("James Kirk HH-0017001 timed out", ["James Kirk"])).toBe("[redacted] [redacted] timed out");
  });
});
