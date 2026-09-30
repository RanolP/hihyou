// Scoring one target's runs, and the snapshot and matrix files that commit the score.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { diffArrays } from "diff";

/** One fixture under one option set, compared with the reference's expected output. */
export interface Run {
  /** The options as the reference's test spec wrote them, for the report. */
  label: string;
  outcome: "pass" | "fail" | "refused";
  /** Line similarity of our output to the expected one, 0..1. */
  ratio: number;
  /** For `refused`, the formatter's `reason: detail`, or `check: ` and what `check` found broken. */
  why?: string;
}

export interface FixtureResult {
  fixture: string;
  runs: Run[];
}

export interface Excluded {
  fixture: string;
  reason: string;
}

/**
 * What similar's `TextDiff::from_lines(a, b).ratio()` gives (the ratio oxc's conformance reports): twice the
 * lines a Myers diff keeps, over the lines of both sides, each line with its line break.
 */
export function lineRatio(a: string, b: string): number {
  const lines = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const x = lines(a);
  const y = lines(b);
  if (x.length + y.length === 0) return 1;
  let kept = 0;
  for (const part of diffArrays(x, y))
    if (!part.added && !part.removed) kept += part.count;
  return (2 * kept) / (x.length + y.length);
}

/** A fixture passes when every option set its spec declares prints exactly the reference's output. */
export const fixtureOutcome = (r: FixtureResult): Run["outcome"] =>
  r.runs.some((x) => x.outcome === "refused")
    ? "refused"
    : r.runs.every((x) => x.outcome === "pass")
      ? "pass"
      : "fail";

/** A passing run counts as 1, so a fixture that fails one option set of two reads at least 50%. */
export const fixtureRatio = (r: FixtureResult) =>
  r.runs.reduce((sum, x) => sum + x.ratio, 0) / r.runs.length;

const percent = (x: number) => `${(x * 100).toFixed(2)}%`;
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export interface TargetReport {
  id: string;
  /** Where the fixtures and their expectations come from, one line. */
  source: string;
  results: FixtureResult[] | "not implemented";
  excluded: Excluded[];
  /** Other formatters scored on the same fixtures and option sets, for comparison. */
  references: ReferenceScore[];
}

export interface ReferenceScore {
  /** The tool's name and version. */
  name: string;
  passed: number;
  total: number;
}

const REFERENCES = "Other formatters on the same fixtures, fixtures passed:";
const renderReferences = (refs: ReferenceScore[]) => [
  REFERENCES,
  "",
  ...refs.map(
    (r) =>
      `- ${r.name}: ${r.passed}/${r.total} (${percent(r.total === 0 ? 0 : r.passed / r.total)})`,
  ),
];

/** The committed `<id>.snap.md`: a header line the matrix reads back, then each fixture that does not pass. */
export function renderSnapshot(t: TargetReport): string {
  const out: string[] = [];
  if (t.results === "not implemented") {
    out.push(`${t.id} compatibility: not implemented`, "");
  } else {
    const failed = t.results.filter((r) => fixtureOutcome(r) === "fail");
    const refused = t.results.filter((r) => fixtureOutcome(r) === "refused");
    const passed = t.results.length - failed.length - refused.length;
    const rate = t.results.length === 0 ? 0 : passed / t.results.length;
    out.push(
      `${t.id} compatibility: ${passed}/${t.results.length} (${percent(rate)}), ${refused.length} refused (ok:false), ${t.excluded.length} excluded`,
      "",
    );
  }
  if (t.references.length > 0) out.push(...renderReferences(t.references), "");
  out.push(t.source, "");
  if (t.results !== "not implemented") {
    const failed = t.results.filter((r) => fixtureOutcome(r) === "fail");
    const refused = t.results.filter((r) => fixtureOutcome(r) === "refused");
    out.push(
      "# Failed",
      "",
      "Printed, but not as the reference prints it. A run is one option set of the fixture's spec.",
      "",
      "| Fixture | Runs passed | Match ratio |",
      "| :------ | :---------: | :---------: |",
      ...failed.map(
        (r) =>
          `| ${cell(r.fixture)} | ${r.runs.filter((x) => x.outcome === "pass").length}/${r.runs.length} | ${percent(fixtureRatio(r))} |`,
      ),
      "",
      "# Refused",
      "",
      "The formatter threw (ok:false), or `check` found that its output says something the input does not.",
      "",
      "| Fixture | Runs refused | Match ratio | First reason |",
      "| :------ | :----------: | :---------: | :----------- |",
      ...refused.map((r) => {
        const first = r.runs.find((x) => x.outcome === "refused");
        return `| ${cell(r.fixture)} | ${r.runs.filter((x) => x.outcome === "refused").length}/${r.runs.length} | ${percent(fixtureRatio(r))} | ${cell((first?.why ?? "").slice(0, 120))} |`;
      }),
      "",
    );
  }
  if (t.excluded.length > 0) {
    out.push("# Excluded", "");
    const byReason = new Map<string, Excluded[]>();
    for (const e of t.excluded)
      byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e]);
    for (const [reason, list] of [...byReason].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      out.push(`## ${reason} (${list.length})`, "");
      for (const e of list) out.push(`- ${e.fixture}`);
      out.push("");
    }
  }
  return out.join("\n");
}

