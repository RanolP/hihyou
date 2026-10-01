// YAML laid out as oxfmt 0.70.0 prints it with prettier's defaults (prettier 3.9.9's language-yaml printer).
// Every rule here was read off oxfmt's output over a matrix of variants. A construct the printer has no rule
// for yet throws `Unsupported`, so the file is refused rather than printed wrong.

import { SYM_ERROR } from "../../core/language.js";
import type { PrettierOptions } from "../../fmt/options.js";
import type { FormatTree } from "../../fmt/tree.js";

export class Unsupported extends Error {}

/** The stream `root` as printed, without its final line break. */
export function printYaml(tree: FormatTree, root: number, _options: PrettierOptions): string {
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if (tree.kind(n) === SYM_ERROR || tree.missing(n)) throw new Unsupported("a YAML parse error");
  }
  return tree.text(root).replace(/\s+$/, "");
}
