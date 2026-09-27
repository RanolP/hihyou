// Where formatter time goes, per language: a measurement tool, never on a production path.
//
//   node packages/syntechs/dist/fmt/phases.node.js cold <lang>
//     The bench's folder-level run (cli.node.js over the corpus files) split into phases: node bootstrap, module
//     import, grammar bundle eval, table decode, first file parse/format, remaining files parse/format, IO. Also
//     the reference tool (oxfmt, or ruff for python) on the same folder, and `node -e 0`.
//   node [--cpu-prof --cpu-prof-dir=<dir>] packages/syntechs/dist/fmt/phases.node.js warm <lang> [passes]
//     The largest corpus input, warm: parse and format medians, and GC time inside each phase.
//   node packages/syntechs/dist/fmt/phases.node.js analyze <file.cpuprofile>
//     A --cpu-prof of `warm` split into parse / comment attachment / Doc build / printer / GC, plus the top-10
//     self-time functions under `format`.
//
// <lang> is a bench group: json, css, js, ts, python. `cold-child <dir>` is the instrumented child `cold` spawns;
// its only static imports are node builtins, so its import phase times exactly what cli.node.js loads.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const entryMs = performance.now();

type GrammarName = "json" | "css" | "javascript" | "typescript" | "tsx" | "python";

const GROUPS: Record<string, { grammars: GrammarName[]; largest: string }> = {
  json: { grammars: ["json"], largest: "big.json" },
  css: { grammars: ["css"], largest: "bootstrap.css" },
  js: { grammars: ["javascript"], largest: "lodash.js" },
  ts: { grammars: ["typescript", "tsx"], largest: "checker.ts" },
  // typing.py is larger, but format refuses it at cb27b44 (unsupported expression: union_type).
  python: { grammars: ["python"], largest: "argparse.py" },
};

// cli.node.js's extension table, restricted to what the bench writes.
const EXT: Record<string, { grammar: GrammarName; fmtDir: string; export: string }> = {
  ".json": { grammar: "json", fmtDir: "json", export: "json" },
  ".css": { grammar: "css", fmtDir: "css", export: "css" },
  ".jsx": { grammar: "javascript", fmtDir: "javascript", export: "javascript" },
  ".ts": { grammar: "typescript", fmtDir: "typescript", export: "typescript" },
  ".tsx": { grammar: "tsx", fmtDir: "typescript", export: "tsx" },
  ".py": { grammar: "python", fmtDir: "python", export: "python" },
};
const FMT_GRAMMARS: Record<string, GrammarName[]> = {
  json: ["json"],
  css: ["css"],
  javascript: ["javascript"],
  typescript: ["javascript", "typescript", "tsx"],
  python: ["python"],
};
// The bench's oxfmtExt: JS is written as .jsx.
const extOf = (g: GrammarName) =>
  ({ json: "json", css: "css", javascript: "jsx", typescript: "ts", tsx: "tsx", python: "py" })[g];

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const here = (rel: string) => new URL(rel, import.meta.url).href;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;
const ms = (x: number) => x.toFixed(1);

type Tree = unknown;
type ParseTree = (grammar: unknown, text: string) => Tree;
type Format = (tree: Tree, lang: unknown) => { ok: boolean; text?: string };

