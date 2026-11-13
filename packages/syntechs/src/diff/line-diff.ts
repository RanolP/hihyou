import { diffArrays } from "diff";
import type { RawEdit, Span } from "./edit-script.js";

interface Line extends Span {
  /** The line's tokens; blank lines have none and drop out. */
  key: string;
}

interface Token extends Span {
  key: string;
}

// Whitespace separates tokens and is never one itself, so `a  b` equals `a b` while `isnot` differs from `is not`.
// A token is a word run, a quoted string kept whole, or any other single character.
// A quote right after a word character is an apostrophe (`don't`), not the start of a string.
const token =
  /(?<![\p{L}\p{N}_])(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/**
 * A line's tokens as it compares: whitespace is never a change, not as indentation (even in Python or YAML) and not
 * inside a string, so a line differing from another only in whitespace reads the same.
 */
export const lineKey = (tokens: readonly string[]): string =>
  JSON.stringify(tokens.map((t) => t.replace(/\s+/g, "")));

function lines(text: string): Line[] {
  const out: Line[] = [];
  for (let start = 0; start <= text.length;) {
    const nl = text.indexOf("\n", start);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(start, end);
    const tokens = line.match(token);
    if (tokens)
      out.push({
        start,
        end: text[end - 1] === "\r" ? end - 1 : end,
        key: lineKey(tokens),
      });
    if (nl === -1) break;
    start = nl + 1;
  }
  return out;
}

/** Fallback for text the AST path cannot take: a line diff over each line's tokens, reporting whole changed lines. */
export function lineDiff(oldText: string, newText: string): RawEdit[] {
  const edits: RawEdit[] = [];
  for (const c of diffArrays(
    lines(oldText),
    lines(newText),
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

/** Token-sized emphasis for text the AST path cannot take. */
export function tokenDiff(oldText: string, newText: string): RawEdit[] {
  const tokens = (text: string): Token[] =>
    [...text.matchAll(token)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      key: match[0],
    }));
  const edits: RawEdit[] = [];
  for (const change of diffArrays(tokens(oldText), tokens(newText), {
    comparator: (a, b) => a.key === b.key,
  })) {
    const [first] = change.value;
    const last = change.value.at(-1);
    if (!first || !last || !(change.added || change.removed)) continue;
    const span = { start: first.start, end: last.end };
    edits.push(
      change.added
        ? { kind: "insert", new: span }
        : { kind: "delete", old: span },
    );
  }
  return edits;
}
