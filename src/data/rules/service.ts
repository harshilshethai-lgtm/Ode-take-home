// Rule-management API. Functions are shaped like the REST endpoints in the spec and throw ApiError with an
// HTTP-style status (404 / 409 / 422 ...). The UI calls only this layer; to move behind a real server, expose
// each function as a route and swap the store.
//
//   GET    /policies                       listPolicies
//   GET    /policies/:id                   getPolicy
//   GET    /policies/:id/versions/:vid     getVersion
//   POST   /policies/:id/versions          createDraft           (optional cloneFrom)
//   PATCH  /versions/:id                   patchVersion          (drafts only, else 409)
//   POST   /versions/:id/validate          validateVersion
//   POST   /versions/:id/test              testVersion
//   POST   /versions/:id/publish           publishVersion
//   GET    /versions/compare?a=&b=         compareVersions
//   POST   /evaluate                       evaluate
//   GET    /evaluations/:id                getEvaluation
//   GET    /audit?entityId=                getAudit

import { addDays } from "@/domain/rules/dates";
import { diffVersions, summarizeDiff, type DiffSummary, type VersionDiff } from "@/domain/rules/diff";
import { ENGINE_VERSION, evaluateOrder } from "@/domain/rules/engine";
import { runTestCases, type TestRunResult } from "@/domain/rules/testRunner";
import { validateVersion, type ValidationContext } from "@/domain/rules/validation";
import { deriveStatus } from "@/domain/rules/versionStatus";
import type {
  AuditAction,
  AuditLog,
  Evaluation,
  EvaluationInput,
  Payer,
  Policy,
  PolicyVersion,
  PriorAuthRequirement,
  RulesUser,
  TestCase,
  ValidationResult,
  VersionEditableFields,
  VersionStatus,
} from "@/domain/rules/types";
import { newId, type RulesDb, type RulesStore } from "./store";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type VersionView = PolicyVersion & { derivedStatus: VersionStatus };

export interface PolicySummary {
  policy: Policy;
  payer: Payer;
  /** The version people think of as "current": active, else the next scheduled, else the latest published. */
  current: VersionView | null;
  openDraft: VersionView | null;
  scheduled: VersionView | null;
  cptCodes: string[];
  warningCount: number;
  hasAssumptions: boolean;
  testCaseCount: number;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
}

export interface PolicyFilters {
  payerId?: string;
  bodySite?: string;
  cpt?: string;
  hasAssumptions?: boolean;
  q?: string;
}

export interface CoverageGaps {
  cptWithoutCriteria: Array<PriorAuthRequirement & { payerName: string }>;
  policiesWithoutTests: Array<{ policy: Policy; payer: Payer }>;
  assumptionVersions: Array<{ policy: Policy; payer: Payer; version: VersionView; count: number }>;
  sourceChanged: Array<{ policy: Policy; payer: Payer; version: VersionView; document: string; publishedHash: string; observedHash: string }>;
}

export interface ApiOptions {
  /** ISO date. Injected so the prototype's demo clock (and tests) control "today". */
  today: () => string;
  /** ISO timestamp for audit and publish stamps. */
  now: () => string;
}

const docPath = (doc: string) => doc.split("#")[0];

