import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { createHighlighter, type Highlighter } from "../../highlight/index.js";
import { parseQuery } from "../../highlight/query.js";
import { tmScopeOf } from "../../highlight/sitter-to-tm.js";
import { highlight } from "./highlight.gen.js";
import { language } from "./index.js";

const here = import.meta.dirname;
const grammarDir = resolve(here, "../../../grammars/tree-sitter-swift");
const corpus = join(here, "corpus");
const files = readdirSync(corpus, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".swift"))
  .map((f) => join(corpus, f));

const hasCli = spawnSync("tree-sitter", ["--version"]).status === 0;

/** Per `row:byteCol-row:byteCol` range, the latest pattern's mapped capture: what a highlight shows. */
type Winners = Map<string, { pattern: number; capture: string }>;

function keep(w: Winners, key: string, pattern: number, capture: string) {
  if (tmScopeOf(capture) === null) return;
  const old = w.get(key);
  if (old === undefined || pattern >= old.pattern) w.set(key, { pattern, capture });
}

/** tree-sitter's own query engine over a query file, through the CLI mise.toml pins. */
function reference(query: string): Map<string, Winners> {
  const r = spawnSync("tree-sitter", ["query", "-p", grammarDir, query, ...files], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0) throw new Error(`tree-sitter query failed (status ${r.status}):\n${r.stderr}`);
  const out = new Map<string, Winners>();
  const known = new Set(files);
  let current: Winners | undefined;
  let pattern = -1;
  for (const line of r.stdout.split("\n")) {
    if (known.has(line)) {
      current = new Map();
      out.set(line, current);
      continue;
    }
    const p = /^ {2}pattern: (\d+)$/.exec(line);
    if (p !== null) {
      pattern = Number(p[1]);
      continue;
    }
    const c = /^ {4}capture: (?:\d+ - )?([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)/.exec(line);
    if (c !== null && current !== undefined)
      keep(current, `${c[2]}:${c[3]}-${c[4]}:${c[5]}`, pattern, c[1] as string);
  }
  return out;
}

function generated(file: string, highlight: Highlighter): Winners {
  const text = readFileSync(file, "utf8");
  const tree = parseTree(language, text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const point = (offset: number) => {
    let row = 0;
    while (row + 1 < lineStarts.length && (lineStarts[row + 1] as number) <= offset) row++;
    const start = lineStarts[row] as number;
    return `${row}:${Buffer.byteLength(text.slice(start, offset))}`;
  };
  const w: Winners = new Map();
  const walk = (n: number) => {
    const c = highlight.captureOf(tree, n);
    if (c !== undefined)
      keep(w, `${point(tree.start(n))}-${point(tree.end(n))}`, c.pattern, c.capture);
    for (let i = 0; i < tree.count(n); i++) walk(tree.child(n, i));
  };
  walk(tree.root);
  return w;
}

// A regression here is the generated matcher drifting from tree-sitter's query semantics (a field, an anchor, a
// predicate or the later-pattern-wins order read differently): on the corpus, every highlighted range must get the
// capture that tree-sitter's own query engine gives it over the same highlights.scm.
function diff(query: string, highlight: Highlighter): string[] {
  const ref = reference(query);
  const diffs: string[] = [];
  for (const file of files) {
    const want = ref.get(file) ?? new Map();
    const got = generated(file, highlight);
    for (const key of new Set([...want.keys(), ...got.keys()])) {
      const a = want.get(key)?.capture;
      const b = got.get(key)?.capture;
      if (a !== b) diffs.push(`${file.slice(corpus.length + 1)} ${key}: tree-sitter @${a}, generated @${b}`);
    }
  }
  return diffs;
}

test.skipIf(!hasCli)("generated highlights match tree-sitter's query engine on the corpus", () => {
  const diffs = diff(join(grammarDir, "queries/highlights.scm"), highlight);
  expect(diffs.slice(0, 20)).toEqual([]);
  expect(diffs.length).toBe(0);
}, 120_000);

// The query features tree-sitter-swift's highlights.scm does not use yet, which another grammar's will: anchors,
// quantifiers, negated fields, wildcards and the other predicates. A regression here is one of them read
// differently from tree-sitter while the swift parity above still passes.
const FEATURES = `
(call_expression . (simple_identifier) @function.call)
(value_arguments (value_argument) @variable.member .)
(value_arguments "(" . (value_argument) @label)
(parameter !external_name name: (simple_identifier) @variable.parameter)
((simple_identifier) @variable.builtin (#any-of? @variable.builtin "context" "node" "rule"))
((simple_identifier) @constant.builtin (#eq? @constant.builtin "token"))
((type_identifier) @type (#not-match? @type "^[A-Z]"))
(lambda_literal (statements (call_expression)* @function.macro))
(value_arguments "(" (value_argument)? @string ")")
(_ (comment) @comment.documentation . (function_declaration))
(navigation_suffix _ @punctuation.special)
(statements [(call_expression) (assignment)]+ @keyword)
`;

test.skipIf(!hasCli)("anchors, quantifiers, negated fields and predicates match tree-sitter's", () => {
  const file = join(mkdtempSync(join(tmpdir(), "syntechs-query-")), "features.scm");
  writeFileSync(file, FEATURES);
  const diffs = diff(file, createHighlighter(parseQuery(FEATURES), "swift"));
  expect(diffs.slice(0, 20)).toEqual([]);
  expect(diffs.length).toBe(0);
}, 120_000);
