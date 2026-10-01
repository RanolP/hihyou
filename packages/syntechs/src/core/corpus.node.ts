// The inputs parity and benchmarks run on, per grammar, and the native tree-sitter reference they compare to.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Language } from "./language.js";

export const pkgRoot = resolve(import.meta.dirname, "../..");
export const repoRoot = resolve(pkgRoot, "../..");
const benchInputs = join(repoRoot, "research/parser-bench/inputs");
const corpusDir = join(pkgRoot, "corpus");
/** Vendored and committed, unlike corpusDir: see its NOTICE. */
export const kotlinCorpusDir = join(pkgRoot, "src/grammars/kotlin/corpus");

export const GRAMMAR_NAMES = [
  "json",
  "css",
  "html",
  "javascript",
  "typescript",
  "tsx",
  "python",
  "kotlin",
  "yaml",
] as const;
export type GrammarName = (typeof GRAMMAR_NAMES)[number];

/** Each grammar's directory (holding src/parser.c) under node_modules, and its package. */
const GRAMMAR_DIRS: Record<GrammarName, [string, string]> = {
  json: ["tree-sitter-json", "tree-sitter-json"],
  css: ["tree-sitter-css", "tree-sitter-css"],
  html: ["tree-sitter-html", "tree-sitter-html"],
  javascript: ["tree-sitter-javascript", "tree-sitter-javascript"],
  typescript: ["tree-sitter-typescript/typescript", "tree-sitter-typescript"],
  tsx: ["tree-sitter-typescript/tsx", "tree-sitter-typescript"],
  python: ["tree-sitter-python", "tree-sitter-python"],
  kotlin: ["tree-sitter-kotlin", "tree-sitter-kotlin"],
  yaml: ["tree-sitter-yaml", "tree-sitter-yaml"],
};

const EXTENSIONS: Record<GrammarName, string[]> = {
  json: [".json"],
  css: [".css"],
  html: [".html"],
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  python: [".py"],
  kotlin: [".kt", ".kts"],
  yaml: [".yaml", ".yml"],
};

/** Large real-world files: the parser-bench inputs, then what fetch-corpus.sh downloads, or what is vendored. */
export const FETCHED: Record<GrammarName, string[]> = {
  json: [
    join(benchInputs, "big.json"),
    join(benchInputs, "package-lock.json"),
    join(benchInputs, "edge.json"),
  ],
  css: ["bootstrap.css", "normalize.css", "animate.css"].map((f) =>
    join(corpusDir, f),
  ),
  // No large file is fetched: the repo's own .html files and the committed parity cases are its inputs.
  html: [],
  javascript: ["lodash.js", "jquery.js"].map((f) => join(corpusDir, f)),
  typescript: [
    join(benchInputs, "scanner.ts"),
    join(benchInputs, "checker.ts"),
  ],
  tsx: ["App.tsx", "LayerUI.tsx"].map((f) => join(corpusDir, f)),
  python: [
    join(benchInputs, "argparse.py"),
    ...["typing.py", "dataclasses.py", "base_events.py"].map((f) =>
      join(corpusDir, f),
    ),
  ],
  kotlin: [
    "Collections.kt",
    "Result.kt",
    "Delay.kt",
    "Transform.kt",
    "Okio.kt",
    "build.gradle.kts",
  ].map((f) => join(kotlinCorpusDir, f)),
  // No large file is fetched: the repo's own .yaml files (pnpm-lock.yaml among them) are its inputs.
  yaml: [],
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
    .filter((f) => EXTENSIONS[grammar].some((e) => f.endsWith(e)))
    .map((f) => join(repoRoot, f));
}

