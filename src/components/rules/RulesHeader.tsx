import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { RULES_USERS } from "@/data/rules";
import { useRulesUser } from "@/lib/rulesUser";

export interface Crumb {
  label: string;
  to?: string;
}

export function RulesHeader({ crumbs }: { crumbs: Crumb[] }) {
  const { user, setUserId } = useRulesUser();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
        <Link to="/settings" className="hover:text-slate-800 hover:underline">
          Settings
        </Link>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={14} />
            {c.to ? (
              <Link to={c.to} className="hover:text-slate-800 hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className="font-medium text-slate-800">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <label className="flex items-center gap-2 text-xs text-slate-500" title="Stand-in for sign-in. Editors edit drafts; approvers can also publish when the two-person rule is on.">
        Acting as
        <select value={user.id} onChange={(e) => setUserId(e.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800">
          {RULES_USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
