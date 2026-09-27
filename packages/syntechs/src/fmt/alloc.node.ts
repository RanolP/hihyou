// Doc size and allocation sites per language: a measurement tool, never on a production path.
//
//   node packages/syntechs/dist/fmt/alloc.node.js size <lang>
//     The largest input (as phases.node.js picks it), formatted once: Doc nodes by kind, the JS arrays and list
//     elements the Doc holds, the side-table entries, tree nodes and leaves, placed tokens, output size.
//   node packages/syntechs/dist/fmt/alloc.node.js heap <lang> [passes] [outDir]
//     The same input warm, under V8's sampling heap profiler with objects collected by GC kept: bytes allocated
//     per pass, parse and format apart, by allocating function and, for format, by phase. Writes the two
//     .heapprofile files to outDir when given.
//
// <lang> is a bench group: json, css, js, ts, python.

import { Session } from "node:inspector/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Tree } from "../core/arena.js";

type GrammarName =
  | "json"
  | "css"
  | "javascript"
  | "typescript"
  | "tsx"
  | "python";
const GROUPS: Record<
  string,
  { grammar: GrammarName; fmtDir: string; largest: string }
> = {
  json: { grammar: "json", fmtDir: "json", largest: "big.json" },
  css: { grammar: "css", fmtDir: "css", largest: "bootstrap.css" },
  js: { grammar: "javascript", fmtDir: "javascript", largest: "lodash.js" },
  ts: { grammar: "typescript", fmtDir: "typescript", largest: "checker.ts" },
  python: { grammar: "python", fmtDir: "python", largest: "argparse.py" },
};
const here = (rel: string) => new URL(rel, import.meta.url).href;

type Format = (
  tree: Tree,
  lang: unknown,
) => { ok: boolean; text?: string; anchors?: unknown[] };

async function load(lang: string) {
  const g = GROUPS[lang];
  if (!g)
    throw new Error(
      `unknown language ${lang}; one of ${Object.keys(GROUPS).join(", ")}`,
    );
  const { benchFiles } = (await import(here("../core/corpus.node.js"))) as {
    benchFiles: (g: GrammarName) => { name: string; text: string }[];
  };
  const input = benchFiles(g.grammar).find((f) => f.name.endsWith(g.largest));
  if (!input) throw new Error(`${g.largest} missing`);
  const { parseTree } = (await import(here("../core/index.js"))) as {
    parseTree: (grammar: unknown, text: string) => Tree;
  };
  const { format } = (await import(here("./format.js"))) as { format: Format };
  const grammar = (
    (await import(here(`../grammars/${g.grammar}/index.js`))) as {
      language: unknown;
    }
  ).language;
  const fmt = (
    (await import(here(`../grammars/${g.fmtDir}/fmt.js`))) as Record<
      string,
      unknown
    >
  )[g.grammar] as { settings: (o: unknown) => object };
  return { input, parse: () => parseTree(grammar, input.text), format, fmt };
}

const KINDS = [
  "token",
  "text",
  "line",
  "group",
  "indent",
  "fill",
  "lineSuffix",
  "breakParent",
  "ifBreak",
  "align",
  "lineSuffixBoundary",
  "bestFitting",
  "bestFitParenthesize",
  "fitsExpanded",
  "groupIfBreak",
];