/** The instrumented cli.node.js: same imports, same order, same per-file work, with a clock between steps. */
async function coldChild(dir: string) {
  const t: Record<string, number> = { entry: entryMs };
  let at = performance.now();
  const lap = (key: string) => {
    const now = performance.now();
    t[key] = (t[key] ?? 0) + (now - at);
    at = now;
  };
  const { parseTree } = (await import(here("../core/index.js"))) as { parseTree: ParseTree };
  lap("importCore");
  const { format } = (await import(here("./format.js"))) as { format: Format };
  lap("importFormat");
  const jobs: { grammar: unknown; lang: unknown; text: string }[] = [];
  const grammars = new Map<string, unknown>();
  const langs = new Map<string, unknown>();
  let first = true;
  for (const name of readdirSync(dir)) {
    const spec = EXT[extname(name)];
    if (!spec) continue;
    at = performance.now();
    // A fmt module imports every grammar it formats (typescript/fmt.js pulls in javascript and tsx too), so
    // those load here first, to charge their bundle eval and table decode to those rows rather than to importFmt.
    for (const g of FMT_GRAMMARS[spec.fmtDir] as GrammarName[]) {
      if (grammars.has(g)) continue;
      await import(here(`../grammars/${g}/bundle.js`));
      lap("importBundle");
      grammars.set(
        g,
        ((await import(here(`../grammars/${g}/index.js`))) as { language: unknown }).language,
      );
      const before = t.decodeTables ?? 0;
      lap("decodeTables");
      t[`decode ${g}`] = (t.decodeTables ?? 0) - before;
    }
    const langKey = `${spec.fmtDir}#${spec.export}`;
    if (!langs.has(langKey)) {
      langs.set(
        langKey,
        ((await import(here(`../grammars/${spec.fmtDir}/fmt.js`))) as Record<string, unknown>)[
          spec.export
        ],
      );
      lap("importFmt");
    }
    const suffix = first ? "First" : "Rest";
    const path = join(dir, name);
    const text = readFileSync(path, "utf8");
    lap("io");
    const tree = parseTree(grammars.get(spec.grammar), text);
    lap(`parse${suffix}`);
    const out = format(tree, langs.get(langKey));
    lap(`format${suffix}`);
    if (out.ok) writeFileSync(path, out.text as string);
    lap("io");
    first = false;
    jobs.push({ grammar: grammars.get(spec.grammar), lang: langs.get(langKey), text });
  }
  t.end = performance.now();
  // `--warm`: the same parse + format work again, 5 times in the now-warm process, to separate cold JIT from
  // steady-state cost. It runs after `end`, in a spawn of its own, so it never inflates the timed wall.
  if (process.argv.includes("--warm")) {
    const p: number[] = [];
    const f: number[] = [];
    for (let i = 0; i < 5; i++) {
      let parse = 0;
      let fmt = 0;
      for (const j of jobs) {
        const t0 = performance.now();
        const tree = parseTree(j.grammar, j.text);
        const t1 = performance.now();
        format(tree, j.lang);
        fmt += performance.now() - t1;
        parse += t1 - t0;
      }
      p.push(parse);
      f.push(fmt);
    }
    t.warmParse = median(p);
    t.warmFormat = median(f);
  }
  process.stdout.write(JSON.stringify(t));
}

const require = createRequire(import.meta.url);
function resolveBin(pkg: string): string {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  return join(dirname(pkgJsonPath), typeof bin === "string" ? bin : (bin[pkg] as string));
}

