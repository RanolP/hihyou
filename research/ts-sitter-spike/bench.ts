// Spike vs web-tree-sitter on the same tree-sitter-json tables.
// Usage (after `node gen.ts ... json.tables.ts`): node bench.ts [runs] [input.json...]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import * as json from "./json.tables.ts";
import { parse, type Tree } from "./runtime.ts";

const benchDir = new URL("../parser-bench/", import.meta.url);
const require = createRequire(new URL("package.json", benchDir));
const { Parser, Language } = await import(pathToFileURL(require.resolve("web-tree-sitter")).href);

const RUNS = Number(process.argv[2] ?? 15);
const files = process.argv.slice(3);
if (files.length === 0) files.push(new URL("inputs/package-lock.json", benchDir).pathname.replace(/^\/(\w:)/, "$1"));

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
function time<T>(fn: () => T): { ms: number; out: T } {
  fn();
  const ts: number[] = [];
  let out!: T;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    out = fn();
    ts.push(performance.now() - t0);
  }
  return { ms: median(ts), out };
}

const lineStarts = (src: string) => {
  const ls = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) ls.push(i + 1);
  return Int32Array.from(ls);
};
const rowOf = (ls: Int32Array, off: number) => {
  let lo = 0, hi = ls.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ls[mid] <= off) lo = mid; else hi = mid - 1;
  }
  return lo;
};

// Same reads as parser-bench/bench.mjs walks: type, offsets, row/col, leaf text.
function walkSpike(t: Tree, src: string, ls: Int32Array) {
  const names = json.symbolNames;
  const stack = new Int32Array(4096);
  let sp = 0, n = 0, acc = 0;
  stack[sp++] = t.root;
  while (sp > 0) {
    const i = stack[--sp];
    const s = t.start[i], e = t.end[i];
    const sr = rowOf(ls, s), er = rowOf(ls, e);
    acc += names[t.type[i]].length + s + e + sr + (e - ls[er]);
    n++;
    const fc = t.firstChild[i];
    if (fc < 0) { acc += src.slice(s, e).length; continue; }
    // push children in reverse for pre-order
    const base = sp;
    for (let c = fc; c >= 0; c = t.nextSibling[c]) stack[sp++] = c;
    stack.subarray(base, sp).reverse();
  }
  return { n, acc };
}

function flattenSpike(t: Tree): string[] {
  const out: string[] = [];
  const visit = (i: number) => {
    out.push(`${json.symbolNames[t.type[i]]}@${t.start[i]}-${t.end[i]}`);
    for (let c = t.firstChild[i]; c >= 0; c = t.nextSibling[c]) visit(c);
  };
  visit(t.root);
  return out;
}
function flattenWts(tree: any): string[] {
  const out: string[] = [];
  const c = tree.walk();
  for (;;) {
    out.push(`${c.nodeType}@${c.startIndex}-${c.endIndex}`);
    if (c.gotoFirstChild()) continue;
    while (!c.gotoNextSibling()) if (!c.gotoParent()) { c.delete(); return out; }
  }
}
function walkWtsCursor(tree: any) {
  const c = tree.walk();
  let n = 0, acc = 0;
  for (;;) {
    const type = c.nodeType, s = c.startIndex, e = c.endIndex, sp = c.startPosition, ep = c.endPosition;
    acc += type.length + s + e + sp.row + ep.column;
    n++;
    if (c.gotoFirstChild()) continue;
    acc += c.nodeText.length;
    while (!c.gotoNextSibling()) if (!c.gotoParent()) { c.delete(); return { n, acc }; }
  }
}

await Parser.init();
const lang = await Language.load(readFileSync(require.resolve("tree-sitter-json/tree-sitter-json.wasm")));
const p = new Parser();
p.setLanguage(lang);

console.log(`node ${process.version}, ${RUNS} runs, median ms`);
console.log("file\tkb\tnodes\tsameTree\twts.parse\tspike.parse\twts.walkCursor\tspike.walk\twts.parse+walk\tspike.parse+walk");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const a = flattenWts(p.parse(src));
  const b = flattenSpike(parse(json as any, src));
  let same = a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same) {
    const k = a.findIndex((x, i) => x !== b[i]);
    console.error(`MISMATCH at node ${k}: wts=${a[k]} spike=${b[k]} (wts ${a.length} nodes, spike ${b.length})`);
  }
  const ls = lineStarts(src);
  const wp = time(() => p.parse(src));
  const sp = time(() => parse(json as any, src));
  const ww = time(() => walkWtsCursor(wp.out));
  const sw = time(() => walkSpike(sp.out, src, ls));
  const wBoth = time(() => { const t = p.parse(src); const r = walkWtsCursor(t); t.delete(); return r; });
  const sBoth = time(() => walkSpike(parse(json as any, src), src, lineStarts(src)));
  console.log([f.split(/[\\/]/).pop(), Math.round(src.length / 1024), sw.out.n, same, wp.ms, sp.ms, ww.ms, sw.ms, wBoth.ms, sBoth.ms]
    .map((v) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v))).join("\t"));
}
