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
//
// Published versions are immutable: every write goes through `mutate`, which rolls back and throws 409 if a
// published version changed. Every successful write appends to the audit log (actor, action, entity, before,
// after, timestamp); refused and no-op writes append nothing.

import { slugify } from "@/domain/rules/common";
import { addDays } from "@/domain/rules/dates";
import { diffVersions, summarizeDiff, type DiffSummary, type VersionDiff } from "@/domain/rules/diff";
import { ENGINE_VERSION, buildSnapshot, evaluateOrder, rollupOverall } from "@/domain/rules/engine";
import { evaluationStaleness, type Staleness } from "@/domain/rules/staleness";
import { runTestCases, type TestRunResult } from "@/domain/rules/testRunner";
import { assumptionCount } from "@/domain/rules/policyProperties";
import { validateVersion, type ValidationContext } from "@/domain/rules/validation";
import { changedPublished, publishedFingerprint } from "@/domain/rules/immutability";
import { deriveStatus, versionFor } from "@/domain/rules/versionStatus";
import type {
  AuditAction,
  CriterionResult,
  CriterionStatus,
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

export interface RecentPublish {
  versionId: string;
  /** The published version it replaced, to diff against. Null for a policy's first version. */
  previousVersionId: string | null;
  policyId: string;
  payerName: string;
  externalPolicyId: string;
  versionNumber: number;
  changeNote: string | null;
  publishedAt: string;
  publishedBy: string;
  effectiveFrom: string | null;
  derivedStatus: string;
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

  /**
   * Every write goes through here. Beyond the per-endpoint checks (409 on a non-draft), this guarantees that no
   * mutation, present or future, can alter a published version: the store rolls the change back and we throw 409.
   */
  function mutate<T>(fn: (d: RulesDb) => T): T {
    return store.mutate((d) => {
      const before = publishedFingerprint(d.versions);
      const result = fn(d);
      const broken = changedPublished(before, d.versions);
      if (broken.length > 0) {
        const names = broken.map((id) => `v${d.versions.find((v) => v.id === id)?.versionNumber ?? "?"}`).join(", ");
        throw new ApiError(409, `Published versions are immutable (${names}). Create a new draft instead.`);
      }
      return result;
    });
  }

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
      hasAssumptions: !!shown && assumptionCount(shown) > 0,
      testCaseCount: d.testCases.filter((t) => t.policyId === policy.id).length,
      lastUpdatedBy: last ? (last.publishedBy && last.publishedAt === last.updatedAt ? last.publishedBy : last.lastEditedBy) : "",
      lastUpdatedAt: last?.updatedAt ?? policy.createdAt,
    };
  }

  /* ------------------------------ reads ------------------------------ */

  function listPayers(): Payer[] {
    return [...db().payers].sort((a, b) => a.name.localeCompare(b.name));
  }

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

  /** The published version of a policy that governs a service date (range ends inclusive), or null. */
  function getVersionFor(policyId: string, serviceDate: string): VersionView | null {
    const d = db();
    requirePolicy(d, policyId);
    const v = versionFor(d.versions, policyId, serviceDate);
    return v ? view(v) : null;
  }

  /** The latest publishes across every payer, newest first: the "Recent changes" strip. */
  function listRecentPublishes(limit = 10): RecentPublish[] {
    const d = db();
    return d.versions
      .filter((v) => v.status === "published" && v.publishedAt && v.publishedBy)
      .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!) || b.versionNumber - a.versionNumber)
      .slice(0, limit)
      .map((v) => {
        const { policy, payer } = requirePolicy(d, v.policyId);
        const previous = d.versions
          .filter((x) => x.policyId === v.policyId && x.status === "published" && x.versionNumber < v.versionNumber)
          .sort((a, b) => b.versionNumber - a.versionNumber)[0];
        return {
          versionId: v.id,
          previousVersionId: previous?.id ?? null,
          policyId: policy.id,
          payerName: payer.name,
          externalPolicyId: policy.externalPolicyId,
          versionNumber: v.versionNumber,
          changeNote: v.changeNote,
          publishedAt: v.publishedAt!,
          publishedBy: v.publishedBy!,
          effectiveFrom: v.effectiveFrom,
          derivedStatus: deriveStatus(v, today()),
        };
      });
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
    return mutate((d) => {
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
    return mutate((d) => {
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

  /**
   * Create a policy (and its payer, if new) with an empty draft v1, so a rules admin can start from nothing.
   * 409 when the payer already has a policy with that ID.
   */
  function createPolicy(
    input: { payerId?: string; newPayerName?: string; externalPolicyId: string; title: string; bodySite: string },
    actor: RulesUser,
  ): { policy: Policy; payer: Payer; draft: VersionView } {
    return mutate((d) => {
      const externalPolicyId = input.externalPolicyId.trim();
      const title = input.title.trim();
      const bodySite = slugify(input.bodySite);
      const problems: string[] = [];
      if (!externalPolicyId) problems.push("policy ID");
      if (!title) problems.push("title");
      if (!bodySite) problems.push("body site");
      let payer = input.payerId ? d.payers.find((p) => p.id === input.payerId) : undefined;
      if (input.payerId && !payer) throw new ApiError(404, `Payer ${input.payerId} not found.`);
      const newName = input.newPayerName?.trim() ?? "";
      if (!payer && !newName) problems.push("payer");
      if (problems.length > 0) throw new ApiError(422, `Add the ${problems.join(", ")}.`, { fields: problems });

      const existingPayer = payer ?? d.payers.find((p) => p.name.toLowerCase() === newName.toLowerCase());
      if (existingPayer && d.policies.some((p) => p.payerId === existingPayer.id && p.externalPolicyId.toLowerCase() === externalPolicyId.toLowerCase())) {
        throw new ApiError(409, `${existingPayer.name} already has a policy ${externalPolicyId}.`);
      }

      const now = opts.now();
      let createdPayer = false;
      if (!payer) {
        payer = existingPayer;
        if (!payer) {
          const base = slugify(newName) || "payer";
          let slug = base;
          for (let n = 2; d.payers.some((p) => p.slug === slug); n++) slug = `${base}_${n}`;
          payer = { id: newId(d, "payer"), name: newName, slug: slug.replace(/_/g, "-") };
          d.payers.push(payer);
          createdPayer = true;
        }
      }
      const policy: Policy = { id: newId(d, "pol"), payerId: payer.id, externalPolicyId, title, bodySite, createdAt: now };
      d.policies.push(policy);
      const draft: PolicyVersion = {
        id: newId(d, "ver"),
        policyId: policy.id,
        versionNumber: 1,
        status: "draft",
        effectiveFrom: null,
        effectiveTo: null,
        sourceRevisionLabel: null,
        sourceDocument: null,
        sourceDocumentHash: null,
        applicability: { cptCodes: [], settings: "all" },
        logic: "ALL",
        properties: [],
        criteria: [],
        exceptions: [],
        changeNote: null,
        createdBy: actor.name,
        lastEditedBy: actor.name,
        publishedBy: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
        clonedFromVersionId: null,
      };
      d.versions.push(draft);
      audit(d, {
        actor: actor.name,
        action: "created_policy",
        entityType: "policy",
        entityId: policy.id,
        before: null,
        after: { payer: payer.name, newPayer: createdPayer, externalPolicyId, title, bodySite },
      });
      audit(d, { actor: actor.name, action: "created_draft", entityType: "policy_version", entityId: draft.id, before: null, after: { versionNumber: 1, empty: true } });
      return { policy, payer, draft: view(draft) };
    });
  }

  /**
   * Throw a draft away. The draft is archived (history stays in the audit log). If it was the policy's only
   * version, the policy never really existed, so it is removed with it.
   */
  function discardDraft(versionId: string, actor: RulesUser): { policyRemoved: boolean } {
    return mutate((d) => {
      const v = requireVersion(d, versionId);
      if (v.status !== "draft") throw new ApiError(409, `Only drafts can be discarded; v${v.versionNumber} is ${v.status}.`);
      const others = d.versions.filter((x) => x.policyId === v.policyId && x.id !== v.id);
      if (others.length === 0) {
        d.versions = d.versions.filter((x) => x.id !== v.id);
        d.policies = d.policies.filter((p) => p.id !== v.policyId);
        d.testCases = d.testCases.filter((t) => t.policyId !== v.policyId);
        audit(d, { actor: actor.name, action: "archived", entityType: "policy_version", entityId: v.id, before: { status: "draft", versionNumber: v.versionNumber }, after: { status: "discarded", policyRemoved: true } });
        return { policyRemoved: true };
      }
      v.status = "archived";
      v.updatedAt = opts.now();
      audit(d, { actor: actor.name, action: "archived", entityType: "policy_version", entityId: v.id, before: { status: "draft" }, after: { status: "archived" } });
      return { policyRemoved: false };
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
    return mutate((d) => {
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
    return mutate((d) => {
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
      openAssumptions: assumptionCount(v),
      twoPersonRule: d.config.twoPersonRule,
    };
  }

  function publishVersion(versionId: string, req: { effectiveFrom: string; changeNote: string }, actor: RulesUser): VersionView {
    return mutate((d) => {
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

  function evaluate(input: EvaluationInput, meta: { patientRef: string; orderRef: string; actor?: string }): Evaluation {
    return mutate((d) => {
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
      audit(d, {
        actor: meta.actor ?? "System",
        action: "evaluated",
        entityType: "evaluation",
        entityId: evaluation.id,
        before: null,
        after: { orderRef: meta.orderRef, overall: evaluation.overall, policyVersionId, engineVersion: ENGINE_VERSION },
      });
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
    const staleness = evaluationStaleness(d.versions, evaluation);
    return { evaluation, version: versionView, policy, payer, supersededBy, staleness: staleness ? withViews(staleness) : null };
  }

  const withViews = (s: Staleness) => ({ ...s, pinned: view(s.pinned), applicable: view(s.applicable) });

  /** The newest evaluation recorded for an order number, or null. */
  function getLatestEvaluationFor(orderRef: string): Evaluation | null {
    return db().evaluations.filter((e) => e.orderRef === orderRef).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  /** Has a newer version taken over for this evaluation's service date? Null when the check is still current. */
  function getStaleness(evaluationId: string) {
    const d = db();
    const e = d.evaluations.find((x) => x.id === evaluationId);
    if (!e) throw new ApiError(404, `Evaluation ${evaluationId} not found.`);
    const s = evaluationStaleness(d.versions, e);
    return s ? withViews(s) : null;
  }

  /**
   * Store an outcome that was decided elsewhere (a case's checks) as an evaluation, pinned to the version that
   * governed `evaluatedOn`. The criteria snapshot is copied in, so the record stays readable if rules change.
   */
  function recordEvaluation(
    r: {
      orderRef: string;
      patientRef: string;
      policyId: string;
      cptCode: string;
      planType: string;
      serviceDate: string;
      evaluatedOn: string;
      createdAt?: string;
      results: Array<{ criterionKey: string; status: CriterionStatus; reason: string }>;
    },
    actor = "System",
  ): Evaluation {
    return mutate((d) => {
      const version = versionFor(d.versions, r.policyId, r.evaluatedOn);
      if (!version) throw new ApiError(422, `No published version of ${r.policyId} governed ${r.evaluatedOn}.`);
      return insertRecorded(d, version, r, actor);
    });
  }

  function insertRecorded(
    d: RulesDb,
    version: PolicyVersion,
    r: { orderRef: string; patientRef: string; cptCode: string; planType: string; serviceDate: string; createdAt?: string; results: Array<{ criterionKey: string; status: CriterionStatus; reason: string }> },
    actor: string,
  ): Evaluation {
    const { policy, payer } = requirePolicy(d, version.policyId);
    const snapshot = buildSnapshot(payer, policy, version);
    const criterionResults: CriterionResult[] = snapshot.criteria.map((c) => {
      const given = r.results.find((x) => x.criterionKey === c.key);
      return {
        criterionKey: c.key,
        displayLabel: c.displayLabel,
        status: given?.status ?? "unknown",
        reason: given?.reason ?? "No result was recorded.",
        evidenceRefs: [],
        ref: c.ref,
        excerpt: c.excerpt,
        ruleText: c.text,
        isAssumption: c.isAssumption,
      };
    });
    const evaluation: Evaluation = {
      id: newId(d, "eval"),
      patientRef: r.patientRef,
      orderRef: r.orderRef,
      serviceDate: r.serviceDate,
      cptCode: r.cptCode,
      planType: r.planType,
      payerId: payer.id,
      policyVersionId: version.id,
      input: { payerId: payer.id, planType: r.planType, cptCode: r.cptCode, serviceDate: r.serviceDate, facts: [] },
      engineVersion: ENGINE_VERSION,
      createdAt: r.createdAt ?? opts.now(),
      origin: "recorded",
      overall: rollupOverall(criterionResults.map((x) => x.status)),
      criterionResults,
      exceptionResults: [],
      missingInfoChecklist: [],
      submissionBlocked: false,
      rulesSnapshot: snapshot,
    };
    d.evaluations.push(evaluation);
    audit(d, {
      actor,
      action: "evaluated",
      entityType: "evaluation",
      entityId: evaluation.id,
      before: null,
      after: { orderRef: r.orderRef, overall: evaluation.overall, policyVersionId: version.id, engineVersion: ENGINE_VERSION },
    });
    return evaluation;
  }

  /**
   * Check an evaluation again under the version that governs its service date now.
   * Engine evaluations replay their facts. Recorded ones keep each result whose rule did not change and flag the
   * rest "needs review", because there are no facts to replay.
   */
  function recheckEvaluation(id: string, actor = "System"): Evaluation {
    const d = db();
    const e = d.evaluations.find((x) => x.id === id);
    if (!e) throw new ApiError(404, `Evaluation ${id} not found.`);
    if (e.origin !== "recorded") return rerunEvaluation(id, { actor });
    const stale = evaluationStaleness(d.versions, e);
    if (!stale) return e;
    const changed = new Map(stale.affected.map((a) => [a.key, a.kind]));
    const prior = new Map(e.criterionResults.map((c) => [c.criterionKey, c]));
    const results = stale.applicable.criteria.map((c) => {
      const kind = changed.get(c.key);
      const before = prior.get(c.key);
      if (!kind && before) return { criterionKey: c.key, status: before.status, reason: before.reason };
      return {
        criterionKey: c.key,
        status: "needs_review" as CriterionStatus,
        reason: `${kind === "added" ? "New" : "Changed"} in v${stale.applicable.versionNumber}. Check it against the chart again.`,
      };
    });
    const stamped = opts.now();
    const createdAt = e.createdAt >= stamped ? new Date(Date.parse(e.createdAt) + 1000).toISOString() : stamped;
    return mutate((dd) => {
      const version = dd.versions.find((v) => v.id === stale.applicable.id)!;
      return insertRecorded(dd, version, { orderRef: e.orderRef, patientRef: e.patientRef, cptCode: e.cptCode, planType: e.planType, serviceDate: e.serviceDate, createdAt, results }, actor);
    });
  }

  /** Re-check many at once. Skips ids that are already current. */
  function recheckEvaluations(ids: string[], actor = "System"): Evaluation[] {
    return ids.flatMap((id) => {
      const d = db();
      const e = d.evaluations.find((x) => x.id === id);
      if (!e || !evaluationStaleness(d.versions, e)) return [];
      return [recheckEvaluation(id, actor)];
    });
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
  function rerunEvaluation(id: string, o: { serviceDate?: string; actor?: string } = {}): Evaluation {
    const d = db();
    const e = d.evaluations.find((x) => x.id === id);
    if (!e) throw new ApiError(404, `Evaluation ${id} not found.`);
    return evaluate({ ...e.input, serviceDate: o.serviceDate ?? e.input.serviceDate }, { patientRef: e.patientRef, orderRef: e.orderRef, actor: o.actor });
  }

  /** Turn a real evaluation into a golden test case, with today's result as the expectation. */
  function saveEvaluationAsTestCase(evaluationId: string, name: string, actor: RulesUser): TestCase {
    return mutate((d) => {
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
      audit(d, { actor: actor.name, action: "test_case_saved", entityType: "test_case", entityId: testCase.id, before: null, after: { policyId, name: testCase.name, fromEvaluation: evaluationId } });
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
            count: assumptionCount(version),
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
  function observeSourceHash(document: string, hash: string, actor = "System") {
    mutate((d) => {
      const path = docPath(document);
      const previous = d.observedSourceHashes[path] ?? null;
      if (previous === hash) return;
      d.observedSourceHashes[path] = hash;
      audit(d, { actor, action: "source_observed", entityType: "source_document", entityId: path, before: { hash: previous }, after: { hash } });
    });
  }

  const getConfig = () => db().config;
  function setTwoPersonRule(on: boolean, actor?: RulesUser) {
    mutate((d) => {
      if (d.config.twoPersonRule === on) return;
      audit(d, { actor: actor?.name ?? "System", action: "config_changed", entityType: "config", entityId: "two_person_rule", before: { on: d.config.twoPersonRule }, after: { on } });
      d.config.twoPersonRule = on;
    });
  }

  return {
    today,
    listPayers,
    getVersionFor,
    listRecentPublishes,
    listPolicies,
    findPolicyForCpt,
    getPolicy,
    getVersion,
    getVersionById,
    createDraft,
    patchVersion,
    validateVersion: validateVersionById,
    archiveVersion,
    createPolicy,
    discardDraft,
    testVersion,
    previewPublish,
    publishVersion,
    compareVersions,
    evaluate,
    getEvaluation,
    getLatestEvaluationFor,
    getStaleness,
    recordEvaluation,
    recheckEvaluation,
    recheckEvaluations,
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
