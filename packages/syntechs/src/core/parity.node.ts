// Parity with native tree-sitter (the 0.27 CLI): every visible node's type, range, field, named, isMissing and
// isError, in preorder with depth; then, once those agree, the `SyntaxTree` hihyou consumes (labels, layout-only
// JSX text dropped, height, size) and its errorChars. The CLI prints a field only on named nodes, so an anonymous
// node's field goes unchecked. Usage: node packages/syntechs/dist/core/parity.node.js [grammar...] [--show N]

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
import { parseRaw } from "./index.js";
import type { Language } from "./language.js";
import { jsxText } from "./label.js";
import { type RawTree, type SyntaxNode, type SyntaxTree, visibleTree } from "./tree.js";

interface Walk {
  lines: string[];
  syntax: string[];
}

function describeSyntax(tree: SyntaxTree): string[] {
  return [
    ...tree.nodes.map(
      (n, i) =>
        `${i === n.id ? n.id : `${i}!=${n.id}`} ${n.kind}${n.named ? "" : "(anon)"} ${n.start}-${n.end} ${(n.named && n.field) || "-"}${n.missing ? " MISSING" : ""} p${n.parent?.id ?? "-"} h${n.height} s${n.size} ${JSON.stringify(n.label)}`,
    ),
    `errorChars ${tree.errorChars}`,
  ];
}

/**
 * The cursor walk packages/engine did over web-tree-sitter, rebuilt here over the CLI's preorder so the reference
 * SyntaxTree shares no walk, label, errorChars or height/size code with the port. Only `jsxText` and the
 * layout-leaf removal inside `visibleTree` are shared.
 */
function reference(ref: ReferenceNode[], text: string): Walk {
  const lines: string[] = [];
  const raw: RawTree = {
    nodes: [],
    layout: new Set(),
    errorChars: 0,
  };
  const path: SyntaxNode[] = [];
  for (const r of ref) {
    lines.push(
      `${r.depth} ${r.kind}${r.named ? "" : "(anon)"}${r.missing ? "(MISSING)" : ""} ${r.start}-${r.end}${r.field ? ` ${r.field}:` : ""}`,
    );
    path.length = r.depth;
    const parent = path.at(-1);
    const node: SyntaxNode = {
      id: raw.nodes.length,
      kind: r.kind,
      named: r.named,
      field: r.field,
      missing: r.missing,
      label: "",
      start: r.start,
      end: r.end,
      parent,
      children: [],
      height: 1,
      size: 1,
    };
    raw.nodes.push(node);
    parent?.children.push(node);
    if (node.kind === "ERROR" && !path.some((p) => p.kind === "ERROR")) raw.errorChars += node.end - node.start;
    path.push(node);
  }
  for (const node of raw.nodes) {
    if (node.children.length > 0) continue;
    const token = text.slice(node.start, node.end);
    if (node.kind.includes("comment")) node.label = token.replace(/\s+/g, " ");
    else if (node.kind === "jsx_text") {
      node.label = jsxText(token);
      if (node.label === "") raw.layout.add(node);
    } else node.label = token;
  }
  for (const n of raw.nodes.toReversed())
    if (n.parent) {
      n.parent.height = Math.max(n.parent.height, n.height + 1);
      n.parent.size += n.size;
    }
  return { lines, syntax: describeSyntax(visibleTree(raw)) };
}

function ours(lang: Language, text: string): Walk {
  const raw = parseRaw(lang, text);
  const depthOf = new Map<unknown, number>();
  const lines = raw.nodes.map((n) => {
    const depth = n.parent ? (depthOf.get(n.parent) as number) + 1 : 0;
    depthOf.set(n, depth);
    return `${depth} ${n.kind}${n.named ? "" : "(anon)"}${n.missing ? "(MISSING)" : ""} ${n.start}-${n.end}${n.named && n.field ? ` ${n.field}:` : ""}`;
  });
  return { lines, syntax: describeSyntax(visibleTree(raw)) };
}

/** The first index where the lists differ, or -1 when they are identical. */
function firstDifference(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i === a.length && i === b.length ? -1 : i;
}

interface Divergence {
  input: Input;
  /** `nodes`: the per-node lines differ. `syntaxTree`: those agree, but the SyntaxTree or errorChars do not. */
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
    if (expected.lines.some((l) => l.includes(" ERROR ") || l.includes("(MISSING)"))) withErrors++;
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
  const names = args.filter((a, i) => !a.startsWith("--") && (showAt < 0 || i !== showAt + 1));
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
        console.log(`    threw: ${d.error.split("\n").slice(0, 6).join("\n    ")}`);
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

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/").replace(/^\/?/, "/")}`)
  await main();
