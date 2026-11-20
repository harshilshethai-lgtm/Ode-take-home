// Node-only paths for fixture PDFs. Do not import this from the browser bundle.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const EXTRA: Record<string, string> = {
  policy: "fixtures/policies/insurer-policy-excerpts.pdf",
  "scott-pt": "fixtures/case-2-scott/utopia-pt.pdf",
  "sulu-note": "fixtures/case-3-sulu/visit-note.pdf",
  "uhura-denial": "fixtures/case-26-uhura/denial.pdf",
  "uhura-appeal": "fixtures/case-26-uhura/appeal.pdf",
  "uhura-pt": "fixtures/case-26-uhura/pt.pdf",
  "chekov-portal": "fixtures/case-27-chekov/portal.pdf",
};

export function fixturePath(file: string): string | null {
  if (EXTRA[file]) return EXTRA[file];
  const folder = readdirSync("fixtures").find((name) => name.startsWith("case-") && name.endsWith(`-${file}`));
  return folder ? join("fixtures", folder, "input.pdf") : null;
}
