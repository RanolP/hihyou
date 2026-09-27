// Prettier's source-text probes (src/utilities, 3.9.9), which decide comment placement and blank lines. Each
// looks only at the few characters around one offset.

import { NO_NODE } from "../core/arena.js";
import { type FormatTree, nextLeaf } from "./tree.js";

const isNewline = (c: string) =>
  c === "\n" || c === "\r" || c === " " || c === " ";

function skipSpaces(text: string, i: number, backwards = false): number {
  while (i >= 0 && i < text.length) {
    const c = text.charAt(i);
    if (c !== " " && c !== "\t") return i;
    i += backwards ? -1 : 1;
  }
  return i;
}

function skipNewline(text: string, i: number, backwards = false): number {
  const c = text.charAt(i);
  if (backwards) {
    if (c === "\n" && text.charAt(i - 1) === "\r") return i - 2;
    return isNewline(c) ? i - 1 : i;
  }
  if (c === "\r" && text.charAt(i + 1) === "\n") return i + 2;
  return isNewline(c) ? i + 1 : i;
}

/** Whether only spaces and tabs stand between `i` and a line break (looking left of `i` when `backwards`). */
export function hasNewline(
  text: string,
  i: number,
  backwards = false,
): boolean {
  const at = skipSpaces(text, backwards ? i - 1 : i, backwards);
  return skipNewline(text, at, backwards) !== at;
}

export function hasNewlineInRange(text: string, from: number, to: number) {
  for (let i = from; i < to; i++) if (text.charAt(i) === "\n") return true;
  return false;
}

/** Whether the line after the one holding `i` is blank, skipping separators and comments that end that line. */
export function isNextLineEmpty(text: string, i: number): boolean {
  for (let old = -1; i !== old;) {
    old = i;
    while (i < text.length && ",; \t".includes(text.charAt(i))) i++;
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end !== -1) i = end + 2;
    }
    i = skipSpaces(text, i);
  }
  if (text.startsWith("//", i))
    while (i < text.length && !isNewline(text.charAt(i))) i++;
  const next = skipNewline(text, i);
  return next !== i && hasNewline(text, next);
}

/** Whether the line before the one holding `i` is blank. */
export function isPreviousLineEmpty(text: string, i: number): boolean {
  let at = skipSpaces(text, i - 1, true);
  at = skipNewline(text, at, true);
  at = skipSpaces(text, at, true);
  return skipNewline(text, at, true) !== at;
}

// The same probes over the tree, which knows the line breaks before each leaf (`lf`) and after the last one
// (`trailingLf`), so no offset into the source is needed. `hasNewline(text, n.start, true)` is `lf(n) > 0`, and
// `isPreviousLineEmpty(text, n.start)` is `lf(n) >= 2`.

/** Line breaks between node `n` and the next leaf (or the end of the file), clamped to 3. */
export function lfAfter(tree: FormatTree, n: number): number {
  const next = nextLeaf(tree, n);
  return next === NO_NODE ? tree.trailingLf : tree.lf(next);
}

/** `isNextLineEmpty` after node `n`: skips the `,`, `;` and comments that end its line. */
export function nextLineEmpty(tree: FormatTree, n: number): boolean {
  const onLine = (l: number) => l !== NO_NODE && tree.lf(l) === 0;
  let l = nextLeaf(tree, n);
  for (; onLine(l); l = nextLeaf(tree, l)) {
    const t = tree.text(l);
    if (t !== "," && t !== ";" && t !== "" && !t.startsWith("/*")) break;
  }
  if (onLine(l) && tree.text(l).startsWith("//")) l = nextLeaf(tree, l);
  return (l === NO_NODE ? tree.trailingLf : tree.lf(l)) >= 2;
}

/** Whether a line break lies between the start of leaf `from` and the start of `to`, a later leaf. */
export function newlineBetween(
  tree: FormatTree,
  from: number,
  to: number,
): boolean {
  for (let l = from; l !== to && l !== NO_NODE;) {
    if (tree.text(l).includes("\n")) return true;
    l = nextLeaf(tree, l);
    if (l !== NO_NODE && tree.lf(l) > 0) return true;
  }
  return false;
}
