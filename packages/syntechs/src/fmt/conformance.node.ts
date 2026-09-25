// The formatter conformance matrix: each language's formatter against its reference tool's own test suite
// (prettier 3.9.9's tests/format, ruff 0.16.8's formatter fixtures), fetched by fetch-corpus.sh. Writes
// conformance/<target>.snap.md per target and conformance/README.md, the matrix, and commits both.
//
//   node packages/syntechs/dist/fmt/conformance.node.js [target...] [--diff <fixture substring>]
//
// A language joins the matrix with one entry in TARGETS: its fmt module export and its fixture directories.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTwoFilesPatch } from "diff";
import { type GrammarName, pkgRoot } from "../core/corpus.node.js";
import { parse } from "../core/index.js";
import type { Language as Grammar } from "../core/language.js";
import {
  type Case,
  type PrettierTarget,
  prettierSuite,
  type Suite,
} from "./conformance/prettier.node.js";
import {
  type DprintPlugin,
  dprint,
  oxfmt,
  type Reference,
} from "./conformance/references.node.js";
import {
  type FixtureResult,
  lineRatio,
  type MatrixRow,
  type ReferenceScore,
  type Run,
  readHeader,
  renderMatrix,
  renderSnapshot,
} from "./conformance/report.node.js";
import { ruffSuite } from "./conformance/ruff.node.js";
import { format } from "./format.js";
import type { Language } from "./rules.js";

const PRETTIER = "prettier 3.9.9";
const RUFF = "ruff 0.16.8";
const prettierRoot = join(
  pkgRoot,
  "corpus",
  "prettier-3.9.9",
  "tests",
  "format",
);
const ruffRoot = join(
  pkgRoot,
  "corpus",
  "ruff-0.16.8",
  "crates",
  "ruff_python_formatter",
);

/**
 * oxc's IGNORE_TESTS for prettier's js/ts fixtures (oxc tasks/prettier_conformance/src/ignore_list.rs at
 * 79dd965), less its `range` and `cursor` substrings, which the placeholder rule covers exactly: experimental
 * syntax no standard parser accepts, embedded languages, syntax recovery, and prettier-ignore.
 */
const JS_IGNORE = [
  "typescript/conformance/classes/constructorDeclarations/constructorParameters/readonlyReadonly.ts",
  "typescript/conformance/parser/ecmascript5/Statements/parserES5ForOfStatement21.ts",
  "js/optional-chaining-assignment/",
  "js/async-do-expressions/",
  "js/do/",
  "jsx/do/",
  "jsx/fbt/",
  "js/export-default/export-default-from/",
  "js/export-default/escaped/",
  "js/module-blocks",
  "js/tuple",
  "js/record",
  "tuple-and-record.js",
  "jsx/tuple/",
  "js/comments-pipeline-own-line",
  "js/partial-application",
  "js/pipeline-operator",
  "js/arrows-bind/",
  "js/bind-expressions/",
  "js/objects/expression.js",
  "js/no-semi-babylon-extensions/no-semi.js",
  "js/destructuring-private-fields",
  "js/import-reflection/",
  "js/throw_expressions/",
  "js/deferred-import-evaluation",
  "js/babel-plugins",
  "js/source-phase-imports",
  "js/comments-closure-typecast/styled-components.js",
  "js/multiparser",
  "typescript/multiparser",
  "typescript/angular-component-examples",
  "js/strings/template-literals.js",
  "js/template-literals/css-prop.js",
  "js/template-literals/styled-components-with-expressions.js",
  "js/template-literals/styled-jsx-with-expressions.js",
  "js/template-literals/styled-jsx.js",
  "js/last-argument-expansion/embed.js",
  "jsx/template/styled-components.js",
  "typescript/as/as-const-embedded.ts",
  "typescript/decorators-ts/angular.ts",
  "typescript/error-recovery/",
  "js/ignore",
  "typescript/prettier-ignore",
  "js/call/invalid",
  "typescript/trailing-comma/invalid.ts",
  "typescript/decorator-auto-accessors/decorator-auto-accessors-abstract-class.ts",
  "typescript/decorator-auto-accessors/decorator-auto-accessors-declare-class.ts",
  "typescript/decorator-auto-accessors/decorator-auto-accessors-mixed-modifiers.ts",
  "js/top-level-await",
  "jsx/top-level-await",
  "typescript/top-level-await",
  "js/ternaries/parenthesis/await-expression.js",
  "js/await/like-call.js",
  "js/quotes/objects.js",
];

