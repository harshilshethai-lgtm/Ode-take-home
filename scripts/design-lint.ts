// Design guardrails (.cursor/rules/design.mdc). Run: npm run lint:design. Also runs in CI.
// Plain regex checks over src/**. No dependencies; runs with Node's built-in TypeScript support.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const TEXT_FILE = /\.(tsx?|css)$/;
const rel = (p: string) => relative(ROOT, p);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const IS_GLOBALS = (f: string) => f === "src/index.css";
const IS_LABELS = (f: string) => f === "src/lib/labels.ts";
const IS_TEST = (f: string) => /\.test\.tsx?$/.test(f);
const IS_PAGE_TITLE = (f: string) => f === "src/components/ui/page-title.tsx";
/** Only these may use rounded-full: avatars and status dots. */
const ROUND_ALLOWED = new Set(["src/components/ui/avatar.tsx", "src/components/ui/status-dot.tsx"]);

/** Spacing utilities that must stay on the 4px grid (no half steps). */
const SPACING = "(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|size|w|h|min-w|min-h|max-w|max-h)";

const LINE_RULES: { rule: string; re: RegExp; skip?: (f: string) => boolean; message: string }[] = [
  {
    rule: "color",
    re: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/,
    skip: (f) => IS_GLOBALS(f),
    message: "raw color outside src/index.css. Use a token (text-fg, bg-panel, ...).",
  },
  {
    rule: "text-size",
    re: /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/,
    message: "default Tailwind text sizes are not allowed. Use text-caption, text-body, text-emph or text-section.",
  },
  {
    rule: "page-title-size",
    re: /(?<![\w-])text-title(?![\w-])/,
    skip: (f) => IS_PAGE_TITLE(f) || IS_TEST(f),
    message: "text-title (20px) is only for the PageTitle component.",
  },
  {
    rule: "font-weight",
    re: /(?<![\w-])font-(?:bold|extrabold|black|thin|extralight|light)(?![\w-])/,
    message: "font weights are 400, 500 and 600 only (font-normal, font-medium, font-semibold).",
  },
  {
    rule: "shadow",
    re: /(?<![\w-])shadow-(?:md|lg|xl|2xl|inner)(?![\w-])|["'`\s]shadow["'`\s]/,
    message: "only shadow-sm is allowed, and only on popovers and menus.",
  },
  {
    rule: "arbitrary-value",
    re: /(?<![\w\]])(?:[a-z0-9-]+:)*-?[a-z][a-z0-9-]*-\[[^\]\s]+\]|(?<=["'`\s])\[&[^\]]*\]/,
    message: "arbitrary Tailwind values (p-[13px]) are not allowed. Add a token or use the spacing scale.",
  },
  {
    rule: "half-step-spacing",
    re: new RegExp(`(?<![\\w-])-?${SPACING}-\\d+\\.5(?![\\w.-])`),
    message: "spacing is on a 4px grid: use 1, 2, 3, 4, 6 or 8 (no half steps).",
  },
  {
    rule: "radius",
    re: /^$/, // matched in the loop below via RADIUS_CLASS_CONTEXT
    message: "radius is rounded-md (controls) or rounded-lg (cards). Nothing else.",
  },
];

// Undefined radius steps compile to nothing, so flag them in class-like contexts only.
const RADIUS_CLASS_CONTEXT = /(?:class(?:Name)?=|cn\(|clsx\(|["'`])[^\n]*?(?<![\w-])rounded(?:-(?:xs|sm|xl|2xl|3xl|none))(?![\w-])/;

const SNAKE = /\b[a-z]+_[a-z_]+\b/;
/** Props whose values are identifiers, not user-visible text. */
const NON_VISIBLE_PROPS = new Set([
  "className",
  "key",
  "id",
  "to",
  "href",
  "type",
  "name",
  "htmlFor",
  "value",
  "defaultValue",
  "role",
  "variant",
  "tone",
  "side",
  "align",
  "system",
  "status",
  "view",
  "kind",
  "field",
  "criterionKey",
  "factType",
]);

/**
 * Screens another workstream is still building in the old style. They are skipped here so CI stays green
 * while that work lands. Retrofit them to the design system, then delete this list.
 */
const NOT_YET_MIGRATED = ["src/pages/rules/", "src/components/rules/", "src/rules-preview.tsx"];
const isNotYetMigrated = (f: string) => NOT_YET_MIGRATED.some((p) => f === p || f.startsWith(p));

const violations: Violation[] = [];
const add = (file: string, line: number, rule: string, text: string) => violations.push({ file, line, rule, text: text.trim().slice(0, 140) });

function stripComments(src: string): string {
  // Keep line structure so line numbers stay correct.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

for (const abs of walk(SRC).filter((f) => TEXT_FILE.test(f))) {
  const file = rel(abs);
  if (isNotYetMigrated(file)) continue;
  const raw = readFileSync(abs, "utf8");
  const code = stripComments(raw);
  const lines = code.split("\n");

  lines.forEach((text, i) => {
    for (const r of LINE_RULES) {
      if (r.skip?.(file)) continue;
      if (r.rule === "radius") {
        if (RADIUS_CLASS_CONTEXT.test(text)) add(file, i + 1, r.rule, text);
        continue;
      }
      if (r.re.test(text)) add(file, i + 1, r.rule, text);
    }
    if (/(?<![\w-])rounded-full(?![\w-])/.test(text) && !ROUND_ALLOWED.has(file)) {
      add(file, i + 1, "rounded-full", text);
    }
  });

  if (!file.endsWith(".tsx") || IS_LABELS(file) || IS_TEST(file)) continue;

  // snake_case in JSX text nodes: >text< or >text{
  const jsxText = /(?<![=-])>([^<>{}]*)(?=<|\{)/g;
  for (const m of code.matchAll(jsxText)) {
    const body = m[1];
    if (!/[A-Za-z]/.test(body) || !SNAKE.test(body)) continue;
    const line = code.slice(0, m.index).split("\n").length;
    add(file, line, "snake-case-text", body);
  }

  // snake_case in string props: prop="a_b"
  const propRe = /\b([A-Za-z][\w-]*)=(["'])([^"'\n]*)\2/g;
  for (const m of code.matchAll(propRe)) {
    const [, prop, , value] = m;
    if (NON_VISIBLE_PROPS.has(prop) || prop.startsWith("data-")) continue;
    if (!SNAKE.test(value)) continue;
    const line = code.slice(0, m.index).split("\n").length;
    add(file, line, "snake-case-prop", `${prop}="${value}"`);
  }

  // At most one primary button per page file.
  if (file.startsWith("src/pages/")) {
    const primaries = [...code.matchAll(/variant="default"/g)].length;
    if (primaries > 1) add(file, 1, "primary-button", `${primaries} variant="default" buttons; at most 1 per page`);
  }
}

if (violations.length === 0) {
  console.log(`design-lint: ok (skipped, not yet migrated: ${NOT_YET_MIGRATED.join(", ")})`);
  process.exit(0);
}

const byRule = new Map<string, Violation[]>();
for (const v of violations) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
for (const [rule, list] of byRule) {
  const message = LINE_RULES.find((r) => r.rule === rule)?.message ?? "";
  console.error(`\n[${rule}] ${message}`);
  for (const v of list) console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error(`\ndesign-lint: ${violations.length} violation(s)`);
process.exit(1);
