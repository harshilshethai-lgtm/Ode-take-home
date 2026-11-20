import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  id: string;
  /** Sentence case, at most 3 words, no trailing colon. */
  header: string;
  /** Replaces the text header (e.g. a select-all checkbox). `header` stays as the accessible name. */
  headerCell?: ReactNode;
  align?: "left" | "right";
  /** Width class ("w-24") or a percentage ("16%"). Percentages keep the table inside the viewport. */
  width?: string;
  /** Allow the cell to wrap. Comfortable tables use this for a name over a caption. */
  wrap?: boolean;
  /**
   * content: size to the text, never ellipsis.
   * shrink: ellipsis below 1280px, full text at 1280px and up.
   * Unset: the historical clip, so other tables stay the same.
   */
  fit?: "content" | "shrink";
  cell: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T) => string;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  loading?: boolean;
  empty?: ReactNode;
  /** Two-line cells (name over a caption). Header sits on the app surface. */
  comfortable?: boolean;
  /** 4px cell padding, for a table that has to fit the viewport. */
  compact?: boolean;
  className?: string;
}

const MAX_COLUMNS = 8;

/**
 * Hairline dividers, no zebra, no vertical borders, hover bg-hover.
 * Rows are 36px. A two-line cell may grow the row just enough to fit a caption.
 * Selected row: 2px accent left border plus bg-hover. At most 8 columns.
 */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  selectedKey,
  onRowClick,
  rowClassName,
  loading,
  empty,
  comfortable = false,
  compact = false,
  className,
}: Props<T>) {
  if (columns.length > MAX_COLUMNS) {
    throw new Error(`DataTable allows at most ${MAX_COLUMNS} columns (got ${columns.length}).`);
  }
  return (
    <table className={cn("w-full text-left text-body group/table", className)}>
      <thead>
        <tr className="border-b border-line">
          {columns.map((c, i) => (
            <th
              key={c.id}
              scope="col"
              className={cn(
                "sticky top-0 z-10 border-l-2 border-transparent text-caption font-normal text-fg-2",
                compact ? "whitespace-nowrap max-xl:whitespace-normal" : "whitespace-nowrap",
                compact ? "px-1" : "px-3",
                comfortable ? "h-9 bg-app" : "h-8 bg-panel",
                c.fit === "shrink" && "w-full max-w-0 xl:whitespace-normal max-xl:overflow-hidden max-xl:text-ellipsis max-xl:whitespace-nowrap",
                i === 0 && (comfortable && !compact ? "pl-6" : "pl-4"),
                i === columns.length - 1 && comfortable && !compact && "pr-6",
                c.align === "right" && "text-right",
                c.width && !c.width.endsWith("%") && c.width,
              )}
              style={c.width?.endsWith("%") ? { width: c.width } : undefined}
            >
              {c.headerCell ?? c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading &&
          Array.from({ length: 6 }, (_, i) => (
            <tr key={i} className="h-9 border-b border-line">
              <td colSpan={columns.length} className="px-4">
                <div className="h-3 w-full animate-pulse rounded-md bg-chip" />
              </td>
            </tr>
          ))}
        {!loading && rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="py-8 text-center text-body text-fg-2">
              {empty ?? "Nothing here"}
            </td>
          </tr>
        )}
        {!loading &&
          rows.map((row) => {
            const key = getKey(row);
            const selected = key === selectedKey;
            return (
              <tr
                key={key}
                data-row-key={key}
                aria-selected={selected}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "group border-b border-line transition-colors last:border-b-0 hover:bg-hover",
                  comfortable ? "min-h-9 align-middle" : "h-9",
                  onRowClick && "cursor-pointer",
                  selected && "bg-hover",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.id}
                    className={cn(
                      "h-9 border-l-2 align-middle",
                      compact ? "px-1" : "px-3",
                      c.fit === "content" && "w-px whitespace-nowrap",
                      c.fit === "shrink" && "max-xl:w-full max-xl:min-w-32 max-xl:max-w-0 max-xl:overflow-hidden max-xl:text-ellipsis max-xl:whitespace-nowrap xl:whitespace-nowrap",
                      !c.fit && (c.wrap ? "whitespace-normal" : "overflow-hidden whitespace-nowrap"),
                      i === 0 && (comfortable && !compact ? "pl-6" : "pl-4"),
                      i === columns.length - 1 && comfortable && !compact && "pr-6",
                      i === 0 && selected ? "border-accent" : "border-transparent",
                      c.align === "right" && "tabular text-right",
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}
