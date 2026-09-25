// Measures parse, full walk, and materialization cost for web-tree-sitter and Lezer.
// Usage: node bench.mjs [runs]   (inputs come from ./fetch-inputs.sh)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { Language, Parser } from "web-tree-sitter";
import { parser as lezerJs } from "@lezer/javascript";
import { parser as lezerJson } from "@lezer/json";
import { parser as lezerPy } from "@lezer/python";

const require = createRequire(import.meta.url);
const RUNS = Number(process.argv[2] ?? 9);
const here = (p) => new URL(p, import.meta.url);
const wasmOf = (pkg, file) => readFileSync(require.resolve(`${pkg}/${file}`));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
function time(fn) {
  fn(); // warm-up
  const ts = [];
  let out;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    out = fn();
    ts.push(performance.now() - t0);
  }
  return { ms: median(ts), out };
}

// ---- web-tree-sitter walks -------------------------------------------------
// Every walk reads: type string, start/end offset, start/end row+column, and text of leaves.
function walkCursor(tree) {
  const c = tree.walk();
  let n = 0, acc = 0;
  for (;;) {
    const type = c.nodeType;
    const s = c.startIndex, e = c.endIndex;
    const sp = c.startPosition, ep = c.endPosition;
    acc += type.length + s + e + sp.row + ep.column;
    n++;
    if (c.gotoFirstChild()) continue;
    acc += c.nodeText.length; // leaf
    while (!c.gotoNextSibling()) {
      if (!c.gotoParent()) { c.delete(); return { n, acc }; }
    }
  }
}

function walkNode(tree) {
  let n = 0, acc = 0;
  const visit = (node) => {
    const type = node.type;
    const s = node.startIndex, e = node.endIndex;
    const sp = node.startPosition, ep = node.endPosition;
    acc += type.length + s + e + sp.row + ep.column;
    n++;
    const kids = node.children;
    if (kids.length === 0) acc += node.text.length;
    for (const k of kids) visit(k);
  };
  visit(tree.rootNode);
  return { n, acc };
}

// Walk via firstChild/nextSibling (no children array) -- the other common Node-API idiom.
function walkNodeSiblings(tree) {
  let n = 0, acc = 0;
  const visit = (node) => {
    const type = node.type;
    const s = node.startIndex, e = node.endIndex;
    const sp = node.startPosition, ep = node.endPosition;
    acc += type.length + s + e + sp.row + ep.column;
    n++;
    let k = node.firstChild;
    if (!k) acc += node.text.length;
    while (k) { visit(k); k = k.nextSibling; }
  };
  visit(tree.rootNode);
  return { n, acc };
}

// Materialize to plain JS objects through a TreeCursor.
function materialize(tree) {
  const c = tree.walk();
  const mk = () => {
    const sp = c.startPosition, ep = c.endPosition;
    return { type: c.nodeType, named: c.currentNode.isNamed, start: c.startIndex, end: c.endIndex,
      sr: sp.row, sc: sp.column, er: ep.row, ec: ep.column, text: undefined, children: [] };
  };
  const root = mk();
  const stack = [root];
  for (;;) {
    if (c.gotoFirstChild()) {
      const child = mk();
      stack[stack.length - 1].children.push(child);
      stack.push(child);
      continue;
    }
    const leaf = stack[stack.length - 1];
    leaf.text = c.nodeText;
    for (;;) {
      stack.pop();
      if (c.gotoNextSibling()) {
        const sib = mk();
        stack[stack.length - 1].children.push(sib);
        stack.push(sib);
        break;
      }
      if (!c.gotoParent()) { c.delete(); return root; }
    }
  }
}

// Same materialization, but skipping the `currentNode.isNamed` read (one Node marshal per node).
function materializeLite(tree) {
  const c = tree.walk();
  const mk = () => {
    const sp = c.startPosition, ep = c.endPosition;
    return { type: c.nodeType, start: c.startIndex, end: c.endIndex,
      sr: sp.row, sc: sp.column, er: ep.row, ec: ep.column, text: undefined, children: [] };
  };
  const root = mk();
  const stack = [root];
  for (;;) {
    if (c.gotoFirstChild()) {
      const child = mk();
      stack[stack.length - 1].children.push(child);
      stack.push(child);
      continue;
    }
    stack[stack.length - 1].text = c.nodeText;
    for (;;) {
      stack.pop();
      if (c.gotoNextSibling()) {
        const sib = mk();
        stack[stack.length - 1].children.push(sib);
        stack.push(sib);
        break;
      }
      if (!c.gotoParent()) { c.delete(); return root; }
    }
  }
}