function wall(
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): { ms: number; stdout: string } {
  const t = performance.now();
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const elapsed = performance.now() - t;
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}: ${r.stderr.slice(0, 500)}`);
  return { ms: elapsed, stdout: r.stdout };
}

async function inputs(lang: string, filtered = true) {
  const group = GROUPS[lang];
  if (!group) throw new Error(`unknown language ${lang}; one of ${Object.keys(GROUPS).join(", ")}`);
  const { benchFiles } = (await import(here("../core/corpus.node.js"))) as {
    benchFiles: (g: GrammarName) => { name: string; text: string }[];
  };
  const all = group.grammars.flatMap((grammar) =>
    benchFiles(grammar).map((f) => ({ ...f, grammar })),
  );
  if (lang === "python" || !filtered) return all;
  // The bench's filter: only inputs both prettier and oxfmt accept, so every tool formats the same bytes.
  const prettier = (await import("prettier")) as {
    format: (t: string, o: object) => Promise<string>;
  };
  const { oxfmt } = (await import(here("./conformance/references.node.js"))) as {
    oxfmt: { format: (name: string, t: string, o: object) => Promise<unknown> };
  };
  const kept: typeof all = [];
  for (const f of all) {
    try {
      await prettier.format(f.text, {
        parser: lang === "js" ? "babel" : lang === "ts" ? "typescript" : lang,
      });
      await oxfmt.format(`input.${extOf(f.grammar)}`, f.text, { printWidth: 80 });
      kept.push(f);
    } catch {}
  }
  return kept;
}

/** Median of 3 after 1 warmup (OS file cache), restoring the unformatted files before every run, as the bench does. */
async function cold(lang: string) {
  const files = await inputs(lang);
  const root = mkdtempSync(join(tmpdir(), "syntechs-phases-"));
  const dir = join(root, "inputs");
  mkdirSync(dir);
  const written = files.map((f, i) => ({
    path: join(dir, `${i}.${extOf(f.grammar)}`),
    text: f.text,
  }));
  const restore = () => {
    for (const f of written) writeFileSync(f.path, f.text);
  };
  const cfgRoot = mkdtempSync(join(tmpdir(), "syntechs-phases-cfg-"));
  const oxfmtConfig = join(cfgRoot, ".oxfmtrc.json");
  writeFileSync(oxfmtConfig, JSON.stringify({ printWidth: 80 }));
  const self = fileURLToPath(import.meta.url);
  const runs = (run: () => { ms: number; stdout: string }) => {
    restore();
    run();
    const out = [0, 1, 2].map(() => {
      restore();
      return run();
    });
    return out.sort((a, b) => a.ms - b.ms)[1] as { ms: number; stdout: string };
  };
  try {
    const nodeEmpty = runs(() => wall(process.execPath, ["-e", "0"])).ms;
    const ours = runs(() => wall(process.execPath, [self, "cold-child", dir]));
    const reference =
      lang === "python"
        ? runs(() =>
            wall(
              execFileSync("mise", ["which", "ruff"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
              ["format", "--isolated", "--no-cache", dir],
              { RAYON_NUM_THREADS: "1" },
            ),
          ).ms
        : runs(() =>
            wall(process.execPath, [
              resolveBin("oxfmt"),
              "--write",
              "--disable-nested-config",
              "-c",
              oxfmtConfig,
              "--threads=1",
              dir,
            ]),
          ).ms;
    const t = JSON.parse(ours.stdout) as Record<string, number>;
    restore();
    const warmRun = JSON.parse(
      wall(process.execPath, [self, "cold-child", dir, "--warm"]).stdout,
    ) as Record<string, number>;
    const total = ours.ms;
    const rows: [string, number][] = [
      ["node bootstrap to script entry (in-process clock)", t.entry ?? 0],
      ["import core/index (parser)", t.importCore ?? 0],
      ["import fmt/format (formatter core)", t.importFormat ?? 0],
      ["grammar bundle eval (bundle.js)", t.importBundle ?? 0],
      ["table decode (index.js: loadLanguage)", t.decodeTables ?? 0],
      ["fmt module import (grammars/*/fmt.js)", t.importFmt ?? 0],
      [`first file parse (${files[0]?.name})`, t.parseFirst ?? 0],
      ["first file format", t.formatFirst ?? 0],
      [`remaining ${files.length - 1} files parse`, t.parseRest ?? 0],
      [`remaining ${files.length - 1} files format`, t.formatRest ?? 0],
      ["IO (read + write)", t.io ?? 0],
      ["process spawn + teardown (wall - in-process end)", total - (t.end ?? 0)],
    ];
    rows.push(["unaccounted (dir listing, loop)", total - rows.reduce((n, [, v]) => n + v, 0)]);
    const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.text), 0);
    console.log(
      `## ${lang}: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB (${files.map((f) => f.name.split("/").pop()).join(", ")})\n`,
    );
    console.log("| Phase | ms | % of total |\n| :-- | --: | --: |");
    for (const [label, v] of rows)
      console.log(`| ${label} | ${ms(v)} | ${((100 * v) / total).toFixed(1)} |`);
    console.log(`| **syntechs total (wall)** | **${ms(total)}** | 100 |`);
    console.log(
      `| reference: ${lang === "python" ? "ruff" : "oxfmt"} total (wall) | ${ms(reference)} | ${((100 * reference) / total).toFixed(1)} |`,
    );
    console.log(
      `| reference: \`node -e 0\` (wall) | ${ms(nodeEmpty)} | ${((100 * nodeEmpty) / total).toFixed(1)} |`,
    );
    console.log(
      `\ntable decode per grammar: ${Object.entries(t)
        .filter(([k]) => k.startsWith("decode "))
        .map(([k, v]) => `${k.slice(7)} ${ms(v)} ms`)
        .join(", ")}`,
    );
    const coldParse = (t.parseFirst ?? 0) + (t.parseRest ?? 0);
    const coldFormat = (t.formatFirst ?? 0) + (t.formatRest ?? 0);
    console.log(
      `all files, cold (this run) vs warm (same process, median of 5 repeats): parse ${ms(coldParse)} vs ${ms(warmRun.warmParse ?? 0)} ms, ` +
        `format ${ms(coldFormat)} vs ${ms(warmRun.warmFormat ?? 0)} ms; cold-JIT excess ${ms(coldParse + coldFormat - (warmRun.warmParse ?? 0) - (warmRun.warmFormat ?? 0))} ms`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cfgRoot, { recursive: true, force: true });
  }
}

