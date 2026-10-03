import {
  type DiffFile,
  diffStyles,
  githubDark,
  githubLight,
  renderDiffset,
  revealElided,
  type Unchanged,
} from "@hihyou/ui";
import expansions from "./dist/expansions.json";
import files from "./dist/files.json";

const style = document.createElement("style");
style.textContent = diffStyles;
document.head.append(style);

const root = document.getElementById("root");
if (!root) throw new Error("fixture: #root is missing from index.html");
let current = files as DiffFile[];
// build.mjs read each elided run whole, so an expand here reveals all of it at once.
const view = renderDiffset(root, current, {
  onExpand: async (fileId, elided) => {
    const file = current.find((f) => f.path === fileId);
    const next =
      file &&
      (await revealElided(file, elided, "all", async (path, lines, count) => {
        const key = `${path}|${lines.before}|${lines.after}|${count ?? ""}`;
        return (expansions as Record<string, Unchanged | undefined>)[key];
      }));
    if (!next) return console.log("expand: nothing read for", fileId, elided);
    current = current.map((f) => (f === file ? next : f));
    view.update(current);
  },
  theme: matchMedia("(prefers-color-scheme: dark)").matches
    ? githubDark
    : githubLight,
});
