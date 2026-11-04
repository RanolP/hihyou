import { expect, test } from "vitest";
import { type FileTreeNode, fileTree } from "./file-tree.js";

type F = { path: string };
const shape = (nodes: FileTreeNode<F>[]): unknown[] =>
  nodes.map((n) =>
    n.kind === "file"
      ? n.file.path
      : { [`${n.name} (${n.path})`]: shape(n.children) },
  );

// Catches a compacted folder whose path loses a segment (a click then targets the wrong file), a single-child
// chain left uncompacted, a folder with files of its own wrongly merged into its only subfolder, or siblings
// grouped by kind instead of sorted by full path.
test("compacts single-folder chains and sorts siblings by full path", () => {
  const tree = fileTree<F>([
    { path: "packages/vscode/src/panel/panel.ts" },
    { path: "packages/vscode/src/activate.ts" },
    { path: "packages/vscode/package.json" },
    { path: "README.md" },
    { path: "docs/design/a.md" },
  ]);
  expect(shape(tree)).toEqual([
    "README.md",
    { "docs/design (docs/design)": ["docs/design/a.md"] },
    {
      "packages/vscode (packages/vscode)": [
        "packages/vscode/package.json",
        {
          "src (packages/vscode/src)": [
            "packages/vscode/src/activate.ts",
            {
              "panel (packages/vscode/src/panel)": [
                "packages/vscode/src/panel/panel.ts",
              ],
            },
          ],
        },
      ],
    },
  ]);
});
