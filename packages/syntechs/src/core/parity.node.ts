// Parity with native tree-sitter (the 0.27 CLI): every visible node's type, range, field, named, isMissing and
// isError, in preorder with depth; then, once those agree, the arena `Tree` hihyou consumes (labels, parents)
// and its errorChars. Layout-only JSX text, which the arena drops, is dropped from the reference too. The CLI
// prints a field only on named nodes, so an anonymous node's field goes unchecked. Usage: node
// packages/syntechs/dist/core/parity.node.js [grammar...] [--show N]

import {
  corpus,
  GRAMMAR_NAMES,
  type GrammarName,
  type Input,
  loadGenerated,
  type ReferenceNode,
  referenceMissing,
  referenceTrees,
} from "./corpus.node.js";
import { parseTree } from "./index.js";
import type { Language } from "./language.js";
import { jsxText } from "./label.js";

interface Walk {
  lines: string[];
  syntax: string[];
}

function nodeLine(
  depth: number,
  kind: string,
  named: boolean,
  missing: boolean,
  start: number,
  end: number,
  field: string | undefined,
): string {
  return `${depth} ${kind}${named ? "" : "(anon)"}${missing ? "(MISSING)" : ""} ${start}-${end}${named && field ? ` ${field}:` : ""}`;
}

/**
 * The CLI's preorder, described with no walk, label or errorChars code shared with the port. Only `jsxText`
 * is shared.
 */
function reference(ref: ReferenceNode[], text: string): Walk {
  const lines: string[] = [];
  const syntax: string[] = [];
  let errorChars = 0;
  /** The open ancestors by depth: kind, and preorder id among the kept nodes. */
  const path: { kind: string; id: number }[] = [];
  for (const [k, r] of ref.entries()) {
    path.length = r.depth;
    if (r.kind === "ERROR" && !path.some((p) => p.kind === "ERROR"))
      errorChars += r.end - r.start;
    const leaf = (ref[k + 1]?.depth ?? -1) <= r.depth;
    let label = "";
    if (leaf) {
      const token = text.slice(r.start, r.end);
      if (r.kind.includes("comment")) label = token.replace(/\s+/g, " ");
      else if (r.kind === "jsx_text") {
        label = jsxText(token);
        if (label === "") continue;
      } else label = token;
    }
    const id = lines.length;
    lines.push(
      nodeLine(r.depth, r.kind, r.named, r.missing, r.start, r.end, r.field),
    );
    syntax.push(
      `${id} ${r.kind} p${path.at(-1)?.id ?? "-"} ${JSON.stringify(label)}`,
    );
    path.push({ kind: r.kind, id });
  }
  syntax.push(`errorChars ${errorChars}`);
  return { lines, syntax };
}

function ours(lang: Language, text: string): Walk {
  const tree = parseTree(lang, text);
  const lines: string[] = [];
  const syntax: string[] = [];
  /** Preorder without recursion: each pending node with its depth and its parent's preorder id. */
  const stack: [number, number, number][] = [[tree.root, 0, -1]];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [n, depth, parent] = top;
    const id = lines.length;
    const kind = tree.kindName(n);
    lines.push(
      nodeLine(
        depth,
        kind,
        tree.named(n),
        tree.missing(n),
        tree.start(n),
        tree.end(n),
        tree.fieldName(n),
      ),
    );
    syntax.push(
      `${id} ${kind} p${parent < 0 ? "-" : parent} ${JSON.stringify(tree.label(n))}`,
    );
    for (let i = tree.count(n) - 1; i >= 0; i--)
      stack.push([tree.child(n, i), depth + 1, id]);
  }
  syntax.push(`errorChars ${tree.errorChars}`);
  return { lines, syntax };
}

/** The first index where the lists differ, or -1 when they are identical. */
function firstDifference(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i === a.length && i === b.length ? -1 : i;
}

interface Divergence {
  input: Input;
  /** `nodes`: the per-node lines differ. `syntaxTree`: those agree, but the labels, parents or errorChars do not. */
  stage: "nodes" | "syntaxTree";
  index: number;
  expected: string[];
  actual: string[];
  error?: string;
}

export async function checkParity(
  grammar: GrammarName,
  inputs: Input[],
  generated?: Language,
): Promise<{
  same: number;
  nodes: number;
  nodesSame: number;
  withErrors: number;
  divergences: Divergence[];
}> {
  const lang = generated ?? (await loadGenerated(grammar));
  const refs = referenceTrees(
    grammar,
    inputs.map((i) => i.text),
    lang,
  );
  let same = 0;
  let nodes = 0;
  let nodesSame = 0;
  let withErrors = 0;
  const divergences: Divergence[] = [];
  for (const [k, input] of inputs.entries()) {
    const expected = reference(refs[k] as ReferenceNode[], input.text);
    nodes += expected.lines.length;
    if (
      expected.lines.some(
        (l) => l.includes(" ERROR ") || l.includes("(MISSING)"),
      )
    )
      withErrors++;
    let actual: Walk;
    try {
      actual = ours(lang, input.text);
    } catch (e) {
      divergences.push({
        input,
        stage: "nodes",
        index: 0,
        expected: expected.lines,
        actual: [],
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
      continue;
    }
    const i = firstDifference(expected.lines, actual.lines);
    nodesSame += i < 0 ? expected.lines.length : i;
    if (i >= 0) {
      divergences.push({
        input,
        stage: "nodes",
        index: i,
        expected: expected.lines,
        actual: actual.lines,
      });
      continue;
    }
    const j = firstDifference(expected.syntax, actual.syntax);
    if (j < 0) same++;
    else
      divergences.push({
        input,
        stage: "syntaxTree",
        index: j,
        expected: expected.syntax,
        actual: actual.syntax,
      });
  }
  return { same, nodes, nodesSame, withErrors, divergences };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showAt = args.indexOf("--show");
  const show = showAt >= 0 ? Number(args[showAt + 1]) : 3;
  const names = args.filter(
    (a, i) => !a.startsWith("--") && (showAt < 0 || i !== showAt + 1),
  );
  const grammars = (names.length > 0 ? names : GRAMMAR_NAMES) as GrammarName[];
  const missing = referenceMissing();
  if (missing) throw new Error(missing);
  for (const grammar of grammars) {
    const inputs = corpus(grammar);
    const r = await checkParity(grammar, inputs);
    const pct = ((100 * r.same) / inputs.length).toFixed(2);
    const nodePct = ((100 * r.nodesSame) / r.nodes).toFixed(3);
    console.log(
      `${grammar}: ${r.same}/${inputs.length} inputs identical (${pct}%), ${nodePct}% of ${r.nodes} nodes before the first divergence, ${r.withErrors} inputs with ERROR or MISSING`,
    );
    for (const d of r.divergences.slice(0, show)) {
      console.log(
        `  ${d.input.name} (${d.input.text.length} chars): first ${d.stage} divergence at line ${d.index}`,
      );
      if (d.error) {
        console.log(
          `    threw: ${d.error.split("\n").slice(0, 6).join("\n    ")}`,
        );
        continue;
      }
      for (let k = Math.max(0, d.index - 2); k < d.index + 3; k++) {
        console.log(
          `    ${k === d.index ? ">" : " "} native: ${d.expected[k] ?? "(end)"}  |  ours: ${d.actual[k] ?? "(end)"}`,
        );
      }
    }
  }
}

if (
  import.meta.url ===
  `file://${process.argv[1]?.replaceAll("\\", "/").replace(/^\/?/, "/")}`
)
  await main();
