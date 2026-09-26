// The shipped arena (packages/syntechs/src/core/arena.ts) against today's SyntaxNode object tree, both built
// from the same parser Subtree by core/tree.ts (buildTree and walkTree + visibleTree): build time, the whole
// parse to each tree, retained bytes, a preorder walk and parent chains. Every build is checked word for word
// against fromSyntaxTree's. Also prints the record words per source char that arena.ts presizes from. Needs a build (`pnpm build`), the parser-bench inputs
// (research/parser-bench/fetch-inputs.sh) and the corpus (packages/syntechs/fetch-corpus.sh).
//
//   node --expose-gc research/tree-arena/arena.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = new URL("../../packages/syntechs/dist/", import.meta.url);
const { parseSubtree } = await import(new URL("core/parser.js", dist));
const { parse } = await import(new URL("core/index.js", dist));
const { buildTree, walkTree, visibleTree } = await import(
  new URL("core/tree.js", dist)
);
const { fromSyntaxTree } = await import(new URL("core/arena.js", dist));

const RUNS = 21;
const WARMUP = 5;
const gc = globalThis.gc;
if (!gc) throw new Error("run with node --expose-gc");
// The minimum, not the median: on a machine shared with other work the median of the small inputs moved 2x
// between identical processes, while the minimum held.
function time(fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    gc();
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

// A preorder walk reading each node's kind, start and end: the shape of the formatter's and the diff's reads.
function walkObjects(root) {
  let acc = 0;
  const stack = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    acc += n.kind.length + n.start + n.end;
    const cs = n.children;
    for (let i = cs.length - 1; i >= 0; i--) stack.push(cs[i]);
  }
  return acc;
}
function walkArena(t) {
  let acc = 0;
  const stack = [t.root];
  while (stack.length > 0) {
    const h = stack.pop();
    acc += t.kind(h) + t.start(h) + t.end(h);
    for (let i = t.count(h) - 1; i >= 0; i--) stack.push(t.child(h, i));
  }
  return acc;
}
// Every 7th node's ancestors up to the root, as the diff's candidate search and the engine's context lookups do.
function parentsObjects(nodes) {
  let acc = 0;
  for (let i = 0; i < nodes.length; i += 7)
    for (let p = nodes[i].parent; p; p = p.parent) acc++;
  return acc;
}
function parentsArena(t) {
  let acc = 0;
  for (let o = 0; o < t.nodeCount; o += 7)
    for (let p = t.parent(t.at(o)); p !== -1; p = t.parent(p)) acc++;
  return acc;
}
function heap() {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

const inputs = new URL("../parser-bench/inputs/", import.meta.url);
const corpus = new URL("../../packages/syntechs/corpus/", import.meta.url);
const cases = [
  [inputs, "big.json", "json"],
  [inputs, "package-lock.json", "json"],
  [corpus, "bootstrap.css", "css"],
  [corpus, "normalize.css", "css"],
  [corpus, "jquery.js", "javascript"],
  [corpus, "lodash.js", "javascript"],
  [inputs, "checker.ts", "typescript"],
  [inputs, "scanner.ts", "typescript"],
  [corpus, "App.tsx", "tsx"],
  [corpus, "LayerUI.tsx", "tsx"],
  [inputs, "argparse.py", "python"],
  [corpus, "dataclasses.py", "python"],
];

async function measure(dir, file, grammar, variant) {
  const lang = (await import(new URL(`grammars/${grammar}/index.js`, dist)))
    .language;
  const text = readFileSync(new URL(file, dir), "utf8");
  const root = parseSubtree(lang, text);
  const r = { variant };
  if (variant === "objects") {
    r.build = time(() => visibleTree(walkTree(lang, root, text)).nodes.length);
    r.parse = time(() => parse(lang, text).nodes.length);
    // Enough copies to hold 1M nodes, so a small tree is not lost in the heap's own noise.
    const tree = visibleTree(walkTree(lang, root, text));
    r.nodes = tree.nodes.length;
    const copies = Math.ceil(1e6 / r.nodes);
    const h0 = heap();
    const kept = Array.from({ length: copies }, () =>
      visibleTree(walkTree(lang, root, text)),
    );
    r.bytes = (heap() - h0) / (r.nodes * kept.length);
    r.walk = time(() => walkObjects(tree.nodes[0]));
    r.parents = time(() => parentsObjects(tree.nodes));
    return r;
  }
  r.build = time(() => buildTree(lang, root, text).nodeCount);
  r.parse = time(
    () => buildTree(lang, parseSubtree(lang, text), text).nodeCount,
  );
  const t = buildTree(lang, root, text);
  const ref = fromSyntaxTree(
    lang,
    visibleTree(walkTree(lang, root, text)),
    text,
  );
  if (t.nodeCount !== ref.nodeCount)
    throw new Error(`${file}: ${t.nodeCount} nodes, converter ${ref.nodeCount}`);
  r.nodes = t.nodeCount;
  let words = 0;
  for (let o = 0; o < t.nodeCount; o++) {
    const c = t.count(t.at(o));
    words += c === 0 ? 5 : 6 + c;
  }
  // `data` is private in TypeScript only; the bench reads it to compare and to size the buffers.
  for (let w = 0; w < words; w++)
    if (t.data[w] !== ref.data[w])
      throw new Error(
        `${file}: word ${w} is ${t.data[w]}, converter ${ref.data[w]}`,
      );
  r.words = words;
  r.chars = text.length;
  // Retained: both buffers as allocated, presize slack included.
  r.bytes = (t.data.byteLength + t.ords.byteLength) / t.nodeCount;
  r.usedBytes = (words * 4 + t.nodeCount * 4) / t.nodeCount;
  r.walk = time(() => walkArena(t));
  r.parents = time(() => parentsArena(t));
  return r;
}

if (process.argv[2]) {
  const [dir, file, grammar, variant] = process.argv.slice(2);
  console.log(JSON.stringify(await measure(new URL(dir), file, grammar, variant)));
} else {
  const self = fileURLToPath(import.meta.url);
  const f = (x, d = 1) => x.toFixed(d);
  console.log(
    `node ${process.version}; minimum of ${RUNS} runs after ${WARMUP} warm-ups, each from a collected heap; each variant in its own process, the median of 3 processes by build time\n`,
  );
  console.log(
    "| input | nodes | words/char | objects build ms | arena build ms | parse → SyntaxTree ms | parse → arena ms | objects B/node | arena B/node (allocated / used) | objects walk ms | arena walk ms | objects parents ms | arena parents ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const [dir, file, grammar] of cases) {
    const [o, a] = ["objects", "arena"].map((v) => {
      const runs = [0, 1, 2].map(() =>
        JSON.parse(
          execFileSync(
            process.execPath,
            ["--expose-gc", self, dir.href, file, grammar, v],
            { encoding: "utf8", maxBuffer: 1 << 24 },
          ),
        ),
      );
      return runs.sort((p, q) => p.build - q.build)[1];
    });
    if (o.nodes !== a.nodes)
      throw new Error(`${file}: arena ${a.nodes} nodes, objects ${o.nodes}`);
    console.log(
      `| ${file} | ${a.nodes} | ${f(a.words / a.chars, 2)} | ${f(o.build)} | ${f(a.build)} | ${f(o.parse)} | ${f(a.parse)} | ${f(o.bytes, 0)} | ${f(a.bytes, 0)} / ${f(a.usedBytes, 0)} | ${f(o.walk, 2)} | ${f(a.walk, 2)} | ${f(o.parents, 2)} | ${f(a.parents, 2)} |`,
    );
  }
}
