// Diffs a few files between real revisions of this repo with the engine, then bundles the page that renders
// the result. `pnpm --filter @hihyou/ui fixture`, then open fixture/index.html.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";

const here = import.meta.dirname;
const out = join(here, "dist");
mkdirSync(out, { recursive: true });

const move = "packages/engine/fixtures/cross-file-move";
const extract = join(here, "../../engine/fixtures/extract");
/** Blob ids are `<rev>:<path>`, which `git show` reads as is. */
const changes = [
  {
    path: "packages/engine/src/interdiff.ts",
    before: "e6d26b0:packages/engine/src/interdiff.ts",
    after: "5f48679:packages/engine/src/interdiff.ts",
  },
  {
    path: "src/util.ts",
    before: `e6d26b0^:${move}/before/src/util.ts`,
    after: `e6d26b0^:${move}/after/src/util.ts`,
  },
  {
    path: "src/text.ts",
    before: null,
    after: `e6d26b0^:${move}/after/src/text.ts`,
  },
  {
    path: "packages/engine/src/move.ts",
    oldPath: "packages/engine/src/match/cross-file.ts",
    before: "e6d26b0^:packages/engine/src/match/cross-file.ts",
    after: "e6d26b0:packages/engine/src/move.ts",
  },
  {
    path: "docs/design/review-core.md",
    before: "e6d26b0:docs/design/review-core.md",
    after: "5f48679:docs/design/review-core.md",
  },
  {
    path: "packages/engine/src/doc/fold.ts",
    before: "e6d26b0^:packages/engine/src/doc/fold.ts",
    after: null,
  },
  {
    path: "pnpm-lock.yaml",
    before: "e6d26b0^:pnpm-lock.yaml",
    after: "e6d26b0:pnpm-lock.yaml",
  },
  // Whole units: an added file, a function added whole to a changed file, and a method added to a class
  // beside a local added inside another method, which stays no unit.
  { path: "src/whole/added.ts", before: null, after: "synthetic:added" },
  {
    path: "src/whole/shop.ts",
    before: "synthetic:shop-before",
    after: "synthetic:shop-after",
  },
  {
    path: "src/whole/cart.ts",
    before: "synthetic:cart-before",
    after: "synthetic:cart-after",
  },
  // An extract refactor, RanolP/hihyou#380: code of generate.node.ts went into the new kinds.node.ts.
  {
    path: "packages/syntechs/src/highlight/generate.node.ts",
    before: `file:${extract}/before/generate.node.ts`,
    after: `file:${extract}/after/generate.node.ts`,
  },
  {
    path: "packages/syntechs/src/highlight/kinds.node.ts",
    before: null,
    after: `file:${extract}/after/kinds.node.ts`,
  },
];

const keep = `export function keep(a: number): number {
  return a * 2;
}
`;
/** Synthetic blobs, read by their `synthetic:` id instead of from git. */
const synthetic = {
  added: `export function extra(a: number): number {
  return a + 1;
}

export class Shop {
  open = true;
}
`,
  "shop-before": keep,
  "shop-after": `${keep}
export function extra(b: number): number {
  const c = b + 1;
  return c;
}
`,
  "cart-before": `export class Cart {
  total(prices: number[]): number {
    return prices.reduce((a, b) => a + b, 0);
  }
}
`,
  "cart-after": `export class Cart {
  total(prices: number[]): number {
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum;
  }

  clear(): void {
    this.total([]);
  }
}
`,
};

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
  readBlob: (id) =>
    id.startsWith("synthetic:")
      ? new TextEncoder().encode(synthetic[id.slice("synthetic:".length)])
      : id.startsWith("file:")
        ? new Uint8Array(readFileSync(id.slice("file:".length)))
        : new Uint8Array(
          execFileSync("git", ["show", id], { cwd: here, maxBuffer: 1 << 28 }),
        ),
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
