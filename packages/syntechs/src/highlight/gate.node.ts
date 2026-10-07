// Ratchet the committed shiki colour parity floor per language.
// Usage: node packages/syntechs/dist/highlight/gate.node.js [--corpus bench] [--matrix path] [--show N]

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { measureParity, type ParityResult } from "./parity.node.js";

interface MatrixGroup {
  id: string;
  compared: number;
  matched: number;
  parity: number;
}

interface Matrix {
  theme: "github-dark";
  corpus: string;
  tools: { shiki: string };
  groups: MatrixGroup[];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

function loadMatrix(path: string): Matrix {
  const matrix = JSON.parse(readFileSync(path, "utf8")) as Matrix;
  if (matrix.theme !== "github-dark")
    throw new Error(`highlight gate: unsupported theme ${matrix.theme}`);
  if (matrix.tools.shiki !== "shiki 2.5.0")
    throw new Error(`highlight gate: matrix is not pinned to shiki 2.5.0`);
  if (matrix.groups.length === 0)
    throw new Error("highlight gate: matrix has no language groups");
  return matrix;
}

/** Full precision on purpose: a regression of a few characters in millions only shows past the 4th decimal. */
function report(floor: MatrixGroup, current: ParityResult): string {
  const lines = [
    `${floor.id}: measured ${current.parity}% < floor ${floor.parity}% (delta ${current.parity - floor.parity} points)`,
    `  matched ${current.matched}/${current.compared} chars over ${current.files} files; floor matched ${floor.matched}/${floor.compared}`,
    `  top mismatches (count, tree context: ours -> shiki's colour, first sample [our scope stack]):`,
  ];
  for (const m of current.mismatches)
    lines.push(`    ${m.count}\t${m.cause}\n\t\t${m.example}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const matrixPath = resolve(
    arg(
      "--matrix",
      join(import.meta.dirname, "../../src/highlight/parity.matrix.json"),
    ),
  );
  const matrix = loadMatrix(matrixPath);
  const corpus = arg("--corpus", matrix.corpus);
  const show = Number(arg("--show", "8"));
  const failures: string[] = [];
  for (const floor of matrix.groups) {
    const current = await measureParity(floor.id, corpus, matrix.theme, show);
    console.log(
      `${floor.id}\t${current.parity}%\tfloor ${floor.parity}%\tdelta ${current.parity - floor.parity}`,
    );
    if (current.compared === 0)
      failures.push(`${floor.id}: no comparable characters`);
    else if (current.parity + 1e-9 < floor.parity)
      failures.push(report(floor, current));
  }
  if (failures.length > 0) {
    console.error(`highlight gate failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`highlight gate passed: ${matrix.groups.length} parity floors`);
}

if (
  import.meta.url ===
  `file://${process.argv[1]?.replaceAll("\\", "/").replace(/^\/?/, "/")}`
)
  await main();
