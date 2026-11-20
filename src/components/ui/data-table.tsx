import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  id: string;
  /** Sentence case, at most 3 words, no trailing colon. */
  header: string;
  /** Replaces the text header (e.g. a select-all checkbox). `header` stays as the accessible name. */
  headerCell?: ReactNode;
  align?: "left" | "right";
  /** Width class on the header cell, e.g. "w-24". */
  width?: string;
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
}

const MAX_COLUMNS = 8;

/**
 * 36px rows, hairline dividers, no zebra, no vertical borders, hover bg-hover.
 * Selected row: 2px accent left border plus bg-hover. At most 8 columns.
 */
export function DataTable<T>({ columns, rows, getKey, selectedKey, onRowClick, rowClassName, loading, empty }: Props<T>) {
  if (columns.length > MAX_COLUMNS) {
    throw new Error(`DataTable allows at most ${MAX_COLUMNS} columns (got ${columns.length}).`);
  }
  return (
    <table className="w-full text-left text-body">
      <thead>
        <tr className="border-b border-line">
          {columns.map((c, i) => (
            <th
              key={c.id}
              scope="col"
              className={cn(
                "h-8 whitespace-nowrap border-l-2 border-transparent px-3 text-caption font-normal text-fg-2",
                i === 0 && "pl-4",
                c.align === "right" && "text-right",
                c.width,
              )}
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
                  "group h-9 border-b border-line transition-colors hover:bg-hover",
                  onRowClick && "cursor-pointer",
                  selected && "bg-hover",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.id}
                    className={cn(
                      "whitespace-nowrap border-l-2 px-3 align-middle",
                      i === 0 && "pl-4",
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
