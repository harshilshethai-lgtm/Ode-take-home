// Ordering-provider names from packets. Lists use "Last, First MD". Detail uses "First Last, MD".

export interface ProviderName {
  raw: string;
  list: string;
  detail: string;
  parsed: boolean;
}

const CREDENTIAL = /,?\s*(MD|DO|NP|PA)\.?$/i;

/** Split a credentialed name. Names that lack a first name or a credential stay unmarked as parsed. */
export function normalizeProvider(raw: string): ProviderName {
  const trimmed = raw.trim();
  const [head, ...rest] = trimmed.split(" · ");
  const suffix = rest.length > 0 ? ` · ${rest.join(" · ")}` : "";
  const body = head.replace(/^Dr\.?\s+/i, "").trim();
  const credMatch = CREDENTIAL.exec(body);
  const credential = credMatch?.[1]?.toUpperCase() ?? null;
  const name = credMatch ? body.slice(0, credMatch.index).replace(/,\s*$/, "").trim() : body;
  const parsed = credential ? formatName(name, credential) : null;
  if (!parsed) return { raw: trimmed, list: trimmed, detail: trimmed, parsed: false };
  return {
    raw: trimmed,
    list: `${parsed.list}${suffix}`,
    detail: `${parsed.detail}${suffix}`,
    parsed: true,
  };
}

function formatName(name: string, credential: string): { list: string; detail: string } | null {
  if (name.includes(",")) {
    const [last, first] = name.split(",").map((part) => part.trim());
    if (!last || !first) return null;
    return { list: `${last}, ${first} ${credential}`, detail: `${first} ${last}, ${credential}` };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1] ?? "";
  const first = parts.slice(0, -1).join(" ");
  if (!last || !first) return null;
  return { list: `${last}, ${first} ${credential}`, detail: `${first} ${last}, ${credential}` };
}
