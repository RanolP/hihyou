// Allocation sites per language: a measurement tool, never on a production path.
//
//   node packages/syntechs/dist/fmt/alloc.node.js heap <lang> [passes] [outDir]
//     The largest input (as phases.node.js picks it) warm, under V8's sampling heap profiler with objects collected by GC kept: bytes allocated
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
  if (is("fmt/stream.js", "printStream")) return "printer";
  return undefined;
}

interface HeapProfile {
  head: HeapNode;
}

// Node's sampled `size` is the allocation step that crossed the interval, not the object's size, so the profile
// gives bytes per site (checked: 1M `{node, text, synthetic}` objects read as 56 MB, 48 B each plus the 8 B array
// slot holding it) but no object counts.
const INTERVAL = 256;

function summarize(p: HeapProfile, passes: number, byPhase: boolean) {
  const sites = new Map<string, number>();
  const phases = new Map<string, number>();
  let total = 0;
  const walk = (n: HeapNode, phase: string, caller: string) => {
    const f = n.callFrame;
    const own = byPhase ? phaseOf(f) : undefined;
    // A frame deeper than the printer stays the printer's.
    const ph = own && phase !== "printer" ? own : phase;
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
  walk(p.head, "rules and other", "(root)");
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
if (mode === "heap" && arg) await heap(arg, Number(extra ?? 5), outDir);
else throw new Error("usage: alloc.node.js heap <lang> [passes] [outDir]");