export interface MatrixRow {
  id: string;
  reference: string;
  /** Undefined when the language has no formatter yet. */
  score?: { passed: number; total: number; refused: number; excluded: number };
  references: ReferenceScore[];
}

const HEADER =
  /^(\S+) compatibility: (?:not implemented|(\d+)\/(\d+) \([\d.]+%\), (\d+) refused \(ok:false\), (\d+) excluded)$/;
const REFERENCE = /^- (.+): (\d+)\/(\d+) \([\d.]+%\)$/;

/** Reads the scores back from a snapshot's header lines. */
export function readHeader(
  snapshot: string,
): Omit<MatrixRow, "id" | "reference"> {
  const lines = snapshot.split("\n");
  const m = HEADER.exec(lines[0] ?? "");
  if (!m)
    throw new Error(
      `not a conformance snapshot header: ${snapshot.slice(0, 80)}`,
    );
  const references: ReferenceScore[] = [];
  const at = lines.indexOf(REFERENCES);
  for (const line of at === -1 ? [] : lines.slice(at + 2)) {
    const r = REFERENCE.exec(line);
    if (!r) break;
    references.push({
      name: r[1] as string,
      passed: Number(r[2]),
      total: Number(r[3]),
    });
  }
  if (m[2] === undefined) return { references };
  return {
    score: {
      passed: Number(m[2]),
      total: Number(m[3]),
      refused: Number(m[4]),
      excluded: Number(m[5]),
    },
    references,
  };
}

/** The matrix cell of the reference tool whose name starts with `tool`. */
const referenceCell = (r: MatrixRow, tool: string) => {
  const s = r.references.find((x) => x.name.startsWith(`${tool} `));
  return s ? percent(s.total === 0 ? 0 : s.passed / s.total) : "-";
};

const toolNames = (rows: MatrixRow[]) =>
  [
    ...new Set(
      rows.flatMap((r) =>
        r.references
          .filter((x) => x.name.startsWith("oxfmt "))
          .map((x) => `\`${x.name}\``),
      ),
    ),
  ].join(", ");

export function renderMatrix(rows: MatrixRow[]): string {
  return [
    "# Formatter conformance",
    "",
    "Generated by `node packages/syntechs/dist/fmt/conformance.node.js` from the snapshots beside this file; do not edit by hand. A fixture passes when every option set its reference spec declares prints byte-identical to the reference. `ok:false` counts fixtures refused: the formatter threw, or `check` found its output dropping, changing or inventing a token or comment. They are not counted as passed.",
    "",
    `The oxfmt column scores that tool (${toolNames(rows)}) on the same fixtures and option sets against the same expected output, for context. The \`@oxfmt\` rows score syntechs against oxfmt's own output on the same fixtures and option sets instead: syntechs prints what oxfmt prints, so those rows are its gate, and the plain prettier-family rows measure how far that output stays from prettier's.`,
    "",
    "| Language | Reference | Passed | Compatibility | ok:false | Excluded | oxfmt |",
    "| :------- | :-------- | -----: | ------------: | -------: | -------: | ----: |",
    ...rows.map((r) => {
      const ours = r.score
        ? `${r.score.passed}/${r.score.total} | ${percent(r.score.total === 0 ? 0 : r.score.passed / r.score.total)} | ${r.score.refused} | ${r.score.excluded}`
        : "not implemented | | |";
      return `| [${r.id}](${r.id}.snap.md) | ${r.reference} | ${ours} | ${referenceCell(r, "oxfmt")} |`;
    }),
    "",
  ].join("\n");
}

/**
 * Where a machine-readable result came from, for the scorecard the website publishes: the commit measured (CI's
 * `GITHUB_SHA`, else the checkout's HEAD), when, and the tool versions it ran against.
 */
export interface RunInfo {
  commit: string;
  date: string;
  node: string;
  tools: Record<string, string>;
}

export function runInfo(tools: Record<string, string>): RunInfo {
  const commit =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
    }).trim();
  return {
    commit,
    date: new Date().toISOString(),
    node: process.version,
    tools,
  };
}

/** The value of `--json <path>` in `args`; throws when the flag has no path after it. */
export function jsonPathArg(args: string[]): string | undefined {
  const at = args.indexOf("--json");
  if (at === -1) return undefined;
  const path = args[at + 1];
  if (path === undefined || path.startsWith("--"))
    throw new Error(`--json needs a file path, got ${path ?? "nothing"}`);
  return path;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
