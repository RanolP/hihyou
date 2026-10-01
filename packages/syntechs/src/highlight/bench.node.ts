// The syntechs TypeScript highlighter against shiki (oniguruma and its JavaScript regex engine), both ending
// in a colour per token under github-dark. Ours is timed twice: highlight-only on an already-parsed tree, and
// parse + highlight. Usage: node packages/syntechs/dist/highlight/bench.node.js [--runs N]
// Inputs come from the vite clone at .eval/vite: a large file, a medium file and all of packages/vite/src.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { bundledThemes, createHighlighter, type HighlighterGeneric } from "shiki";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { repoRoot } from "../core/corpus.node.js";
import { parseTree, type Tree } from "../core/index.js";
import { language } from "../grammars/typescript/index.js";
import { highlight } from "../grammars/typescript/highlight.js";
import { type CompiledTheme, compileTheme, scopeRuns, type Theme } from "./index.js";

const RUNS = Number(process.argv[process.argv.indexOf("--runs") + 1] || 7);
const WARMUP = 2;
const COLD_RUNS = 5;
const VITE = join(repoRoot, ".eval/vite");
const LARGE = "packages/vite/src/node/plugins/css.ts";
const MEDIUM = "packages/vite/src/node/plugins/asset.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;

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

function inputs(): { name: string; texts: string[] }[] {
  const read = (p: string) => readFileSync(join(VITE, p), "utf8");
  const set = execFileSync("git", ["-C", VITE, "ls-files", "-z", "--", "packages/vite/src/*.ts"], { encoding: "utf8" })
    .split("\0")
    .filter((n) => n !== "")
    .flatMap((n) => {
      try {
        return [read(n)];
      } catch {
        return [];
      }
    });
  return [
    { name: LARGE.split("/").at(-1) as string, texts: [read(LARGE)] },
    { name: MEDIUM.split("/").at(-1) as string, texts: [read(MEDIUM)] },
    { name: `packages/vite/src (${set.length} files)`, texts: set },
  ];
}

type Engine = "oniguruma" | "js";

async function shiki(engine: Engine): Promise<HighlighterGeneric<never, never>> {
  return (await createHighlighter({
    themes: ["github-dark"],
    langs: ["typescript"],
    engine: engine === "js" ? createJavaScriptRegexEngine() : createOnigurumaEngine(import("shiki/wasm")),
  })) as unknown as HighlighterGeneric<never, never>;
}

const shikiColours = (h: HighlighterGeneric<never, never>, text: string) =>
  h.codeToTokens(text, { lang: "typescript" as never, theme: "github-dark" as never });

/** Our end product, comparable to shiki's tokens: runs with a resolved colour each. */
function ourColours(tree: Tree, length: number, theme: CompiledTheme): (string | undefined)[] {
  const { stacks, runs } = scopeRuns(tree, highlight, length);
  const colours = new Array<string | undefined>(runs.length / 3);
  for (let r = 0; r < runs.length; r += 3) colours[r / 3] = theme.style(stacks[runs[r + 2] as number] as string).foreground;
  return colours;
}

async function loadTheme(): Promise<CompiledTheme> {
  return compileTheme((await bundledThemes["github-dark"]()).default as Theme);
}

/** One fresh process: import, set up, colour the medium file once. Prints ms. */
async function coldChild(who: string): Promise<void> {
  const text = readFileSync(join(VITE, MEDIUM), "utf8");
  const t0 = performance.now();
  if (who === "ours") {
    const theme = await loadTheme();
    ourColours(parseTree(language, text), text.length, theme);
  } else shikiColours(await shiki(who as Engine), text);
  process.stdout.write(String(performance.now() - t0));
}

function cold(who: string): number {
  const self = fileURLToPath(import.meta.url);
  const samples: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++)
    samples.push(Number(execFileSync(process.execPath, [self, "--cold", who], { encoding: "utf8" })));
  return median(samples);
}

async function main(): Promise<void> {
  const coldAt = process.argv.indexOf("--cold");
  if (coldAt >= 0) return coldChild(process.argv[coldAt + 1] as string);

  const onig = await shiki("oniguruma");
  const js = await shiki("js");
  const theme = await loadTheme();
  console.log(`warm: median of ${RUNS} after ${WARMUP} warm-up runs, ms; every column ends in a colour per token`);
  console.log("input\tKB\tshiki-oniguruma\tshiki-js\tours highlight-only\tours parse+highlight\tspeedup (parse+highlight vs faster shiki)");
  for (const { name, texts } of inputs()) {
    const kb = texts.reduce((a, t) => a + t.length, 0) / 1024;
    const trees = texts.map((t) => parseTree(language, t));
    const o = time(() => texts.forEach((t) => shikiColours(onig, t)));
    const j = time(() => texts.forEach((t) => shikiColours(js, t)));
    const h = time(() => trees.forEach((tree, i) => ourColours(tree, (texts[i] as string).length, theme)));
    const ph = time(() => texts.forEach((t) => ourColours(parseTree(language, t), t.length, theme)));
    console.log(
      `${name}\t${kb.toFixed(0)}\t${o.toFixed(1)}\t${j.toFixed(1)}\t${h.toFixed(1)}\t${ph.toFixed(1)}\t${(Math.min(o, j) / ph).toFixed(1)}x (highlight-only ${(Math.min(o, j) / h).toFixed(1)}x)`,
    );
  }
  console.log(`\ncold: fresh process, import + set up + colour ${MEDIUM.split("/").at(-1)} once, median of ${COLD_RUNS}, ms`);
  for (const who of ["oniguruma", "js", "ours"]) console.log(`${who === "ours" ? "ours" : `shiki-${who}`}\t${cold(who).toFixed(1)}`);
}

await main();
