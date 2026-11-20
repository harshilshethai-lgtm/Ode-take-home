import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BarChart3, Home, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun, TrendingUp, type LucideIcon } from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { firstName } from "@/components/AssignMenu";
import { Avatar } from "@/components/ui/avatar";
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { DEMO_NOW } from "@/data/orders";
import { PEOPLE } from "@/data/people";
import { cn } from "@/lib/cn";
import { fmtTableDate } from "@/lib/format";
import { usePersona } from "@/lib/persona";
import { useTheme } from "@/lib/theme";

const COLLAPSE_KEY = "halcyon.sidebar.collapsed.v1";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that keep this item selected (the case view lives under Worklist). */
  alsoActiveFor?: string[];
}

const MAIN_NAV: NavItem[] = [
  { to: "/", label: "Worklist", icon: Home, alsoActiveFor: ["/case"] },
  { to: "/impact", label: "Impact", icon: TrendingUp },
  { to: "/analytics", label: "Operations", icon: BarChart3 },
];

const FOOTER_NAV: NavItem[] = [{ to: "/settings", label: "Settings", icon: Settings }];

export default function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const { pathname } = useLocation();

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <div className="flex h-full flex-col sm:flex-row">
      <MobileNav pathname={pathname} />
      <aside
        aria-label="Primary"
        className={cn(
          "hidden shrink-0 flex-col border-r border-line bg-sidebar sm:flex",
          collapsed ? "w-12" : "w-56",
        )}
      >
        <div className={cn("flex h-12 items-center", collapsed ? "justify-center" : "px-4")}>
          {collapsed ? (
            <span className="text-emph text-fg">H</span>
          ) : (
            <span className="truncate text-emph text-fg">Halcyon Health</span>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2">
          {MAIN_NAV.map((item) => (
            <SidebarLink key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            {FOOTER_NAV.map((item) => (
              <SidebarLink key={item.to} item={item} collapsed={collapsed} pathname={pathname} />
            ))}
          </div>
        </nav>

        <SidebarFooter collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <Outlet />
      </div>
      <CommandPalette />
    </div>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  const items = [...MAIN_NAV, ...FOOTER_NAV];
  return (
    <div className="flex h-12 items-center gap-4 overflow-x-auto border-b border-line px-4 sm:hidden">
      <span className="shrink-0 text-emph text-fg">Halcyon</span>
      {items.map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);
        const extra = item.alsoActiveFor?.some((prefix) => pathname.startsWith(prefix)) ?? false;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={cn(
              "shrink-0 text-body",
              active || extra ? "font-medium text-accent-fg" : "text-fg-2",
            )}
          >
            {item.label}
          </NavLink>
        );
      })}
    </div>
  );
}

function SidebarFooter({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { me, setMeId } = usePersona();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("flex gap-1 p-2", collapsed ? "flex-col items-center" : "items-center")}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tip content="Viewing as" side="right">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Viewing as"
              className={cn("flex h-8 items-center gap-2 rounded-md px-1 hover:bg-chip", !collapsed && "min-w-0 flex-1")}
            >
              <Avatar name={me.name} />
              {!collapsed && <span className="truncate text-body text-fg">{firstName(me)}</span>}
            </button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent side="top" className="w-56">
          {PEOPLE.map((p) => (
            <MenuItem
              key={p.id}
              selected={p.id === me.id}
              onClick={() => {
                setMeId(p.id);
                setOpen(false);
              }}
            >
              <Avatar name={p.name} />
              {p.name}
              <span className="ml-auto text-caption text-fg-3">{p.role === "nurse" ? "Nurse" : "Coord."}</span>
            </MenuItem>
          ))}
          <div className="px-2 py-1 text-caption text-fg-3" title="Fixed so dates in the sample data stay consistent.">
            Demo clock · {fmtTableDate(DEMO_NOW)}
          </div>
        </PopoverContent>
      </Popover>
      <Tip content="Search" shortcut="⌘K" side="right">
        <button
          type="button"
          aria-label="Search"
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="flex size-8 items-center justify-center rounded-md text-fg-2 hover:bg-chip hover:text-fg"
        >
          <Search size={16} />
        </button>
      </Tip>
      <Tip content={theme === "dark" ? "Light mode" : "Dark mode"} side="right">
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggle}
          className="flex size-8 items-center justify-center rounded-md text-fg-2 hover:bg-chip hover:text-fg"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </Tip>
      <Tip content={collapsed ? "Expand" : "Collapse"} side="right">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex size-8 items-center justify-center rounded-md text-fg-2 hover:bg-chip hover:text-fg"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </Tip>
    </div>
  );
}

function SidebarLink({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string }) {
  const Icon = item.icon;
  const extra = item.alsoActiveFor?.some((p) => pathname.startsWith(p)) ?? false;

  const link = (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          "flex h-8 items-center rounded-md text-body transition-colors",
          collapsed ? "justify-center" : "gap-2 px-2",
          isActive || extra ? "bg-hover font-medium text-accent-fg" : "text-label hover:bg-hover hover:text-fg",
        )
      }
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
  return collapsed ? (
    <Tip content={item.label} side="right">
      {link}
    </Tip>
  ) : (
    link
  );
}

