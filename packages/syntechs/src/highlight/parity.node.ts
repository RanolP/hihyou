// Parity of the syntechs highlighters with shiki (VS Code's TextMate grammars), compared as the colour each
// non-whitespace character resolves to under one theme. The `bench` corpus combines the package sources tracked at
// benchSourcesCommit with the pinned files fetched by packages/syntechs/fetch-corpus.sh and the vendored
// GraphQL/Kotlin/Swift inputs.
// Usage: node packages/syntechs/dist/highlight/parity.node.js [lang...] [--corpus bench|vite|repo] [--show N]
// [--theme github-dark] [--json path].

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BundledLanguage, bundledThemes, createHighlighter } from "shiki";
import { parseTree, type Tree } from "../core/index.js";
import type { Language } from "../core/language.js";
import { repoRoot } from "../core/corpus.node.js";
import {
  compileTheme,
  type HighlightModule,
  scopeRuns,
  type Theme,
} from "./index.js";

interface LanguageSpec {
  exts: string[];
  shiki: (name: string) => BundledLanguage;
  load: () => Promise<{ language: Language; highlight: HighlightModule }>;
}

const LANGS: Record<string, LanguageSpec> = {
  json: {
    exts: [".json"],
    shiki: () => "json",
    load: async () => ({
      ...(await import("../grammars/json/index.js")),
      ...(await import("../grammars/json/highlight.js")),
    }),
  },
  css: {
    exts: [".css"],
    shiki: () => "css",
    load: async () => ({
      ...(await import("../grammars/css/index.js")),
      ...(await import("../grammars/css/highlight.js")),
    }),
  },
  graphql: {
    exts: [".graphql", ".gql"],
    shiki: () => "graphql",
    load: async () => ({
      ...(await import("../grammars/graphql/index.js")),
      ...(await import("../grammars/graphql/highlight.js")),
    }),
  },
  html: {
    exts: [".html"],
    shiki: () => "html",
    load: async () => ({
      ...(await import("../grammars/html/index.js")),
      ...(await import("../grammars/html/highlight.js")),
    }),
  },
  javascript: {
    exts: [".js", ".mjs", ".cjs", ".jsx"],
    shiki: (name) => (name.endsWith(".jsx") ? "jsx" : "javascript"),
    load: async () => ({
      ...(await import("../grammars/javascript/index.js")),
      ...(await import("../grammars/javascript/highlight.js")),
    }),
  },
  typescript: {
    exts: [".ts", ".mts", ".cts"],
    shiki: () => "typescript",
    load: async () => ({
      ...(await import("../grammars/typescript/index.js")),
      ...(await import("../grammars/typescript/highlight.js")),
    }),
  },
  tsx: {
    exts: [".tsx"],
    shiki: () => "tsx",
    load: async () => ({
      ...(await import("../grammars/tsx/index.js")),
      ...(await import("../grammars/tsx/highlight.js")),
    }),
  },
  python: {
    exts: [".py"],
    shiki: () => "python",
    load: async () => ({
      ...(await import("../grammars/python/index.js")),
      ...(await import("../grammars/python/highlight.js")),
    }),
  },
  kotlin: {
    exts: [".kt", ".kts"],
    shiki: () => "kotlin",
    load: async () => ({
      ...(await import("../grammars/kotlin/index.js")),
      ...(await import("../grammars/kotlin/highlight.js")),
    }),
  },
  swift: {
    exts: [".swift"],
    shiki: () => "swift",
    load: async () => ({
      ...(await import("../grammars/swift/index.js")),
      ...(await import("../grammars/swift/highlight.js")),
    }),
  },
  yaml: {
    exts: [".yaml", ".yml"],
    shiki: () => "yaml",
    load: async () => ({
      ...(await import("../grammars/yaml/index.js")),
      ...(await import("../grammars/yaml/highlight.js")),
    }),
  },
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

function positionalArgs(): string[] {
  const flags = new Set(["--corpus", "--show", "--theme", "--json"]);
  const out: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    const value = process.argv[i] as string;
    if (flags.has(value)) {
      i++;
      continue;
    }
    if (!value.startsWith("--")) out.push(value);
  }
  return out;
}

/**
 * The commit whose tracked package sources the `bench` corpus reads, from git rather than the working tree, so a
 * committed parity floor moves only when a highlighter changes, never when an unrelated source file is edited.
 * Moving it re-baselines every floor: re-measure with `--json` and commit the new parity.matrix.json with it.
 */
const benchSourcesCommit = "731702151bf1ccc6c4fc2fd071922018fa41d962";

