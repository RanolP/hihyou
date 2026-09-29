// Writes src/grammars/<name>/fmt.gen.ts from each language's formatter spec, src/grammars/<name>/format.ts. Like
// the bundles, the output is derived and untracked; packages/syntechs/generate.mjs bundles this file with esbuild
// and runs it after the bundles exist, since a spec reads its bundle's grammar.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as cssFormat from "../../grammars/css/format.js";
import { grammar as cssGrammar } from "../../grammars/css/index.js";
import * as javascriptFormat from "../../grammars/javascript/format.js";
import { grammar as javascriptGrammar } from "../../grammars/javascript/index.js";
import * as jsonFormat from "../../grammars/json/format.js";
import * as kotlinFormat from "../../grammars/kotlin/format.js";
import { grammar as kotlinGrammar } from "../../grammars/kotlin/index.js";
import * as pythonFormat from "../../grammars/python/format.js";
import { grammar as pythonGrammar } from "../../grammars/python/index.js";
import { grammar as tsxGrammar } from "../../grammars/tsx/index.js";
import type { DslGrammar, FormatIR } from "./dsl.js";
import { emit } from "./emit.js";

// Run as generate.mjs's bundle, dist/compiler/fmt-generate.mjs.
const pkg = resolve(import.meta.dirname, "../..");

const FORMATS: Record<
  string,
  { specs: Record<string, FormatIR>; grammar: DslGrammar; sink?: string }
> = {
  css: { specs: cssFormat, grammar: cssGrammar as DslGrammar },
  // Prettier reads JSON as a JS expression, so JSON5's forms parse (see json/format.ts).
  json: { specs: jsonFormat, grammar: javascriptGrammar as DslGrammar },
  kotlin: { specs: kotlinFormat, grammar: kotlinGrammar as DslGrammar },
  // JS's rules move off the Doc a kind at a time, so they write through a sink that records Docs (sink.ts).
  javascript: { specs: javascriptFormat, grammar: tsxGrammar as DslGrammar, sink: "./sink.js" },
  // Python's rules are parts of ruff's, which read their output as values (fmt/sink.ts).
  python: { specs: pythonFormat, grammar: pythonGrammar as DslGrammar, sink: "./fmt/sink.js" },
};

for (const [name, { specs, grammar, sink }] of Object.entries(FORMATS)) {
  const out = join(pkg, "src", "grammars", name, "fmt.gen.ts");
  writeFileSync(out, emit(specs, grammar, `src/grammars/${name}/format.ts`, sink));
  console.log(`wrote ${out}`);
}
