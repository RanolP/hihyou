// Formatting speed against the reference tools, on the same inputs: the large corpus files (fetch-corpus.sh,
// research/parser-bench) and the conformance fixtures, each at its tool's defaults with an 80-column width.
// The target: syntechs within 5x oxfmt's time and faster than prettier's; for Python, within 5x ruff's. oxfmt
// covers every prettier-family language here (JSON and CSS natively too), so it is the reference for each.
//
//   node packages/syntechs/dist/fmt/bench.node.js [language...] [--ruff <path to ruff>]
//
// Every tool is timed the same way, folder level: the inputs are written to a temp dir once, then per pass the
// unformatted copies are restored and ONE whole-process CLI invocation formats the directory in place (2
// warmups, median of 5). oxfmt and prettier run their own bin/ script under this Node (`--write`, print width
// 80); ruff is the native binary `mise which ruff` resolves (or `--ruff`), `format --isolated --no-cache`, one
// thread; syntechs runs through fmt/cli.node.js, a minimal directory-formatting entry built for this bench, bundled by
// tsdown as a Node CLI ships (prettier and oxfmt ship theirs bundled too), so startup loads a few files rather
// than resolving, stat-ing and compiling ~60 modules one by one. All four pay their own process/Node startup, so the comparison is apples to apples. The pre-existing in-process
// syntechs timing (parse + format only, no process startup) is kept as a secondary "in-process" column; it is
// not used for the ratio or the verdict.

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
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

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const require = createRequire(import.meta.url);

