// Parity with web-tree-sitter 0.27: every visible node's type, range, field, named, isMissing and isError,
// in preorder with depth. Usage: node dist/parity.node.js [grammar...] [--show N]

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

function reference(parser: WasmParser, text: string): string[] {
  const tree = parser.parse(text);
  if (!tree) throw new Error("web-tree-sitter returned no tree");
  const c = tree.walk();
  const out: string[] = [];
  let depth = 0;
  for (;;) {
    out.push(
      `${depth} ${c.nodeType}${c.nodeIsNamed ? "" : "(anon)"}${c.nodeIsMissing ? "(MISSING)" : ""} ${c.startIndex}-${c.endIndex}${c.currentFieldName ? ` ${c.currentFieldName}:` : ""}`,
    );
    if (c.gotoFirstChild()) {
      depth++;
      continue;
    }
    while (!c.gotoNextSibling()) {
      if (!c.gotoParent()) {
        c.delete();
        tree.delete();
        return out;
      }
      depth--;
    }
  }
}

function ours(lang: Language, text: string): string[] {
  const raw = parseRaw(lang, text);
  const depthOf = new Map<unknown, number>();
  return raw.nodes.map((n) => {
    const depth = n.parent ? (depthOf.get(n.parent) as number) + 1 : 0;
    depthOf.set(n, depth);
    return `${depth} ${n.kind}${n.named ? "" : "(anon)"}${raw.missing.has(n) ? "(MISSING)" : ""} ${n.start}-${n.end}${n.field ? ` ${n.field}:` : ""}`;
  });
}

interface Divergence {
  input: Input;
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
    nodes += expected.length;
    if (expected.some((l) => l.includes(" ERROR ") || l.includes("(MISSING)")))
      withErrors++;
    let actual: string[];
    try {
      actual = ours(lang, input.text);
    } catch (e) {
      divergences.push({
        input,
        index: 0,
        expected,
        actual: [],
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
      continue;
    }
    let i = 0;
    while (
      i < expected.length &&
      i < actual.length &&
      expected[i] === actual[i]
    )
      i++;
    nodesSame += i;
    if (i === expected.length && i === actual.length) same++;
    else divergences.push({ input, index: i, expected, actual });
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
        `  ${d.input.name} (${d.input.text.length} chars): first divergence at node ${d.index}`,
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
