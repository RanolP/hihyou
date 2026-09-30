// Regenerates the language bundles: `node packages/syntechs/generate.mjs [grammar...]`. syntechs' postinstall runs
// it with plain node, not a nested `pnpm run`, whose task-state files overflow Windows' 260-character path limit
// in a deep checkout. The compiler is TypeScript and the TypeScript build needs the bundles, so esbuild bundles
// it first.
//
// scripts/worktree-setup.js sets HIHYOU_SKIP_GRAMMAR_GENERATE when it has already copied bundle.js files built
// from a checkout on the same pnpm-lock.yaml and grammar packages, so a fresh worktree's install doesn't redo this work.
//
// The formatters, src/grammars/<name>/fmt.gen.ts, are generated from the bundles and each language's format.ts
// every time, the copied bundles included: they are cheap, and a spec edit must reach them.

import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = import.meta.dirname;
const run = async (entry, name) => {
  const outfile = `${here}/dist/compiler/${name}`;
  await build({
    entryPoints: [`${here}/src/${entry}`],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "warning",
    outfile,
  });
  await import(pathToFileURL(outfile).href);
};

if (process.env.HIHYOU_SKIP_GRAMMAR_GENERATE)
  console.log(
    "generate.mjs: HIHYOU_SKIP_GRAMMAR_GENERATE set, reusing the copied grammar bundles",
  );
else await run("compiler/compile.node.ts", "generate.mjs");
await run("fmt/dsl/generate.node.ts", "fmt-generate.mjs");
