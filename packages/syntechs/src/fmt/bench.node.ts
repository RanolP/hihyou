// Formatting speed against the reference tools, on the same inputs: the large corpus files (fetch-corpus.sh,
// research/parser-bench) and the conformance fixtures, each at its tool's defaults with an 80-column width.
// The target: syntechs within 5x oxfmt's time and faster than prettier's; for Python, within 5x ruff's. oxfmt
// covers every prettier-family language here (JSON and CSS natively too), so it is the reference for each.
//
//   node packages/syntechs/dist/fmt/bench.node.js [language...] [--ruff <path to ruff 0.16.8>]
//
// syntechs is parse + format, in process, timed after its bundles load (the load is reported apart). prettier
// 3.9.9 and oxfmt run in process through their JS APIs, one awaited call per input. ruff has no JS API: it
// runs as native ruff 0.16.8 (uvx, or `--ruff`), `format --check` over a directory of the inputs on one thread,
// timed as a whole process less the same process over an empty directory.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as prettier from "prettier";
import { benchFiles, type GrammarName } from "../core/corpus.node.js";
import { parseTree } from "../core/index.js";
import type { Language as Grammar } from "../core/language.js";
import { check } from "./check.js";
import { oxfmt } from "./conformance/references.node.js";
import { TARGETS } from "./conformance.node.js";
import { format } from "./format.js";
import type { Language } from "./rules.js";

const RUNS = 5;
const WARMUP = 2;
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;

interface Input {
  name: string;
  text: string;
  grammar: GrammarName;
}

interface Group {
  id: string;
  /** The conformance target whose fmt module and fixtures this language uses. */
  target: string;
  corpus: GrammarName[];
  /** prettier's parser and oxfmt's file extension by grammar; absent for Python, which only ruff formats. */
  prettier?: (g: GrammarName) => string;
  oxfmtExt?: (g: GrammarName) => string;
}

const GROUPS: Group[] = [
  {
    id: "json",
    target: "json",
    corpus: ["json"],
    prettier: () => "json",
    oxfmtExt: () => "json",
  },
  {
    id: "css",
    target: "css",
    corpus: ["css"],
    prettier: () => "css",
    oxfmtExt: () => "css",
  },
  {
    id: "js",
    target: "js",
    corpus: ["javascript"],
    prettier: () => "babel",
    oxfmtExt: () => "jsx",
  },
  {
    id: "ts",
    target: "ts",
    corpus: ["typescript", "tsx"],
    prettier: () => "typescript",
    oxfmtExt: (g) => (g === "tsx" ? "tsx" : "ts"),
  },
  { id: "python", target: "python", corpus: ["python"] },
];

async function timed(
  pass: () => unknown,
): Promise<{ cold: number; warm: number }> {
  const t0 = performance.now();
  await pass();
  const cold = performance.now() - t0;
  for (let i = 0; i < WARMUP; i++) await pass();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await pass();
    samples.push(performance.now() - t);
  }
  return { cold, warm: median(samples) };
}

async function load<T>(url: URL, name: string): Promise<T | undefined> {
  try {
    return (await import(url.href))[name] as T | undefined;
  } catch {
    return undefined;
  }
}

function resolveRuff(): string {
  const at = process.argv.indexOf("--ruff");
  if (at !== -1 && process.argv[at + 1]) return process.argv[at + 1] as string;
  return execFileSync(
    "uvx",
    [
      "--from",
      "ruff@0.16.8",
      "python",
      "-c",
      "import shutil; print(shutil.which('ruff'))",
    ],
    { encoding: "utf8" },
  ).trim();
}

