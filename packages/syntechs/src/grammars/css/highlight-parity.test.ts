import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import type { CaptureScope } from "../../highlight/match.js";
import { LANGUAGES } from "../../highlight/rules.node.js";
import { treeSitterQuery } from "../../highlight/query.node.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const here = import.meta.dirname;
const grammarDir = resolve(here, "../../../grammars/tree-sitter-css");
const corpus = join(here, "corpus");
const files = readdirSync(corpus, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".css"))
  .map((f) => join(corpus, f));

const hasCli = spawnSync("tree-sitter", ["--version"]).status === 0;
const captures = (LANGUAGES.css as { captures: Record<string, string | CaptureScope | null> }).captures;

/** Per `row:byteCol-row:byteCol` range, the capture tree-sitter's query engine shows there. */
type Captures = Map<string, string>;

/** tree-sitter's own query engine over highlights.scm, through the CLI mise.toml pins: the latest pattern's capture wins. */
function reference(): Map<string, Captures> {
  const query = join(grammarDir, "queries/highlights.scm");
  const stdout = treeSitterQuery(grammarDir, query, files);
  const out = new Map<string, Map<string, { pattern: number; capture: string }>>();
  const known = new Set(files);
  let current: Map<string, { pattern: number; capture: string }> | undefined;
  let pattern = -1;
  for (const line of stdout.split("\n")) {
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
    if (c === null || current === undefined) continue;
    const capture = c[1] as string;
    if (capture.startsWith("_") || captures[capture] === null) continue;
    const key = `${c[2]}:${c[3]}-${c[4]}:${c[5]}`;
    const old = current.get(key);
    if (old === undefined || pattern >= old.pattern) current.set(key, { pattern, capture });
  }
  return new Map([...out].map(([file, w]) => [file, new Map([...w].map(([k, v]) => [k, v.capture]))]));
}

/** The scopes the generated highlighter paints, and the kinds and text of the nodes at each range. */
function generated(file: string) {
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
  const range = (n: number) => `${point(tree.start(n))}-${point(tree.end(n))}`;
  const scopes = new Map<string, string>();
  highlight.highlight(tree, (n, scope, from) => {
    if (from === undefined) scopes.set(range(n), scope);
  });
  const nodes = new Map<string, { kinds: string[]; text: string }>();
  const walk = (n: number) => {
    const k = range(n);
    const at = nodes.get(k) ?? { kinds: [], text: tree.text(n) };
    at.kinds.push(tree.kindName(n));
    nodes.set(k, at);
    for (let i = 0; i < tree.count(n); i++) walk(tree.child(n, i));
  };
  walk(tree.root);
  return { scopes, nodes };
}

/** A capture's scope at a node, refined by its kind or text as rules.node.ts says. */
function scopeOf(capture: string, at: { kinds: string[]; text: string } | undefined): string {
  const rule = captures[capture];
  if (typeof rule === "string") return rule;
  if (!rule) throw new Error(`@${capture} has no scope`);
  for (const kind of at?.kinds ?? []) if (rule.byKind && Object.hasOwn(rule.byKind, kind)) return rule.byKind[kind] as string;
  const text = at?.text ?? "";
  if (rule.byText && Object.hasOwn(rule.byText, text)) return rule.byText[text] as string;
  for (const [prefix, scope] of rule.byPrefix ?? []) if (text.startsWith(prefix)) return scope;
  return rule.scope;
}

// A regression here is the generated matcher drifting from tree-sitter's query semantics (a field, an anchor, a
// predicate or the later-pattern-wins order read differently): on the corpus, every highlighted range must get the
// scope of the capture that tree-sitter's own query engine gives it over the same highlights.scm.
test.skipIf(!hasCli)("generated highlights match tree-sitter's query engine on the corpus", () => {
  const ref = reference();
  const diffs: string[] = [];
  for (const file of files) {
    const want = ref.get(file) ?? new Map<string, string>();
    const { scopes, nodes } = generated(file);
    for (const key of new Set([...want.keys(), ...scopes.keys()])) {
      const capture = want.get(key);
      const a = capture === undefined ? undefined : scopeOf(capture, nodes.get(key));
      const b = scopes.get(key);
      if (a !== b) diffs.push(`${file.slice(corpus.length + 1)} ${key}: tree-sitter ${a} (@${capture}), generated ${b}`);
    }
  }
  expect(diffs.slice(0, 20)).toEqual([]);
  expect(diffs.length).toBe(0);
}, 120_000);
