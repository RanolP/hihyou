// Builds hihyou.user.js, the extension as a userscript for Tampermonkey and Violentmonkey, and hihyou.meta.js, its
// metadata block alone, which a manager polls for updates instead of the whole script. The website serves both.
//   vite build -c userscript.config.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
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

// The app is the bulk of the script, and the script runs on every github.com page. Bundled as an ordinary dynamic
// import, each of its modules sits in a parenthesized arrow, which V8 compiles to bytecode at once on every page
// load and keeps in the tab's heap. Built separately and placed in one function declaration that only the dynamic
// import calls, it is just pre-parsed until a reviewer turns hihyou on.
const appId = "\0hihyou:app";
function lazyApp(): Plugin {
  return {
    name: "hihyou:lazy-app",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./app.js" && importer?.endsWith("userscript.ts"))
        return appId;
      return null;
    },
    async load(id) {
      if (id !== appId) return null;
      const result = await build({
        configFile: false,
        logLevel: "warn",
        resolve: { conditions },
        publicDir: false,
        build: {
          write: false,
          target: "es2023",
          minify: true,
          lib: {
            entry: fileURLToPath(new URL("src/app.ts", import.meta.url)),
            formats: ["iife"],
            name: "hihyouApp",
          },
        },
        plugins: [browserSafe(), solid()],
      });
      const output = (Array.isArray(result) ? result : [result]).flatMap((r) =>
        "output" in r ? r.output : [],
      );
      // A CSS file or a second chunk would be dropped here, and the app would break only once turned on.
      const [chunk] = output;
      if (output.length !== 1 || chunk?.type !== "chunk")
        throw new Error(
          `the app built to ${output.map((o) => o.fileName).join(", ")}; the userscript inlines exactly one chunk`,
        );
      // A function declaration, never parenthesized: V8 compiles a parenthesized function eagerly, guessing it is
      // called at once, and the bundler wraps each lazy module that way.
      return `function evaluateApp() {\n${chunk.code}\nreturn hihyouApp.app;\n}\nexport const app = evaluateApp();\n`;
    },
  };
}

export default defineConfig({
  resolve: { conditions },
  publicDir: false,
  build: {
    outDir: ".output/userscript",
    emptyOutDir: true,
    target: "es2023",
    minify: true,
    lib: {
      entry: "src/userscript.ts",
      formats: ["iife"],
      name: "hihyou",
      fileName: () => "hihyou.user.js",
    },
  },
  plugins: [
    lazyApp(),
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
