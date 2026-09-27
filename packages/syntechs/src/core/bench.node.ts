// This runtime (parse + the arena Tree) against the tree-sitter 0.27 CLI's own parse time (the parity reference).
// Usage: node packages/syntechs/dist/core/bench.node.js [grammar...]    (warm parse, cold start, min+gzip size)

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import {
  benchFiles,
  GRAMMAR_NAMES,
  type GrammarName,
  loadGenerated,
  pkgRoot,
  referenceMissing,
  referenceParseMs,
} from "./corpus.node.js";
import { parseTree } from "./index.js";

const RUNS = 15;
const WARMUP = 3;

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;

function time(fn: () => unknown): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

async function warm(grammar: GrammarName): Promise<void> {
  const lang = await loadGenerated(grammar);
  // The CLI times its own parse alone (no spawn, no tree walk), so its column is a floor, not a like-for-like.
  const missing = referenceMissing();
  if (missing) console.log(`(no cli column: ${missing})`);
  console.log(
    `\n${grammar}: parse + materialise, median of ${RUNS} after ${WARMUP} warm-up runs`,
  );
  console.log("input\tKB\tnodes\tours ms\tnative ms\tours/native");
  for (const input of benchFiles(grammar)) {
    const nodes = parseTree(lang, input.text).nodeCount;
    const ours = time(() => parseTree(lang, input.text));
    const theirs = missing
      ? Number.NaN
      : referenceParseMs(grammar, input.text, WARMUP, RUNS);
    const name = input.name.split(/[\\/]/).at(-1);
    console.log(
      `${name}\t${(input.text.length / 1024).toFixed(0)}\t${nodes}\t${ours.toFixed(1)}\t${theirs.toFixed(1)}\t${(ours / theirs).toFixed(2)}x`,
    );
  }
}

const TINY: Record<GrammarName, string> = {
  json: '{"a":[1,2]}',
  css: "a { color: red; }",
  javascript: "let a = 1;",
  typescript: "let a: number = 1;",
  tsx: "const a = <div>{b}</div>;",
  python: "x = 1\n",
};

/** One fresh process: import, load the grammar, parse a tiny input. Prints ms. */
async function coldChild(grammar: GrammarName): Promise<void> {
  const t0 = performance.now();
  const { parseTree } = await import("./index.js");
  const lang = await loadGenerated(grammar);
  parseTree(lang, TINY[grammar]);
  process.stdout.write(String(performance.now() - t0));
}

function cold(grammar: GrammarName): void {
  const self = fileURLToPath(import.meta.url);
  const sample = () =>
    median(
      Array.from({ length: 7 }, () =>
        Number(
          execFileSync(process.execPath, [self, "--cold", grammar], {
            encoding: "utf8",
          }),
        ),
      ),
    );
  console.log(
    `cold start (import + load + tiny parse, median of 7 fresh processes): ours ${sample().toFixed(1)} ms`,
  );
}

async function minGzip(entry: string): Promise<{ min: number; gz: number }> {
  const r = await build({
    stdin: { contents: entry, resolveDir: join(pkgRoot, "src"), loader: "ts" },
    bundle: true,
    minify: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const code = (r.outputFiles[0] as { contents: Uint8Array }).contents;
  return { min: code.length, gz: gzipSync(code, { level: 9 }).length };
}

async function size(grammar: GrammarName): Promise<void> {
  const ours = await minGzip(
    `export { parse } from "./core/index.ts"; export { language } from "./grammars/${grammar}/index.ts";`,
  );
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`size: ours ${kb(ours.min)} min, ${kb(ours.gz)} gz`);
}

if (process.argv[2] === "--cold")
  await coldChild(process.argv[3] as GrammarName);
else {
  const names = process.argv.slice(2);
  for (const grammar of (names.length > 0
    ? names
    : GRAMMAR_NAMES) as GrammarName[]) {
    await warm(grammar);
    cold(grammar);
    await size(grammar);
  }
}
