// The inputs parity and benchmarks run on, per grammar, and the web-tree-sitter reference they compare to.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  Language as WasmLanguage,
  Parser as WasmParser,
} from "web-tree-sitter";
import type { Language } from "./language.js";

const require = createRequire(import.meta.url);
export const pkgRoot = resolve(import.meta.dirname, "..");
export const repoRoot = resolve(pkgRoot, "../..");
const benchInputs = join(repoRoot, "research/parser-bench/inputs");
const corpusDir = join(pkgRoot, "corpus");

export const GRAMMAR_NAMES = [
  "json",
  "css",
  "javascript",
  "typescript",
  "tsx",
  "python",
] as const;
export type GrammarName = (typeof GRAMMAR_NAMES)[number];

const WASM: Record<GrammarName, string> = {
  json: "tree-sitter-json/tree-sitter-json.wasm",
  css: "tree-sitter-css/tree-sitter-css.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
};

const EXTENSIONS: Record<GrammarName, string[]> = {
  json: [".json"],
  css: [".css"],
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  python: [".py"],
};

/** Large real-world files: the parser-bench inputs, then what fetch-corpus.sh downloads. */
const FETCHED: Record<GrammarName, string[]> = {
  json: [
    join(benchInputs, "big.json"),
    join(benchInputs, "package-lock.json"),
    join(benchInputs, "edge.json"),
  ],
  css: ["bootstrap.css", "normalize.css", "animate.css"].map((f) =>
    join(corpusDir, f),
  ),
  javascript: ["lodash.js", "jquery.js"].map((f) => join(corpusDir, f)),
  typescript: [
    join(benchInputs, "scanner.ts"),
    join(benchInputs, "checker.ts"),
  ],
  tsx: [],
  python: [
    join(benchInputs, "argparse.py"),
    ...["typing.py", "dataclasses.py", "base_events.py"].map((f) =>
      join(corpusDir, f),
    ),
  ],
};

export interface Input {
  name: string;
  text: string;
}

function repoFiles(grammar: GrammarName): string[] {
  const out = execFileSync("git", ["-C", repoRoot, "ls-files"], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(
      (f) =>
        EXTENSIONS[grammar].some((e) => f.endsWith(e)) &&
        !f.includes("/generated/"),
    )
    .map((f) => join(repoRoot, f));
}

export function benchFiles(grammar: GrammarName): Input[] {
  const missing = FETCHED[grammar].filter((f) => !existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `missing inputs, run research/parser-bench/fetch-inputs.sh and packages/sitter/fetch-corpus.sh: ${missing.join(", ")}`,
    );
  }
  return FETCHED[grammar].map((f) => ({
    name: f.slice(repoRoot.length + 1),
    text: readFileSync(f, "utf8"),
  }));
}

/** Deterministic PRNG so a divergence found once reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE = [
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ";",
  ",",
  ":",
  '"',
  "'",
  "`",
  "/*",
  "\n",
  " ",
  "=",
  "<",
  ">",
  "#",
  "@",
  "\\",
  "if",
  ".",
];

/** Edits that break the syntax: deleted spans, inserted punctuation, truncation, over windows of real files. */
export function brokenInputs(sources: Input[], perSource: number): Input[] {
  const out: Input[] = [];
  for (const [si, src] of sources.entries()) {
    const random = rng(si * 7919 + 17);
    for (let k = 0; k < perSource; k++) {
      const windowSize = Math.min(src.text.length, 4000);
      const from = Math.floor(random() * (src.text.length - windowSize + 1));
      let text = src.text.slice(from, from + windowSize);
      const edits = 1 + Math.floor(random() * 3);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(random() * (text.length + 1));
        const kind = random();
        if (kind < 0.4)
          text =
            text.slice(0, at) + text.slice(at + 1 + Math.floor(random() * 20));
        else if (kind < 0.85)
          text =
            text.slice(0, at) +
            (NOISE[Math.floor(random() * NOISE.length)] as string) +
            text.slice(at);
        else text = text.slice(0, at);
      }
      out.push({ name: `${src.name}#broken${k}`, text });
    }
  }
  return out;
}

export function corpus(grammar: GrammarName): Input[] {
  const fetched = benchFiles(grammar);
  const repo = repoFiles(grammar).map((f) => ({
    name: f.slice(repoRoot.length + 1),
    text: readFileSync(f, "utf8"),
  }));
  const whole = [...fetched, ...repo];
  return [...whole, ...brokenInputs(whole, grammar === "tsx" ? 8 : 20)];
}

export async function loadGenerated(grammar: GrammarName): Promise<Language> {
  const mod = (await import(`./generated/${grammar}.js`)) as {
    language: Language;
  };
  return mod.language;
}

let wasmReady: Promise<void> | undefined;

export async function loadWasm(grammar: GrammarName): Promise<WasmParser> {
  wasmReady ??= WasmParser.init();
  await wasmReady;
  const parser = new WasmParser();
  parser.setLanguage(
    await WasmLanguage.load(readFileSync(require.resolve(WASM[grammar]))),
  );
  return parser;
}

export function wasmPath(grammar: GrammarName): string {
  return require.resolve(WASM[grammar]);
}
