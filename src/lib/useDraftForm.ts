import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type RulesApi, type VersionView } from "@/data/rules/service";
import type { RulesUser, ValidationResult, VersionEditableFields } from "@/domain/rules/types";

export type SaveState = { kind: "saved" | "saving"; at: number } | { kind: "error"; message: string; at: number };

const EDITABLE: Array<keyof VersionEditableFields> = [
  "applicability",
  "logic",
  "properties",
  "criteria",
  "exceptions",
  "sourceRevisionLabel",
  "sourceDocument",
  "sourceDocumentHash",
  "changeNote",
  "effectiveFrom",
];

function pick(v: VersionView): VersionEditableFields {
  return Object.fromEntries(EDITABLE.map((k) => [k, structuredClone(v[k])])) as unknown as VersionEditableFields;
}

const SAVE_DELAY_MS = 600;

/**
 * Local copy of a draft that saves itself. Edits apply instantly; the changed parts are sent to the API shortly
 * after typing stops, and again when the editor closes. Validation runs on the local copy, so feedback is instant
 * and never waits for the save. A draft with errors still saves; only publishing is blocked.
 */
export function useDraftForm(version: VersionView, api: RulesApi, actor: RulesUser) {
  const [form, setForm] = useState<VersionEditableFields>(() => pick(version));
  const formRef = useRef(form);
  const pending = useRef<Partial<VersionEditableFields>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved", at: Date.now() });

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    try {
      api.patchVersion(version.id, patch, actor);
      setSaveState({ kind: "saved", at: Date.now() });
    } catch (e) {
      pending.current = { ...patch, ...pending.current };
      setSaveState({ kind: "error", message: e instanceof ApiError ? e.message : "Could not save.", at: Date.now() });
    }
  }, [api, version.id, actor]);

  /** Drop unsaved edits without writing them, e.g. right before the draft is discarded. */
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = {};
  }, []);

  const update = useCallback(
    (change: Partial<VersionEditableFields> | ((f: VersionEditableFields) => Partial<VersionEditableFields>)) => {
      const patch = typeof change === "function" ? change(formRef.current) : change;
      const next = { ...formRef.current, ...patch };
      formRef.current = next;
      setForm(next);
      Object.assign(pending.current, patch);
      setSaveState({ kind: "saving", at: Date.now() });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  // Save what is pending when the editor goes away (Done, navigation, closing the tab).
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      flush();
    };
  }, [flush]);

  const validation: ValidationResult = useMemo(() => api.validateVersion(version.id, undefined, form), [api, version.id, form]);

  return { form, update, flush, cancel, saveState, validation };
}

/** Re-renders every second, so "saved 2s ago" keeps counting. */
export function useTicker(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "just now", "2s ago", "3m ago". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
