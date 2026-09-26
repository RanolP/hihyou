// Today's SyntaxNode object tree against arena layouts, built from the same parser Subtree of real inputs:
// build time, bytes per node, full-heap GC time with the tree alive, and the traversals the formatter and the
// diff do. Needs a build (`pnpm build`) and the parser-bench inputs (research/parser-bench/fetch-inputs.sh).
//
//   node --expose-gc research/tree-arena/tree.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = new URL("../../packages/syntechs/dist/", import.meta.url);
const inputs = new URL("../parser-bench/inputs/", import.meta.url);
const { parseSubtree } = await import(new URL("core/parser.js", dist));
const { walkTree } = await import(new URL("core/tree.js", dist));
const L = await import(new URL("core/language.js", dist));
const S = await import(new URL("core/subtree.js", dist));
const grammars = {
  json: (await import(new URL("grammars/json/index.js", dist))).language,
  typescript: (await import(new URL("grammars/typescript/index.js", dist)))
    .language,
};

const RUNS = 11;
const gc = globalThis.gc;
if (!gc) throw new Error("run with node --expose-gc");
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
// GC pauses inside each timed run, so a build's time splits into its own work and the collections it caused.
const gcSeen = new PerformanceObserver(() => {});
gcSeen.observe({ entryTypes: ["gc"] });
const gcPause = () =>
  gcSeen.takeRecords().reduce((sum, e) => sum + e.duration, 0);
let lastGc = 0;
/** Median ms of `runs` runs, each from a freshly collected heap; `lastGc` gets the median GC pause per run. */
function time(fn, runs = RUNS) {
  fn();
  const xs = [];
  const pauses = [];
  for (let i = 0; i < runs; i++) {
    gc();
    gcPause();
    const t = performance.now();
    fn();
    xs.push(performance.now() - t);
    pauses.push(gcPause());
  }
  lastGc = median(pauses);
  return median(xs);
}

// ---- The arena ---------------------------------------------------------------------------------------------
// head = kind (bits 0-15) | field (16-23) | flags (24-30); bit 31 stays clear so a head is a small integer.
const F_NAMED = 1 << 24;
const F_MISSING = 2 << 24;
const F_INNER = 4 << 24; // [.., count, c1..cn] follows
const F_FIXED = 8 << 24; // a token whose text is its kind's name: end = start + name length

// Record layouts. `wide` stores everything today's SyntaxNode carries except the derived height/size and the
// label: [head, start, end, parent, ord] for a token, [head, start, end, parent, ord, count, c1..cn] for an
// inner node. `lean` stores only what cannot be derived: [head, ord, start] for a fixed-text token,
// [head, ord, start, end] for a variable one, [head, ord, count, c1..cn] for an inner node, whose start/end
// come from its first/last leaf; parents go to a column by ordinal. `none` writes nothing (the traversal alone).

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

const nameLengths = new WeakMap();
function nameLength(lang) {
  let a = nameLengths.get(lang);
  if (a) return a;
  a = new Uint16Array(lang.symbolNames.length);
  for (let s = 0; s < a.length; s++)
    a[s] = L.symbolName(lang, L.publicSymbol(lang, s)).length;
  nameLengths.set(lang, a);
  return a;
}

/**
 * walkTree's traversal (aliases, hidden nodes, inherited fields), appending each visible node when it closes,
 * so an inner node's record is written once with its children's handles: postorder.
 */
