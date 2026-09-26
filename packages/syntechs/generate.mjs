// Regenerates the language bundles: `node packages/syntechs/generate.mjs [grammar...]`. The root postinstall runs
// it with plain node, not a nested `pnpm run`, whose task-state files overflow Windows' 260-character path limit
// in a deep checkout. The compiler is TypeScript and the TypeScript build needs the bundles, so esbuild bundles
// it first.
//
// scripts/worktree-setup.sh sets HIHYOU_SKIP_GRAMMAR_GENERATE when it has already copied bundle.js files built
// from a checkout on the same pnpm-lock.yaml, so a fresh worktree's install doesn't redo this work.
if (process.env.HIHYOU_SKIP_GRAMMAR_GENERATE) {
  console.log(
    "generate.mjs: HIHYOU_SKIP_GRAMMAR_GENERATE set, reusing the copied grammar bundles",
  );
  process.exit(0);
}

import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = import.meta.dirname;
const outfile = `${here}/dist/compiler/generate.mjs`;
await build({
  entryPoints: [`${here}/src/compiler/compile.node.ts`],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "warning",
  outfile,
});
await import(pathToFileURL(outfile).href);
