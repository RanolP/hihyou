// Bundles the extension: dist/extension.js (desktop, Node), dist/web/extension.js (vscode.dev, github.dev) and
// dist/webview.js (the panel's page). Workspace packages resolve to their TypeScript sources, as tsc and vitest do.
import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";

const here = import.meta.dirname;
const shared = {
  bundle: true,
  conditions: ["@hihyou/source"],
  sourcemap: true,
  logLevel: "warning",
};
// @hihyou/ui draws with Solid: its .tsx goes through Solid's JSX compiler, not esbuild's React transform.
const solid = solidPlugin();

// A web extension has no Node, so a Node import that sneaks into the shared code must fail the build, not the
// extension at run time.
const builtins = new Set(builtinModules);
const noNode = {
  name: "no-node",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) =>
      args.path.startsWith("node:") || builtins.has(args.path)
        ? {
            errors: [
              {
                text: `web extension imports Node built-in "${args.path}" (from ${args.importer})`,
              },
            ],
          }
        : undefined,
    );
  },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(here, "src/extension.node.ts")],
    outfile: join(here, "dist/extension.js"),
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    plugins: [solid],
  }),
  build({
    ...shared,
    entryPoints: [join(here, "src/extension.web.ts")],
    outfile: join(here, "dist/web/extension.js"),
    platform: "browser",
    format: "cjs",
    target: "es2023",
    external: ["vscode"],
    plugins: [noNode, solid],
  }),
  build({
    ...shared,
    entryPoints: [join(here, "src/panel/webview.ts")],
    outfile: join(here, "dist/webview.js"),
    platform: "browser",
    format: "iife",
    target: "es2023",
    plugins: [noNode, solid],
  }),
]);
// The plugin sees only what esbuild resolves; this reads the emitted text, so a require the bundler passed
// through (an `external`, a shim's own require) is caught too.
const nodeRef = new RegExp(
  String.raw`\b(?:require|import)\s*\(\s*["'](?:node:[^"']*|${[...builtins].map((m) => m.replaceAll("/", "\\/")).join("|")})["']\s*\)|\bfrom\s*["']node:`,
);
for (const out of ["dist/web/extension.js", "dist/webview.js"]) {
  const hit = nodeRef.exec(await readFile(join(here, out), "utf8"));
  if (hit) throw new Error(`${out} references Node: ${hit[0]}`);
}
console.log(`vscode: bundled into ${join(here, "dist")}`);
