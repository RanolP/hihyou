import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type Language, parseTree } from "../../core/index.js";
import { format } from "../../fmt/format.js";
import type { Language as FmtLanguage } from "../../fmt/rules.js";
import { language as tsxParser } from "../tsx/index.js";
import { tsx, typescript } from "../typescript/fmt.js";
import { language as tsParser } from "../typescript/index.js";
import { javascript } from "./fmt.js";
import { language as jsParser } from "./index.js";
import type { JsOptions } from "./print/util.js";

// Holds the JS/TS/TSX output still while its rules move off the Doc: every prettier fixture and corpus file, under
// two option sets, hashed by text and anchors. Opt-in, as it formats ~2.3k files four ways: JS_BASELINE=<file>
// writes the hashes to <file> when it is missing, and otherwise fails naming each input whose hash moved (the
// current hashes land in <file>.actual for a diff).

const baseline = process.env.JS_BASELINE;
const corpus = join(import.meta.dirname, "../../../corpus");

const byExtension: Record<string, [Language, FmtLanguage<JsOptions>]> = {
  js: [jsParser, javascript],
  jsx: [jsParser, javascript],
  mjs: [jsParser, javascript],
  cjs: [jsParser, javascript],
  ts: [tsParser, typescript],
  mts: [tsParser, typescript],
  cts: [tsParser, typescript],
  tsx: [tsxParser, tsx],
};

const optionSets: [string, Partial<JsOptions>][] = [
  ["defaults", {}],
  [
    "custom",
    {
      semi: false,
      singleQuote: true,
      tabWidth: 4,
      printWidth: 100,
      arrowParens: "avoid",
      trailingComma: "es5",
    },
  ],
];

function inputs(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__snapshots__") walk(path);
      } else if (e.name !== "format.test.js" && e.name !== "jsfmt.spec.js" && extension(e.name) in byExtension)
        out.push(path);
    }
  };
  for (const d of ["js", "jsx", "typescript"]) {
    const dir = join(corpus, "prettier-3.9.9/tests/format", d);
    if (existsSync(dir)) walk(dir);
  }
  for (const f of ["jquery.js", "lodash.js", "App.tsx", "LayerUI.tsx"])
    if (existsSync(join(corpus, f))) out.push(join(corpus, f));
  return out.sort();
}

const extension = (name: string) => name.slice(name.lastIndexOf(".") + 1);

function hashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of inputs()) {
    const [parser, lang] = byExtension[extension(path)] as [Language, FmtLanguage<JsOptions>];
    const text = readFileSync(path, "utf8");
    const tree = parseTree(parser, text);
    for (const [name, options] of optionSets) {
      let printed: string;
      try {
        const r = format(tree, lang, options);
        printed = r.ok ? `${r.text}\0${JSON.stringify(r.anchors)}` : `${r.reason}: ${r.detail}`;
      } catch (e) {
        printed = `threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      out[`${path.slice(corpus.length + 1).replaceAll("\\", "/")} [${name}]`] = createHash("sha1")
        .update(printed)
        .digest("hex");
    }
  }
  return out;
}

it.runIf(baseline !== undefined)(
  "every JS/TS/TSX fixture prints as the baseline recorded, so a rule moved off the Doc cannot change output",
  () => {
    const file = baseline as string;
    const now = hashes();
    if (!existsSync(file)) {
      writeFileSync(file, JSON.stringify(now, null, 1));
      return;
    }
    const was = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    const moved = Object.keys({ ...was, ...now }).filter((k) => was[k] !== now[k]);
    if (moved.length > 0) writeFileSync(`${file}.actual`, JSON.stringify(now, null, 1));
    expect(moved).toEqual([]);
  },
  1_200_000,
);
