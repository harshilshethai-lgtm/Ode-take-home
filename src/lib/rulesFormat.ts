export function fmtDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${iso.slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
export function effectiveRange(v: { effectiveFrom: string | null; effectiveTo: string | null }): string {
  if (!v.effectiveFrom) return "no effective date yet";
  return `${v.effectiveFrom} → ${v.effectiveTo ?? "open-ended"}`;
}