async function size(lang: string) {
  const { input, parse, format, fmt } = await load(lang);
  const doc = (await import(here("./doc.js"))) as typeof import("./doc.js");
  const tree = parse();
  // `print` reads `layout.ruff` once, right after `docCount()`: the Doc is complete then and not yet released.
  let snap:
    | { docNodes: number; arrays: number; [k: string]: number }
    | undefined;
  const byKind = KINDS.map(() => 0);
  const base = doc.docCount();
  const hooked = {
    ...fmt,
    settings(o: unknown) {
      const s = fmt.settings(o) as { ruff?: boolean };
      return Object.defineProperty({ ...s }, "ruff", {
        get() {
          const top = doc.docCount();
          for (let h = base; h < top; h++)
            byKind[doc.kindCode(h as never)]! += 1;
          // Every JS array the Doc holds: the lists slots point at, and arrays nested inside them.
          const seen = new Set<readonly unknown[]>();
          let elements = 0;
          let arrayRefs = 0;
          const walk = (a: readonly unknown[]) => {
            if (seen.has(a)) return;
            seen.add(a);
            elements += a.length;
            for (const x of a)
              if (typeof x !== "number") {
                arrayRefs++;
                walk(x as readonly unknown[]);
              }
          };
          for (const l of doc.lists) walk(l);
          // What merging adjacent text at build time would remove: in each run of two or more adjacent
          // TEXT items (or, `WithTokens`, TOKEN/TEXT items) in one array, every item past the first. `Flat`
          // also joins runs across nested plain arrays, each array counted once.
          const isText = (x: unknown, tokens: boolean) => {
            if (typeof x !== "number") return false;
            const k = doc.kindCode(x as never);
            return k === doc.TEXT || (tokens && k === doc.TOKEN);
          };
          const removable = (tokens: boolean, flat: boolean) => {
            let removed = 0;
            let run = 0;
            const end = () => {
              if (run > 1) removed += run - 1;
              run = 0;
            };
            const visit = (a: readonly unknown[]) => {
              for (const x of a) {
                if (isText(x, tokens)) run++;
                else if (flat && typeof x !== "number")
                  visit(x as readonly unknown[]);
                else end();
              }
            };
            for (const a of seen) {
              visit(a);
              end();
            }
            return removed;
          };
          snap = {
            removableText: removable(false, false),
            removableTextFlat: removable(false, true),
            removableWithTokens: removable(true, false),
            removableWithTokensFlat: removable(true, true),
            docNodes: top - base,
            listSlots: doc.lists.length,
            arrays: seen.size,
            arrayElements: elements,
            nestedArrayRefs: arrayRefs,
            emptyArrays: [...seen].filter((a) => a.length === 0).length,
            singletonArrays: [...seen].filter((a) => a.length === 1).length,
            strs: doc.strs.length,
            nodes: doc.nodes.length,
          };
          return s.ruff;
        },
      });
    },
  };
  const out = format(tree, hooked);
  if (!out.ok || !snap) throw new Error(`${input.name}: format failed`);
  let leaves = 0;
  for (let o = 0; o < tree.nodeCount; o++)
    if (tree.count(tree.at(o)) === 0) leaves++;
  const text = out.text as string;
  const placed = (out.anchors as unknown[]).length;
  const s = snap;
  const r = (a: number, b: number) => (a / b).toFixed(2);
  console.log(
    JSON.stringify({
      lang,
      input: input.name.split("/").pop(),
      inputBytes: Buffer.byteLength(input.text),
      outputBytes: Buffer.byteLength(text),
      outputChars: text.length,
      treeNodes: tree.nodeCount,
      leaves,
      placedTokens: placed,
      ...s,
      byKind: Object.fromEntries(
        KINDS.map((k, i) => [k, byKind[i]]).filter(([, n]) => n),
      ),
      docPerLeaf: r(s.docNodes, leaves),
      docPerPlaced: r(s.docNodes, placed),
      docPerOutByte: r(s.docNodes, Buffer.byteLength(text)),
      arraysPerPlaced: r(s.arrays, placed),
    }),
  );
}

interface HeapNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: HeapNode[];
}

/** The format sub-phase a stack is in: the innermost phase-naming frame, as phases.node.js `analyze` buckets. */
function phaseOf(f: HeapNode["callFrame"]): string | undefined {
  const url = f.url.replace(/\\/g, "/");
  const is = (u: string, fn: string) =>
    f.functionName === fn && url.endsWith(u);
  if (
    is("fmt/comments.js", "attachComments") ||
    is("python/fmt/comments.js", "attach")
  )
    return "comment attachment";
  if (is("python/fmt/ast.js", "toAst")) return "python toAst";
  if (is("fmt/printer.js", "propagateBreaks"))
    return "printer: propagateBreaks";
  if (is("fmt/printer.js", "fits")) return "printer: fits";
  if (is("fmt/printer.js", "print")) return "printer: print";
  if (is("fmt/format.js", "anchorsOf")) return "anchors";
  return undefined;
}

