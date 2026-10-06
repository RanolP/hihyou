// Ratchet the committed shiki colour parity floor per language.
// Usage: node packages/syntechs/dist/highlight/gate.node.js [--corpus bench] [--matrix path]

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { measureParity } from "./parity.node.js";

interface MatrixGroup {
  id: string;
  compared: number;
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

async function main(): Promise<void> {
  const matrixPath = resolve(
    arg(
      "--matrix",
      join(import.meta.dirname, "../../src/highlight/parity.matrix.json"),
    ),
  );
  const matrix = loadMatrix(matrixPath);
  const corpus = arg("--corpus", matrix.corpus);
  const failures: string[] = [];
  for (const baseline of matrix.groups) {
    const current = await measureParity(baseline.id, corpus, matrix.theme, 0);
    if (current.compared === 0)
      failures.push(`${baseline.id}: no comparable characters`);
    else if (current.parity + 1e-9 < baseline.parity)
      failures.push(
        `${baseline.id}: parity ${current.parity.toFixed(2)}% < ${baseline.parity.toFixed(2)}%`,
      );
  }
  if (failures.length > 0)
    throw new Error(
      `highlight gate failed:\n${failures.map((f) => `- ${f}`).join("\n")}`,
    );
  console.log(`highlight gate passed: ${matrix.groups.length} parity floors`);
}

if (
  import.meta.url ===
  `file://${process.argv[1]?.replaceAll("\\", "/").replace(/^\/?/, "/")}`
)
  await main();
