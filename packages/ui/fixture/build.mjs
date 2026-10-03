// Diffs a few files between real revisions of this repo with the engine, then bundles the page that renders
// the result. `pnpm --filter @hihyou/ui fixture`, then open fixture/index.html.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { changes, readBlob } from "./changes.mjs";

const here = import.meta.dirname;
const out = join(here, "dist");
mkdirSync(out, { recursive: true });

const engineOut = join(out, "engine.mjs");
await build({
  stdin: {
    contents: `export { createEngine, syntechsGrammars } from "@hihyou/engine";`,
    resolveDir: here,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  conditions: ["@hihyou/source"],
  outfile: engineOut,
  logLevel: "warning",
});
const { createEngine, syntechsGrammars } = await import(
  pathToFileURL(engineOut).href
);
const engine = createEngine({
  grammars: syntechsGrammars(),
  resolveDiffset: () => ({ id: "fixture", changes }),
  readBlob,
});
const diffset = await engine.diffset("fixture");
const diffs = await diffset.diff();
const files = diffs.map((diff, i) => ({ ...diff, change: changes[i] }));
writeFileSync(join(out, "files.json"), JSON.stringify(files));

/** The page has no engine to ask, so every elided run's whole text is read here, keyed as the page asks for it. */
const startOf = (f) =>
  f.kind === "unchanged" || f.kind === "elided"
    ? f.lines
    : f.kind === "diff"
      ? { before: f.before.startLine, after: f.after.startLine }
      : undefined;
const expansions = {};
for (const file of files)
  for (const [i, f] of file.fragments.entries()) {
    if (f.kind !== "elided") continue;
    const next = file.fragments
      .slice(i + 1)
      .map(startOf)
      .find(Boolean);
    const count = next && next.after - f.lines.after;
    const key = `${file.path}|${f.lines.before}|${f.lines.after}|${count ?? ""}`;
    expansions[key] = await diffset.expand(file.path, f.lines, count);
  }
writeFileSync(join(out, "expansions.json"), JSON.stringify(expansions));

await build({
  entryPoints: [join(here, "main.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  conditions: ["@hihyou/source"],
  outfile: join(out, "main.js"),
  plugins: [solidPlugin()],
  logLevel: "warning",
});
console.log(`fixture: ${files.length} files -> ${join(out, "main.js")}`);