function walkPlain(root) {
  let n = 0, acc = 0;
  const visit = (o) => {
    acc += o.type.length + o.start + o.end + o.sr + o.ec;
    n++;
    if (o.children.length === 0) acc += o.text.length;
    for (const k of o.children) visit(k);
  };
  visit(root);
  return { n, acc };
}

// ---- Lezer ------------------------------------------------------------------
function lineStarts(src) {
  const ls = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) ls.push(i + 1);
  return ls;
}
function rowOf(ls, off) {
  let lo = 0, hi = ls.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ls[mid] <= off) lo = mid; else hi = mid - 1;
  }
  return lo;
}
// Same reads as the tree-sitter walks; rows/columns come from a line table since Lezer has none.
function walkLezer(tree, src) {
  const ls = lineStarts(src);
  const c = tree.cursor();
  let n = 0, acc = 0;
  for (;;) {
    const type = c.name;
    const s = c.from, e = c.to;
    const sr = rowOf(ls, s), er = rowOf(ls, e);
    acc += type.length + s + e + sr + (e - ls[er]);
    n++;
    if (c.firstChild()) continue;
    acc += src.slice(s, e).length;
    while (!c.nextSibling()) {
      if (!c.parent()) return { n, acc };
    }
  }
}
function countLezerErrors(tree) {
  let errs = 0;
  tree.iterate({ enter: (n) => { if (n.type.isError) errs++; } });
  return errs;
}

// ---- main -------------------------------------------------------------------
await Parser.init();
const langs = {
  ts: await Language.load(wasmOf("tree-sitter-typescript", "tree-sitter-typescript.wasm")),
  py: await Language.load(wasmOf("tree-sitter-python", "tree-sitter-python.wasm")),
  json: await Language.load(wasmOf("tree-sitter-json", "tree-sitter-json.wasm")),
};
const lezer = {
  ts: lezerJs.configure({ dialect: "ts" }),
  py: lezerPy,
  json: lezerJson,
};

const inputs = [
  ["scanner.ts", "ts"],
  ["checker.ts", "ts"],
  ["argparse.py", "py"],
  ["package-lock.json", "json"],
];

const rows = [];
for (const [file, lang] of inputs) {
  const src = readFileSync(here(`./inputs/${file}`), "utf8");
  const lines = src.split("\n").length;
  const p = new Parser();
  p.setLanguage(langs[lang]);

  const parse = time(() => p.parse(src));
  const tree = parse.out;
  const cursor = time(() => walkCursor(tree));
  const node = time(() => walkNode(tree));
  const nodeSib = time(() => walkNodeSiblings(tree));
  const mat = time(() => materialize(tree));
  const matLite = time(() => materializeLite(tree));
  const plain = time(() => walkPlain(mat.out));

  const lz = lezer[lang];
  const lzParse = time(() => lz.parse(src));
  const lzWalk = time(() => walkLezer(lzParse.out, src));

  rows.push({
    file, lines, kb: Math.round(src.length / 1024),
    tsNodes: cursor.out.n, tsHasError: tree.rootNode.hasError,
    tsParse: parse.ms, tsWalkCursor: cursor.ms, tsWalkNodeChildren: node.ms, tsWalkNodeSiblings: nodeSib.ms,
    tsMaterialize: mat.ms, tsMaterializeNoIsNamed: matLite.ms, plainWalk: plain.ms,
    lezerNodes: lzWalk.out.n, lezerErrors: countLezerErrors(lzParse.out),
    lezerParse: lzParse.ms, lezerWalk: lzWalk.ms,
  });
  tree.delete();
  p.delete();
}

const fmt = (v) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v));
console.log(`node ${process.version}, ${RUNS} runs, median ms`);
const keys = Object.keys(rows[0]);
console.log(keys.join("\t"));
for (const r of rows) console.log(keys.map((k) => fmt(r[k])).join("\t"));
console.log(JSON.stringify(rows));