function buildArena(lang, root, layout, initialWords) {
  const lens = nameLength(lang);
  let data = new Uint32Array(initialWords);
  let top = 0;
  let ords = new Uint32Array(1024); // ordinal -> handle
  let count = 0;
  const grow = (need) => {
    if (top + need <= data.length) return;
    let n = data.length * 2;
    while (top + need > n) n *= 2;
    const next = new Uint32Array(n);
    next.set(data);
    data = next;
  };
  const addOrd = (h) => {
    if (count === ords.length) {
      const next = new Uint32Array(ords.length * 2);
      next.set(ords);
      ords = next;
    }
    ords[count++] = h;
  };
  const kids = [];
  const writeToken = (head, start, end, symbol) => {
    const h = top;
    if (layout === "none") {
      count++;
      return h;
    }
    if (layout === "wide") {
      grow(5);
      data[h] = head;
      data[h + 1] = start;
      data[h + 2] = end;
      data[h + 4] = count;
      top += 5;
    } else {
      const fixed =
        (head & (F_NAMED | F_MISSING)) === 0 && end - start === lens[symbol];
      grow(4);
      data[h] = fixed ? head | F_FIXED : head;
      data[h + 1] = count;
      data[h + 2] = start;
      if (fixed) top += 3;
      else {
        data[h + 3] = end;
        top += 4;
      }
    }
    addOrd(h);
    return h;
  };
  const writeInner = (head, start, end, from) => {
    const n = kids.length - from;
    if (layout === "none") {
      kids.length = from;
      count++;
      return 0;
    }
    const h = top;
    const base = layout === "wide" ? 6 : 3;
    grow(base + n);
    data[h] = head | F_INNER;
    if (layout === "wide") {
      data[h + 1] = start;
      data[h + 2] = end;
      data[h + 4] = count;
      data[h + 5] = n;
      for (let i = 0; i < n; i++) {
        const c = kids[from + i];
        data[h + 6 + i] = c;
        data[c + 3] = h; // parent, patched now that the parent exists
      }
    } else {
      data[h + 1] = count;
      data[h + 2] = n;
      for (let i = 0; i < n; i++) data[h + 3 + i] = kids[from + i];
    }
    top += base + n;
    kids.length = from;
    addOrd(h);
    return h;
  };

  const headOf = (tree, alias, field) =>
    (alias !== 0 ? alias : tree.symbol) |
    (field << 16) |
    ((
      alias !== 0
        ? L.symbolFlags(lang, alias) & L.FLAG_NAMED
        : S.flag(tree, S.NAMED)
    )
      ? F_NAMED
      : 0) |
    (S.flag(tree, S.IS_MISSING) ? F_MISSING : 0);

  const trees = [root];
  const index = [0];
  const structural = [0];
  const position = [root.padding];
  const openHead = [headOf(root, 0, 0)];
  const openStart = [root.padding];
  const openEnd = [root.padding + root.size];
  const hiddenField = [-1];
  const kidsFrom = [0];
  let depth = 1;
  while (depth > 0) {
    const d = depth - 1;
    const tree = trees[d];
    const children = tree.children;
    const i = index[d];
    if (i === children.length) {
      depth = d;
      if (hiddenField[d] === -1)
        kids.push(
          writeInner(openHead[d], openStart[d], openEnd[d], kidsFrom[d]),
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
      const head = headOf(child, alias, field);
      if (hasChildren) {
        trees[depth] = child;
        index[depth] = 0;
        structural[depth] = 0;
        position[depth] = start;
        openHead[depth] = head;
        openStart[depth] = start;
        openEnd[depth] = start + child.size;
        hiddenField[depth] = -1;
        kidsFrom[depth] = kids.length;
        depth++;
      } else
        kids.push(
          writeToken(
            head,
            start,
            start + child.size,
            alias !== 0 ? alias : child.symbol,
          ),
        );
    } else if (hasChildren) {
      trees[depth] = child;
      index[depth] = 0;
      structural[depth] = 0;
      position[depth] = start;
      hiddenField[depth] = field;
      depth++;
    }
  }
  let parents;
  if (layout === "lean") {
    // Parent column by ordinal, filled in one pass over the inner records.
    parents = new Uint32Array(count);
    for (let o = 0; o < count; o++) {
      const h = ords[o];
      if ((data[h] & F_INNER) === 0) continue;
      const n = data[h + 2];
      for (let i = 0; i < n; i++) parents[data[data[h + 3 + i] + 1]] = h;
    }
  }
  return { data, words: top, ords, count, root: kids[0], parents, layout };
}

// ---- Accessors: what the function API compiles to --------------------------------------------------------
function makeAccess(t, lang) {
  const { data } = t;
  if (t.layout === "wide")
    return {
      start: (h) => data[h + 1],
      end: (h) => data[h + 2],
      count: (h) => ((data[h] & F_INNER) === 0 ? 0 : data[h + 5]),
      child: (h, i) => data[h + 6 + i],
      parent: (h) => (h === t.root ? -1 : data[h + 3]),
    };
  const nl = nameLength(lang);
  return {
    start: (h) => {
      while ((data[h] & F_INNER) !== 0) h = data[h + 3];
      return data[h + 2];
    },
    end: (h) => {
      while ((data[h] & F_INNER) !== 0) h = data[h + 2 + data[h + 2]];
      const head = data[h];
      return (head & F_FIXED) !== 0
        ? data[h + 2] + nl[head & 0xffff]
        : data[h + 3];
    },
    count: (h) => ((data[h] & F_INNER) === 0 ? 0 : data[h + 2]),
    child: (h, i) => data[h + 3 + i],
    parent: (h) => (h === t.root ? -1 : t.parents[data[h + 1]]),
  };
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
function walkArena(t, a) {
  const { data } = t;
  let acc = 0;
  const stack = [t.root];
  while (stack.length > 0) {
    const h = stack.pop();
    acc += (data[h] & 0xffff) + a.start(h) + a.end(h);
    const n = a.count(h);
    for (let i = n - 1; i >= 0; i--) stack.push(a.child(h, i));
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
function parentsArena(t, a) {
  let acc = 0;
  for (let o = 0; o < t.count; o += 7)
    for (let p = a.parent(t.ords[o]); p !== -1; p = a.parent(p)) acc++;
  return acc;
}

function gcCost() {
  gc();
  gc();
  const xs = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    gc();
    xs.push(performance.now() - t);
  }
  return median(xs);
}
function heap() {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

// ---- Run: one process per (input, variant), so no variant inherits another's type feedback or garbage ----
const VARIANTS = ["walk only", "objects (today)", "arena wide", "arena lean"];
const cases = [
  ["big.json", "json"],
  ["package-lock.json", "json"],
  ["scanner.ts", "typescript"],
  ["checker.ts", "typescript"],
];

function measure(file, grammar, variant) {
  const lang = grammars[grammar];
  const text = readFileSync(new URL(file, inputs), "utf8");
  let root = parseSubtree(lang, text);
  const r = { variant };
  // Builds are timed first; the GC is then timed with the parser's Subtree dropped, so a full GC marks only
  // the tree under test (and the loaded modules, which the `walk only` process measures alone).
  if (variant === "walk only") {
    // The traversal every builder shares, creating nothing: what materialization adds is the rest.
    r.build = time(() => buildArena(lang, root, "none", 1024).count);
    r.buildGc = lastGc;
    r.parse = time(() => parseSubtree(lang, text).size, 5);
    r.parseGc = lastGc;
    root = undefined;
    r.gc = gcCost();
    return r;
  }
  if (variant === "objects (today)") {
    r.build = time(() => walkTree(lang, root, text).nodes.length);
    r.buildGc = lastGc;
    const h0 = heap();
    const tree = walkTree(lang, root, text);
    r.nodes = tree.nodes.length;
    r.bytes = (heap() - h0) / r.nodes;
    root = undefined;
    r.gc = gcCost();
    r.walk = time(() => walkObjects(tree.nodes[0]));
    r.parents = time(() => parentsObjects(tree.nodes));
    return r;
  }
  const layout = variant.split(" ")[1];
  r.build = time(() => buildArena(lang, root, layout, 1024).count);
  r.buildGc = lastGc;
  r.presized = time(() => buildArena(lang, root, layout, text.length).count);
  const t = buildArena(lang, root, layout, 1024);
  r.nodes = t.count;
  r.words = t.words / t.count;
  // What the tree keeps: the used words, the ordinal table and the parent column. The slack doubling leaves is
  // not counted; one copy at the end of the build trims it.
  r.bytes =
    (t.words * 4 + t.count * 4 + (t.parents ? t.count * 4 : 0)) / t.count;
  root = undefined;
  r.gc = gcCost();
  const a = makeAccess(t, lang);
  r.walk = time(() => walkArena(t, a));
  r.parents = time(() => parentsArena(t, a));
  return r;
}

if (process.argv[2]) {
  const [file, grammar, variant] = process.argv.slice(2);
  console.log(JSON.stringify(measure(file, grammar, variant)));
} else {
  const self = fileURLToPath(import.meta.url);
  const f = (x, d = 1) => (x === undefined ? "" : x.toFixed(d));
  console.log(
    `node ${process.version}; build and walks: median of ${RUNS} runs after 1 warm-up, each from a collected heap, in the median of 3 processes; GC in build: collections during one build; full GC: median of 5 forced full GCs with only the tree alive, less the same with nothing alive`,
  );
  for (const [file, grammar] of cases) {
    // Three processes per variant; the one with the median build time is reported.
    const rs = VARIANTS.map((v) => {
      const runs = [0, 1, 2].map(() =>
        JSON.parse(
          execFileSync(
            process.execPath,
            ["--expose-gc", self, file, grammar, v],
            { encoding: "utf8", maxBuffer: 1 << 24 },
          ),
        ),
      );
      return runs.sort((p, q) => p.build - q.build)[1];
    });
    const [base, objects] = rs;
    console.log(
      `\n${file} (${grammar}, ${objects.nodes} nodes; parseSubtree takes ${f(base.parse)} ms, ${f(base.parseGc)} of it GC; the shared traversal of its result ${f(base.build)} ms)\n\n` +
        "| tree | build ms | GC in build ms | build less traversal ms | presized build ms | bytes/node | words/node | full GC ms | preorder walk ms | parent chains ms |\n" +
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const r of rs.slice(1)) {
      if (r.nodes !== objects.nodes)
        throw new Error(`${r.variant} has ${r.nodes} nodes, objects ${objects.nodes}`);
      console.log(
        `| ${r.variant} | ${f(r.build)} | ${f(r.buildGc)} | ${f(r.build - base.build)} | ${f(r.presized)} | ${f(r.bytes, 0)} | ${f(r.words, 2)} | ${f(r.gc - base.gc)} | ${f(r.walk)} | ${f(r.parents)} |`,
      );
    }
  }
}
