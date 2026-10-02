// Highlighting speed against shiki, per language, on the formatter bench's inputs: the large corpus files
// (fetch-corpus.sh, research/parser-bench) and the conformance fixtures of the language's target. Both sides end
// in a colour per token under github-dark: ours parses and highlights each input (parseTree + scopeRuns + the
// compiled theme), shiki runs codeToTokens on its default engine, oniguruma.
//
//   node packages/syntechs/dist/highlight/bench.node.js [language...] [--json <path>]
//
// Timing matches fmt/bench.node.ts: per language, one pass highlights every input; 2 warmups, median of 5. Both
// run in this process with their grammars and theme loaded before any timing, so neither pays startup.
// `--json` writes each language's totals with the commit and tool versions for the website's scorecard, where
// ratio.shiki = shiki ms / syntechs ms: above 1, syntechs is faster.

import { createRequire } from "node:module";
import { bundledThemes, createHighlighter } from "shiki";
import {
  benchFiles,
  type GrammarName,
  type Input,
  swiftInputs,
} from "../core/corpus.node.js";
import { parseTree, type Tree } from "../core/index.js";
import type { Language as Grammar } from "../core/language.js";
import {
  jsonPathArg,
  runInfo,
  writeJson,
} from "../fmt/conformance/report.node.js";
import { PRETTIER_FIXTURES, TARGETS } from "../fmt/conformance.node.js";
import {
  type CompiledTheme,
  compileTheme,
  type HighlightModule,
  scopeRuns,
  type Theme,
} from "./index.js";

const RUNS = 5;
const WARMUP = 2;
const THEME = "github-dark";
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;

interface Group {
  /** The language as the scorecard names it: a conformance row id without its `@reference` suffix. */
  id: string;
  /** The conformance target whose fixtures join the corpus. */
  target: string;
  corpus: GrammarName[];
  /** The grammar a fixture is highlighted with; the target's own when absent. */
  grammar?: (fixture: string) => GrammarName;
  /** shiki's language id for an input. */
  shiki: (input: BenchInput) => string;
}

interface BenchInput extends Input {
  grammar: GrammarName;
}

const GROUPS: Group[] = [
  // prettier's JSON fixtures go through the javascript grammar to format; to highlight, they are JSON.
  {
    id: "json",
    target: "json",
    corpus: ["json"],
    grammar: () => "json",
    shiki: () => "json",
  },
  { id: "css", target: "css", corpus: ["css"], shiki: () => "css" },
  { id: "html", target: "html", corpus: ["html"], shiki: () => "html" },
  {
    id: "js",
    target: "js",
    corpus: ["javascript"],
    shiki: (i) => (i.name.endsWith(".jsx") ? "jsx" : "javascript"),
  },
  {
    id: "ts",
    target: "ts",
    corpus: ["typescript", "tsx"],
    shiki: (i) => (i.grammar === "tsx" ? "tsx" : "typescript"),
  },
  { id: "python", target: "python", corpus: ["python"], shiki: () => "python" },
  { id: "kotlin", target: "kotlin", corpus: ["kotlin"], shiki: () => "kotlin" },
  {
    id: "swift",
    target: "swift@swift-format",
    corpus: ["swift"],
    shiki: () => "swift",
  },
  { id: "yaml", target: "yaml", corpus: ["yaml"], shiki: () => "yaml" },
];

interface GroupResult {
  id: string;
  inputs: number;
  bytes: number;
  /** Median pass over every input, in-process. */
  ms: Record<"syntechs" | "shiki", number>;
  /** shiki's time over syntechs'; above 1, syntechs is faster. */
  ratio: { shiki: number };
}

function time(pass: () => unknown): number {
  for (let i = 0; i < WARMUP; i++) pass();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    pass();
    samples.push(performance.now() - t);
  }
  return median(samples);
}

/** Our end product, comparable to shiki's tokens: runs with a resolved colour each. */
function ourColours(
  tree: Tree,
  highlight: HighlightModule,
  length: number,
  theme: CompiledTheme,
): (string | undefined)[] {
  const { stacks, runs } = scopeRuns(tree, highlight, length);
  const colours: (string | undefined)[] = [];
  for (let r = 0; r < runs.length; r += 3)
    colours.push(
      theme.style(stacks[runs[r + 2] as number] as string).foreground,
    );
  return colours;
}

