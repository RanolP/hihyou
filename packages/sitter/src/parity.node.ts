// Parity with web-tree-sitter 0.27: every visible node's type, range, field, named, isMissing and isError,
// in preorder with depth; then, once those agree, the `SyntaxTree` hihyou consumes (labels, layout-only JSX
// text dropped, height, size) and its errorChars. Usage: node dist/parity.node.js [grammar...] [--show N]

import type { Parser as WasmParser } from "web-tree-sitter";
import {
  corpus,
  GRAMMAR_NAMES,
  type GrammarName,
  type Input,
  loadGenerated,
  loadWasm,
} from "./corpus.node.js";
import { parseRaw } from "./index.js";
import type { Language } from "./language.js";
import {
  jsxText,
  type RawTree,
  type SyntaxNode,
  type SyntaxTree,
  syntaxTree,
} from "./tree.js";

interface Walk {
  lines: string[];
  syntax: string[];
}

function describeSyntax(tree: SyntaxTree): string[] {
  return [
    ...tree.nodes.map(
      (n, i) =>
        `${i === n.id ? n.id : `${i}!=${n.id}`} ${n.kind}${n.named ? "" : "(anon)"} ${n.start}-${n.end} ${n.field ?? "-"} p${n.parent?.id ?? "-"} h${n.height} s${n.size} ${JSON.stringify(n.label)}`,
    ),
    `errorChars ${tree.errorChars}`,
  ];
}

/**
 * The cursor walk packages/engine does over web-tree-sitter, rebuilt here so the reference SyntaxTree shares
 * no walk, label, errorChars or height/size code with the port. Only `jsxText` and the layout-leaf removal
 * inside `syntaxTree` are shared.
 */
function reference(parser: WasmParser, text: string): Walk {
  const tree = parser.parse(text);
  if (!tree) throw new Error("web-tree-sitter returned no tree");
  const c = tree.walk();
  const lines: string[] = [];
  const raw: RawTree = {
    nodes: [],
    missing: new Set(),
    layout: new Set(),
    errorChars: 0,
  };
  let parent: SyntaxNode | undefined;
  let depth = 0;
  let errorDepth = 0;
  for (;;) {
    lines.push(
      `${depth} ${c.nodeType}${c.nodeIsNamed ? "" : "(anon)"}${c.nodeIsMissing ? "(MISSING)" : ""} ${c.startIndex}-${c.endIndex}${c.currentFieldName ? ` ${c.currentFieldName}:` : ""}`,
    );
    const node: SyntaxNode = {
      id: raw.nodes.length,
      kind: c.nodeType,
      named: c.nodeIsNamed,
      field: c.currentFieldName ?? undefined,
      label: "",
      start: c.startIndex,
      end: c.endIndex,
      parent,
      children: [],
      height: 1,
      size: 1,
    };
    raw.nodes.push(node);
    parent?.children.push(node);
    if (node.kind === "ERROR" && errorDepth === 0)
      raw.errorChars += node.end - node.start;
    if (c.gotoFirstChild()) {
      if (node.kind === "ERROR") errorDepth++;
      parent = node;
      depth++;
      continue;
    }
    const token = text.slice(node.start, node.end);
    if (node.kind.includes("comment")) node.label = token.replace(/\s+/g, " ");
    else if (node.kind === "jsx_text") {
      node.label = jsxText(token);
      if (node.label === "") raw.layout.add(node);
    } else node.label = token;
    while (!c.gotoNextSibling()) {
      if (!c.gotoParent() || !parent) {
        c.delete();
        tree.delete();
        for (const n of raw.nodes.toReversed())
          if (n.parent) {
            n.parent.height = Math.max(n.parent.height, n.height + 1);
            n.parent.size += n.size;
          }
        return { lines, syntax: describeSyntax(syntaxTree(raw)) };
      }
      if (parent.kind === "ERROR") errorDepth--;
      parent = parent.parent;
      depth--;
    }
  }
}

function ours(lang: Language, text: string): Walk {
  const raw = parseRaw(lang, text);
  const depthOf = new Map<unknown, number>();
  const lines = raw.nodes.map((n) => {
    const depth = n.parent ? (depthOf.get(n.parent) as number) + 1 : 0;
    depthOf.set(n, depth);
    return `${depth} ${n.kind}${n.named ? "" : "(anon)"}${raw.missing.has(n) ? "(MISSING)" : ""} ${n.start}-${n.end}${n.field ? ` ${n.field}:` : ""}`;
  });
  return { lines, syntax: describeSyntax(syntaxTree(raw)) };
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
  const wasm = await loadWasm(grammar);
  let same = 0;
  let nodes = 0;
  let nodesSame = 0;
  let withErrors = 0;
  const divergences: Divergence[] = [];
  for (const input of inputs) {
    const expected = reference(wasm, input.text);
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
  wasm.delete();
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
          `    ${k === d.index ? ">" : " "} wasm: ${d.expected[k] ?? "(end)"}  |  ours: ${d.actual[k] ?? "(end)"}`,
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
