import { useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleX } from "lucide-react";
import type { RunSide, TestRunResult } from "@/domain/rules/testRunner";
import type { OverallStatus } from "@/domain/rules/types";
import { OVERALL_LABEL, Pill } from "./ui";

function Outcome({ side, expected }: { side?: RunSide; expected: OverallStatus }) {
  if (!side) return <span className="text-slate-400">n/a</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {side.passes ? <CircleCheck size={14} className="text-emerald-600" /> : <CircleX size={14} className="text-rose-600" />}
      <span className={side.overall === expected ? "" : "font-medium text-rose-700"}>{OVERALL_LABEL[side.overall]}</span>
    </span>
  );
}

/** Test · Expected · Active result · Draft result · Changed? */
export function TestResults({ result, candidateLabel }: { result: TestRunResult; candidateLabel: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const activeLabel = result.rows[0]?.active ? `Active (v${result.rows[0].active.versionNumber})` : "Active";
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>
          {result.candidatePassing} of {result.total} pass on {candidateLabel}
        </span>
        {result.candidateFailing > 0 && <Pill tone="rose">{result.candidateFailing} failing</Pill>}
        {result.changedCount > 0 && <Pill tone="amber">{result.changedCount} changed vs active</Pill>}
        {result.candidateFailing === 0 && result.changedCount === 0 && <Pill tone="emerald">No differences</Pill>}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="px-3 py-2 font-medium">Test</th>
            <th className="px-3 py-2 font-medium">Expected</th>
            <th className="px-3 py-2 font-medium">{activeLabel}</th>
            <th className="px-3 py-2 font-medium">{candidateLabel}</th>
            <th className="px-3 py-2 font-medium">Changed?</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => {
            const expanded = open === r.testCaseId;
            const failing = !r.candidate.passes || (r.active && !r.active.passes);
            return (
              <tr key={r.testCaseId} className={`border-b border-slate-100 align-top last:border-0 ${!r.candidate.passes ? "bg-rose-50/60" : r.changed ? "bg-amber-50/60" : ""}`}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setOpen(expanded ? null : r.testCaseId)} aria-expanded={expanded} className="flex items-start gap-1 text-left">
                    {expanded ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
                    <span>
                      <span className="font-medium text-slate-900">{r.name}</span>
                      {expanded && <span className="mt-0.5 block text-xs font-normal text-slate-500">{r.description}</span>}
                    </span>
                  </button>
                  {expanded && failing && (
                    <ul className="ml-5 mt-1 list-disc space-y-0.5 text-xs text-rose-700">
                      {[...(r.active && r.active.versionId !== r.candidate.versionId ? r.active.failures.map((f) => `${activeLabel}: ${f}`) : []), ...r.candidate.failures.map((f) => `${candidateLabel}: ${f}`)].map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-700">{OVERALL_LABEL[r.expected.overall]}</td>
                <td className="px-3 py-2">
                  <Outcome side={r.active} expected={r.expected.overall} />
                </td>
                <td className="px-3 py-2">
                  <Outcome side={r.candidate} expected={r.expected.overall} />
                </td>
                <td className="px-3 py-2">{r.changed ? <Pill tone="amber">Changed</Pill> : <span className="text-slate-400">No</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
