// Native node-tree-sitter reference point (not usable in the browser; for comparison only).
// Usage: NATIVE_DIR=<dir with tree-sitter + grammars installed> node native.mjs [runs]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const dir = process.env.NATIVE_DIR;
if (!dir) throw new Error("set NATIVE_DIR to a directory where `tree-sitter` and grammars are installed");
const require = createRequire(join(dir, "package.json"));
const Parser = require("tree-sitter");
const langs = {
  ts: require("tree-sitter-typescript").typescript,
  py: require("tree-sitter-python"),
  json: require("tree-sitter-json"),
};
const RUNS = Number(process.argv[2] ?? 9);
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
function time(fn) {
  fn();
  const ts = [];
  let out;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    out = fn();
    ts.push(performance.now() - t0);
  }
  return { ms: median(ts), out };
}

function walkCursor(tree, src) {
  const c = tree.walk();
  let n = 0, acc = 0;
  for (;;) {
    const type = c.nodeType;
    const s = c.startIndex, e = c.endIndex;
    const sp = c.startPosition, ep = c.endPosition;
    acc += type.length + s + e + sp.row + ep.column;
    n++;
    if (c.gotoFirstChild()) continue;
    acc += c.nodeText.length;
    while (!c.gotoNextSibling()) if (!c.gotoParent()) return { n, acc };
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

const inputs = [["scanner.ts", "ts"], ["checker.ts", "ts"], ["argparse.py", "py"], ["package-lock.json", "json"]];
console.log(`node ${process.version}, native tree-sitter ${require("tree-sitter/package.json").version}, ${RUNS} runs, median ms`);
console.log("file\tnodes\tparse\twalkCursor\twalkNodeChildren");
for (const [file, lang] of inputs) {
  const src = readFileSync(new URL(`./inputs/${file}`, import.meta.url), "utf8");
  const p = new Parser();
  p.setLanguage(langs[lang]);
  // node-tree-sitter's default bufferSize can truncate large inputs; pass one big enough.
  const parse = time(() => p.parse(src, undefined, { bufferSize: src.length * 2 + 1024 }));
  const cur = time(() => walkCursor(parse.out, src));
  const node = time(() => walkNode(parse.out));
  console.log([file, cur.out.n, parse.ms.toFixed(1), cur.ms.toFixed(1), node.ms.toFixed(1)].join("\t"));
}
