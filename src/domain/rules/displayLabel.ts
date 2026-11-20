/** Plain-words name for a criterion. `display_label` wins; otherwise the criterion's own label. */
export function criterionDisplayLabel(criterion: { label?: string; display_label?: string; displayLabel?: string }): string {
  const explicit = (criterion.display_label ?? criterion.displayLabel ?? "").trim();
  if (explicit) return explicit;
  const fallback = criterion.label?.trim();
  return fallback || "Criterion";
}