function resolveRuff(): string {
  const at = process.argv.indexOf("--ruff");
  if (at !== -1 && process.argv[at + 1]) return process.argv[at + 1] as string;
  try {
    return execFileSync("mise", ["which", "ruff"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error(
      "ruff not found via `mise which ruff`; run `mise install` in the repo root",
    );
  }
}

/** The bin script a package declares, resolved from its own package.json — never a mise or pnpm shim. */
function resolveBin(pkg: string): string {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof bin === "string" ? bin : (bin[pkg] as string);
  return join(dirname(pkgJsonPath), rel);
}

/** Bundles fmt/cli.node.js into `outdir`, split per language like its dynamic imports; returns the entry. */
async function bundleCli(outdir: string): Promise<string> {
  await build({
    entry: {
      "cli.node": fileURLToPath(new URL("./cli.node.js", import.meta.url)),
    },
    format: "esm",
    platform: "node",
    outDir: outdir,
    dts: false,
    clean: false,
    config: false,
    // Bundle every dependency, matching esbuild's `bundle: true` -- otherwise tsdown externalizes
    // node_modules imports (e.g. emoji-regex), and the bundle can't run standalone.
    deps: { alwaysBundle: /.*/ },
    logLevel: "warn",
  });
  return join(outdir, "cli.node.mjs");
}

/**
 * Writes `inputs` once to a fresh temp dir (extension per `extOf`, so each CLI infers the right language), then
 * runs `run(dir)` for `WARMUP` + `RUNS` passes, restoring the unformatted copies before each. Returns the
 * median whole-process time of `run` alone (restore excluded) and the dir, for an error message.
 */
function folderTime(
  inputs: Input[],
  extOf: (i: Input) => string,
  run: (dir: string) => void,
): { ms: number; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "syntechs-bench-"));
  const dir = join(root, "inputs");
  mkdirSync(dir);
  const files = inputs.map((input, i) => ({
    path: join(dir, `${i}.${extOf(input)}`),
    text: input.text,
  }));
  try {
    const pass = () => {
      for (const f of files) writeFileSync(f.path, f.text);
      const t = performance.now();
      run(dir);
      return performance.now() - t;
    };
    for (let i = 0; i < WARMUP; i++) pass();
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) samples.push(pass());
    return { ms: median(samples), dir };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const runNode =
  (bin: string, args: string[]) =>
  (dir: string): void => {
    const r = spawnSync(process.execPath, [bin, ...args, dir], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (r.status !== 0)
      throw new Error(
        `${bin} ${args.join(" ")} ${dir} exited ${r.status}: ${r.stderr.slice(0, 500)}`,
      );
  };

const runRuff =
  (bin: string) =>
  (dir: string): void => {
    const r = spawnSync(bin, ["format", "--isolated", "--no-cache", dir], {
      cwd: REPO_ROOT,
      env: { ...process.env, RAYON_NUM_THREADS: "1" },
      encoding: "utf8",
    });
    if (r.status !== 0)
      throw new Error(`ruff exited ${r.status}: ${r.stderr.slice(0, 500)}`);
  };

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
  let oxfmtBin: string | undefined;
  let prettierBin: string | undefined;
  const cliRoot = mkdtempSync(join(tmpdir(), "syntechs-bench-cli-"));
  const CLI_PATH = await bundleCli(cliRoot);
  console.log(`syntechs CLI: ${CLI_PATH}`);

  // oxfmt's own printWidth default is 100; this config, outside every bench dir so it is never itself
  // formatted, pins it to 80 to match the in-process options and prettier's --print-width.
  const oxfmtConfigRoot = mkdtempSync(join(tmpdir(), "syntechs-bench-cfg-"));
  const oxfmtConfig = join(oxfmtConfigRoot, ".oxfmtrc.json");
  writeFileSync(oxfmtConfig, JSON.stringify({ printWidth: 80 }));

  try {
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
            if (problem)
              failures.push(`${g.id} ${label} ${i.name}: ${problem}`);
          }

        let pretty: number | undefined;
        let ox: number | undefined;
        let rf: number | undefined;
        let oursFolder: number | undefined;
        if (g.prettier && g.oxfmtExt) {
          const extOf = (i: Input) =>
            (g.oxfmtExt as (g: GrammarName) => string)(i.grammar);
          if (oxfmtBin === undefined) {
            oxfmtBin = resolveBin("oxfmt");
            console.log(`oxfmt CLI: ${oxfmtBin}`);
          }
          if (prettierBin === undefined) {
            prettierBin = resolveBin("prettier");
            console.log(`prettier CLI: ${prettierBin}`);
          }
          ox = folderTime(
            inputs,
            extOf,
            runNode(oxfmtBin, [
              "--write",
              "--disable-nested-config",
              "-c",
              oxfmtConfig,
              "--threads=1",
            ]),
          ).ms;
          pretty = folderTime(
            inputs,
            extOf,
            runNode(prettierBin, ["--write", "--print-width=80"]),
          ).ms;
          if (implemented)
            oursFolder = folderTime(inputs, extOf, runNode(CLI_PATH, [])).ms;
        } else {
          const extOf = () => "py";
          if (ruff === undefined) {
            ruff = resolveRuff();
            console.log(`ruff: ${ruff}`);
          }
          rf = folderTime(inputs, extOf, runRuff(ruff)).ms;
          if (implemented)
            oursFolder = folderTime(inputs, extOf, runNode(CLI_PATH, [])).ms;
        }
        const ref = rf ?? ox;
        totals = {
          ours: totals.ours + (oursFolder ?? 0),
          prettier: totals.prettier + (pretty ?? 0),
          oxfmt: totals.oxfmt + (ox ?? 0),
          ruff: totals.ruff + (rf ?? 0),
        };
        const mbs = (ms: number | undefined) =>
          ms === undefined ? undefined : bytes / 1e6 / (ms / 1e3);
        rows.push(
          `| ${g.id} | ${label} | ${inputs.length} | ${(bytes / 1024).toFixed(0)} | ${oursFolder !== undefined ? `${cell(oursFolder)} (${cell(mbs(oursFolder), 2)} MB/s)` : implemented ? "-" : "not implemented"} | ${ours ? cell(ours.warm) : "-"} | ${pretty === undefined ? "-" : `${cell(pretty)} (${cell(mbs(pretty), 2)} MB/s)`} | ${ox === undefined ? "-" : `${cell(ox)} (${cell(mbs(ox), 2)} MB/s)`} | ${rf === undefined ? "-" : cell(rf)} | ${oursFolder && ref ? cell(oursFolder / ref, 2) : "-"} | ${oursFolder && pretty ? cell(oursFolder / pretty, 2) : "-"} |`,
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
        `${g.id}: ${pass ? "PASS" : "FAIL"} (syntechs ${totals.ours.toFixed(1)} ms folder = ${vsRef.toFixed(2)}x ${refName}${g.prettier ? `, ${(totals.ours / totals.prettier).toFixed(2)}x prettier` : ""}; load ${loadMs.toFixed(0)} ms not counted)`,
      );
    }
  } finally {
    rmSync(oxfmtConfigRoot, { recursive: true, force: true });
    rmSync(cliRoot, { recursive: true, force: true });
  }

  console.log(
    `\nWarm = median of ${RUNS} passes after ${WARMUP}; each pass is one whole-process CLI invocation over the input directory. ms per pass over the set.\n`,
  );
  console.log(
    "| Language | Inputs | Files | KB | syntechs folder ms | syntechs in-process ms | prettier folder ms | oxfmt folder ms | ruff folder ms | syntechs / oxfmt (ruff) | syntechs / prettier |",
  );
  console.log(
    "| :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |",
  );
  for (const r of rows) console.log(r);
  console.log(
    "\nTarget: syntechs <= 5x oxfmt and < prettier (Python: <= 5x ruff), over corpus + fixtures, all folder-level. The in-process column (parse + format, no process startup) is a secondary diagnostic, not the verdict.",
  );
  for (const v of verdicts) console.log(v);
  console.log(
    failures.length === 0
      ? "\nEvery output passed `check`."
      : `\n${failures.length} outputs failed \`check\` (untimed):\n${failures.join("\n")}`,
  );
}

await main();
