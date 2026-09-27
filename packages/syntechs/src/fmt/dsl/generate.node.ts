// Writes src/grammars/<name>/fmt.gen.ts from each language's formatter spec, src/grammars/<name>/format.ts. Like
// the bundles, the output is derived and untracked; packages/syntechs/generate.mjs bundles this file with esbuild
// and runs it after the bundles exist, since a spec reads its bundle's grammar.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as cssFormat from "../../grammars/css/format.js";
import { grammar as cssGrammar } from "../../grammars/css/index.js";
import * as jsonFormat from "../../grammars/json/format.js";
import { grammar as jsonGrammar } from "../../grammars/json/index.js";
import * as pythonFormat from "../../grammars/python/format.js";
import { grammar as pythonGrammar } from "../../grammars/python/index.js";
import type { DslGrammar, FormatIR } from "./dsl.js";
import { emit } from "./emit.js";

// Run as generate.mjs's bundle, dist/compiler/fmt-generate.mjs.
const pkg = resolve(import.meta.dirname, "../..");

const FORMATS: Record<string, { specs: Record<string, FormatIR>; grammar: DslGrammar }> = {
  css: { specs: cssFormat, grammar: cssGrammar as DslGrammar },
  json: { specs: jsonFormat, grammar: jsonGrammar as DslGrammar },
  python: { specs: pythonFormat, grammar: pythonGrammar as DslGrammar },
};

for (const [name, { specs, grammar }] of Object.entries(FORMATS)) {
  const out = join(pkg, "src", "grammars", name, "fmt.gen.ts");
  writeFileSync(out, emit(specs, grammar, `src/grammars/${name}/format.ts`));
  console.log(`wrote ${out}`);
}
