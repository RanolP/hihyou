import {
  type DiffFile,
  diffStyles,
  githubDark,
  githubLight,
  renderDiffset,
} from "@hihyou/ui";
import files from "./dist/files.json";

const style = document.createElement("style");
style.textContent = diffStyles;
document.head.append(style);

const root = document.getElementById("root");
if (!root) throw new Error("fixture: #root is missing from index.html");
// No host here to fetch elided text from, so expanding only logs what a host would receive.
renderDiffset(root, files as DiffFile[], {
  onExpand: (fileId, elided) => console.log("expand", fileId, elided),
  theme: matchMedia("(prefers-color-scheme: dark)").matches ? githubDark : githubLight,
});
