// The scorecard's numbers, read at build time from the JSON the syntechs conformance and bench scripts write
// with `--json` (CI runs both, then builds this site). Nothing here is typed in by hand: without both files the
// build fails rather than publishing a stale or empty table.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineLoader } from "vitepress";

/** What `conformance.node.js --json` writes: its matrix rows (report.node.ts MatrixRow). */
interface Conformance {
  commit: string;
  date: string;
  tools: Record<string, string>;
  rows: {
    id: string;
    reference: string;
    score?: {
      passed: number;
      total: number;
      refused: number;
      excluded: number;
    };
    references: { name: string; passed: number; total: number }[];
  }[];
}

/** What `bench.node.js --json` writes: each language group's totals. */
interface Bench {
  commit: string;
  date: string;
  tools: Record<string, string>;
  groups: {
    id: string;
    ratio: Record<"reference" | "oxfmt", number | null>;
  }[];
}

export interface ScorecardRow {
  language: string;
  reference: string;
  compatibility: string;
  vsReference: string;
  vsOxfmt: string;
  refused: string;
}

export interface Scorecard {
  commit: string;
  date: string;
  /** The tool versions the speed columns were timed against. */
  benchTools: string;
  rows: ScorecardRow[];
}

declare const data: Scorecard;
export { data };

const percent = (passed: number, total: number) =>
  total === 0 ? "-" : `${((passed / total) * 100).toFixed(2)}%`;

/** syntechs' time over the other tool's, as "2.1x faster" or "1.4x slower". */
const speed = (ratio: number | null | undefined) =>
  ratio == null
    ? "-"
    : ratio <= 1
      ? `${(1 / ratio).toFixed(1)}x faster`
      : `${ratio.toFixed(1)}x slower`;

function readResult<T>(dir: string, file: string): T {
  const path = join(dir, file);
  if (!existsSync(path))
    throw new Error(
      `scorecard: ${path} is missing (SCORECARD_DIR=${dir}); write it with syntechs' ${file.replace(".json", "")}.node.js --json`,
    );
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export default defineLoader({
  load(): Scorecard {
    const env = process.env.SCORECARD_DIR;
    if (!env)
      throw new Error(
        "scorecard: set SCORECARD_DIR to the directory holding conformance.json and bench.json",
      );
    const dir = resolve(env);
    const conformance = readResult<Conformance>(dir, "conformance.json");
    const bench = readResult<Bench>(dir, "bench.json");
    if (conformance.commit !== bench.commit)
      throw new Error(
        `scorecard: conformance.json measured ${conformance.commit} but bench.json measured ${bench.commit}`,
      );
    const rows = conformance.rows.map((r): ScorecardRow => {
      // A prettier-family row (`js@oxfmt`) is timed by its language's bench group (`js`).
      const timed = bench.groups.find((g) => g.id === r.id.replace(/@oxfmt$/, ""));
      return {
        language: r.id,
        reference: r.reference,
        compatibility: r.score
          ? percent(r.score.passed, r.score.total)
          : "not implemented",
        vsReference: speed(timed?.ratio.reference),
        vsOxfmt: speed(timed?.ratio.oxfmt),
        refused: r.score ? String(r.score.refused) : "-",
      };
    });
    return {
      commit: conformance.commit,
      date: conformance.date,
      benchTools: Object.values(bench.tools).join(", "),
      rows,
    };
  },
});
