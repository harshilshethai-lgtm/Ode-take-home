import { Command } from "cmdk";
import { BarChart3, FileText, Home, Moon, RotateCcw, Settings, Sun, TrendingUp, User } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Kbd } from "@/components/ui/kbd";
import { fmtTableDate } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useOrders } from "@/lib/useWorklistState";

/** Policies the Settings screen can jump to. */
const POLICY_JUMPS = [
  { id: "RAD-114", label: "Federation Health · RAD-114", hint: "Lumbar MRI" },
];

function Item({ children, onSelect, value, hint }: { children: ReactNode; onSelect: () => void; value: string; hint?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-body text-label"
    >
      {children}
      {hint && <span className="ml-auto text-caption text-fg-3">{hint}</span>}
    </Command.Item>
  );
}

/** Cmd-K: search cases, jump to a policy or page. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { orders, reset } = useOrders();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-scrim"
      contentClassName="fixed left-1/2 top-24 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-panel text-body text-fg shadow-sm"
    >
      <Command.Input
        placeholder="Search cases, policies, pages"
        className="h-10 w-full border-b border-line bg-transparent px-4 text-body text-fg outline-none placeholder:text-fg-3"
      />
      <Command.List className="max-h-80 overflow-auto p-1">
        <Command.Empty className="py-6 text-center text-body text-fg-2">No results</Command.Empty>
        <Command.Group heading="Cases">
          {orders
            .filter((o) => o.patient)
            .map((o) => (
              <Item
                key={o.id}
                value={`${o.patient!.name} ${o.patient!.mrn} ${o.orderNumber ?? ""} ${o.study}`}
                onSelect={() => go(`/case/${o.id}`)}
                hint={o.scheduledAt ? fmtTableDate(new Date(o.scheduledAt)) : undefined}
              >
                <User size={14} />
                {o.patient!.name}
                <span className="text-fg-3">{o.study}</span>
              </Item>
            ))}
        </Command.Group>
        <Command.Group heading="Policies">
          {POLICY_JUMPS.map((p) => (
            <Item key={p.id} value={`${p.label} ${p.hint}`} onSelect={() => go("/settings")} hint={p.hint}>
              <FileText size={14} />
              {p.label}
            </Item>
          ))}
        </Command.Group>
        <Command.Group heading="Go to">
          <Item value="worklist home" onSelect={() => go("/")}>
            <Home size={14} /> Worklist
          </Item>
          <Item value="impact pilot" onSelect={() => go("/impact")}>
            <TrendingUp size={14} /> Impact
          </Item>
          <Item value="operations analytics" onSelect={() => go("/analytics")}>
            <BarChart3 size={14} /> Operations
          </Item>
          <Item value="settings rules" onSelect={() => go("/settings")}>
            <Settings size={14} /> Settings
          </Item>
        </Command.Group>
        <Command.Group heading="Actions">
          <Item
            value="toggle theme dark light"
            onSelect={() => {
              toggle();
              setOpen(false);
            }}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />} Switch to {theme === "dark" ? "light" : "dark"}
          </Item>
          <Item
            value="reset demo assignments"
            onSelect={() => {
              reset();
              setOpen(false);
            }}
          >
            <RotateCcw size={14} /> Reset assignments
          </Item>
        </Command.Group>
      </Command.List>
      <div className="flex h-8 items-center gap-2 border-t border-line px-4 text-caption text-fg-3">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> move <Kbd>↵</Kbd> open <Kbd>esc</Kbd> close
      </div>
    </Command.Dialog>
  );
}
