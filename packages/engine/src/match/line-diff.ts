import { diffArrays } from "diff";
import type { RawEdit, Span } from "./edit-script.js";

interface Line extends Span {
  /** The line with all whitespace removed, like `git diff -w`; blank lines drop out entirely. */
  key: string;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  for (let start = 0; start <= text.length; ) {
    const nl = text.indexOf("\n", start);
    const end = nl === -1 ? text.length : nl;
    const key = text.slice(start, end).replace(/\s+/g, "");
    if (key)
      out.push({ start, end: text[end - 1] === "\r" ? end - 1 : end, key });
    if (nl === -1) break;
    start = nl + 1;
  }
  return out;
}

/** Fallback for text the AST path cannot take: whitespace-insensitive line diff. */
export function lineDiff(oldText: string, newText: string): RawEdit[] {
  const a = lines(oldText);
  const b = lines(newText);
  const edits: RawEdit[] = [];
  const cover = (ls: Line[], from: number, n: number): Span => ({
    start: (ls[from] as Line).start,
    end: (ls[from + n - 1] as Line).end,
  });
  let i = 0;
  let j = 0;
  for (const c of diffArrays(
    a.map((l) => l.key),
    b.map((l) => l.key),
  )) {
    const n = c.count ?? c.value.length;
    if (c.removed) {
      edits.push({ kind: "delete", old: cover(a, i, n) });
      i += n;
    } else if (c.added) {
      edits.push({ kind: "insert", new: cover(b, j, n) });
      j += n;
    } else {
      i += n;
      j += n;
    }
  }
  return edits;
}
