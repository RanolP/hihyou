// Parity of the syntechs highlighters with shiki (VS Code's TextMate grammars), compared as the colour each
// non-whitespace character resolves to under one theme. The `bench` corpus combines tracked package sources with
// the pinned files fetched by packages/syntechs/fetch-corpus.sh and the vendored Kotlin/Swift inputs.
// Usage: node packages/syntechs/dist/highlight/parity.node.js [lang...] [--corpus bench|vite|repo] [--show N]
// [--theme github-dark] [--json path].

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundledThemes, createHighlighter } from "shiki";
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
  shiki: (name: string) => string;
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

export function corpusFiles(
  corpus: string,
  exts: string[],
): { name: string; text: string }[] {
  const roots: [string, string[]][] = [];
  const tracked = (root: string, patterns: string[]) => {
    if (!existsSync(root)) return;
    const names = execFileSync(
      "git",
      ["-C", root, "ls-files", "-z", "--", ...patterns],
      {
        encoding: "utf8",
        maxBuffer: 1 << 26,
      },
    )
      .split("\0")
      .filter(
        (n) =>
          n !== "" &&
          !n.includes("/dist/") &&
          !n.endsWith("bundle.js") &&
          !n.includes("/corpus/"),
      );
    roots.push([root, names]);
  };
  const directory = (root: string) => {
    if (!existsSync(root)) return;
    roots.push([
      root,
      (readdirSync(root, { recursive: true }) as string[])
        .filter((n) => exts.some((e) => n.endsWith(e)))
        .sort(),
    ]);
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
    tracked(
      repoRoot,
      exts.map((e) => `packages/**/*${e}`),
    );
    for (const root of [
      join(repoRoot, "packages/syntechs/corpus"),
      join(repoRoot, "research/parser-bench/inputs"),
      join(repoRoot, "packages/syntechs/src/grammars/graphql/corpus"),
      join(repoRoot, "packages/syntechs/src/grammars/kotlin/corpus"),
      join(repoRoot, "packages/syntechs/src/grammars/swift/corpus"),
    ])
      directory(root);
  } else directory(resolve(corpus));

  const out: { name: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const [root, names] of roots)
    for (const name of names) {
      const path = join(root, name);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      // shiki gives up tokenizing a line past its default limit; skip minified files on both sides.
      if (
        text.length > 400_000 ||
        text.split("\n").some((l) => l.length > 2000)
      )
        continue;
      const key = `${path}\0${text.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, text });
    }
  return out;
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
      lang: spec.shiki(name) as never,
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