/** The same list's CSS entries: postcss-conditionals and YAML front matter, which no CSS grammar has. */
const CSS_IGNORE = ["css/atrule/if-else.css", "css/yaml/dirty.css"];

interface Target {
  id: string;
  reference: string;
  /** The grammar directory (src/grammars/<fmt>) whose fmt module holds the language, and its export. */
  fmt: string;
  export: string;
  grammar: (fixture: string) => GrammarName;
  source: string;
  suite: () => Suite;
  /** The dprint plugin scored with oxfmt beside syntechs on the same fixtures; none for Python. */
  dprint?: DprintPlugin;
}

const prettier = (
  id: string,
  fmt: string,
  exportName: string,
  grammar: Target["grammar"],
  t: PrettierTarget,
): Target => ({
  id,
  reference: PRETTIER,
  fmt,
  export: exportName,
  grammar,
  source: `Fixtures: ${PRETTIER} tests/format/{${t.dirs.join(",")}} (recursive), every spec call listing parser ${t.parsers.map((p) => `\`${p}\``).join(" or ")}, expected output from its __snapshots__.`,
  suite: () => prettierSuite(prettierRoot, t),
  dprint: fmt === "json" || fmt === "css" ? fmt : "typescript",
});

export const TARGETS: Target[] = [
  prettier("json", "json", "json", () => "json", {
    dirs: ["json/json", "json/with-comment"],
    parsers: ["json"],
    ignore: [],
  }),
  prettier("jsonc", "json", "jsonc", () => "json", {
    dirs: ["json/jsonc", "json/with-comment"],
    parsers: ["jsonc"],
    ignore: [],
  }),
  prettier("json-stringify", "json", "jsonStringify", () => "json", {
    dirs: ["json/json"],
    parsers: ["json-stringify"],
    ignore: [],
  }),
  prettier("css", "css", "css", () => "css", {
    dirs: ["css"],
    parsers: ["css"],
    ignore: CSS_IGNORE,
  }),
  prettier("js", "javascript", "javascript", () => "javascript", {
    dirs: ["js", "jsx"],
    parsers: ["babel", "acorn", "espree", "meriyah", "oxc"],
    ignore: JS_IGNORE,
  }),
  prettier(
    "ts",
    "typescript",
    "typescript",
    (f) => (f.endsWith(".tsx") || f.startsWith("jsx/") ? "tsx" : "typescript"),
    {
      dirs: ["typescript", "jsx"],
      parsers: ["typescript", "babel-ts", "oxc-ts"],
      ignore: JS_IGNORE,
    },
  ),
  {
    id: "python",
    reference: RUFF,
    fmt: "python",
    export: "python",
    grammar: () => "python",
    source: `Fixtures: ${RUFF} crates/ruff_python_formatter/resources/test/fixtures/{black,ruff} (recursive), every option set of each \`.options.json\`, expected output from tests/snapshots (black cases without a snapshot: their \`.expect\` file). Options are passed by their ruff.toml names.`,
    suite: () => ruffSuite(ruffRoot),
  },
];

/** The ts target formats .tsx fixtures and prettier's jsx/ dir with the tsx grammar's `tsx` export. */
const exportFor = (t: Target, grammar: GrammarName) =>
  t.id === "ts" && grammar === "tsx" ? "tsx" : t.export;

const formatters = new Map<string, Language<unknown> | undefined>();
async function loadFormatter(dir: string, name: string) {
  const key = `${dir}#${name}`;
  if (!formatters.has(key)) {
    const url = new URL(`../grammars/${dir}/fmt.js`, import.meta.url);
    const mod: Record<string, unknown> | undefined = existsSync(url)
      ? await import(url.href)
      : undefined;
    formatters.set(key, mod?.[name] as Language<unknown> | undefined);
  }
  return formatters.get(key);
}

const grammars = new Map<GrammarName, Grammar>();
async function loadGrammar(name: GrammarName) {
  let g = grammars.get(name);
  if (!g) {
    const mod: { language: Grammar } = await import(
      new URL(`../grammars/${name}/index.js`, import.meta.url).href
    );
    g = mod.language;
    grammars.set(name, g);
  }
  return g;
}

