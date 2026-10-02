// Parity of the syntechs highlighters with shiki (VS Code's TextMate grammars), compared as the colour each
// non-whitespace character resolves to under one theme, since the two name scopes at different depths.
// Usage: node packages/syntechs/dist/highlight/parity.node.js [lang...] [--corpus vite|repo] [--show N]
// [--theme github-dark]. The vite corpus is the clone at .eval/vite.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledThemes, createHighlighter } from "shiki";
import { parseTree, type Tree } from "../core/index.js";
import type { Language } from "../core/language.js";
import { repoRoot } from "../core/corpus.node.js";
import { compileTheme, type HighlightModule, scopeRuns, type Theme } from "./index.js";

const LANGS: Record<string, { exts: string[]; load: () => Promise<{ language: Language; highlight: HighlightModule }> }> = {
  typescript: {
    exts: [".ts", ".mts", ".cts"],
    load: async () => ({ ...(await import("../grammars/typescript/index.js")), ...(await import("../grammars/typescript/highlight.js")) }),
  },
  tsx: {
    exts: [".tsx"],
    load: async () => ({ ...(await import("../grammars/tsx/index.js")), ...(await import("../grammars/tsx/highlight.js")) }),
  },
  javascript: {
    exts: [".js", ".mjs", ".cjs", ".jsx"],
    load: async () => ({ ...(await import("../grammars/javascript/index.js")), ...(await import("../grammars/javascript/highlight.js")) }),
  },
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

export function corpusFiles(corpus: string, exts: string[]): { name: string; text: string }[] {
  const root = corpus === "vite" ? join(repoRoot, ".eval/vite") : repoRoot;
  const patterns = corpus === "vite" ? exts.map((e) => `*${e}`) : exts.map((e) => `packages/**/*${e}`);
  const names = execFileSync("git", ["-C", root, "ls-files", "-z", "--", ...patterns], { encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\0")
    .filter((n) => n !== "" && !n.includes("/dist/") && !n.endsWith("bundle.js") && !n.includes("/corpus/"));
  const out: { name: string; text: string }[] = [];
  for (const name of names) {
    let text: string;
    try {
      text = readFileSync(join(root, name), "utf8");
    } catch {
      continue;
    }
    // shiki gives up tokenizing a line past its default limit; skip minified files on both sides.
    if (text.length > 400_000 || text.split("\n").some((l) => l.length > 2000)) continue;
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
  const name = (n: number) => (tree.named(n) ? tree.kindName(n) : JSON.stringify(tree.kindName(n)));
  return (i) => {
    const n = at[i] as number;
    if (n < 0) return "?";
    const p = tree.parent(n);
    return p < 0 ? name(n) : `${name(n)} < ${name(p)}.${tree.fieldName(n) ?? ""}`;
  };
}

async function main(): Promise<void> {
  const corpus = arg("--corpus", "vite");
  const show = Number(arg("--show", "10"));
  const themeName = arg("--theme", "github-dark") as keyof typeof bundledThemes;
  const langs = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  const themeJson = (await bundledThemes[themeName]()).default as Theme & { colors: Record<string, string> };
  const theme = compileTheme(themeJson);
  const fg = (themeJson.colors["editor.foreground"] ?? "").toLowerCase();
  for (const lang of langs.length > 0 ? langs : Object.keys(LANGS)) {
    const spec = LANGS[lang];
    if (!spec) throw new Error(`unknown language ${lang}`);
    const { language, highlight } = await spec.load();
    const shiki = await createHighlighter({ themes: [themeName], langs: [lang] });
    const files = corpusFiles(corpus, spec.exts);
    let compared = 0;
    let matched = 0;
    const misses = new Map<string, { count: number; example: string }>();
    for (const { name, text } of files) {
      const theirs: (string | undefined)[] = new Array(text.length);
      for (const line of shiki.codeToTokens(text, { lang: lang as never, theme: themeName }).tokens)
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
    console.log(
      `${lang}\t${corpus}\t${files.length} files\t${compared} chars\t${((100 * matched) / compared).toFixed(2)}% colour match`,
    );
    const top = [...misses].sort((a, b) => b[1].count - a[1].count).slice(0, show);
    for (const [key, { count, example }] of top) console.log(`  ${count}\t${key}\n\t\t${example}`);
  }
}

await main();
