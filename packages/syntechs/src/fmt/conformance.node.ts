// The formatter conformance matrix: each language's formatter against its reference tool's output on a fixture
// suite (prettier 3.9.9's tests/format run through oxfmt, ruff 0.16.8's formatter fixtures, ktfmt's), fetched by
// fetch-corpus.sh. Writes
// conformance/<target>.snap.md per target and conformance/README.md, the matrix, and commits both.
//
//   node packages/syntechs/dist/fmt/conformance.node.js [target...] [--diff <fixture substring>] [--only <substring>]... [--json <path>]
//
// A language joins the matrix with one entry in TARGETS: its fmt module export and its fixture directories. A
// prettier-family language runs as `<id>@oxfmt`: prettier's fixtures and option sets, oxfmt's output as the
// expected one.
// `--only` (repeatable) runs just the fixtures whose path matches one of the given substrings, prints
// passed/total and the failing fixture names, and writes no snapshot or README — for a worker checking a slice
// of the matrix without producing a diff the others would have to reconcile. `--json` also writes the matrix rows,
// with the commit and tool versions, for the website's scorecard.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTwoFilesPatch } from "diff";
import { type GrammarName, pkgRoot } from "../core/corpus.node.js";
import { parseTree } from "../core/index.js";
import type { Language as Grammar } from "../core/language.js";
import { check } from "./check.js";
import {
  type Answers,
  type Case,
  type CaseRun,
  type PrettierTarget,
  prettierSuite,
  type Suite,
} from "./conformance/prettier.node.js";
import { ktfmt, ktfmtSuite } from "./conformance/ktfmt.node.js";
import { oxfmt, type Reference } from "./conformance/references.node.js";
import {
  type Excluded,
  type FixtureResult,
  fixtureOutcome,
  lineRatio,
  type MatrixRow,
  type ReferenceScore,
  type Run,
  jsonPathArg,
  readHeader,
  renderMatrix,
  renderSnapshot,
  runInfo,
  writeJson,
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

  // experimental proposal syntax (below TC39 Stage 4), ignored until it ships
  "js/discard-binding/",
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
  /** Its fixtures; `reference` asks a prettier-family set for every input, its expected output left to a reference. */
  suite: (answers?: Answers) => Suite | Promise<Suite>;
}

/**
 * A prettier-family language's fixtures: prettier's, with the option sets its spec calls declare. The expected
 * output they carry is prettier's, which only `againstOxfmt` and the benchmark's fixture set read past.
 */
const prettierFixtures = (
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
  source: `Fixtures: ${PRETTIER} tests/format/{${t.dirs.join(",")}} (recursive), every spec call listing parser ${t.parsers.map((p) => `\`${p}\``).join(" or ")}, with the option sets it declares`,
  suite: (answers) => prettierSuite(prettierRoot, t, answers),
});

/**
 * `fixtures` scored against oxfmt, run with prettier's defaults (references.node.ts), as `<id>@oxfmt`: the output
 * syntechs is held to.
 */
const againstOxfmt = (fixtures: Target): Target => ({
  ...fixtures,
  id: `${fixtures.id}@oxfmt`,
  reference: oxfmt.name,
  source: `${fixtures.source}; expected output from ${oxfmt.name} run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.`,
  suite: async () => referenceSuite(await fixtures.suite("reference"), oxfmt),
});

/** The prettier-family fixture sets, by the ids the benchmark's groups name. */
export const PRETTIER_FIXTURES: Target[] = [
  prettierFixtures("json", "json", "json", () => "javascript", {
    dirs: ["json/json", "json/with-comment"],
    parsers: ["json"],
    ignore: [],
  }),
  prettierFixtures("jsonc", "json", "jsonc", () => "javascript", {
    dirs: ["json/jsonc", "json/with-comment"],
    parsers: ["jsonc"],
    ignore: [],
  }),
  prettierFixtures("json-stringify", "json", "jsonStringify", () => "javascript", {
    dirs: ["json/json"],
    parsers: ["json-stringify"],
    ignore: [],
  }),
  prettierFixtures("css", "css", "css", () => "css", {
    dirs: ["css"],
    parsers: ["css"],
    ignore: CSS_IGNORE,
  }),
  prettierFixtures("js", "javascript", "javascript", () => "javascript", {
    dirs: ["js", "jsx"],
    parsers: ["babel", "acorn", "espree", "meriyah", "oxc"],
    ignore: JS_IGNORE,
  }),
  prettierFixtures(
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
  prettierFixtures("yaml", "yaml", "yaml", () => "yaml", {
    dirs: ["yaml"],
    parsers: ["yaml"],
    ignore: [],
  }),
];

export const TARGETS: Target[] = [
  {
    id: "python",
    reference: RUFF,
    fmt: "python",
    export: "python",
    grammar: () => "python",
    source: `Fixtures: ${RUFF} crates/ruff_python_formatter/resources/test/fixtures/{black,ruff} (recursive), every option set of each \`.options.json\`, expected output from tests/snapshots (black cases without a snapshot: their \`.expect\` file). Options are passed by their ruff.toml names.`,
    suite: () => ruffSuite(ruffRoot),
  },
  {
    id: "kotlin",
    reference: ktfmt.name,
    fmt: "kotlin",
    export: "kotlin",
    grammar: () => "kotlin",
    source: `Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files, then the inputs of ktfmt's own tests: its cases/**/*.input files and KDocFormatterTest.kt's comments), expected output from ${ktfmt.name} run on each.`,
    suite: ktfmtSuite,
  },
  ...PRETTIER_FIXTURES.map(againstOxfmt),
];

