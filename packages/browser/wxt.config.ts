import path from "node:path";
import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import type { Plugin } from "vite";
import { defineConfig } from "wxt";
import { browserSafe, conditions } from "./browser-safe.ts";

const engineGrammarsPath = fileURLToPath(
  new URL("../engine/src/grammars.ts", import.meta.url),
);

/** Keeps the extension's app IIFE small by resolving the engine's existing lazy loaders through injected globals. */
function injectedGrammarModules(): Plugin {
  return {
    name: "hihyou:injected-grammar-modules",
    enforce: "pre",
    transform(code, id) {
      if (
        path.normalize(id.split("?", 1)[0] ?? "") !==
        path.normalize(engineGrammarsPath)
      )
        return null;
      let imports = 0;
      const transformed = code.replace(
        /import\((["'])(syntechs\/grammars\/[^"']+)\1\)/g,
        (_match, _quote: string, specifier: string) => {
          imports++;
          return `hihyouGrammarModule(${JSON.stringify(specifier)})`;
        },
      );
      if (imports !== 39)
        throw new Error(
          `expected 39 lazy syntechs grammar imports in ${id}, found ${imports}`,
        );
      return {
        code: `const hihyouGrammarModule = (id) => {\n  const module = globalThis.hihyouGrammarModules?.[id];\n  if (!module) return Promise.reject(new Error(\`grammar module \${id} was not injected\`));\n  return Promise.resolve(module);\n};\n${transformed}`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  manifest: ({ browser }) => ({
    name: "hihyou",
    description:
      "Review GitHub pull requests with hihyou's syntax-aware diff, in place of the Files changed tab.",
    homepage_url: "https://github.com/RanolP/hihyou",
    permissions: ["scripting"],
    host_permissions: [
      "https://github.com/*",
      "https://api.github.com/*",
      "https://patch-diff.githubusercontent.com/*",
      "https://raw.githubusercontent.com/*",
    ],
    browser_specific_settings: {
      gecko: {
        id: "hihyou@ranolp.github.io",
        ...(browser === "firefox"
          ? {
              data_collection_permissions: { required: ["none"] },
              strict_min_version: "140.0",
            }
          : {}),
      },
    },
  }),
  zip: {
    sourcesRoot: path.resolve(process.cwd(), "../.."),
    includeSources: [
      "LICENSE",
      "mise.toml",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig*.json",
      "packages/browser/**",
      "packages/engine/**",
      "packages/github/**",
      "packages/syntechs/**",
      "packages/ui/**",
    ],
    excludeSources: [
      "**/.output/**",
      "**/.wxt/**",
      "**/dist/**",
      "**/fixture/**",
      "**/fixtures/**",
      "**/test/**",
      "**/tests/**",
      "**/corpus/**",
      "**/conformance/**",
      "**/*.tsbuildinfo",
      "packages/syntechs/grammars/.cache/**",
      "packages/website/docs/**",
    ],
  },
  vite: () => ({
    resolve: { conditions },
    // WXT imports each entrypoint in Node to read its definition, with every dependency external. A workspace
    // package would then load its tsc output, which has no .js for a .tsx module (jsx is preserved), so the
    // workspace packages are bundled from source there too.
    environments: {
      inline: { resolve: { noExternal: [/^@hihyou\//], conditions } },
    },
    plugins: [injectedGrammarModules(), browserSafe(), solid()],
  }),
});
