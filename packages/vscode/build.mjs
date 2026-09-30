// Bundles the extension: dist/extension.js (desktop, Node), dist/web/extension.js (vscode.dev, github.dev) and
// dist/webview.js (the panel's page). Workspace packages resolve to their TypeScript sources, as tsc and vitest do.
import { builtinModules } from "node:module";
import { join } from "node:path";
import { build } from "esbuild";

const here = import.meta.dirname;
const shared = {
  bundle: true,
  conditions: ["@hihyou/source"],
  sourcemap: true,
  logLevel: "warning",
};

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
  }),
  build({
    ...shared,
    entryPoints: [join(here, "src/extension.web.ts")],
    outfile: join(here, "dist/web/extension.js"),
    platform: "browser",
    format: "cjs",
    target: "es2023",
    external: ["vscode"],
    plugins: [noNode],
  }),
  build({
    ...shared,
    entryPoints: [join(here, "src/panel/webview.ts")],
    outfile: join(here, "dist/webview.js"),
    platform: "browser",
    format: "iife",
    target: "es2023",
    plugins: [noNode],
  }),
]);
console.log(`vscode: bundled into ${join(here, "dist")}`);
