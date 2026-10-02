import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "vitepress";

// The userscript build (`build:userscript` in packages/browser), which this package's `build` runs first.
const userscript = join(
  import.meta.dirname,
  "../../../browser/.output/userscript",
);

export default defineConfig({
  title: "syntechs",
  description:
    "A parser and formatter in pure TypeScript that runs in the browser, scored against prettier, ruff and ktfmt.",
  // GitHub Pages serves the project site under the repository name.
  base: "/hihyou/",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Scorecard", link: "/scorecard" },
      { text: "Userscript", link: "/userscript" },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/RanolP/hihyou" }],
  },
  // Served at the site root, where the script's @updateURL and @downloadURL point.
  async buildEnd({ outDir }) {
    for (const file of ["hihyou.user.js", "hihyou.meta.js"])
      await copyFile(join(userscript, file), join(outDir, file));
  },
});
