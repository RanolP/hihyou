// The scorecard's numbers, read at build time from the JSON the syntechs conformance, bench and highlight bench
// scripts write with `--json` (CI runs all three, then builds this site). Nothing here is typed in by hand: without every file the
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

/** What `highlight/bench.node.js --json` writes: each language's highlighting totals against shiki. */
interface Highlight {
  commit: string;
  date: string;
  tools: Record<string, string>;
  groups: {
    id: string;
    ratio: { shiki: number };
  }[];
}

export interface ScorecardRow {
  language: string;
  reference: string;
  /** The fixtures printed byte-identical to the reference; null where the language has no formatter yet. */
  score: { passed: number; total: number; refused: number } | null;
  /**
   * The measured ratios, for charts. `reference` and `oxfmt` are syntechs' formatting time over that tool's
   * (below 1 is faster); `shiki` is the other way round, shiki's highlighting time over syntechs' (above 1 is
   * faster), and absent where syntechs has no highlighter for the language.
   */
  ratio: { reference: number | null; oxfmt: number | null; shiki?: number };
}

export interface Scorecard {
  commit: string;
  date: string;
  /** The tool versions the speed graphs were timed against. */
  benchTools: string;
  rows: ScorecardRow[];
}

declare const data: Scorecard;
export { data };

function readResult<T>(dir: string, file: string): T {
  const path = join(dir, file);
  if (!existsSync(path))
    throw new Error(
      `scorecard: ${path} is missing (SCORECARD_DIR=${dir}); write it with syntechs' ${file === "highlight.json" ? "highlight/bench" : `fmt/${file.replace(".json", "")}`}.node.js --json`,
    );
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export default defineLoader({
  load(): Scorecard {
    const env = process.env.SCORECARD_DIR;
    if (!env)
      throw new Error(
        "scorecard: set SCORECARD_DIR to the directory holding conformance.json, bench.json and highlight.json",
      );
    const dir = resolve(env);
    const conformance = readResult<Conformance>(dir, "conformance.json");
    const bench = readResult<Bench>(dir, "bench.json");
    const highlight = readResult<Highlight>(dir, "highlight.json");
    for (const [file, commit] of [
      ["bench.json", bench.commit],
      ["highlight.json", highlight.commit],
    ])
      if (commit !== conformance.commit)
        throw new Error(
          `scorecard: conformance.json measured ${conformance.commit} but ${file} measured ${commit}`,
        );
    const rows = conformance.rows.map((r): ScorecardRow => {
      // A prettier-family row (`js@oxfmt`) is timed by its language's bench group (`js`).
      const timed = bench.groups.find(
        (g) => g.id === r.id.replace(/@oxfmt$/, ""),
      );
      // The highlighter is per language whatever the reference: `swift@swift-format` is `swift`.
      const shiki = highlight.groups.find(
        (g) => g.id === r.id.replace(/@.*$/, ""),
      )?.ratio.shiki;
      return {
        ratio: {
          reference: timed?.ratio.reference ?? null,
          oxfmt: timed?.ratio.oxfmt ?? null,
          ...(shiki === undefined ? {} : { shiki }),
        },
        language: r.id,
        reference: r.reference,
        score: r.score
          ? { passed: r.score.passed, total: r.score.total, refused: r.score.refused }
          : null,
      };
    });
    return {
      commit: conformance.commit,
      date: conformance.date,
      benchTools: [...Object.values(bench.tools), ...Object.values(highlight.tools)].join(", "),
      rows,
    };
  },
});
