import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import type { DslGrammar, FormatIR } from "../../fmt/dsl/dsl.js";
import { referenceRules } from "../../fmt/dsl/reference.js";
import { format } from "../../fmt/format.js";
import type { Language } from "../../fmt/rules.js";
import { grammar, language } from "./index.js";
import { type JsonOptions, json, jsonc, jsonStringify, number } from "./fmt.js";
import * as spec from "./format.js";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const fixtures = join(root, "packages/syntechs/corpus/prettier-3.9.9/tests/format/json");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "__snapshots__" ? [] : files(path);
    return /\.(json|jsonc|json5)$/.test(name) ? [path] : [];
  });
}

const edgeCases = [
  "{}",
  "[ ]",
  "{\n}",
  "{/* d */}",
  "[/* a */ /* b */]",
  "[ // x\n]",
  '{\n"a":1,"b":[1,2]}',
  '{"a":1,\n\n\n"b":2,\n"c":[\n1,\n\n2]}',
  '{"a":1,\n\n"b":2}',
  '["a",\n\n"b"]',
  `[${Array.from({ length: 60 }, (_, i) => i * 37).join(",")}]`,
  "[1,2,\n\n3,4]",
  "[1, // one\n2, 3]",
  "[1,\n// two\n2, 3]",
  "[[1,2],[3,4]]",
  "[[1],[2]]",
  '{\n  // lead\n  "a": 1, // trail\n  "b": 2\n}',
  '// top\n\n{"a":1}\n// bottom\n',
  '{"a":1 /* after */, /* before */ "b": 2}',
  "[1,2,]",
  '{"a": {"b": true,}, "c": [1E5, 0.50e01]}',
];

const corpus = [
  ...execFileSync("git", ["ls-files", "*.json"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((f) => readFileSync(join(root, f), "utf8")),
  ...files(fixtures).map((f) => readFileSync(f, "utf8")),
  ...edgeCases,
];

const options: Partial<JsonOptions>[] = [
  {},
  { bracketSpacing: false, objectWrap: "collapse", trailingComma: "none", printWidth: 40 },
];

const languages: [string, Language<JsonOptions>, FormatIR][] = [
  ["json", json, spec.json],
  ["jsonc", jsonc, spec.jsonc],
  ["jsonStringify", jsonStringify, spec.jsonStringify],
];

const run = (text: string, lang: Language<JsonOptions>, o: Partial<JsonOptions>) =>
  format(parseTree(language, text), lang, o);

// The generated rules fuse the two passes; a divergence from the reference would change a layout the spec
// says nothing about, in a way no reader of the spec could predict.
describe("the generated formatter prints what the two-pass reference prints, output and anchors, so fusing the passes never changes a layout", () => {
  it.each(languages)("%s", (_, generated, ir) => {
    const reference = {
      ...generated,
      stream: referenceRules<JsonOptions>(ir, grammar as DslGrammar, { number }),
    };
    for (const text of corpus)
      for (const o of options)
        expect(run(text, generated, o), text).toEqual(run(text, reference, o));
  });
});

