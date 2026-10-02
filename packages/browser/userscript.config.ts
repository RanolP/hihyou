// Builds hihyou.user.js, the extension as a userscript for Tampermonkey and Violentmonkey, and hihyou.meta.js, its
// metadata block alone, which a manager polls for updates instead of the whole script. The website serves both.
//   vite build -c userscript.config.ts
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { browserSafe, conditions } from "./browser-safe.ts";

const { version } = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url), "utf8"),
) as { version: string };
// GitHub Pages serves the website (packages/website) here.
const site = "https://ranolp.github.io/hihyou/";

const metadata = [
  "// ==UserScript==",
  "// @name         hihyou",
  "// @namespace    https://github.com/RanolP/hihyou",
  `// @version      ${version}`,
  "// @description  Review GitHub pull requests with hihyou's syntax-aware diff, in place of the Files changed tab.",
  "// @homepageURL  https://github.com/RanolP/hihyou",
  // Every github.com page: GitHub navigates without reloading, so the script must already be running when a
  // reviewer reaches a pull request's Files changed tab.
  "// @match        https://github.com/*",
  "// @grant        GM_xmlhttpRequest",
  "// @grant        GM.xmlHttpRequest",
  // The fetch starts only on github.com; the others are where pull/<n>.diff and raw/... redirect.
  "// @connect      github.com",
  "// @connect      patch-diff.githubusercontent.com",
  "// @connect      raw.githubusercontent.com",
  "// @run-at       document-idle",
  "// @noframes",
  `// @updateURL    ${site}hihyou.meta.js`,
  `// @downloadURL  ${site}hihyou.user.js`,
  "// ==/UserScript==",
  "",
].join("\n");

export default defineConfig({
  resolve: { conditions },
  publicDir: false,
  build: {
    outDir: ".output/userscript",
    emptyOutDir: true,
    target: "es2023",
    // A reviewer may read what they install; the managers show the source.
    minify: false,
    lib: {
      entry: "src/userscript.ts",
      formats: ["iife"],
      name: "hihyou",
      fileName: () => "hihyou.user.js",
    },
  },
  plugins: [
    browserSafe(),
    solid(),
    {
      name: "hihyou:userscript-metadata",
      // After browserSafe and after minification, so the block stays the file's first bytes.
      enforce: "post",
      generateBundle(_, bundle) {
        for (const chunk of Object.values(bundle))
          if (chunk.type === "chunk") chunk.code = metadata + chunk.code;
        this.emitFile({
          type: "asset",
          fileName: "hihyou.meta.js",
          source: metadata,
        });
      },
    },
  ],
});
