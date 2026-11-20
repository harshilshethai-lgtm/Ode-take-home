/** Strip identifiers before an error leaves the PHI-safe store. The interaction row keeps the original. */
export function redactPhi(message: string, extra: readonly string[] = []): string {
  let out = message;
  const tokens = [...extra].filter((token) => token.trim().length >= 3).sort((a, b) => b.length - a.length);
  for (const token of tokens) out = out.split(token).join("[redacted]");
  out = out.replace(/\b[A-Z]{1,4}-\d{4,}\b/g, "[redacted]");
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted]");
  out = out.replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "[redacted]");
  return out;
}
