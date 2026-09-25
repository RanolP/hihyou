// Option B probe: tree-sitter parse in wasm + ONE bulk export of the whole tree into a u32 buffer.
// Usage: (build bulk/bulk.wasm first) node bulk.mjs [runs]
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

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

const bytes = readFileSync(new URL("./bulk/bulk.wasm", import.meta.url));
const mod = await WebAssembly.compile(bytes);
console.log("wasm imports:", WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`).join(", "));
// The module needs only a few WASI calls that the parse path never reaches; stub them so the
// same code runs in a browser without a WASI polyfill.
const stubs = {};
for (const i of WebAssembly.Module.imports(mod)) {
  stubs[i.module] ??= {};
  stubs[i.module][i.name] = () => { throw new Error(`unexpected WASI call ${i.name}`); };
}
const t0 = performance.now();
const inst = await WebAssembly.instantiate(mod, stubs);
const instMs = performance.now() - t0;
const X = inst.exports;
if (X._initialize) X._initialize();

const cstr = (p) => {
  const m = new Uint8Array(X.memory.buffer);
  let e = p;
  while (m[e]) e++;
  return new TextDecoder().decode(m.subarray(p, e));
};
function names(which) {
  const l = X.set_language(which);
  const n = X.symbol_count(l);
  const out = [];
  for (let i = 0; i < n; i++) out.push(cstr(X.symbol_name(l, i)));
  return out;
}

let srcPtr = 0, srcCap = 0;
function parse(src) {
  if (src.length > srcCap) {
    if (srcPtr) X.dealloc(srcPtr);
    srcCap = src.length;
    srcPtr = X.alloc(srcCap * 2);
  }
  const u16 = new Uint16Array(X.memory.buffer, srcPtr, src.length);
  for (let i = 0; i < src.length; i++) u16[i] = src.charCodeAt(i);
  return X.parse_utf16(srcPtr, src.length);
}
// One crossing; returns a copy of the records so the tree lives in JS.
function exportTree(tree) {
  const n = X.export_tree(tree);
  return new Uint32Array(X.memory.buffer, X.export_ptr(), n * 8).slice();
}
// Same reads as the other walks: type, offsets, row/col, leaf text.
function walkBuf(buf, nm, src) {
  let acc = 0;
  const n = buf.length >> 3;
  for (let i = 0; i < n; i++) {
    const r = i << 3;
    const type = nm[buf[r] & 0xffff];
    acc += type.length + buf[r + 2] + buf[r + 3] + buf[r + 4] + buf[r + 7];
    if (buf[r + 1] === 0) acc += src.slice(buf[r + 2], buf[r + 3]).length;
  }
  return { n, acc };
}
function materializeBuf(buf, nm, src) {
  let i = 0;
  const build = () => {
    const r = i++ << 3;
    const kids = buf[r + 1];
    const o = { type: nm[buf[r] & 0xffff], named: (buf[r] >> 16) & 1, start: buf[r + 2], end: buf[r + 3],
      sr: buf[r + 4], sc: buf[r + 5], er: buf[r + 6], ec: buf[r + 7], text: undefined, children: [] };
    if (kids === 0) o.text = src.slice(o.start, o.end);
    for (let k = 0; k < kids; k++) o.children.push(build());
    return o;
  };
  return build();
}

// Cross-check: the bulk records must describe the same tree web-tree-sitter produces.
const { Parser, Language } = await import("web-tree-sitter");
const { createRequire } = await import("node:module");
const req = createRequire(import.meta.url);
await Parser.init();
const wtsLang = [
  ["tree-sitter-typescript", "tree-sitter-typescript.wasm"],
  ["tree-sitter-python", "tree-sitter-python.wasm"],
  ["tree-sitter-json", "tree-sitter-json.wasm"],
];
const wtsLoaded = [];
for (const [pkg, f] of wtsLang) wtsLoaded.push(await Language.load(readFileSync(req.resolve(`${pkg}/${f}`))));
async function sameAsWts(src, which, buf, nm) {
  const p = new Parser();
  p.setLanguage(wtsLoaded[which]);
  const c = p.parse(src).walk();
  let i = 0;
  for (;;) {
    const r = i++ << 3;
    if (c.nodeType !== nm[buf[r] & 0xffff] || c.startIndex !== buf[r + 2] || c.endIndex !== buf[r + 3] || c.startPosition.column !== buf[r + 5]) return `differs at record ${i - 1}`;
    if (c.gotoFirstChild()) continue;
    while (!c.gotoNextSibling()) if (!c.gotoParent()) return i === buf.length >> 3 ? "same" : "count differs";
  }
}

const inputs = [["scanner.ts", 0], ["checker.ts", 0], ["argparse.py", 1], ["package-lock.json", 2]];
console.log(`node ${process.version}, ${RUNS} runs, median ms; instantiate ${instMs.toFixed(1)} ms, wasm ${(bytes.length / 1024) | 0} KiB`);
console.log("file\tnodes\tparse\texport\twalkBuf\tmaterializeBuf\tparse+export+walk");
for (const [file, which] of inputs) {
  const src = readFileSync(new URL(`./inputs/${file}`, import.meta.url), "utf8");
  const nm = names(which);
  const p = time(() => { const t = parse(src); X.tree_delete(t); });
  const tree = parse(src);
  const ex = time(() => exportTree(tree));
  const w = time(() => walkBuf(ex.out, nm, src));
  const m = time(() => materializeBuf(ex.out, nm, src));
  const all = time(() => { const t = parse(src); const b = exportTree(t); X.tree_delete(t); return walkBuf(b, nm, src); });
  X.tree_delete(tree);
  console.log(`  ${file}: bulk tree vs web-tree-sitter: ${await sameAsWts(src, which, ex.out, nm)}`);
  console.log([file, w.out.n, p.ms, ex.ms, w.ms, m.ms, all.ms].map((v) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : v)).join("\t"));
}