/** The largest input, parsed and formatted `passes` times after 3 warmups; GC entries are charged to the phase they fall in. */
async function warm(lang: string, passes: number) {
  const group = GROUPS[lang] as { grammars: GrammarName[]; largest: string };
  const input = (await inputs(lang, false)).find((f) => f.name.endsWith(group.largest));
  if (!input) throw new Error(`${group.largest} missing`);
  const spec = Object.values(EXT).find((s) => s.grammar === input.grammar) as (typeof EXT)[string];
  const { parseTree } = (await import(here("../core/index.js"))) as { parseTree: ParseTree };
  const { format } = (await import(here("./format.js"))) as { format: Format };
  const grammar = (
    (await import(here(`../grammars/${spec.grammar}/index.js`))) as { language: unknown }
  ).language;
  const fmt = (
    (await import(here(`../grammars/${spec.fmtDir}/fmt.js`))) as Record<string, unknown>
  )[spec.export];
  // SYNTECHS_STREAM=1 times the JSON stream prototype (fmt/stream.ts) in place of the Doc path.
  let run: (tree: unknown) => { ok: boolean } = (tree) => format(tree, fmt);
  if (process.env.SYNTECHS_STREAM === "1") {
    const { formatStream } = (await import(here("./stream-format.js"))) as {
      formatStream: (tree: unknown, language: unknown) => { ok: boolean };
    };
    const { streamFor } = (await import(here("../grammars/json/fmt.js"))) as {
      streamFor: (language: unknown) => unknown;
    };
    const stream = streamFor(fmt);
    run = (tree) => formatStream(tree, stream);
  }

  const gcs: { start: number; duration: number }[] = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) gcs.push({ start: e.startTime, duration: e.duration });
  });
  obs.observe({ entryTypes: ["gc"] });
  const windows: { phase: "parse" | "format"; from: number; to: number }[] = [];
  const pass = () => {
    const t0 = performance.now();
    const tree = parseTree(grammar, input.text);
    const t1 = performance.now();
    const out = run(tree);
    const t2 = performance.now();
    if (!out.ok) throw new Error(`${input.name}: format failed`);
    windows.push({ phase: "parse", from: t0, to: t1 }, { phase: "format", from: t1, to: t2 });
    return { parse: t1 - t0, format: t2 - t1 };
  };
  for (let i = 0; i < 3; i++) pass();
  windows.length = 0;
  const samples = Array.from({ length: passes }, pass);
  await new Promise((r) => setTimeout(r, 50)); // flush the observer
  obs.disconnect();
  const gcIn = { parse: 0, format: 0 };
  for (const g of gcs) {
    const w = windows.find((w) => g.start >= w.from && g.start < w.to);
    if (w) gcIn[w.phase] += g.duration;
  }
  const p = median(samples.map((s) => s.parse));
  const f = median(samples.map((s) => s.format));
  const sum = (k: "parse" | "format") => samples.reduce((n, s) => n + s[k], 0);
  console.log(
    `${lang} warm ${input.name} (${(Buffer.byteLength(input.text) / 1024).toFixed(0)} KB), median of ${passes} passes: ` +
      `parse ${ms(p)} ms (${((100 * p) / (p + f)).toFixed(0)}%), format ${ms(f)} ms (${((100 * f) / (p + f)).toFixed(0)}%); ` +
      `GC share of phase time: parse ${((100 * gcIn.parse) / sum("parse")).toFixed(1)}%, format ${((100 * gcIn.format) / sum("format")).toFixed(1)}%`,
  );
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}