function git(args: string[], input?: string): Buffer {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    input,
    stdio: "pipe",
    maxBuffer: 1 << 28,
  });
}

/** Every tracked package source at `commit` with one of `exts`, as path and text. */
function pinnedSources(
  commit: string,
  exts: string[],
): { name: string; text: string }[] {
  try {
    git(["cat-file", "-e", `${commit}^{commit}`]);
  } catch {
    // A CI checkout is shallow; fetch just the pinned commit.
    try {
      git(["fetch", "--no-tags", "--depth=1", "origin", commit]);
    } catch (e) {
      throw new Error(
        `bench corpus: commit ${commit} is not in this clone and \`git fetch origin ${commit}\` failed: ${String(e)}`,
      );
    }
  }
  const names = git([
    "ls-tree",
    "-r",
    "-z",
    "--name-only",
    commit,
    "--",
    "packages",
  ])
    .toString("utf8")
    .split("\0")
    .filter((n) => n !== "" && exts.some((e) => n.endsWith(e)) && included(n));
  if (names.length === 0) return [];
  const out = git(
    ["cat-file", "--batch"],
    names.map((n) => `${commit}:${n}\n`).join(""),
  );
  const files: { name: string; text: string }[] = [];
  let at = 0;
  for (const name of names) {
    const header = out.toString("latin1", at, out.indexOf(10, at));
    const size = Number(header.split(" ")[2]);
    if (!header.includes(" blob ") || !Number.isInteger(size))
      throw new Error(
        `bench corpus: git cat-file ${commit}:${name} -> ${header}`,
      );
    at += header.length + 1;
    files.push({ name, text: out.toString("utf8", at, at + size) });
    at += size + 1;
  }
  return files;
}

function included(name: string): boolean {
  return (
    !name.includes("/dist/") &&
    !name.endsWith("bundle.js") &&
    !name.includes("/corpus/")
  );
}

export function corpusFiles(
  corpus: string,
  exts: string[],
): { name: string; text: string }[] {
  const candidates: { name: string; text: string }[] = [];
  const read = (root: string, names: string[]) => {
    for (const name of names)
      try {
        candidates.push({ name, text: readFileSync(join(root, name), "utf8") });
      } catch {
        // A tracked file deleted in the working tree.
      }
  };
  const tracked = (root: string, patterns: string[]) => {
    if (!existsSync(root)) return;
    read(
      root,
      execFileSync("git", ["-C", root, "ls-files", "-z", "--", ...patterns], {
        encoding: "utf8",
        maxBuffer: 1 << 26,
      })
        .split("\0")
        .filter((n) => n !== "" && included(n)),
    );
  };
  const directory = (root: string) => {
    if (!existsSync(root)) return;
    read(
      root,
      (readdirSync(root, { recursive: true }) as string[])
        .filter((n) => exts.some((e) => n.endsWith(e)))
        .sort(),
    );
  };
  if (corpus === "vite")
    tracked(
      join(repoRoot, ".eval/vite"),
      exts.map((e) => `*${e}`),
    );
  else if (corpus === "repo")
    tracked(
      repoRoot,
      exts.map((e) => `packages/**/*${e}`),
    );
  else if (corpus === "bench") {
    candidates.push(...pinnedSources(benchSourcesCommit, exts));
    for (const root of [
      join(repoRoot, "packages/syntechs/corpus"),
      join(repoRoot, "research/parser-bench/inputs"),
      join(repoRoot, "packages/syntechs/src/grammars/graphql/corpus"),
      join(repoRoot, "packages/syntechs/src/grammars/kotlin/corpus"),
      join(repoRoot, "packages/syntechs/src/grammars/swift/corpus"),
    ])
      directory(root);
  } else directory(resolve(corpus));

  // shiki gives up tokenizing a line past its default limit; skip minified files on both sides.
  return candidates.filter(
    ({ text }) =>
      text.length <= 400_000 && !text.split("\n").some((l) => l.length > 2000),
  );
}

/** Deepest leaf (or inner node, for text no child covers) at each character, as "kind < parent". */
function contexts(tree: Tree, length: number): (n: number) => string {
  const at = new Int32Array(length).fill(-1);
  const stack = [tree.root];
  while (stack.length > 0) {
    const n = stack.pop() as number;
    at.fill(n, tree.start(n), Math.min(length, tree.end(n)));
    for (let i = tree.count(n) - 1; i >= 0; i--) stack.push(tree.child(n, i));
  }
  const name = (n: number) =>
    tree.named(n) ? tree.kindName(n) : JSON.stringify(tree.kindName(n));
  return (i) => {
    const n = at[i] as number;
    if (n < 0) return "?";
    const p = tree.parent(n);
    return p < 0
      ? name(n)
      : `${name(n)} < ${name(p)}.${tree.fieldName(n) ?? ""}`;
  };
}

