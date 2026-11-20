// Resolve a policy's `sourceDocument` ("fixtures/policies/x.pdf#page=2") to a URL the browser can open.

const files = import.meta.glob("/fixtures/policies/*.pdf", { query: "?url", import: "default", eager: true }) as Record<string, string>;

export function sourceDocumentUrl(doc: string | null): string | null {
  if (!doc) return null;
  const [path, hash] = doc.split("#");
  const url = files[`/${path}`];
  if (!url) return null;
  return hash ? `${url}#${hash}` : url;
}
