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

/** Bump when the shape of RulesDb changes and add a step to MIGRATIONS. */
export const SCHEMA_VERSION = 1;
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

type Migration = (db: Record<string, unknown>) => Record<string, unknown>;
/** MIGRATIONS[n] upgrades a schemaVersion n document to n + 1. */
const MIGRATIONS: Record<number, Migration> = {};

export function migrate(raw: unknown): RulesDb | null {
  if (!raw || typeof raw !== "object") return null;
  let doc = raw as Record<string, unknown>;
  let v = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (v > SCHEMA_VERSION) return null;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return null;
    doc = { ...step(doc), schemaVersion: v + 1 };
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
