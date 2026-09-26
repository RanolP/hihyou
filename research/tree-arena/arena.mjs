// The shipped arena (packages/syntechs/src/core/arena.ts) against today's SyntaxNode object tree, both built
// from the same parser Subtree: build time, retained bytes, a preorder walk and parent chains. The arena is fed
// by walkTree's traversal calling TreeBuilder, which is what a buildTree next to walkTree would do; every build
// is checked word for word against fromSyntaxTree's. Also prints the record words per source char that
// arena.ts presizes from. Needs a build (`pnpm build`), the parser-bench inputs
// (research/parser-bench/fetch-inputs.sh) and the corpus (packages/syntechs/fetch-corpus.sh).
//
//   node --expose-gc research/tree-arena/arena.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = new URL("../../packages/syntechs/dist/", import.meta.url);
const { parseSubtree } = await import(new URL("core/parser.js", dist));
const { walkTree, visibleTree, jsxText } = await import(
  new URL("core/tree.js", dist)
);
const { TreeBuilder, NAMED, MISSING, fromSyntaxTree } = await import(
  new URL("core/arena.js", dist)
);
const L = await import(new URL("core/language.js", dist));
const S = await import(new URL("core/subtree.js", dist));

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

function fieldFor(lang, productionId, structuralIndex) {
  const start = lang.fieldSliceIndex[productionId];
  const end = start + lang.fieldSliceLength[productionId];
  for (let i = start; i < end; i++)
    if (
      lang.fieldEntryInherited[i] === 0 &&
      lang.fieldEntryChild[i] === structuralIndex
    )
      return lang.fieldEntryField[i];
  return 0;
}

/** walkTree's traversal, appending each visible node to a TreeBuilder when it closes; layout-only JSX text is skipped. */
function buildArena(lang, root, text) {
  const b = new TreeBuilder(lang, text);
  const jsx = lang.symbolNames.indexOf("jsx_text");
  const flagsOf = (tree, alias) =>
    ((
      alias !== 0
        ? L.symbolFlags(lang, alias) & L.FLAG_NAMED
        : S.flag(tree, S.NAMED)
    )
      ? NAMED
      : 0) | (S.flag(tree, S.IS_MISSING) ? MISSING : 0);
  const trees = [root];
  const index = [0];
  const structural = [0];
  const position = [root.padding];
  const openKind = [L.publicSymbol(lang, root.symbol)];
  const openFlags = [flagsOf(root, 0)];
  const openField = [0];
  const openStart = [root.padding];
  const mark = [b.mark()];
  const hiddenField = [-1];
  let depth = 1;
  while (depth > 0) {
    const d = depth - 1;
    const tree = trees[d];
    const children = tree.children;
    const i = index[d];
    if (i === children.length) {
      depth = d;
      if (hiddenField[d] === -1)
        b.inner(
          openKind[d],
          openField[d],
          openFlags[d],
          openStart[d],
          openStart[d] + tree.size,
          mark[d],
        );
      continue;
    }
    const child = children[i];
    const start = i === 0 ? position[d] : position[d] + child.padding;
    position[d] = start + child.size;
    index[d] = i + 1;
    let alias = 0;
    let field = 0;
    if (!S.flag(child, S.EXTRA)) {
      const s = structural[d];
      alias = L.aliasAt(lang, tree.productionId, s);
      field = fieldFor(lang, tree.productionId, s);
      if (field === 0 && hiddenField[d] > 0) field = hiddenField[d];
      structural[d] = s + 1;
    }
    const hasChildren = child.children.length > 0;
    if (S.flag(child, S.VISIBLE) || alias !== 0) {
      const kind = L.publicSymbol(lang, alias !== 0 ? alias : child.symbol);
      const flags = flagsOf(child, alias);
      if (hasChildren) {
        trees[depth] = child;
        index[depth] = 0;
        structural[depth] = 0;
        position[depth] = start;
        openKind[depth] = kind;
        openFlags[depth] = flags;
        openField[depth] = field;
        openStart[depth] = start;
        mark[depth] = b.mark();
        hiddenField[depth] = -1;
        depth++;
      } else if (
        kind !== jsx ||
        jsxText(text.slice(start, start + child.size)) !== ""
      )
        b.leaf(kind, field, flags, start, start + child.size);
    } else if (hasChildren) {
      trees[depth] = child;
      index[depth] = 0;
      structural[depth] = 0;
      position[depth] = start;
      hiddenField[depth] = field;
      depth++;
    }
  }
  return b.finish(0);
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
  r.build = time(() => buildArena(lang, root, text).nodeCount);
  const t = buildArena(lang, root, text);
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

export { buildArena };

if (!import.meta.main) {
  // Imported for its builder.
} else if (process.argv[2]) {
  const [dir, file, grammar, variant] = process.argv.slice(2);
  console.log(JSON.stringify(await measure(new URL(dir), file, grammar, variant)));
} else {
  const self = fileURLToPath(import.meta.url);
  const f = (x, d = 1) => x.toFixed(d);
  console.log(
    `node ${process.version}; minimum of ${RUNS} runs after ${WARMUP} warm-ups, each from a collected heap; each variant in its own process, the median of 3 processes by build time\n`,
  );
  console.log(
    "| input | nodes | words/char | objects build ms | arena build ms | objects B/node | arena B/node (allocated / used) | objects walk ms | arena walk ms | objects parents ms | arena parents ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
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
      `| ${file} | ${a.nodes} | ${f(a.words / a.chars, 2)} | ${f(o.build)} | ${f(a.build)} | ${f(o.bytes, 0)} | ${f(a.bytes, 0)} / ${f(a.usedBytes, 0)} | ${f(o.walk, 2)} | ${f(a.walk, 2)} | ${f(o.parents, 2)} | ${f(a.parents, 2)} |`,
    );
  }
}