export function benchFiles(grammar: GrammarName): Input[] {
  const missing = FETCHED[grammar].filter((f) => !existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `missing inputs, run research/parser-bench/fetch-inputs.sh and packages/syntechs/fetch-corpus.sh: ${missing.join(", ")}`,
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

/** The examples in a tree-sitter test corpus directory (`===` title, source, `---`, expected tree), sources only. */
export function testCorpus(dir: string): Input[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .flatMap((f) => {
      const text = readFileSync(join(dir, f), "utf8").replaceAll("\r\n", "\n");
      return [
        ...text.matchAll(/^={3,}\n(.*)\n={3,}\n([\s\S]*?)\n-{3,}\n/gm),
      ].map((m) => ({ name: `${f}: ${m[1]}`, text: m[2] as string }));
    });
}

/** Kotlin's inputs with no syntax error: the grammar's test corpus and example, then the real-world files. */
export function kotlinInputs(): Input[] {
  const grammarDir = join(kotlinCorpusDir, "tree-sitter-kotlin");
  return [
    ...testCorpus(grammarDir),
    ...[join(grammarDir, "Logger.kt"), ...FETCHED.kotlin].map((f) => ({
      name: f.slice(repoRoot.length + 1),
      text: readFileSync(f, "utf8"),
    })),
  ];
}

/** Kotlin's raw-string `.trimIndent()`: drops a blank first and last line, then the lines' common indent. */
function trimIndent(s: string): string {
  const lines = s.split("\n");
  if (lines[0]?.trim() === "") lines.shift();
  if (lines.at(-1)?.trim() === "") lines.pop();
  const indent = Math.min(
    ...lines
      .filter((l) => l.trim() !== "")
      .map((l) => l.length - l.trimStart().length),
  );
  return lines.map((l) => l.slice(indent)).join("\n");
}

/**
 * The comment each test of ktfmt's KDocFormatterTest.kt formats: its first raw string, when that is a
 * `.trimIndent()`ed comment with no template in it but `${"$"}` (a literal `$`).
 */
function kdocInputs(file: string): Input[] {
  const src = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  return src
    .split(/\n {2}@Test\n/)
    .slice(1)
    .flatMap((body) => {
      const name = /fun (\w+)\(/.exec(body)?.[1];
      const m = /"""([\s\S]*?)"""\s*\.trimIndent\(\)/.exec(body);
      const raw = m?.[1]?.replaceAll('${"$"}', "\0");
      if (!name || raw === undefined || /\$[{\w]/.test(raw)) return [];
      const text = trimIndent(raw.replaceAll("\0", "$"));
      return /^\/[*/]/.test(text)
        ? [{ name: `ktfmt/kdoc/${name}.kt`, text: `${text}\n` }]
        : [];
    });
}

/**
 * The inputs of ktfmt's own tests (vendored under src/grammars/kotlin/corpus/ktfmt, see its NOTICE): every
 * `.input` file case, named by its path under `cases/` and read as a script when its directive header says
 * `// FILE_TYPE SCRIPT` or it starts with a shebang, then KDocFormatterTest.kt's comments. Some hold syntax
 * tree-sitter-kotlin cannot parse, so, unlike kotlinInputs, they feed the ktfmt conformance set only.
 */
export function ktfmtInputs(): Input[] {
  const root = join(kotlinCorpusDir, "ktfmt");
  const cases = join(root, "cases");
  const files = readdirSync(cases, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".input"))
    .map((f) => f.replaceAll("\\", "/"))
    .sort();
  return [
    ...files.map((f) => {
      const text = readFileSync(join(cases, f), "utf8");
      const script = /^(#!|(\/\/.*\n)*\/\/ FILE_TYPE SCRIPT\s*\n)/.test(text);
      return {
        name: `ktfmt/${f.slice(0, -".input".length)}${script ? ".kts" : ".kt"}`,
        text,
      };
    }),
    ...kdocInputs(join(root, "KDocFormatterTest.kt.txt")),
  ];
}

export function corpus(grammar: GrammarName): Input[] {
  const fetched = benchFiles(grammar);
  const repo = repoFiles(grammar)
    .filter((f) => !FETCHED[grammar].includes(f))
    .map((f) => ({
      name: f.slice(repoRoot.length + 1),
      text: readFileSync(f, "utf8"),
    }));
  const whole = [...fetched, ...repo];
  return [...whole, ...brokenInputs(whole, grammar === "tsx" ? 8 : 20)];
}

export async function loadGenerated(grammar: GrammarName): Promise<Language> {
  const mod = (await import(`../grammars/${grammar}/index.js`)) as {
    language: Language;
  };
  return mod.language;
}

// The reference is the tree-sitter CLI at the runtime version the port follows, loading each grammar compiled
// natively by zig. Both come from the repo's mise.toml; they run only in dev and CI, never shipped.
const CLI_VERSION = "0.27.0";

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  // mise resolves the pinned version from mise.toml, so the shims must run inside the repo.
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1", ...env },
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

function failure(what: string, r: ReturnType<typeof run>): Error {
  return new Error(
    `${what} failed (status ${r.status}${r.signal ? `, signal ${r.signal}` : ""}${r.error ? `, ${r.error.message}` : ""})\n${r.stderr}${r.stdout.slice(0, 2000)}`,
  );
}

let missing: string | undefined | null = null;

/** Why the CLI reference cannot run here, or undefined when it can. */
export function referenceMissing(): string | undefined {
  if (missing !== null) return missing;
  const problems: string[] = [];
  const cli = run("tree-sitter", ["--version"]);
  if (cli.status !== 0 || !cli.stdout.includes(CLI_VERSION))
    problems.push(
      `tree-sitter ${CLI_VERSION} (got: ${(cli.error?.message ?? cli.stdout + cli.stderr).trim()})`,
    );
  const zig = run("zig", ["version"]);
  if (zig.status !== 0)
    problems.push(
      `zig (got: ${(zig.error?.message ?? zig.stdout + zig.stderr).trim()})`,
    );
  missing =
    problems.length > 0
      ? `the parity reference needs ${problems.join(" and ")} on PATH: run \`mise install\` at the repo root`
      : undefined;
  return missing;
}

/**
 * The grammar compiled by zig into a shared library the CLI loads, built once per grammar source: the key hashes
 * the C sources, because a grammar's grammar.patch (packages/syntechs/grammars/) changes them under one version.
 */
function referenceLibrary(grammar: GrammarName): string {
  const [dir, pkg] = GRAMMAR_DIRS[grammar];
  const modules = join(pkgRoot, "node_modules");
  const { version } = JSON.parse(
    readFileSync(join(modules, pkg, "package.json"), "utf8"),
  ) as {
    version: string;
  };
  const hash = createHash("sha256");
  // tree-sitter-typescript's scanner.c only includes common/scanner.h, where its scanning logic lives.
  for (const path of [
    join(modules, dir, "src", "parser.c"),
    join(modules, dir, "src", "scanner.c"),
    join(modules, pkg, "common", "scanner.h"),
  ]) {
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  const source = hash.digest("hex").slice(0, 12);
  const ext =
    process.platform === "win32"
      ? ".dll"
      : process.platform === "darwin"
        ? ".dylib"
        : ".so";
  const cache = join(modules, ".cache", "tree-sitter-cli");
  const lib = join(
    cache,
    `${grammar}-${version}-${source}-${CLI_VERSION}${ext}`,
  );
  if (existsSync(lib)) return lib;
  mkdirSync(cache, { recursive: true });
  // The cc crate's default flags carry a Rust target triple (`x86_64-pc-windows-msvc`) that zig cannot parse, so
  // they are dropped and zig builds for the host.
  const r = run("tree-sitter", ["build", "-o", lib, join(modules, dir)], {
    CC: "zig cc",
    CRATE_CC_NO_DEFAULTS: "1",
    CFLAGS: process.platform === "win32" ? "-O2" : "-O2 -fPIC",
  });
  if (r.status !== 0 || !existsSync(lib))
    throw failure(`tree-sitter build ${grammar}`, r);
  return lib;
}

/** One node of the reference tree, in preorder; `depth` 0 is the root. Indices count UTF-16 units, as ours do. */
export interface ReferenceNode {
  depth: number;
  kind: string;
  named: boolean;
  missing: boolean;
  field: string | undefined;
  start: number;
  end: number;
}

const UNESCAPE: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "0": "\0",
  v: "\v",
  f: "\f",
};
const unescape = (s: string) =>
  s.replace(/\\(.)/g, (_, c: string) => UNESCAPE[c] ?? c);
const log10 = (n: number) => String(n).length - 1;

/**
 * Reads one file's `parse --cst` rendering. Each line is `row:col<pad>- row:col<pad>`, then two spaces per depth
 * (the root sits at one), one more space for an error-free node inside an error, then the node. The pads are
 * sized from the widest source line; the root starts at its row and column, so its first pad yields that width.
 */
function readCst(
  lines: string[],
  text: string,
  tokens: Set<string>,
): ReferenceNode[] {
  // Parsed as UTF-16LE, a column counts bytes from the row's start, two per UTF-16 unit; rows break at `\n`.
  const rowStart = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1))
    rowStart.push(i + 1);
  const index = (row: string, col: string) =>
    (rowStart[Number(row)] as number) + Number(col) / 2;
  const nodes: ReferenceNode[] = [];
  let width = 0;
  for (const line of lines) {
    const m = /^(\d+):(\d+)( +)- (\d+):(\d+)( +)(.*)$/.exec(line);
    if (!m) throw new Error(`unreadable CST line: ${JSON.stringify(line)}`);
    const [, sr, sc, pad1, er, ec, spaces, rest] = m as unknown as string[] as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    // A named leaf spanning lines prints its text on continuation lines.
    if (rest.startsWith("`")) continue;
    if (nodes.length === 0)
      width = pad1.length + log10(Number(sr)) + log10(Number(sc));
    const pad2 = Math.max(1, width - log10(Number(er)) - log10(Number(ec)));
    const depth = ((spaces.length - pad2) >> 1) - 1;
    const prev = nodes.at(-1);
    if (depth < 0 || (prev ? depth > prev.depth + 1 : depth !== 0))
      throw new Error(
        `CST line at depth ${depth} after ${prev?.depth}: ${JSON.stringify(line)}`,
      );
    const start = index(sr, sc);
    const end = index(er, ec);
    if (rest.startsWith('MISSING: "')) {
      nodes.push({
        depth,
        kind: rest.slice(10, -1),
        named: false,
        missing: true,
        field: undefined,
        start,
        end,
      });
    } else if (rest.startsWith('"')) {
      nodes.push({
        depth,
        kind: unescape(rest.slice(1, -1)),
        named: false,
        missing: false,
        field: undefined,
        start,
        end,
      });
    } else {
      const n = /^(?:([^\s:]+): )?(•)?(\S+)(?: `.*`)?$/.exec(rest);
      if (!n) throw new Error(`unreadable CST node: ${JSON.stringify(line)}`);
      // `•` marks a node holding an error: on an empty leaf, a MISSING token (which the CST prints like an empty
      // one), or an empty nonterminal whose only child is a hidden MISSING token. Only a token can be missing.
      const kind = n[3] as string;
      nodes.push({
        depth,
        kind,
        named: true,
        missing: n[2] !== undefined && tokens.has(kind),
        field: n[1],
        start,
        end,
      });
    }
  }
  for (const [i, n] of nodes.entries())
    if (n.missing && n.named)
      n.missing = n.start === n.end && !((nodes[i + 1]?.depth ?? 0) > n.depth);
  return nodes;
}

/**
 * The names a MISSING named node can carry: the grammar's tokens, and its aliases (an alias that only renames a
 * nonterminal would let an empty wrapper of a hidden MISSING token pass as missing; no grammar here has one that
 * reaches the corpus). The CLI's own `query` could find MISSING nodes exactly, but it parses UTF-8 only, and error
 * recovery costs bytes, so a UTF-8 parse can recover differently from the UTF-16 one compared here.
 */
function tokenKinds(lang: Language): Set<string> {
  return new Set(
    lang.symbolNames.filter(
      (_, s) => s < lang.tokenCount || s >= lang.symbolCount,
    ),
  );
}

/** Writes each text as UTF-16LE (lone surrogates survive, and columns map straight to UTF-16 indices). */
function withInputs<T>(
  texts: string[],
  fn: (paths: string[], dir: string) => T,
): T {
  const dir = mkdtempSync(join(tmpdir(), "syntechs-reference-"));
  try {
    const paths = texts.map((text, i) => {
      const path = join(dir, `${i}.txt`);
      writeFileSync(path, Buffer.from(text, "utf16le"));
      return path;
    });
    return fn(paths, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(
  grammar: GrammarName,
  dir: string,
  paths: string[],
  output: string[],
): string[] {
  const list = join(dir, "paths.txt");
  writeFileSync(list, paths.join("\n"));
  return [
    "parse",
    ...output,
    "--time",
    "--encoding",
    "utf16-le",
    "-l",
    referenceLibrary(grammar),
    "--lang-name",
    grammar,
    "--paths",
    list,
  ];
}

/**
 * The reference trees for many inputs, parsed by the tree-sitter CLI a batch per call. Throws when the CLI or zig
 * is missing (check `referenceMissing` first) or its output does not read back.
 */
export function referenceTrees(
  grammar: GrammarName,
  texts: string[],
  lang: Language,
): ReferenceNode[][] {
  const tokens = tokenKinds(lang);
  return withInputs(texts, (paths, dir) => {
    const out: ReferenceNode[][] = [];
    for (let from = 0; from < texts.length;) {
      let to = from + 1;
      for (
        let size = (texts[from] as string).length;
        to < texts.length && size < 1 << 20;
        to++
      )
        size += (texts[to] as string).length;
      const r = run(
        "tree-sitter",
        parseArgs(grammar, dir, paths.slice(from, to), ["--cst"]),
      );
      // The CLI exits non-zero when any input holds an ERROR or MISSING node, so only unreadable output fails.
      if (r.error || r.signal || r.stdout === "")
        throw failure(`tree-sitter parse ${grammar}`, r);
      let lines: string[] = [];
      for (const line of r.stdout.split("\n")) {
        // `--time` ends each file with `<path>\tParse: ...`; tabs inside the CST are escaped.
        if (!line.includes("\t")) {
          if (line !== "") lines.push(line);
          continue;
        }
        const i = out.length;
        if (!line.startsWith(paths[i] as string))
          throw new Error(
            `tree-sitter parse ${grammar}: expected ${paths[i]}, got ${JSON.stringify(line)}`,
          );
        out.push(readCst(lines, texts[i] as string, tokens));
        lines = [];
      }
      if (out.length !== to)
        throw failure(
          `tree-sitter parse ${grammar}: ${out.length} of ${to} inputs read`,
          r,
        );
      from = to;
    }
    return out;
  });
}

/** The CLI's own parse time for one text, the median ms of `runs` after `warmup`, spawn and output excluded. */
export function referenceParseMs(
  grammar: GrammarName,
  text: string,
  warmup: number,
  runs: number,
): number {
  return withInputs([text], ([path], dir) => {
    const r = run(
      "tree-sitter",
      parseArgs(grammar, dir, Array(warmup + runs).fill(path), ["--quiet"]),
    );
    const ms = [...r.stdout.matchAll(/\tParse:\s+([\d.]+) ms/g)].map((m) =>
      Number(m[1]),
    );
    if (ms.length !== warmup + runs)
      throw failure(`tree-sitter parse --time ${grammar}`, r);
    return ms.slice(warmup).sort((a, b) => a - b)[runs >> 1] as number;
  });
}
