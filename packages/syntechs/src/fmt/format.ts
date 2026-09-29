import { NO_NODE, type Tree } from "../core/arena.js";
import { SYM_ERROR } from "../core/language.js";
import type { EndOfLine } from "./options.js";
import type { Language } from "./rules.js";
import { formatStream } from "./stream-format.js";

/**
 * Where one source token (`from`, in the input) landed (`to`, in the output), as UTF-16 [start, end). A
 * respelled token (`'a'` printed as `"a"`) keeps its node's range; a `synthetic` one (an inserted `;`) has the
 * range of the node it anchors to, and no text there is its own.
 */
export interface Anchor {
  from: readonly [number, number];
  to: readonly [number, number];
  synthetic?: true;
}

export type Formatted =
  | { ok: true; text: string; anchors: Anchor[] }
  | {
      ok: false;
      /** `formatter-error`: a rule threw, so there is no output. */
      reason: "formatter-error";
      detail: string;
    };

/**
 * Lays out `tree` by `language`'s rules, with `options` (by the names the language's own tool uses) over the
 * language's defaults, and `anchors` says where each input token landed. It does not verify that the output
 * says what the input says: `check` does, apart, because a mismatch is a rule or parser bug for the tests to
 * catch rather than a cost every format pays. If a rule throws, there is no output, only the reason.
 */
export function format<O>(
  tree: Tree,
  language: Language<O>,
  options: Partial<O> = {},
): Formatted {
  return formatStream(tree, language, options);
}

/**
 * The nodes with an `ERROR` or missing child, or undefined when the tree has none; an `ERROR` that `recovered`
 * holds of leaves its parent formatted.
 */
export function brokenNodes(tree: Tree, recovered?: (error: number) => boolean): Set<number> | undefined {
  let broken: Set<number> | undefined;
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if ((tree.kind(n) === SYM_ERROR && recovered?.(n) !== true) || tree.missing(n)) {
      const parent = tree.parent(n);
      if (parent !== NO_NODE) (broken ??= new Set()).add(parent);
    }
  }
  return broken;
}

// Prettier's guessEndOfLine (common/end-of-line.js); ruff's `auto` also takes the first line ending.
export function endOfLine(eol: EndOfLine, tree: Tree): string {
  if (eol === "auto") return tree.lineEnding();
  return { lf: "\n", crlf: "\r\n", cr: "\r" }[eol];
}

/**
 * Maps an offset in the printed `text` to the same place once every line break is written as `eol`, those
 * inside tokens too (a block comment's), as prettier does by normalizing its input. Offsets must be asked in
 * ascending order: anchors run in output order, so one pass over the breaks moves them all.
 */
export function shiftForEndOfLine(text: string, eol: string) {
  const breaks = [...text.matchAll(/\r\n?|\n/g)].filter((m) => m[0] !== eol);
  let next = 0;
  let shift = 0;
  return (at: number) => {
    for (let b = breaks[next]; b && b.index < at; b = breaks[++next])
      shift += eol.length - b[0].length;
    return at + shift;
  };
}
