import solid from "vite-plugin-solid";
import { defineConfig } from "wxt";
import { browserSafe, conditions } from "./browser-safe.ts";

export default defineConfig({
  manifest: {
    name: "hihyou",
    description:
      "Review GitHub pull requests with hihyou's syntax-aware diff, in place of the Files changed tab.",
    permissions: ["scripting"],
    host_permissions: [
      "https://github.com/*",
      "https://patch-diff.githubusercontent.com/*",
      "https://raw.githubusercontent.com/*",
    ],
    browser_specific_settings: {
      gecko: { id: "hihyou@ranolp.github.io" },
    },
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
