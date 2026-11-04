import path from "node:path";
import solid from "vite-plugin-solid";
import { defineConfig } from "wxt";
import { browserSafe, conditions } from "./browser-safe.ts";

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
    plugins: [browserSafe(), solid()],
  }),
});
