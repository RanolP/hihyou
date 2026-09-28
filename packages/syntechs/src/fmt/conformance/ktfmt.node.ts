// ktfmt (a JVM jar) with `--kotlinlang-style`, the reference Kotlin formatter. The jar and the JDK are pinned in
// the repo's mise.toml (`http:ktfmt`, `java`); they run only in dev, never shipped. The JVM starts in about a
// second, so `formatAll` formats every input in one run.

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kotlinInputs, ktfmtInputs, repoRoot } from "../../core/corpus.node.js";
import type { Suite } from "./prettier.node.js";
import type { Reference } from "./references.node.js";

/** Must match `http:ktfmt` in mise.toml. */
export const KTFMT_VERSION = "0.64";

function run(cmd: string, args: string[], input?: string) {
  // mise resolves the pinned versions from mise.toml, so it must run inside the repo.
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    input,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

const failure = (what: string, r: ReturnType<typeof run>) =>
  new Error(
    `${what} failed (status ${r.status}${r.signal ? `, signal ${r.signal}` : ""}${r.error ? `, ${r.error.message}` : ""})\n${r.stderr}${r.stdout.slice(0, 2000)}`,
  );

let jar: string | undefined;

/** Why ktfmt cannot run here, or undefined when it can. */
export function ktfmtMissing(): string | undefined {
  const where = run("mise", ["where", `http:ktfmt@${KTFMT_VERSION}`]);
  const path = join(
    where.stdout.trim(),
    `ktfmt-${KTFMT_VERSION}-with-dependencies.jar`,
  );
  const java = run("java", ["-version"]);
  const problems: string[] = [];
  if (where.status !== 0 || !existsSync(path))
    problems.push(
      `ktfmt ${KTFMT_VERSION} (mise where: ${(where.error?.message ?? where.stdout + where.stderr).trim()})`,
    );
  if (java.status !== 0)
    problems.push(
      `java (got: ${(java.error?.message ?? java.stdout + java.stderr).trim()})`,
    );
  if (problems.length > 0)
    return `ktfmt needs ${problems.join(" and ")}: run \`mise install\` at the repo root`;
  jar = path;
  return undefined;
}

/** The pinned ktfmt jar's path; throws when ktfmt cannot run. */
export function ktfmtJar(): string {
  const missing = jar === undefined ? ktfmtMissing() : undefined;
  if (missing) throw new Error(missing);
  return jar as string;
}

/**
 * Each input formatted by ktfmt, or the Error it reported for that input (a syntax error, or its printer failing). An input's `name`
 * picks its kind by extension: `.kts` is a script, anything else a `.kt` file. Throws when ktfmt cannot run.
 */
export function formatAll(
  inputs: { name: string; text: string }[],
): (string | Error)[] {
  const jarPath = ktfmtJar();
  const dir = mkdtempSync(join(tmpdir(), "syntechs-ktfmt-"));
  try {
    const paths = inputs.map(({ name, text }, i) => {
      const path = join(dir, `${i}${name.endsWith(".kts") ? ".kts" : ".kt"}`);
      writeFileSync(path, text);
      return path;
    });
    const out: (string | Error | undefined)[] = paths.map(() => undefined);
    // A FormattingError ktfmt throws on one file (its printer failing, not the parser) ends the whole run
    // after reporting that file, so the files it had not reached run again until every one has a report.
    for (;;) {
      const pending = paths.flatMap((p, i) =>
        out[i] === undefined ? [i] : [],
      );
      if (pending.length === 0) return out as (string | Error)[];
      // ktfmt formats in place; an argfile keeps a long input list off the command line.
      const args = join(dir, "args.txt");
      writeFileSync(
        args,
        ["--kotlinlang-style", ...pending.map((i) => paths[i])].join("\n"),
      );
      const r = run("java", ["-jar", jarPath, `@${args}`]);
      if (r.error || r.signal) throw failure("ktfmt", r);
      // stderr reports each file: `Done formatting <path>`, or lines naming it (`<path>:<line>:<col>: error: ...`
      // for a syntax error) when it was left as it was. It exits 1 when any file failed.
      const lines = r.stderr.split(/\r?\n/);
      for (const i of pending) {
        const path = paths[i] as string;
        const name = inputs[i]?.name ?? path;
        const own = lines.filter((l) => l.includes(path));
        if (lines.includes(`Done formatting ${path}`))
          out[i] = readFileSync(path, "utf8");
        else if (own.length > 0)
          out[i] = new Error(
            `ktfmt ${name}: ${own.join("\n").replaceAll(path, name)}`,
          );
      }
      if (pending.every((i) => out[i] === undefined))
        throw failure(
          `ktfmt (no report for ${inputs[pending[0] as number]?.name})`,
          r,
        );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const ktfmt: Reference = {
  name: `ktfmt ${KTFMT_VERSION} --kotlinlang-style`,
  async format(file, text, options) {
    // ktfmt's CLI takes no per-option flags beyond the style, so any option would be silently ignored.
    if (Object.keys(options).length > 0)
      throw new Error(
        `ktfmt takes no options here, got ${JSON.stringify(options)}`,
      );
    const [out] = formatAll([{ name: file, text }]);
    if (out instanceof Error) throw out;
    return out as string;
  },
};

/**
 * The Kotlin cases: the inputs parity runs on (the grammar's test corpus and the vendored real-world files), then
 * the inputs of ktfmt's own tests, each expected to print as the pinned jar prints it with `--kotlinlang-style`.
 * Upstream's expected files are not used: they record other styles, other options (a case's directive header,
 * which the CLI ignores) and a newer ktfmt. An input ktfmt rejects is excluded. Throws when ktfmt cannot run.
 */
export function ktfmtSuite(): Suite {
  const inputs = [...kotlinInputs(), ...ktfmtInputs()];
  const outs = formatAll(inputs);
  const suite: Suite = { cases: [], excluded: [] };
  for (const [i, input] of inputs.entries()) {
    const out = outs[i];
    if (out instanceof Error)
      suite.excluded.push({
        fixture: input.name,
        reason: "ktfmt rejects the input",
      });
    else
      suite.cases.push({
        fixture: input.name,
        file: input.name,
        text: input.text,
        runs: [
          {
            label: "--kotlinlang-style",
            options: {},
            expected: out as string,
            asRecorded: (s) => s,
          },
        ],
      });
  }
  return suite;
}
