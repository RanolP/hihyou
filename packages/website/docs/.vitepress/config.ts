import { defineConfig } from "vitepress";

export default defineConfig({
  title: "syntechs",
  description:
    "A parser and formatter in pure TypeScript that runs in the browser, scored against prettier, ruff and ktfmt.",
  // GitHub Pages serves the project site under the repository name.
  base: "/hihyou/",
  cleanUrls: true,
  themeConfig: {
    nav: [{ text: "Scorecard", link: "/scorecard" }],
    socialLinks: [{ icon: "github", link: "https://github.com/RanolP/hihyou" }],
  },
});