/** The ts targets format .tsx fixtures and prettier's jsx/ dir with the tsx grammar's `tsx` export. */
const exportFor = (t: Target, grammar: GrammarName) =>
  t.fmt === "typescript" && grammar === "tsx" ? "tsx" : t.export;

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

/** The JS formatter's sourceType for a fixture whose extension fixes it, as oxc reads the extension. */
const sourceTypeOf = (fixture: string): { sourceType?: string } =>
  /\.m[jt]sx?$/.test(fixture)
    ? { sourceType: "module" }
    : /\.c[jt]sx?$/.test(fixture)
      ? { sourceType: "script" }
      : {};

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
      const res = format(parseTree(grammar, c.text), lang, {
        ...r.options,
        ...sourceTypeOf(c.fixture),
      });
      out = res.ok ? res.text : c.text;
      if (!res.ok) why = `${res.reason}: ${res.detail}`;
      else {
        const problem = check(lang, c.text, res.text);
        if (problem) why = `check: ${problem}`;
      }
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

/** `ref`'s output for one run of `c`, under prettier's parser for it; rejects when `ref` rejects the input. */
const referenceOutput = (
  ref: Reference,
  c: Case,
  r: CaseRun,
  text: string,
): Promise<string> =>
  ref.format(
    c.fixture,
    text,
    r.parser === undefined ? r.options : { parser: r.parser, ...r.options },
  );

/**
 * `base` with each run's expected output from `ref`. A run has no answer, and is excluded, when `ref` rejects its
 * input or option set, or prints its own output differently a second time; a fixture is excluded only when none
 * of its runs has one, and otherwise keeps the runs that do (each dropped run listed as `<fixture> <label>`).
 */
async function referenceSuite(base: Suite, ref: Reference): Promise<Suite> {
  const cases: Case[] = [];
  const excluded = [...base.excluded];
  for (const c of base.cases) {
    const runs: CaseRun[] = [];
    const dropped: Excluded[] = [];
    for (const r of c.runs) {
      try {
        const out = await referenceOutput(ref, c, r, c.text);
        if ((await referenceOutput(ref, c, r, out)) !== out)
          throw new Unstable();
        runs.push({ ...r, expected: r.asRecorded(out) });
      } catch (e) {
        dropped.push({
          fixture: `${c.fixture} ${r.label}`,
          reason:
            e instanceof Unstable
              ? `${ref.name} is not idempotent on it`
              : `${ref.name} rejects it: ${rejection(e)}`,
        });
      }
    }
    if (runs.length > 0) {
      cases.push({ ...c, runs });
      excluded.push(...dropped);
    } else
      excluded.push({
        fixture: c.fixture,
        reason: (dropped[0] as Excluded).reason,
      });
  }
  return { cases, excluded };
}

class Unstable extends Error {}

/** A rejection's first line or clause, which names the error without the position that follows, so the excluded list groups by it. */
const rejection = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split(/[\n;]/, 1)[0] ?? "";

const unformattedScore = (cases: Case[]): ReferenceScore => ({
  name: "unformatted input (no formatter yet)",
  passed: cases.filter((c) =>
    c.runs.every((r) => r.asRecorded(c.text) === r.expected),
  ).length,
  total: cases.length,
});

async function main() {
  const args = process.argv.slice(2);
  const diffAt = args.indexOf("--diff");
  const diff = diffAt === -1 ? undefined : args[diffAt + 1];
  const only = args.filter((_a, i) => args[i - 1] === "--only");
  const json = jsonPathArg(args);
  const wanted = args.filter((a, i) => {
    if (diffAt !== -1 && (i === diffAt || i === diffAt + 1)) return false;
    if (a === "--only" || args[i - 1] === "--only") return false;
    if (a === "--json" || args[i - 1] === "--json") return false;
    return true;
  });
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
    const { cases: allCases, excluded } = await t.suite();
    const cases =
      only.length === 0
        ? allCases
        : allCases.filter((c) => only.some((p) => c.fixture.includes(p)));
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
    if (only.length > 0) {
      const failing =
        results === "not implemented"
          ? []
          : results
              .filter((r) => fixtureOutcome(r) !== "pass")
              .map((r) => r.fixture);
      console.log(
        `${t.id}: ${cases.length - failing.length}/${cases.length} passed` +
          (failing.length > 0 ? `\nfailing: ${failing.join(", ")}` : ""),
      );
      continue;
    }
    const snapshot = renderSnapshot({
      id: t.id,
      source: t.source,
      results,
      excluded,
      // With no formatter, what a viewer shows is the input as written: this is how much of it already reads as
      // the reference prints it.
      references: results === "not implemented" ? [unformattedScore(cases)] : [],
    });
    writeFileSync(join(outDir, `${t.id}.snap.md`), snapshot);
    console.log(snapshot.split("\n", 1)[0]);
  }
  if (only.length > 0) return;

  const rows: MatrixRow[] = [];
  for (const t of TARGETS) {
    const file = join(outDir, `${t.id}.snap.md`);
    if (!existsSync(file)) continue;
    const snapshot = readFileSync(file, "utf8");
    rows.push({ id: t.id, reference: t.reference, ...readHeader(snapshot) });
  }
  writeFileSync(join(outDir, "README.md"), renderMatrix(rows));
  if (json)
    writeJson(json, {
      ...runInfo({
        prettier: PRETTIER,
        ruff: RUFF,
        ktfmt: ktfmt.name,
        oxfmt: oxfmt.name,
      }),
      rows,
    });
}

// The benchmark imports TARGETS; only running this file writes the snapshots.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