export interface ParityResult {
  id: string;
  files: number;
  compared: number;
  matched: number;
  parity: number;
  mismatches: { cause: string; count: number; example: string }[];
}

export async function measureParity(
  grammar: string,
  corpus: string,
  themeName: keyof typeof bundledThemes,
  show: number,
): Promise<ParityResult> {
  const spec = LANGS[grammar];
  if (!spec) throw new Error(`unknown language ${grammar}`);
  const { language, highlight } = await spec.load();
  await highlight.load?.();
  const themeJson = (await bundledThemes[themeName]()).default as Theme & {
    colors: Record<string, string>;
  };
  const theme = compileTheme(themeJson);
  const fg = (themeJson.colors["editor.foreground"] ?? "").toLowerCase();
  const files = corpusFiles(corpus, spec.exts);
  const shikiLangs = [...new Set(files.map((f) => spec.shiki(f.name)))];
  const shiki = await createHighlighter({
    themes: [themeName],
    langs: shikiLangs,
  });
  let compared = 0;
  let matched = 0;
  const misses = new Map<string, { count: number; example: string }>();
  for (const { name, text } of files) {
    const theirs: (string | undefined)[] = new Array(text.length);
    for (const line of shiki.codeToTokens(text, {
      lang: spec.shiki(name),
      theme: themeName,
    }).tokens)
      for (const t of line) {
        const c = (t.color ?? fg).toLowerCase();
        for (let i = 0; i < t.content.length; i++) theirs[t.offset + i] = c;
      }
    const tree = parseTree(language, text);
    const { stacks, runs } = scopeRuns(tree, highlight, text.length);
    const ours = new Array<string>(text.length).fill(fg);
    const stackAt = new Array<string>(text.length).fill("");
    for (let r = 0; r < runs.length; r += 3) {
      const stack = stacks[runs[r + 2] as number] as string;
      const c = theme.style(stack).foreground ?? fg;
      for (let i = runs[r] as number; i < (runs[r + 1] as number); i++) {
        ours[i] = c;
        stackAt[i] = stack;
      }
    }
    const ctx = contexts(tree, text.length);
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) continue;
      const t = theirs[i];
      if (t === undefined) continue;
      compared++;
      if (ours[i] === t) {
        matched++;
        continue;
      }
      const key = `${ctx(i)}: ${ours[i]} -> ${t}`;
      const m = misses.get(key);
      if (m) m.count++;
      else {
        const lineNo = text.slice(0, i).split("\n").length;
        const line = text.split("\n")[lineNo - 1] ?? "";
        misses.set(key, {
          count: 1,
          example: `${name}:${lineNo} \`${line.trim().slice(0, 90)}\` [${stackAt[i]}]`,
        });
      }
    }
  }
  shiki.dispose();
  return {
    id: grammar,
    files: files.length,
    compared,
    matched,
    parity: compared === 0 ? 0 : (100 * matched) / compared,
    mismatches: [...misses]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, show)
      .map(([cause, m]) => ({ cause, count: m.count, example: m.example })),
  };
}

async function main(): Promise<void> {
  const corpus = arg("--corpus", "vite");
  const show = Number(arg("--show", "10"));
  const themeName = arg("--theme", "github-dark") as keyof typeof bundledThemes;
  const langs = positionalArgs();
  const results: ParityResult[] = [];
  for (const lang of langs.length > 0 ? langs : Object.keys(LANGS)) {
    const result = await measureParity(lang, corpus, themeName, show);
    results.push(result);
    console.log(
      `${lang}\t${corpus}\t${result.files} files\t${result.compared} chars\t${result.parity.toFixed(2)}% colour match`,
    );
    for (const mismatch of result.mismatches)
      console.log(
        `  ${mismatch.count}\t${mismatch.cause}\n\t\t${mismatch.example}`,
      );
  }
  const json = arg("--json", "");
  if (json) {
    const require = createRequire(import.meta.url);
    const shikiVersion = (require("shiki/package.json") as { version: string })
      .version;
    writeFileSync(
      json,
      `${JSON.stringify({ theme: themeName, corpus, tools: { shiki: `shiki ${shikiVersion}` }, groups: results }, null, 2)}\n`,
    );
  }
}

if (
  import.meta.url ===
  `file://${process.argv[1]?.replaceAll("\\", "/").replace(/^\/?/, "/")}`
)
  await main();