interface HeapProfile {
  head: HeapNode;
}

// Node's sampled `size` is the allocation step that crossed the interval, not the object's size, so the profile
// gives bytes per site (checked: 1M `{node, text, synthetic}` objects read as 56 MB, 48 B each plus the 8 B array
// slot holding it) but no object counts; those come from `size`'s exact tallies.
const INTERVAL = 256;

function summarize(p: HeapProfile, passes: number, byPhase: boolean) {
  const sites = new Map<string, number>();
  const phases = new Map<string, number>();
  let total = 0;
  const walk = (n: HeapNode, phase: string, caller: string) => {
    const f = n.callFrame;
    const own = byPhase ? phaseOf(f) : undefined;
    // `print` calls `fits`; a frame deeper than a named phase refines it only within the printer.
    const ph =
      own && !(phase.startsWith("printer") && !own.startsWith("printer"))
        ? own
        : phase;
    const src = f.url.replace(/\\/g, "/").split("/dist/").pop() ?? "";
    // A builtin (`push`, `slice`, an iterator's `next`) has no url: its bytes are its caller's allocation.
    const k = src
      ? `${f.functionName || "(anonymous)"} ${src.replace(/\.js$/, ".ts")}:${f.lineNumber + 1}`
      : caller;
    total += n.selfSize;
    sites.set(k, (sites.get(k) ?? 0) + n.selfSize);
    phases.set(ph, (phases.get(ph) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c, ph, k);
  };
  walk(p.head, "Doc build (rules) and other", "(root)");
  const mb = (x: number) => (x / passes / 1048576).toFixed(2);
  console.log(`total ${mb(total)} MB/pass`);
  if (byPhase) {
    console.log("\n| Phase | MB/pass | % |\n| :-- | --: | --: |");
    for (const [k, v] of [...phases].sort((a, b) => b[1] - a[1]))
      console.log(`| ${k} | ${mb(v)} | ${((100 * v) / total).toFixed(1)} |`);
  }
  console.log(
    "\n| Allocating function (dist line = function start) | MB/pass | % |\n| :-- | --: | --: |",
  );
  for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`| \`${k}\` | ${mb(v)} | ${((100 * v) / total).toFixed(1)} |`);
}

async function heap(lang: string, passes: number, outDir?: string) {
  const { input, parse, format, fmt } = await load(lang);
  for (let i = 0; i < 3; i++) format(parse(), fmt);
  const session = new Session();
  session.connect();
  const sample = async (name: string, run: () => void) => {
    await session.post("HeapProfiler.startSampling", {
      samplingInterval: INTERVAL,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    run();
    const { profile } = (await session.post(
      "HeapProfiler.stopSampling",
    )) as unknown as {
      profile: HeapProfile;
    };
    if (outDir)
      writeFileSync(
        join(outDir, `${lang}-${name}.heapprofile`),
        JSON.stringify(profile),
      );
    return profile;
  };
  const trees = Array.from({ length: passes }, parse);
  const parsed = await sample("parse", () => {
    for (let i = 0; i < passes; i++) parse();
  });
  const formatted = await sample("format", () => {
    for (const t of trees) format(t, fmt);
  });
  session.disconnect();
  console.log(
    `## ${lang}: ${input.name.split("/").pop()}, ${passes} passes\n\n### parse`,
  );
  summarize(parsed, passes, false);
  console.log("\n### format");
  summarize(formatted, passes, true);
}

const [mode, arg, extra, outDir] = process.argv.slice(2);
if (mode === "size" && arg) await size(arg);
else if (mode === "heap" && arg) await heap(arg, Number(extra ?? 5), outDir);
else throw new Error("usage: alloc.node.js size|heap <lang> [passes] [outDir]");