/**
 * Buckets each sample by the outermost frame on its stack that names a phase. The format sub-phases are the
 * generic pipeline's (fmt/comments.js attachComments, fmt/printer.js print) plus Python's own passes, which
 * run inside its single `module` rule (python/fmt/ast.js toAst, python/fmt/comments.js attach); whatever else
 * runs under fmt/format.js `format` is Doc building by the rules.
 */
function analyze(file: string) {
  const prof = JSON.parse(readFileSync(file, "utf8")) as {
    nodes: ProfileNode[];
    samples: number[];
    timeDeltas: number[];
  };
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const is = (n: ProfileNode, url: string, fn: string) =>
    n.callFrame.functionName === fn && n.callFrame.url.replace(/\\/g, "/").endsWith(url);
  const phaseOf = (n: ProfileNode): string | undefined => {
    if (n.callFrame.functionName === "(garbage collector)") return "GC";
    if (is(n, "core/parser.js", "parseSubtree") || is(n, "core/tree.js", "buildTree"))
      return "parse";
    if (is(n, "fmt/comments.js", "attachComments") || is(n, "python/fmt/comments.js", "attach"))
      return "format: comment attachment";
    if (is(n, "python/fmt/ast.js", "toAst")) return "format: python AST lowering (toAst)";
    if (is(n, "fmt/printer.js", "print") || is(n, "fmt/stream.js", "printStream"))
      return "format: printer";
    if (is(n, "fmt/format.js", "format") || is(n, "fmt/stream-format.js", "formatStream"))
      return "format: Doc build (rules)";
    return undefined;
  };
  // Stack for a node, root first.
  const stack = (id: number) => {
    const out: ProfileNode[] = [];
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at))
      out.push(byId.get(at) as ProfileNode);
    return out.reverse();
  };
  const cache = new Map<number, { phase: string; underFormat: boolean }>();
  const classify = (id: number) => {
    let c = cache.get(id);
    if (c) return c;
    const frames = stack(id);
    let phase = "other (setup, idle, program)";
    let formatSeen = false;
    for (const f of frames) {
      const p = phaseOf(f);
      if (!p) continue;
      if (p === "format: Doc build (rules)") {
        formatSeen = true;
        phase = p;
        continue;
      }
      phase = p;
      break;
    }
    c = { phase, underFormat: formatSeen };
    cache.set(id, c);
    return c;
  };
  const phaseMs = new Map<string, number>();
  const selfMs = new Map<string, number>();
  let total = 0;
  let formatTotal = 0;
  for (let i = 0; i < prof.samples.length; i++) {
    const id = prof.samples[i] as number;
    const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000;
    const { phase, underFormat } = classify(id);
    total += dt;
    phaseMs.set(phase, (phaseMs.get(phase) ?? 0) + dt);
    if (underFormat) {
      formatTotal += dt;
      const f = (byId.get(id) as ProfileNode).callFrame;
      const key = `${f.functionName || "(anonymous)"} ${f.url.replace(/\\/g, "/").split("/dist/").pop()}:${f.lineNumber + 1}`;
      selfMs.set(key, (selfMs.get(key) ?? 0) + dt);
    }
  }
  console.log(
    `profile ${file}: ${ms(total)} ms sampled\n\n| Phase | ms | % |\n| :-- | --: | --: |`,
  );
  for (const [k, v] of [...phaseMs].sort((a, b) => b[1] - a[1]))
    console.log(`| ${k} | ${ms(v)} | ${((100 * v) / total).toFixed(1)} |`);
  console.log(
    `\nTop 10 self time under format (${ms(formatTotal)} ms; GC excluded, it is charged at the root):\n\n| Function | self ms | % of format |\n| :-- | --: | --: |`,
  );
  for (const [k, v] of [...selfMs].sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`| \`${k}\` | ${ms(v)} | ${((100 * v) / formatTotal).toFixed(1)} |`);
}

const [mode, arg, extra] = process.argv.slice(2);
if (mode === "cold-child" && arg) await coldChild(arg);
else if (mode === "cold" && arg) await cold(arg);
else if (mode === "warm" && arg) await warm(arg, Number(extra ?? 10));
else if (mode === "analyze" && arg) analyze(arg);
else throw new Error("usage: phases.node.js cold|warm|analyze|cold-child <lang|file|dir> [passes]");
