import { Link } from "react-router-dom";
import type { Evaluation } from "@/domain/rules/types";
import { checkedAgainstText, versionHref } from "@/lib/evalNotice";

/** "Checked against Federation Health RAD-114 v3", linking to that exact version in the rule library. */
export function CheckedAgainst({ evaluation, className }: { evaluation: Evaluation; className?: string }) {
  const snap = evaluation.rulesSnapshot;
  if (!snap) return null;
  return (
    <Link to={versionHref(snap.policyId, snap.versionId)} className={className ?? "text-accent-fg hover:underline"}>
      {checkedAgainstText(snap)}
    </Link>
  );
}
