import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "vitepress";

// The userscript build (`build:userscript` in packages/browser), which this package's `build` runs first.
const userscript = join(
  import.meta.dirname,
  "../../../browser/.output/userscript",
);

const pages = [
  { text: "Overview", link: "/" },
  { text: "The Interface", link: "/the-interface" },
  { text: "Reviewing Small Diffs Easily", link: "/reviewing-small-diffs-easily" },
  { text: "Userscript", link: "/userscript" },
];

export default defineConfig({
  title: "hihyou",
  description: "Review the diff, not the pull request or the commit.",
  // GitHub Pages serves the project site under the repository name.
  base: "/hihyou/",
  cleanUrls: true,
  themeConfig: {
    nav: pages,
    sidebar: pages,
    socialLinks: [{ icon: "github", link: "https://github.com/RanolP/hihyou" }],
  },
  // Served at the site root, where the script's @updateURL and @downloadURL point.
  async buildEnd({ outDir }) {
    for (const file of ["hihyou.user.js", "hihyou.meta.js"])
      await copyFile(join(userscript, file), join(outDir, file));
  },
});
