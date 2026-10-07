import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { LANGUAGES, type Rule } from "../../highlight/rules.node.js";
import { treeSitterQuery } from "../../highlight/query.node.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const here = import.meta.dirname;
const grammarDir = resolve(here, "../../../grammars/tree-sitter-json");
const corpus = join(here, "corpus");
const files = readdirSync(corpus, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".json"))
  .map((f) => join(corpus, f));

const hasCli = spawnSync("tree-sitter", ["--version"]).status === 0;
const captures = (LANGUAGES.json as { captures: Record<string, unknown> }).captures;

/** Per `row:byteCol-row:byteCol` range, the scope a highlight shows. */
type Scopes = Map<string, string>;

/**
 * tree-sitter's own query engine over highlights.scm followed by highlights.tm.scm, the files the generator
 * compiles, through the CLI mise.toml pins: the latest pattern's capture wins.
 */
function reference(): Map<string, Scopes> {
  const query = join(mkdtempSync(join(tmpdir(), "json-highlights-")), "highlights.scm");
  writeFileSync(
    query,
    [join(grammarDir, "queries/highlights.scm"), join(here, "highlights.tm.scm")]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n"),
  );
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
  return new Map(
    [...out].map(([file, w]) => {
      const lines = readFileSync(file, "utf8").split("\n");
      /** A capture's scope, with the comment rule's `byPrefix` read off the text at `row:byteCol`. */
      const scope = (key: string, capture: string) => {
        const rule = captures[capture] as Rule;
        if (typeof rule === "string") return rule;
        const [row, col] = (key.split("-")[0] as string).split(":").map(Number);
        const text = Buffer.from(lines[row as number] as string).subarray(col).toString();
        return rule.byPrefix?.find(([prefix]) => text.startsWith(prefix))?.[1] ?? rule.scope;
      };
      return [file, new Map([...w].map(([k, v]) => [k, scope(k, v.capture)]))];
    }),
  );
}

function generated(file: string): Scopes {
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
  const out: Scopes = new Map();
  highlight.highlight(tree, (n, scope, from) => {
    if (from === undefined) out.set(`${point(tree.start(n))}-${point(tree.end(n))}`, scope);
  });
  return out;
}

// A regression here is the generated matcher drifting from tree-sitter's query semantics (a field, an anchor, a
// predicate or the later-pattern-wins order read differently): on the corpus, every highlighted range must get the
// scope of the capture that tree-sitter's own query engine gives it over the same query files.
test.skipIf(!hasCli)("generated highlights match tree-sitter's query engine on the corpus", () => {
  const ref = reference();
  const diffs: string[] = [];
  for (const file of files) {
    const want = ref.get(file) ?? new Map<string, string>();
    const got = generated(file);
    for (const key of new Set([...want.keys(), ...got.keys()])) {
      const a = want.get(key);
      const b = got.get(key);
      if (a !== b) diffs.push(`${file.slice(corpus.length + 1)} ${key}: tree-sitter ${a}, generated ${b}`);
    }
  }
  expect(diffs.slice(0, 20)).toEqual([]);
  expect(diffs.length).toBe(0);
}, 120_000);
