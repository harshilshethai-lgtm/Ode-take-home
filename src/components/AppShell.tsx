import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BarChart3, Clock, Home, PanelLeftClose, PanelLeftOpen, Settings, type LucideIcon } from "lucide-react";
import { DEMO_NOW } from "@/data/orders";
import { PEOPLE } from "@/data/people";
import { fmtDemoClock } from "@/lib/format";
import { usePersona } from "@/lib/persona";

const COLLAPSE_KEY = "halcyon.sidebar.collapsed.v1";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that should keep this item highlighted (e.g. case view lives under Home). */
  alsoActiveFor?: string[];
}

const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: Home, alsoActiveFor: ["/case"] },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
];

const FOOTER_NAV: NavItem[] = [{ to: "/settings", label: "Settings", icon: Settings }];

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/case")) return "Case review";
  if (pathname.startsWith("/analytics")) return "Analytics";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Worklist";
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const { pathname } = useLocation();
  const { me, setMeId } = usePersona();

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside
        aria-label="Primary"
        className={`flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${
          collapsed ? "w-[68px]" : "w-60"
        }`}
      >
        <div className={`flex h-14 items-center border-b border-slate-200 ${collapsed ? "justify-center" : "gap-3 px-4"}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            H
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">Halcyon Health</div>
              <div className="truncate text-xs text-slate-500">Prior authorization</div>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {MAIN_NAV.map((item) => (
            <SidebarLink key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            {FOOTER_NAV.map((item) => (
              <SidebarLink key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
            ))}
          </div>
        </nav>

        <div className="border-t border-slate-200 p-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex w-full items-center rounded-md py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 ${
              collapsed ? "justify-center" : "gap-3 px-3"
            }`}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="whitespace-nowrap text-sm font-medium text-slate-700">{pageTitle(pathname)}</div>
          <div className="flex items-center gap-4">
            <span
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
              title="Prototype clock. Fixed so scan dates and time-in-status in the sample data stay consistent."
            >
              <Clock size={13} /> Demo clock · {fmtDemoClock(DEMO_NOW)}
            </span>
            <label className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-500">
              Viewing as
              <select
                value={me.id}
                onChange={(e) => setMeId(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800"
              >
                {PEOPLE.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.role})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function SidebarLink({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string }) {
  const Icon = item.icon;
  const extra = item.alsoActiveFor?.some((p) => pathname.startsWith(p)) ?? false;

  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      className={({ isActive }) => {
        const active = isActive || extra;
        return `flex items-center rounded-md py-2 text-sm transition ${
          collapsed ? "justify-center" : "gap-3 px-3"
        } ${
          active
            ? "bg-indigo-50 font-medium text-indigo-700"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`;
      }}
    >
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}
