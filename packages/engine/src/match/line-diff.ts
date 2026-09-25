import { diffArrays } from "diff";
import type { RawEdit, Span } from "./edit-script.js";

interface Line extends Span {
  /** The line's tokens, led by its indentation depth where indentation is syntax; blank lines have none and drop out. */
  key: string;
}

// Whitespace separates tokens and is never one itself, so `a  b` equals `a b` while `isnot` differs from `is not`.
// A token is a word run, a quoted string kept whole (its inner whitespace is content), or any other single character.
// A quote right after a word character is an apostrophe (`don't`), not the start of a string.
const token =
  /(?<![\p{L}\p{N}_])(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** Formats whose indentation is syntax, so re-indenting a line changes it: Python, YAML and Makefiles. */
export function indentIsSyntax(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /\.(?:pyi?|ya?ml|mk)$|^(?:gnu)?makefile$/i.test(name);
}

function indentDepth(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === " ") depth += 1;
    else if (ch === "\t") depth += 4;
    else break;
  }
  return depth;
}

function lines(text: string, indentMatters: boolean): Line[] {
  const out: Line[] = [];
  for (let start = 0; start <= text.length; ) {
    const nl = text.indexOf("\n", start);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(start, end);
    const tokens = line.match(token);
    if (tokens)
      out.push({
        start,
        end: text[end - 1] === "\r" ? end - 1 : end,
        key: JSON.stringify(
          indentMatters ? [indentDepth(line), ...tokens] : tokens,
        ),
      });
    if (nl === -1) break;
    start = nl + 1;
  }
  return out;
}

/** Fallback for text the AST path cannot take: a line diff over each line's tokens, reporting whole changed lines. */
export function lineDiff(
  oldText: string,
  newText: string,
  indentMatters: boolean,
): RawEdit[] {
  const edits: RawEdit[] = [];
  for (const c of diffArrays(
    lines(oldText, indentMatters),
    lines(newText, indentMatters),
    { comparator: (p, q) => p.key === q.key },
  )) {
    const [first] = c.value;
    const last = c.value.at(-1);
    if (!first || !last || !(c.added || c.removed)) continue;
    const span = { start: first.start, end: last.end };
    edits.push(
      c.added ? { kind: "insert", new: span } : { kind: "delete", old: span },
    );
  }
  return edits;
}
