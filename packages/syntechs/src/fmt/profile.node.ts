// Formats a grammar's bench files (corpus.node.ts `benchFiles`) warm, many times, so a CPU profile of it shows
// where a format pass spends its time.
// Usage: node --cpu-prof --cpu-prof-dir=<dir> packages/syntechs/dist/fmt/profile.node.js <json|css> [passes]

import { benchFiles } from "../core/corpus.node.js";
import { parse } from "../core/index.js";
import { css } from "../grammars/css/fmt.js";
import { language as cssGrammar } from "../grammars/css/index.js";
import { jsonLanguageFor } from "../grammars/json/fmt.js";
import { language as jsonGrammar } from "../grammars/json/index.js";
import { type FormatNode, format } from "./index.js";

const targets = {
  json: {
    grammar: jsonGrammar,
    run: (root: FormatNode, text: string, path: string) =>
      format(root, text, jsonLanguageFor(path)),
  },
  css: {
    grammar: cssGrammar,
    run: (root: FormatNode, text: string) => format(root, text, css),
  },
};

const name = process.argv[2];
if (name !== "json" && name !== "css")
  throw new Error(`usage: profile.node.js <json|css> [passes], got ${name}`);
const passes = Number(process.argv[3] ?? 10);
const { grammar, run } = targets[name];
const files = benchFiles(name);

function pass(): { parse: number; format: number } {
  let parseMs = 0;
  let formatMs = 0;
  for (const { name: path, text } of files) {
    const t0 = performance.now();
    const root = parse(grammar, text).nodes[0];
    const t1 = performance.now();
    if (!root) throw new Error(`${path}: empty tree`);
    const out = run(root, text, path);
    formatMs += performance.now() - t1;
    parseMs += t1 - t0;
    if (!out.ok) throw new Error(`${path}: ${out.reason}: ${out.detail}`);
  }
  return { parse: parseMs, format: formatMs };
}

for (let i = 0; i < 3; i++) pass();
const samples = Array.from({ length: passes }, pass);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const p = median(samples.map((s) => s.parse)) ?? 0;
const f = median(samples.map((s) => s.format)) ?? 0;
const total = median(samples.map((s) => s.parse + s.format)) ?? 0;
console.log(
  `${name}: ${files.map((f) => f.name).join(", ")}\n` +
    `median of ${passes} warm passes: ${total.toFixed(1)} ms (parse ${p.toFixed(1)}, format ${f.toFixed(1)})`,
);