async function inputsOf(g: Group): Promise<BenchInput[]> {
  const target = [...PRETTIER_FIXTURES, ...TARGETS].find(
    (t) => t.id === g.target,
  );
  if (!target) throw new Error(`${g.id}: no conformance target ${g.target}`);
  const corpus = g.corpus.flatMap((grammar) =>
    benchFiles(grammar).map((f) => ({ ...f, grammar })),
  );
  // The swift target's fixtures are the swift-format sources, read straight from disk.
  const fixtures =
    g.id === "swift"
      ? swiftInputs().map(({ name, text }) => ({
          name,
          text,
          grammar: "swift" as const,
        }))
      : (await target.suite()).cases.map((c) => ({
          name: c.fixture,
          text: c.text,
          grammar: (g.grammar ?? target.grammar)(c.fixture),
        }));
  return [...corpus, ...fixtures];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = jsonPathArg(args);
  const wanted = args.filter(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--json",
  );
  const unknown = wanted.filter((w) => !GROUPS.some((g) => g.id === w));
  if (unknown.length > 0)
    throw new Error(
      `unknown language ${unknown.join(", ")}; languages: ${GROUPS.map((g) => g.id).join(", ")}`,
    );
  const groups = GROUPS.filter(
    (g) => wanted.length === 0 || wanted.includes(g.id),
  );

  const inputs = new Map<string, BenchInput[]>();
  for (const g of groups) inputs.set(g.id, await inputsOf(g));
  const shikiLangs = [
    ...new Set(
      groups.flatMap((g) => (inputs.get(g.id) as BenchInput[]).map(g.shiki)),
    ),
  ];
  const shiki = await createHighlighter({ themes: [THEME], langs: shikiLangs });
  const theme = compileTheme((await bundledThemes[THEME]()).default as Theme);
  const require = createRequire(import.meta.url);
  const shikiVersion = (require("shiki/package.json") as { version: string })
    .version;

  const results: GroupResult[] = [];
  console.log(
    `median of ${RUNS} passes after ${WARMUP}, in-process; each pass colours every input under ${THEME}`,
  );
  console.log(
    "| Language | Inputs | KB | syntechs ms (parse + highlight) | shiki ms (oniguruma) | shiki / syntechs |",
  );
  console.log("| :-- | --: | --: | --: | --: | --: |");
  for (const g of groups) {
    const set = inputs.get(g.id) as BenchInput[];
    if (set.length === 0)
      throw new Error(
        `${g.id}: no inputs; corpus ${g.corpus.join(", ")} and target ${g.target}'s fixtures are empty (stale corpus? rerun packages/syntechs/fetch-corpus.sh)`,
      );
    const grammars = new Map<
      GrammarName,
      { language: Grammar; highlight: HighlightModule }
    >();
    for (const grammar of new Set(set.map((i) => i.grammar))) {
      const { language } = (await import(
        `../grammars/${grammar}/index.js`
      )) as { language: Grammar };
      const { highlight } = (await import(
        `../grammars/${grammar}/highlight.js`
      )) as { highlight: HighlightModule };
      // Injected languages (JSDoc, regex) paint only once loaded, as a real loader awaits it.
      await highlight.load?.();
      grammars.set(grammar, { language, highlight });
    }
    const shikiOf = set.map((i) => g.shiki(i));
    const ours = (i: BenchInput) => {
      const { language, highlight } = grammars.get(i.grammar) as {
        language: Grammar;
        highlight: HighlightModule;
      };
      return ourColours(
        parseTree(language, i.text),
        highlight,
        i.text.length,
        theme,
      );
    };
    const theirs = (i: BenchInput, at: number) =>
      shiki.codeToTokens(i.text, { lang: shikiOf[at] as never, theme: THEME });
    // One untimed pass each, so a throw names the input instead of surfacing mid-measurement.
    for (const [at, i] of set.entries()) {
      try {
        ours(i);
      } catch (e) {
        throw new Error(
          `${g.id}: syntechs failed on ${i.name} (${i.grammar}): ${(e as Error).stack}`,
        );
      }
      try {
        theirs(i, at);
      } catch (e) {
        throw new Error(
          `${g.id}: shiki failed on ${i.name} (lang ${shikiOf[at]}): ${(e as Error).stack}`,
        );
      }
    }
    const syntechs = time(() => set.forEach(ours));
    const shikiMs = time(() => set.forEach(theirs));
    const bytes = set.reduce((n, i) => n + Buffer.byteLength(i.text), 0);
    const ratio = shikiMs / syntechs;
    if (!Number.isFinite(ratio) || ratio <= 0)
      throw new Error(
        `${g.id}: ratio ${ratio} from shiki ${shikiMs} ms / syntechs ${syntechs} ms over ${set.length} inputs`,
      );
    results.push({
      id: g.id,
      inputs: set.length,
      bytes,
      ms: { syntechs, shiki: shikiMs },
      ratio: { shiki: ratio },
    });
    console.log(
      `| ${g.id} | ${set.length} | ${(bytes / 1024).toFixed(0)} | ${syntechs.toFixed(1)} | ${shikiMs.toFixed(1)} | ${ratio.toFixed(2)} |`,
    );
  }
  if (json)
    writeJson(json, {
      ...runInfo({ shiki: `shiki ${shikiVersion}` }),
      runs: RUNS,
      warmup: WARMUP,
      groups: results,
    });
}

await main();
