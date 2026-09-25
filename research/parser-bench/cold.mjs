// Cold start: each sample is a fresh `node` process. Usage: node cold.mjs [runs]
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "--child") {
  const { performance } = await import("node:perf_hooks");
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const t = {};
  let t0 = performance.now();
  const { Parser, Language } = await import("web-tree-sitter");
  t.importJs = performance.now() - t0;
  t0 = performance.now();
  await Parser.init();
  t.initRuntimeWasm = performance.now() - t0;
  for (const [k, pkg, f] of [
    ["ts", "tree-sitter-typescript", "tree-sitter-typescript.wasm"],
    ["py", "tree-sitter-python", "tree-sitter-python.wasm"],
    ["json", "tree-sitter-json", "tree-sitter-json.wasm"],
  ]) {
    const bytes = readFileSync(require.resolve(`${pkg}/${f}`));
    t0 = performance.now();
    const lang = await Language.load(bytes);
    t[`load_${k}`] = performance.now() - t0;
    const p = new Parser();
    p.setLanguage(lang);
    t0 = performance.now();
    p.parse(k === "json" ? '{"a":[1,2]}' : k === "py" ? "x = 1\n" : "let a: number = 1;");
    t[`firstTinyParse_${k}`] = performance.now() - t0;
  }
  t0 = performance.now();
  const { parser } = await import("@lezer/javascript");
  const lz = parser.configure({ dialect: "ts" });
  t.lezerImportConfigure = performance.now() - t0;
  t0 = performance.now();
  lz.parse("let a: number = 1;");
  t.lezerFirstTinyParse = performance.now() - t0;
  process.stdout.write(JSON.stringify(t));
} else {
  const runs = Number(process.argv[2] ?? 7);
  const self = fileURLToPath(import.meta.url);
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(JSON.parse(execFileSync(process.execPath, [self, "--child"], { encoding: "utf8" })));
  const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  console.log(`node ${process.version}, ${runs} fresh processes, median ms`);
  for (const k of Object.keys(samples[0])) console.log(`${k}\t${median(samples.map((s) => s[k])).toFixed(1)}`);
}
