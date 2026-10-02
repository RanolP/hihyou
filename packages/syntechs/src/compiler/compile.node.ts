// Writes every language bundle, src/grammars/<name>/bundle.js, from the grammar packages' generated sources.
// The bundles are derived and untracked: `pnpm install` runs this through packages/syntechs/generate.mjs, which
// bundles this file with esbuild first, because the TypeScript build itself needs the bundles to exist.
//   node packages/syntechs/generate.mjs [grammar...]
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GRAMMARS } from "./grammars.js";
import { compile } from "./index.js";

// Both this file's tsc output and the generate script's bundle sit in dist/compiler/.
const pkg = resolve(import.meta.dirname, "../..");

const only = process.argv.slice(2);
for (const [name, g] of Object.entries(GRAMMARS)) {
  if (only.length > 0 && !only.includes(name)) continue;
  const modules = join(pkg, "node_modules");
  const { version } = JSON.parse(
    readFileSync(
      join(modules, g.src.split("/")[0] as string, "package.json"),
      "utf8",
    ),
  ) as { version: string };
  const read = (file: string) =>
    readFileSync(join(modules, g.src, file), "utf8");
  const text = compile({
    parserC: read("parser.c"),
    grammarJson: read("grammar.json"),
    nodeTypesJson: read("node-types.json"),
    comments: g.comments,
    origin: `${g.src}/parser.c (${version})`,
  });
  const out = join(pkg, "src", "grammars", name, "bundle.js");
  writeFileSync(out, text);
  console.log(`wrote ${out} (${(text.length / 1024).toFixed(0)} KiB)`);
}