export function createRulesApi(store: RulesStore, opts: ApiOptions) {
  const db = () => store.getSnapshot();
  const today = () => opts.today();

  /* ------------------------------ helpers ------------------------------ */

  const view = (v: PolicyVersion): VersionView => ({ ...v, derivedStatus: deriveStatus(v, today()) });

  function requireVersion(d: RulesDb, id: string): PolicyVersion {
    const v = d.versions.find((x) => x.id === id);
    if (!v) throw new ApiError(404, `Version ${id} not found.`);
    return v;
  }
  function requirePolicy(d: RulesDb, id: string): { policy: Policy; payer: Payer } {
    const policy = d.policies.find((p) => p.id === id);
    if (!policy) throw new ApiError(404, `Policy ${id} not found.`);
    return { policy, payer: d.payers.find((p) => p.id === policy.payerId)! };
  }

  function ctxFor(d: RulesDb, policy: Policy): ValidationContext {
    return {
      policy,
      payers: d.payers,
      policies: d.policies,
      allVersions: d.versions,
      testCaseCount: d.testCases.filter((t) => t.policyId === policy.id).length,
      today: today(),
    };
  }

  function validate(d: RulesDb, v: PolicyVersion, publish?: { effectiveFrom: string | null; changeNote: string | null }): ValidationResult {
    const { policy } = requirePolicy(d, v.policyId);
    return validateVersion(v, ctxFor(d, policy), publish);
  }

  function audit(d: RulesDb, a: { actor: string; action: AuditAction; entityType: AuditLog["entityType"]; entityId: string; before: unknown; after: unknown }) {
    const timestamp = opts.now();
    // Autosave fires often: fold consecutive edits by one person into a single entry.
    if (a.action === "edited") {
      const last = [...d.auditLog].reverse().find((x) => x.entityId === a.entityId);
      if (last && last.action === "edited" && last.actor === a.actor && Date.parse(timestamp) - Date.parse(last.timestamp) < 5 * 60_000) {
        last.after = { ...(last.after as object), ...(a.after as object) };
        last.timestamp = timestamp;
        return;
      }
    }
    d.auditLog.push({ id: newId(d, "audit"), timestamp, ...a });
  }

  const activeVersionOf = (d: RulesDb, policyId: string): PolicyVersion | null =>
    d.versions.find((v) => v.policyId === policyId && deriveStatus(v, today()) === "active") ?? null;

  function summarize(d: RulesDb, policy: Policy): PolicySummary {
    const payer = d.payers.find((p) => p.id === policy.payerId)!;
    const vs = d.versions.filter((v) => v.policyId === policy.id);
    const views = vs.map(view);
    const active = views.find((v) => v.derivedStatus === "active") ?? null;
    const scheduled = views.filter((v) => v.derivedStatus === "scheduled").sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!))[0] ?? null;
    const openDraft = views.find((v) => v.derivedStatus === "draft") ?? null;
    const latestPublished = views.filter((v) => v.status === "published").sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
    const current = active ?? scheduled ?? latestPublished;
    const shown = current ?? openDraft;
    const last = [...vs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return {
      policy,
      payer,
      current,
      openDraft,
      scheduled,
      cptCodes: shown?.applicability.cptCodes ?? [],
      warningCount: current ? validate(d, current).warnings.length : 0,
      hasAssumptions: !!shown && (shown.criteria.some((c) => c.isAssumption) || shown.exceptions.some((e) => e.isAssumption)),
      testCaseCount: d.testCases.filter((t) => t.policyId === policy.id).length,
      lastUpdatedBy: last ? (last.publishedBy && last.publishedAt === last.updatedAt ? last.publishedBy : last.lastEditedBy) : "",
      lastUpdatedAt: last?.updatedAt ?? policy.createdAt,
    };
  }

  /* ------------------------------ reads ------------------------------ */

  function listPolicies(f: PolicyFilters = {}): PolicySummary[] {
    const d = db();
    const q = f.q?.trim().toLowerCase();
    return d.policies
      .map((p) => summarize(d, p))
      .filter((s) => {
        if (f.payerId && s.payer.id !== f.payerId) return false;
        if (f.bodySite && s.policy.bodySite !== f.bodySite) return false;
        if (f.cpt && !d.versions.some((v) => v.policyId === s.policy.id && v.applicability.cptCodes.includes(f.cpt!))) return false;
        if (f.hasAssumptions && !s.hasAssumptions) return false;
        if (q) {
          const hay = [s.policy.externalPolicyId, s.policy.title, s.payer.name, ...s.cptCodes].join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.payer.name.localeCompare(b.payer.name) || a.policy.externalPolicyId.localeCompare(b.policy.externalPolicyId));
  }

  /** "Which policy governs CPT 72148?" Reports the version that governs today, if any. */
  function findPolicyForCpt(cpt: string): Array<{ policy: Policy; payer: Payer; version: VersionView | null; status: "governs" | "scheduled" | "draft_only" }> {
    const d = db();
    const out: Array<{ policy: Policy; payer: Payer; version: VersionView | null; status: "governs" | "scheduled" | "draft_only" }> = [];
    for (const policy of d.policies) {
      const vs = d.versions.filter((v) => v.policyId === policy.id && v.applicability.cptCodes.includes(cpt)).map(view);
      if (vs.length === 0) continue;
      const payer = d.payers.find((p) => p.id === policy.payerId)!;
      const active = vs.find((v) => v.derivedStatus === "active");
      const scheduled = vs.find((v) => v.derivedStatus === "scheduled");
      if (active) out.push({ policy, payer, version: active, status: "governs" });
      else if (scheduled) out.push({ policy, payer, version: scheduled, status: "scheduled" });
      else out.push({ policy, payer, version: vs[0], status: "draft_only" });
    }
    return out;
  }

  function getPolicy(id: string) {
    const d = db();
    const { policy, payer } = requirePolicy(d, id);
    const versions = d.versions
      .filter((v) => v.policyId === id)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map(view);
    return {
      policy,
      payer,
      versions,
      testCases: d.testCases.filter((t) => t.policyId === id),
      openDraft: versions.find((v) => v.derivedStatus === "draft") ?? null,
      active: versions.find((v) => v.derivedStatus === "active") ?? null,
    };
  }

  function getVersion(policyId: string, versionId: string) {
    const d = db();
    const { policy, payer } = requirePolicy(d, policyId);
    const v = requireVersion(d, versionId);
    if (v.policyId !== policyId) throw new ApiError(404, `Version ${versionId} does not belong to policy ${policyId}.`);
    return { policy, payer, version: view(v) };
  }

  function getVersionById(versionId: string) {
    const d = db();
    const v = requireVersion(d, versionId);
    return getVersion(v.policyId, versionId);
  }

  /* ------------------------------ drafts ------------------------------ */

  function createDraft(policyId: string, o: { actor: RulesUser; cloneFrom?: string; kind?: "clone" | "rollback" }): VersionView {
    return store.mutate((d) => {
      const { policy } = requirePolicy(d, policyId);
      const existing = d.versions.find((v) => v.policyId === policyId && v.status === "draft");
      if (existing) {
        throw new ApiError(409, `${policy.externalPolicyId} already has an open draft (v${existing.versionNumber}). Finish or archive it first.`, {
          existingDraftId: existing.id,
        });
      }
      const siblings = d.versions.filter((v) => v.policyId === policyId);
      const source = o.cloneFrom
        ? siblings.find((v) => v.id === o.cloneFrom)
        : [...siblings].filter((v) => v.status === "published").sort((a, b) => b.versionNumber - a.versionNumber)[0];
      if (o.cloneFrom && !source) throw new ApiError(404, `Version ${o.cloneFrom} not found in this policy.`);
      if (!source) throw new ApiError(422, "There is no published version to start from.");

      const id = newId(d, "ver");
      const now = opts.now();
      const draft: PolicyVersion = {
        ...structuredClone(source),
        id,
        versionNumber: Math.max(...siblings.map((v) => v.versionNumber)) + 1,
        status: "draft",
        effectiveFrom: null,
        effectiveTo: null,
        changeNote: o.kind === "rollback" ? `Rollback to v${source.versionNumber}.` : null,
        createdBy: o.actor.name,
        lastEditedBy: o.actor.name,
        publishedBy: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
        clonedFromVersionId: source.id,
        criteria: source.criteria.map((c) => ({ ...structuredClone(c), id: newId(d, "crit"), policyVersionId: id })),
        exceptions: source.exceptions.map((e) => ({ ...structuredClone(e), id: newId(d, "exc"), policyVersionId: id })),
      };
      d.versions.push(draft);
      audit(d, {
        actor: o.actor.name,
        action: o.kind === "rollback" ? "rollback" : o.cloneFrom ? "cloned" : "created_draft",
        entityType: "policy_version",
        entityId: id,
        before: null,
        after: { versionNumber: draft.versionNumber, clonedFromVersionId: source.id, clonedFromVersion: source.versionNumber },
      });
      return view(draft);
    });
  }

  function patchVersion(versionId: string, patch: Partial<VersionEditableFields>, actor: RulesUser): { version: VersionView; validation: ValidationResult } {
    return store.mutate((d) => {
      const v = requireVersion(d, versionId);
      if (v.status !== "draft") {
        throw new ApiError(409, `v${v.versionNumber} is ${v.status} and cannot be modified. Create a new draft instead.`);
      }
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(patch)) {
        const key = k as keyof VersionEditableFields;
        if (JSON.stringify(v[key]) === JSON.stringify(val)) continue;
        before[key] = structuredClone(v[key]);
        after[key] = structuredClone(val);
        (v as unknown as Record<string, unknown>)[key] = structuredClone(val);
      }
      if (patch.criteria) {
        v.criteria = v.criteria.map((c, i) => ({ ...c, policyVersionId: v.id, sortOrder: i }));
      }
      if (patch.exceptions) {
        v.exceptions = v.exceptions.map((e) => ({ ...e, policyVersionId: v.id }));
      }
      if (Object.keys(after).length > 0) {
        v.updatedAt = opts.now();
        v.lastEditedBy = actor.name;
        audit(d, { actor: actor.name, action: "edited", entityType: "policy_version", entityId: v.id, before, after });
      }
      return { version: view(v), validation: validate(d, v) };
    });
  }

  /** Validate a version. `unsaved` lets the editor validate its in-memory state without saving it first. */
  function validateVersionById(
    versionId: string,
    publish?: { effectiveFrom: string | null; changeNote: string | null },
    unsaved?: Partial<VersionEditableFields>,
  ): ValidationResult {
    const d = db();
    const v = requireVersion(d, versionId);
    return validate(d, unsaved ? { ...v, ...unsaved } : v, publish);
  }

  function archiveVersion(versionId: string, actor: RulesUser): VersionView {
    return store.mutate((d) => {
      const v = requireVersion(d, versionId);
      if (v.status !== "draft") throw new ApiError(409, `Only drafts can be archived; v${v.versionNumber} is ${v.status}.`);
      v.status = "archived";
      v.updatedAt = opts.now();
      audit(d, { actor: actor.name, action: "archived", entityType: "policy_version", entityId: v.id, before: { status: "draft" }, after: { status: "archived" } });
      return view(v);
    });
  }

  /* ------------------------------ test & publish ------------------------------ */

  function runTests(d: RulesDb, v: PolicyVersion): TestRunResult {
    const { policy, payer } = requirePolicy(d, v.policyId);
    return runTestCases(payer, policy, v, activeVersionOf(d, v.policyId), d.testCases.filter((t) => t.policyId === policy.id));
  }

  /** Run the policy's golden cases against this version and the active one. Read-only apart from the audit entry. */
  function testVersion(versionId: string, actor: RulesUser): TestRunResult {
    return store.mutate((d) => {
      const v = requireVersion(d, versionId);
      const result = runTests(d, v);
      audit(d, {
        actor: actor.name,
        action: "test_run",
        entityType: "policy_version",
        entityId: v.id,
        before: null,
        after: { total: result.total, passing: result.candidatePassing, failing: result.candidateFailing, changed: result.changedCount },
      });
      return result;
    });
  }

  function previewPublish(versionId: string, req: { effectiveFrom: string | null; changeNote: string | null }) {
    const d = db();
    const v = requireVersion(d, versionId);
    const active = activeVersionOf(d, v.policyId);
    const latestPublished = d.versions.filter((x) => x.policyId === v.policyId && x.status === "published").sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
    const baseline = active ?? latestPublished;
    const diff: VersionDiff | null = baseline ? diffVersions(baseline, v) : null;
    return {
      validation: validate(d, v, req),
      diff,
      summary: diff ? summarizeDiff(diff) : (null as DiffSummary | null),
      baseline: baseline ? view(baseline) : null,
      tests: runTests(d, v),
      openAssumptions: v.criteria.filter((c) => c.isAssumption).length + v.exceptions.filter((e) => e.isAssumption).length,
      twoPersonRule: d.config.twoPersonRule,
    };
  }

  function publishVersion(versionId: string, req: { effectiveFrom: string; changeNote: string }, actor: RulesUser): VersionView {
    return store.mutate((d) => {
      const v = requireVersion(d, versionId);
      if (v.status !== "draft") throw new ApiError(409, `v${v.versionNumber} is already ${v.status}; published versions are immutable.`);

      if (d.config.twoPersonRule) {
        if (actor.role !== "approver") throw new ApiError(403, "Only an approver can publish while the two-person rule is on.");
        if (actor.name === v.lastEditedBy) throw new ApiError(403, "The two-person rule is on: the publisher must be someone other than the last editor.");
      }

      const validation = validate(d, v, req);
      if (validation.errors.length > 0) throw new ApiError(422, "This version has errors and cannot be published.", validation);

      // The previous latest version stops where this one starts. effectiveTo is the only field that changes
      // on a published version, and only ever through this path.
      const prev = d.versions
        .filter((x) => x.policyId === v.policyId && x.id !== v.id && x.status === "published")
        .sort((a, b) => b.effectiveFrom!.localeCompare(a.effectiveFrom!))[0];
      let supersedes: unknown = null;
      if (prev) {
        const before = prev.effectiveTo;
        prev.effectiveTo = addDays(req.effectiveFrom, -1);
        supersedes = { versionId: prev.id, versionNumber: prev.versionNumber, effectiveToBefore: before, effectiveToAfter: prev.effectiveTo };
      }

      const now = opts.now();
      v.status = "published";
      v.effectiveFrom = req.effectiveFrom;
      v.effectiveTo = null;
      v.changeNote = req.changeNote.trim();
      v.publishedBy = actor.name;
      v.publishedAt = now;
      v.updatedAt = now;

      audit(d, {
        actor: actor.name,
        action: "published",
        entityType: "policy_version",
        entityId: v.id,
        before: { status: "draft" },
        after: { status: "published", versionNumber: v.versionNumber, effectiveFrom: v.effectiveFrom, changeNote: v.changeNote, supersedes },
      });
      return view(v);
    });
  }

  function compareVersions(aId: string, bId: string): VersionDiff {
    const d = db();
    const a = requireVersion(d, aId);
    const b = requireVersion(d, bId);
    if (a.policyId !== b.policyId) throw new ApiError(400, "Only versions of the same policy can be compared.");
    return diffVersions(a, b);
  }

  /* ------------------------------ evaluations ------------------------------ */

  function evaluate(input: EvaluationInput, meta: { patientRef: string; orderRef: string }): Evaluation {
    return store.mutate((d) => {
      const { outcome, policyVersionId } = evaluateOrder(d, input);
      const evaluation: Evaluation = {
        id: newId(d, "eval"),
        patientRef: meta.patientRef,
        orderRef: meta.orderRef,
        serviceDate: input.serviceDate,
        cptCode: input.cptCode,
        planType: input.planType,
        payerId: input.payerId,
        policyVersionId,
        input: structuredClone(input),
        engineVersion: ENGINE_VERSION,
        createdAt: opts.now(),
        ...outcome,
      };
      d.evaluations.push(evaluation);
      return evaluation;
    });
  }

  function getEvaluation(id: string) {
    const d = db();
    const evaluation = d.evaluations.find((e) => e.id === id);
    if (!evaluation) throw new ApiError(404, `Evaluation ${id} not found.`);
    const version = evaluation.policyVersionId ? d.versions.find((v) => v.id === evaluation.policyVersionId) ?? null : null;
    const versionView = version ? view(version) : null;
    const policy = version ? d.policies.find((p) => p.id === version.policyId) ?? null : null;
    const payer = d.payers.find((p) => p.id === evaluation.payerId) ?? null;
    // If the pinned version is no longer current, find what took over so the trace can say so.
    let supersededBy: VersionView | null = null;
    if (version && versionView?.derivedStatus === "superseded") {
      supersededBy =
        d.versions
          .filter((v) => v.policyId === version.policyId && v.status === "published" && v.effectiveFrom && v.effectiveFrom > version.effectiveFrom!)
          .sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!))
          .map(view)[0] ?? null;
    }
    return { evaluation, version: versionView, policy, payer, supersededBy };
  }

  function listEvaluations(f: { policyId?: string; versionId?: string } = {}): Evaluation[] {
    const d = db();
    const versionIds = f.policyId ? new Set(d.versions.filter((v) => v.policyId === f.policyId).map((v) => v.id)) : null;
    return d.evaluations
      .filter((e) => (!f.versionId || e.policyVersionId === f.versionId) && (!versionIds || (e.policyVersionId !== null && versionIds.has(e.policyVersionId))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * "Re-run under current rules": same facts, resolved against whatever governs the service date now.
   * Pass a new serviceDate when the scan has been rescheduled.
   */
  function rerunEvaluation(id: string, o: { serviceDate?: string } = {}): Evaluation {
    const d = db();
    const e = d.evaluations.find((x) => x.id === id);
    if (!e) throw new ApiError(404, `Evaluation ${id} not found.`);
    return evaluate({ ...e.input, serviceDate: o.serviceDate ?? e.input.serviceDate }, { patientRef: e.patientRef, orderRef: e.orderRef });
  }

  /** Turn a real evaluation into a golden test case, with today's result as the expectation. */
  function saveEvaluationAsTestCase(evaluationId: string, name: string, actor: RulesUser): TestCase {
    return store.mutate((d) => {
      const e = d.evaluations.find((x) => x.id === evaluationId);
      if (!e) throw new ApiError(404, `Evaluation ${evaluationId} not found.`);
      if (!e.policyVersionId || e.overall === "no_policy_found") throw new ApiError(422, "No policy governed this evaluation, so there is nothing to test.");
      const policyId = d.versions.find((v) => v.id === e.policyVersionId)!.policyId;
      const { payerId: _payerId, ...input } = e.input;
      void _payerId;
      const testCase: TestCase = {
        id: newId(d, "tc"),
        policyId,
        name: name.trim() || `Case from ${e.orderRef}`,
        description: `Saved from evaluation of order ${e.orderRef} on ${opts.now().slice(0, 10)} by ${actor.name}.`,
        input: structuredClone(input),
        expected: {
          overall: e.overall as TestCase["expected"]["overall"],
          criteria: Object.fromEntries(e.criterionResults.map((r) => [r.criterionKey, r.status])),
          submissionBlocked: e.submissionBlocked,
        },
      };
      d.testCases.push(testCase);
      return testCase;
    });
  }

  /* ------------------------------ audit, gaps, config ------------------------------ */

  function getAudit(entityId: string): AuditLog[] {
    return db()
      .auditLog.filter((a) => a.entityId === entityId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  function getCoverageGaps(): CoverageGaps {
    const d = db();
    const summaries = d.policies.map((p) => summarize(d, p));
    const covered = (payerId: string, cpt: string) =>
      d.versions.some((v) => {
        const p = d.policies.find((x) => x.id === v.policyId)!;
        return p.payerId === payerId && v.status === "published" && v.criteria.length > 0 && v.applicability.cptCodes.includes(cpt);
      });
    return {
      cptWithoutCriteria: d.priorAuthRequirements
        .filter((r) => !covered(r.payerId, r.cptCode))
        .map((r) => ({ ...r, payerName: d.payers.find((p) => p.id === r.payerId)!.name })),
      policiesWithoutTests: summaries.filter((s) => s.testCaseCount === 0).map((s) => ({ policy: s.policy, payer: s.payer })),
      assumptionVersions: summaries.flatMap((s) =>
        [s.current, s.openDraft]
          .filter((v): v is VersionView => !!v)
          .map((version) => ({
            policy: s.policy,
            payer: s.payer,
            version,
            count: version.criteria.filter((c) => c.isAssumption).length + version.exceptions.filter((e) => e.isAssumption).length,
          }))
          .filter((x) => x.count > 0),
      ),
      sourceChanged: summaries.flatMap((s) => {
        const v = s.current;
        if (!v?.sourceDocument || !v.sourceDocumentHash) return [];
        const observed = d.observedSourceHashes[docPath(v.sourceDocument)];
        if (!observed || observed === v.sourceDocumentHash) return [];
        return [{ policy: s.policy, payer: s.payer, version: v, document: docPath(v.sourceDocument), publishedHash: v.sourceDocumentHash, observedHash: observed }];
      }),
    };
  }

  /** Called by whatever watches insurer documents. Records the newest hash; the gap panel compares it to what was published. */
  function observeSourceHash(document: string, hash: string) {
    store.mutate((d) => {
      d.observedSourceHashes[docPath(document)] = hash;
    });
  }

  const getConfig = () => db().config;
  function setTwoPersonRule(on: boolean) {
    store.mutate((d) => {
      d.config.twoPersonRule = on;
    });
  }

  return {
    today,
    listPolicies,
    findPolicyForCpt,
    getPolicy,
    getVersion,
    getVersionById,
    createDraft,
    patchVersion,
    validateVersion: validateVersionById,
    archiveVersion,
    testVersion,
    previewPublish,
    publishVersion,
    compareVersions,
    evaluate,
    getEvaluation,
    listEvaluations,
    rerunEvaluation,
    saveEvaluationAsTestCase,
    getAudit,
    getCoverageGaps,
    observeSourceHash,
    getConfig,
    setTwoPersonRule,
    reset: () => store.reset(),
  };
}

export type RulesApi = ReturnType<typeof createRulesApi>;
