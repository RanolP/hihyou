import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { type Tree, parseTree } from "../../core/index.js";
import { type CaptureScope, scopeOf } from "../../highlight/match.js";
import { treeSitterQuery } from "../../highlight/query.node.js";
import { LANGUAGES, type Rule } from "../../highlight/rules.node.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const here = import.meta.dirname;
const grammarDir = resolve(here, "../../../grammars/tree-sitter-python");
// CPython's stdlib files that fetch-corpus.sh downloads; the test runs where the corpus is.
const corpus = resolve(here, "../../../corpus");
const files = ["typing.py", "dataclasses.py", "base_events.py"]
  .map((f) => join(corpus, f))
  .filter((f) => existsSync(f));

const hasCli = spawnSync("tree-sitter", ["--version"]).status === 0;
const captures = (LANGUAGES.python as { captures: Record<string, Rule | null> })
  .captures;

/** Per `row:byteCol-row:byteCol` range, the scope a highlight shows. */
type Scopes = Map<string, string>;

/** A parsed corpus file, with each node's range in tree-sitter's `row:byteCol` points. */
function parse(file: string) {
  const text = readFileSync(file, "utf8");
  const tree = parseTree(language, text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") lineStarts.push(i + 1);
  const point = (offset: number) => {
    let row = 0;
    let hi = lineStarts.length - 1;
    while (row < hi) {
      const mid = (row + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) row = mid;
      else hi = mid - 1;
    }
    const start = lineStarts[row] as number;
    return `${row}:${Buffer.byteLength(text.slice(start, offset))}`;
  };
  const range = (n: number) => `${point(tree.start(n))}-${point(tree.end(n))}`;
  return { tree, range };
}

/**
 * tree-sitter's own query engine over highlights.scm, through the CLI mise.toml pins: the latest pattern's capture
 * wins, and its scope is resolved against the deepest node of that range in syntechs' tree (for `byKind`).
 */
function reference(
  file: string,
  tree: Tree,
  range: (n: number) => string,
): Scopes {
  const query = join(grammarDir, "queries/highlights.scm");
  const stdout = treeSitterQuery(grammarDir, query, [file]);
  const won = new Map<string, { pattern: number; capture: string }>();
  let pattern = -1;
  for (const line of stdout.split("\n")) {
    const p = /^ {2}pattern: (\d+)$/.exec(line);
    if (p !== null) {
      pattern = Number(p[1]);
      continue;
    }
    const c =
      /^ {4}capture: (?:\d+ - )?([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)/.exec(
        line,
      );
    if (c === null) continue;
    const key = `${c[2]}:${c[3]}-${c[4]}:${c[5]}`;
    const old = won.get(key);
    if (old === undefined || pattern >= old.pattern)
      won.set(key, { pattern, capture: c[1] as string });
  }
  const deepest = new Map<string, number>();
  const walk = (n: number) => {
    deepest.set(range(n), n);
    for (let i = 0; i < tree.count(n); i++) walk(tree.child(n, i));
  };
  walk(tree.root);
  const out: Scopes = new Map();
  for (const [key, { capture }] of won) {
    const rule = captures[capture];
    if (rule === undefined) throw new Error(`${capture} has no rule`);
    if (rule === null) continue;
    const n = deepest.get(key);
    const scope =
      typeof rule === "string"
        ? rule
        : n === undefined
          ? `<no node at ${key}>`
          : scopeOf(rule as CaptureScope, tree, n);
    if (scope !== "") out.set(key, scope);
  }
  return out;
}

// A regression here is the generated matcher drifting from tree-sitter's query semantics (a field, a `#match?`
// predicate or the later-pattern-wins order read differently): on the corpus, every highlighted range must get the
// scope of the capture that tree-sitter's own query engine gives it over the same highlights.scm.
test.skipIf(!hasCli || files.length === 0)(
  "generated highlights match tree-sitter's query engine on the corpus",
  () => {
    const diffs: string[] = [];
    for (const file of files) {
      const { tree, range } = parse(file);
      const want = reference(file, tree, range);
      const got: Scopes = new Map();
      highlight.highlight(tree, (n, scope, from) => {
        if (from === undefined) got.set(range(n), scope);
      });
      for (const key of new Set([...want.keys(), ...got.keys()])) {
        const a = want.get(key);
        const b = got.get(key);
        if (a !== b)
          diffs.push(
            `${file.slice(corpus.length + 1)} ${key}: tree-sitter ${a}, generated ${b}`,
          );
      }
    }
    expect(diffs.slice(0, 20)).toEqual([]);
    expect(diffs.length).toBe(0);
  },
  120_000,
);
