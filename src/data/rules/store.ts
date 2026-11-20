// Persistence for rule management. The repo is a client-only Vite app (no server, no ORM), so the "database" is
// one versioned JSON document in localStorage behind a small store. Swapping this for a real DB later means
// re-implementing RulesStore; the service (service.ts) and everything above it stay the same.

import type {
  AuditLog,
  Evaluation,
  Payer,
  Policy,
  PolicyVersion,
  PriorAuthRequirement,
  TestCase,
} from "@/domain/rules/types";
import { migrateV3toV4 } from "./migrateV4";

/** Bump when the shape of RulesDb changes and add a step to MIGRATIONS. */
export const SCHEMA_VERSION = 4;
const STORAGE_KEY = "halcyon.rules.db";

export interface RulesConfig {
  /** When on, the publisher must be an approver and differ from the last editor. */
  twoPersonRule: boolean;
}

export interface RulesDb {
  schemaVersion: number;
  seq: number;
  payers: Payer[];
  policies: Policy[];
  versions: PolicyVersion[];
  testCases: TestCase[];
  evaluations: Evaluation[];
  auditLog: AuditLog[];
  priorAuthRequirements: PriorAuthRequirement[];
  /** Latest hash seen for each source document (path without #fragment). Drives the "source changed" gap. */
  observedSourceHashes: Record<string, string>;
  config: RulesConfig;
}

/** Return null to discard the document and re-seed (only when nothing in it was authored by a person). */
type Migration = (db: Record<string, unknown>) => Record<string, unknown> | null;
/** True when nothing in the document was authored by a person, i.e. it is only an older copy of the seed. */
// Evaluations recorded from the seed orders at startup (origin "recorded") are re-created, so they do not count.
const isUntouchedSeed = (doc: Record<string, unknown>) => {
  const authored = (doc.evaluations as Array<{ id: string; origin?: string }>).filter((e) => !e.id.startsWith("eval_seed_") && e.origin !== "recorded");
  const recorded = new Set((doc.evaluations as Array<{ id: string; origin?: string }>).filter((e) => e.origin === "recorded").map((e) => e.id));
  return (
    (doc.versions as Array<{ createdBy?: string }>).every(
      (v) => v.createdBy === "Seed import" || v.createdBy === "Priya Raman" || v.createdBy === "Marcus Lee",
    ) &&
    (doc.auditLog as Array<{ action: string; entityId: string }>).every(
      (a) => a.action === "published" || (a.action === "evaluated" && recorded.has(a.entityId)),
    ) &&
    authored.length === 0
  );
};

/** MIGRATIONS[n] upgrades a schemaVersion n document to n + 1. */
const MIGRATIONS: Record<number, Migration> = {
  // v1 -> v2: every criterion gets a failureType. Duration and repeat-imaging rules are about the patient;
  // the rest are about paperwork, which was the convention in the v1 seed.
  // The seed content changed too (RAD-114 is v3, labels are short), so an untouched seed is replaced.
  1: (doc) => {
    if (isUntouchedSeed(doc)) return null;
    const versions = (doc.versions as Array<Record<string, unknown>>).map((v) => ({
      ...v,
      criteria: (v.criteria as Array<Record<string, unknown>>).map((c) => ({
        ...c,
        failureType: c.failureType ?? (c.type === "min_duration" || c.type === "no_prior_study_in_window" ? "clinical" : "fixable"),
      })),
    }));
    return { ...doc, versions };
  },
  // v2 -> v3: the seed gained RAD-114 v1 and v2 (version history). The shape did not change, so only an
  // untouched seed is replaced; anything people edited is kept as it is.
  2: (doc) => (isUntouchedSeed(doc) ? null : doc),
  // v3 -> v4: criteria are insurer-stated properties with refs, and plan types / submission move to version
  // properties. The seed was rewritten from the insurer's text, so an untouched seed is replaced.
  3: (doc) => (isUntouchedSeed(doc) ? null : migrateV3toV4(doc)),
};

export function migrate(raw: unknown): RulesDb | null {
  if (!raw || typeof raw !== "object") return null;
  let doc = raw as Record<string, unknown>;
  let v = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (v > SCHEMA_VERSION) return null;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return null;
    const next = step(doc);
    if (!next) return null;
    doc = { ...next, schemaVersion: v + 1 };
    v += 1;
  }
  return doc as unknown as RulesDb;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

/** Allocate a readable, unique id inside a transaction. */
export function newId(db: RulesDb, prefix: string): string {
  db.seq += 1;
  return `${prefix}_${db.seq}`;
}

export class RulesStore {
  private state: RulesDb;
  private listeners = new Set<() => void>();

  constructor(
    private storage: StorageLike | null,
    private seed: () => RulesDb,
  ) {
    this.state = this.load();
  }

  private load(): RulesDb {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const migrated = migrate(JSON.parse(raw));
        if (migrated) return migrated;
      }
    } catch {
      /* fall through to seed */
    }
    const fresh = this.seed();
    this.persist(fresh);
    return fresh;
  }

  private persist(db: RulesDb) {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* storage full or unavailable: keep working in memory */
    }
  }

  /** Immutable between mutations, so it is safe for useSyncExternalStore. */
  getSnapshot = (): RulesDb => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /**
   * Apply a change atomically: work on a copy, and only commit if `fn` returns without throwing.
   * A failed validation therefore never leaves half-written state behind.
   */
  mutate<T>(fn: (db: RulesDb) => T): T {
    const draft = structuredClone(this.state);
    const result = fn(draft);
    this.state = draft;
    this.persist(draft);
    this.listeners.forEach((l) => l());
    return result;
  }

  reset() {
    this.state = this.seed();
    this.persist(this.state);
    this.listeners.forEach((l) => l());
  }
}