/** Median whole-process time of ruff over `inputs`, less its time over an empty directory. */
function ruffTime(ruff: string, inputs: Input[]) {
  const root = mkdtempSync(join(tmpdir(), "syntechs-bench-"));
  try {
    const dir = join(root, "inputs");
    const empty = join(root, "empty");
    mkdirSync(dir);
    mkdirSync(empty);
    for (const [i, input] of inputs.entries())
      writeFileSync(join(dir, `${i}.py`), input.text);
    const run = (d: string) => {
      const samples: number[] = [];
      for (let i = 0; i < WARMUP + RUNS; i++) {
        const t = performance.now();
        const r = spawnSync(
          ruff,
          ["format", "--check", "--isolated", "--no-cache", d],
          {
            env: { ...process.env, RAYON_NUM_THREADS: "1" },
            encoding: "utf8",
          },
        );
        if (r.status !== 0 && r.status !== 1)
          throw new Error(`ruff exited ${r.status}: ${r.stderr.slice(0, 500)}`);
        if (i >= WARMUP) samples.push(performance.now() - t);
      }
      return median(samples);
    };
    const startup = run(empty);
    return { total: run(dir), startup };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const cell = (x: number | undefined, digits = 1) =>
  x === undefined ? "-" : x.toFixed(digits);

async function main() {
  const args = process.argv.slice(2);
  const wanted = args.filter(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--ruff",
  );
  const rows: string[] = [];
  const verdicts: string[] = [];
  const failures: string[] = [];
  let ruff: string | undefined;

  for (const g of GROUPS) {
    if (wanted.length > 0 && !wanted.includes(g.id)) continue;
    const target = TARGETS.find((t) => t.id === g.target);
    if (!target) throw new Error(`no conformance target ${g.target}`);
    const sets: [string, Input[]][] = [
      [
        "corpus",
        g.corpus.flatMap((grammar) =>
          benchFiles(grammar).map((f) => ({ ...f, grammar })),
        ),
      ],
      [
        "fixtures",
        target.suite().cases.map((c) => ({
          name: c.fixture,
          text: c.text,
          grammar: target.grammar(c.fixture),
        })),
      ],
    ];

    // syntechs: its grammars and fmt module, loaded before any timing.
    const t0 = performance.now();
    const grammars = new Map<GrammarName, Grammar>();
    const langs = new Map<GrammarName, Language<unknown>>();
    for (const grammar of new Set(
      sets.flatMap(([, inputs]) => inputs.map((i) => i.grammar)),
    )) {
      const language = await load<Grammar>(
        new URL(`../grammars/${grammar}/index.js`, import.meta.url),
        "language",
      );
      const exportName =
        target.id === "ts" && grammar === "tsx" ? "tsx" : target.export;
      const lang = await load<Language<unknown>>(
        new URL(`../grammars/${target.fmt}/fmt.js`, import.meta.url),
        exportName,
      );
      if (language) grammars.set(grammar, language);
      if (lang) langs.set(grammar, lang);
    }
    const loadMs = performance.now() - t0;
    const implemented = langs.size > 0;

    // Keep the inputs every reference accepts, so each tool formats the same bytes.
    for (const set of sets) {
      const kept: Input[] = [];
      for (const input of set[1]) {
        if (g.prettier && g.oxfmtExt) {
          try {
            await prettier.format(input.text, {
              parser: g.prettier(input.grammar),
            });
          } catch {
            continue;
          }
          try {
            await oxfmt.format(
              `input.${g.oxfmtExt(input.grammar)}`,
              input.text,
              { printWidth: 80 },
            );
          } catch {
            continue;
          }
        }
        kept.push(input);
      }
      set[1] = kept;
    }

    let totals = { ours: 0, prettier: 0, oxfmt: 0, ruff: 0 };
    for (const [label, inputs] of sets) {
      const bytes = inputs.reduce((n, i) => n + Buffer.byteLength(i.text), 0);
      const ours = implemented
        ? await timed(() => {
            for (const i of inputs)
              format(
                parseTree(grammars.get(i.grammar) as Grammar, i.text),
                langs.get(i.grammar) as Language<unknown>,
              );
          })
        : undefined;
      // Correctness apart from the timing: `format` does not check its output, so the bench checks each once.
      if (implemented)
        for (const i of inputs) {
          const lang = langs.get(i.grammar) as Language<unknown>;
          const out = format(
            parseTree(grammars.get(i.grammar) as Grammar, i.text),
            lang,
          );
          const problem = out.ok
              ? check(lang, i.text, out.text)
              : `${out.reason}: ${out.detail}`;
          if (problem) failures.push(`${g.id} ${label} ${i.name}: ${problem}`);
        }
      let pretty: number | undefined;
      let ox: number | undefined;
      let rf: { total: number; startup: number } | undefined;
      if (g.prettier && g.oxfmtExt) {
        const parser = g.prettier;
        const ext = g.oxfmtExt;
        pretty = (
          await timed(async () => {
            for (const i of inputs)
              await prettier.format(i.text, { parser: parser(i.grammar) });
          })
        ).warm;
        ox = (
          await timed(async () => {
            for (const i of inputs)
              await oxfmt.format(`input.${ext(i.grammar)}`, i.text, {
                printWidth: 80,
              });
          })
        ).warm;
      } else {
        ruff ??= resolveRuff();
        rf = ruffTime(ruff, inputs);
      }
      const ref = rf ? rf.total - rf.startup : ox;
      totals = {
        ours: totals.ours + (ours?.warm ?? 0),
        prettier: totals.prettier + (pretty ?? 0),
        oxfmt: totals.oxfmt + (ox ?? 0),
        ruff: totals.ruff + (rf ? rf.total - rf.startup : 0),
      };
      const mbs = (ms: number | undefined) =>
        ms === undefined ? undefined : bytes / 1e6 / (ms / 1e3);
      rows.push(
        `| ${g.id} | ${label} | ${inputs.length} | ${(bytes / 1024).toFixed(0)} | ${ours ? `${cell(ours.warm)} (${cell(mbs(ours.warm), 2)} MB/s)` : "not implemented"} | ${cell(ours?.cold)} | ${pretty === undefined ? "-" : `${cell(pretty)} (${cell(mbs(pretty), 2)} MB/s)`} | ${ox === undefined ? "-" : `${cell(ox)} (${cell(mbs(ox), 2)} MB/s)`} | ${rf ? `${cell(rf.total - rf.startup)} (+${cell(rf.startup)} startup)` : "-"} | ${ours && ref ? cell(ours.warm / ref, 2) : "-"} | ${ours && pretty ? cell(ours.warm / pretty, 2) : "-"} |`,
      );
    }
    if (!implemented) {
      verdicts.push(
        `${g.id}: not implemented (no fmt module export \`${target.export}\`)`,
      );
      continue;
    }
    const ref = g.prettier ? totals.oxfmt : totals.ruff;
    const refName = g.prettier ? "oxfmt" : "ruff";
    const vsRef = totals.ours / ref;
    const pass = vsRef <= 5 && (!g.prettier || totals.ours < totals.prettier);
    verdicts.push(
      `${g.id}: ${pass ? "PASS" : "FAIL"} (syntechs ${totals.ours.toFixed(1)} ms = ${vsRef.toFixed(2)}x ${refName}${g.prettier ? `, ${(totals.ours / totals.prettier).toFixed(2)}x prettier` : ""}; load ${loadMs.toFixed(0)} ms not counted)`,
    );
  }

  console.log(
    `Warm = median of ${RUNS} passes after ${WARMUP}; cold = the first pass after load. ms per pass over the set.\n`,
  );
  console.log(
    "| Language | Inputs | Files | KB | syntechs warm ms | syntechs cold ms | prettier ms | oxfmt ms | ruff ms | syntechs / oxfmt (ruff) | syntechs / prettier |",
  );
  console.log(
    "| :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |",
  );
  for (const r of rows) console.log(r);
  console.log(
    "\nTarget: syntechs <= 5x oxfmt and < prettier (Python: <= 5x ruff), over corpus + fixtures.",
  );
  for (const v of verdicts) console.log(v);
  console.log(
    failures.length === 0
      ? "\nEvery output passed `check`."
      : `\n${failures.length} outputs failed \`check\` (untimed):\n${failures.join("\n")}`,
  );
}

await main();