function runCase(
  c: Case,
  grammar: Grammar,
  lang: Language<unknown>,
  diff: string | undefined,
): FixtureResult {
  const runs: Run[] = c.runs.map((r) => {
    let out: string;
    let why: string | undefined;
    try {
      const root = parse(grammar, c.text).nodes[0];
      if (!root) throw new Error("no root node");
      const res = format(root, c.text, lang, r.options);
      out = res.text;
      if (!res.ok) why = `${res.reason}: ${res.detail}`;
    } catch (e) {
      out = c.text;
      why = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    const actual = r.asRecorded(out);
    const outcome = why ? "refused" : actual === r.expected ? "pass" : "fail";
    if (diff !== undefined && c.fixture.includes(diff) && outcome !== "pass")
      console.log(
        createTwoFilesPatch(
          `expected ${c.fixture} ${r.label}`,
          `ours ${outcome}${why ? ` (${why})` : ""}`,
          r.expected,
          actual,
        ),
      );
    return {
      label: r.label,
      outcome,
      ratio: outcome === "pass" ? 1 : lineRatio(actual, r.expected),
      ...(why === undefined ? {} : { why }),
    };
  });
  return { fixture: c.fixture, runs };
}

/** How many fixtures each reference tool prints as the expected output in every run; the fixture name picks its parser. */
const dprints = new Map<DprintPlugin, Reference>();
async function scoreReferences(
  cases: Case[],
  plugin: DprintPlugin | undefined,
): Promise<ReferenceScore[]> {
  if (!plugin) return [];
  if (!dprints.has(plugin)) dprints.set(plugin, dprint(plugin));
  const scores: ReferenceScore[] = [];
  for (const ref of [oxfmt, dprints.get(plugin) as Reference]) {
    let passed = 0;
    for (const c of cases) {
      let all = true;
      for (const r of c.runs) {
        const out = await ref
          .format(c.fixture, c.text, r.options)
          .catch(() => undefined);
        if (out === undefined || r.asRecorded(out) !== r.expected) {
          all = false;
          break;
        }
      }
      if (all) passed++;
    }
    scores.push({ name: ref.name, passed, total: cases.length });
  }
  return scores;
}

async function main() {
  const args = process.argv.slice(2);
  const diffAt = args.indexOf("--diff");
  const diff = diffAt === -1 ? undefined : args[diffAt + 1];
  const wanted = args.filter(
    (_, i) => diffAt === -1 || (i !== diffAt && i !== diffAt + 1),
  );
  const unknown = wanted.filter((w) => !TARGETS.some((t) => t.id === w));
  if (unknown.length > 0)
    throw new Error(
      `unknown target ${unknown.join(", ")}; targets: ${TARGETS.map((t) => t.id).join(", ")}`,
    );
  if (!existsSync(prettierRoot) || !existsSync(ruffRoot))
    throw new Error("missing fixtures, run packages/syntechs/fetch-corpus.sh");

  const outDir = join(pkgRoot, "conformance");
  mkdirSync(outDir, { recursive: true });
  for (const t of TARGETS) {
    if (wanted.length > 0 && !wanted.includes(t.id)) continue;
    const { cases, excluded } = t.suite();
    let results: FixtureResult[] | "not implemented" = [];
    for (const c of cases) {
      const g = t.grammar(c.fixture);
      const lang = await loadFormatter(t.fmt, exportFor(t, g));
      if (!lang) {
        results = "not implemented";
        break;
      }
      results.push(runCase(c, await loadGrammar(g), lang, diff));
    }
    const snapshot = renderSnapshot({
      id: t.id,
      source: t.source,
      results,
      excluded,
      references: await scoreReferences(cases, t.dprint),
    });
    writeFileSync(join(outDir, `${t.id}.snap.md`), snapshot);
    console.log(snapshot.split("\n", 1)[0]);
  }

  const rows: MatrixRow[] = [];
  for (const t of TARGETS) {
    const file = join(outDir, `${t.id}.snap.md`);
    if (!existsSync(file)) continue;
    const snapshot = readFileSync(file, "utf8");
    rows.push({ id: t.id, reference: t.reference, ...readHeader(snapshot) });
  }
  writeFileSync(join(outDir, "README.md"), renderMatrix(rows));
}

// The benchmark imports TARGETS; only running this file writes the snapshots.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
