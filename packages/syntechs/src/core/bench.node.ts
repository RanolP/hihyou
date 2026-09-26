// This runtime against native tree-sitter (the parity reference), both producing the engine's SyntaxTree.
// Usage: node packages/syntechs/dist/core/bench.node.js [grammar...]    (warm parse, cold start, min+gzip size)

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import type NativeParser from "tree-sitter";
import {
  benchFiles,
  GRAMMAR_NAMES,
  type GrammarName,
  loadGenerated,
  loadNative,
  pkgRoot,
} from "./corpus.node.js";
import { parse } from "./index.js";

const RUNS = 15;
const WARMUP = 3;

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;

function time(fn: () => unknown): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

interface Node {
  kind: string;
  named: boolean;
  field: string | undefined;
  label: string;
  start: number;
  end: number;
  parent: Node | undefined;
  children: Node[];
  height: number;
  size: number;
}

/** What packages/engine did with web-tree-sitter before syntechs: parse, then one cursor walk into plain objects. */
function nativeTree(parser: NativeParser, text: string): Node[] {
  const c = parser.parse(text).walk();
  const nodes: Node[] = [];
  const open = (parent: Node | undefined): Node => {
    const n: Node = {
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
    nodes.push(n);
    parent?.children.push(n);
    return n;
  };
  let node = open(undefined);
  for (;;) {
    if (c.gotoFirstChild()) {
      node = open(node);
      continue;
    }
    for (;;) {
      if (node.children.length === 0)
        node.label = text.slice(node.start, node.end);
      for (const k of node.children) {
        if (k.height + 1 > node.height) node.height = k.height + 1;
        node.size += k.size;
      }
      if (c.gotoNextSibling()) {
        node = open(node.parent);
        break;
      }
      if (!c.gotoParent() || !node.parent) {
        return nodes;
      }
      node = node.parent;
    }
  }
}

async function warm(grammar: GrammarName): Promise<void> {
  const lang = await loadGenerated(grammar);
  const native = await loadNative(grammar);
  console.log(
    `\n${grammar}: parse + materialise, median of ${RUNS} after ${WARMUP} warm-up runs`,
  );
  console.log("input\tKB\tnodes\tours ms\tnative ms\tours/native");
  for (const input of benchFiles(grammar)) {
    const nodes = parse(lang, input.text).nodes.length;
    const ours = time(() => parse(lang, input.text));
    const theirs = time(() => nativeTree(native, input.text));
    const name = input.name.split(/[\\/]/).at(-1);
    console.log(
      `${name}\t${(input.text.length / 1024).toFixed(0)}\t${nodes}\t${ours.toFixed(1)}\t${theirs.toFixed(1)}\t${(ours / theirs).toFixed(2)}x`,
    );
  }
}

const TINY: Record<GrammarName, string> = {
  json: '{"a":[1,2]}',
  css: "a { color: red; }",
  javascript: "let a = 1;",
  typescript: "let a: number = 1;",
  tsx: "const a = <div>{b}</div>;",
  python: "x = 1\n",
};

/** One fresh process: import, load the grammar, parse a tiny input. Prints ms. */
async function coldChild(grammar: GrammarName): Promise<void> {
  const t0 = performance.now();
  const { parse } = await import("./index.js");
  const lang = await loadGenerated(grammar);
  parse(lang, TINY[grammar]);
  process.stdout.write(String(performance.now() - t0));
}

function cold(grammar: GrammarName): void {
  const self = fileURLToPath(import.meta.url);
  const sample = () =>
    median(
      Array.from({ length: 7 }, () =>
        Number(
          execFileSync(process.execPath, [self, "--cold", grammar], {
            encoding: "utf8",
          }),
        ),
      ),
    );
  console.log(
    `cold start (import + load + tiny parse, median of 7 fresh processes): ours ${sample().toFixed(1)} ms`,
  );
}

async function minGzip(entry: string): Promise<{ min: number; gz: number }> {
  const r = await build({
    stdin: { contents: entry, resolveDir: join(pkgRoot, "src"), loader: "ts" },
    bundle: true,
    minify: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const code = (r.outputFiles[0] as { contents: Uint8Array }).contents;
  return { min: code.length, gz: gzipSync(code, { level: 9 }).length };
}

async function size(grammar: GrammarName): Promise<void> {
  const ours = await minGzip(
    `export { parse } from "./core/index.ts"; export { language } from "./grammars/${grammar}/index.ts";`,
  );
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`size: ours ${kb(ours.min)} min, ${kb(ours.gz)} gz`);
}

if (process.argv[2] === "--cold")
  await coldChild(process.argv[3] as GrammarName);
else {
  const names = process.argv.slice(2);
  for (const grammar of (names.length > 0
    ? names
    : GRAMMAR_NAMES) as GrammarName[]) {
    await warm(grammar);
    cold(grammar);
    await size(grammar);
  }
}
