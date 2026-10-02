/**
 * Where an outline node's text lies in the drawn rows. The renderer records, per side line, each text node it
 * drew and the column it starts at; a node's (line, column) range then cuts into those pieces without splitting
 * a span, so the CSS Custom Highlight API can paint it.
 */

export interface LinePos {
  line: number;
  column: number;
}

/** A drawn piece of one line: `start` is its first column, `length` its UTF-16 length. */
export interface Placed<T> {
  item: T;
  start: number;
  length: number;
}

export interface Piece<T> {
  item: T;
  /** Offsets into the piece's own text, `to` exclusive. */
  from: number;
  to: number;
}

/** The parts of each drawn piece inside [start, end), line by line; a line with nothing drawn is skipped. */
export function piecesIn<T>(
  lineAt: (line: number) => readonly Placed<T>[] | undefined,
  start: LinePos,
  end: LinePos,
): Piece<T>[] {
  const out: Piece<T>[] = [];
  for (let line = start.line; line <= end.line; line++) {
    const lo = line === start.line ? start.column : 0;
    const hi = line === end.line ? end.column : Infinity;
    for (const p of lineAt(line) ?? []) {
      const from = Math.max(lo, p.start) - p.start;
      const to = Math.min(hi, p.start + p.length) - p.start;
      if (to > from) out.push({ item: p.item, from, to });
    }
  }
  return out;
}

const space = (ch: string) => /\s/.test(ch);

/**
 * Where each non-whitespace character of a before side's unchanged text sits, in order: the skeleton
 * `mergeLines` lines the two sides up by, so a merged row's shared text can be placed on the before side too.
 * Like there, a line of nothing but changed or blank text adds nothing. `line` is the cell's own line number.
 */
export function skeletonOf(
  cells: readonly {
    line: number;
    spans: readonly { text: string; changed?: boolean }[];
  }[],
): LinePos[] {
  const out: LinePos[] = [];
  for (const cell of cells) {
    if (cell.spans.every((s) => s.changed || s.text.trim() === "")) continue;
    let column = 0;
    for (const span of cell.spans) {
      if (!span.changed)
        for (let i = 0; i < span.text.length; ) {
          const ch = String.fromCodePoint(span.text.codePointAt(i) ?? 0);
          if (!space(ch)) out.push({ line: cell.line, column: column + i });
          i += ch.length;
        }
      column += span.text.length;
    }
  }
  return out;
}

/** A piece of shared text and, when its before copy reads the same in one run, where that copy starts. */
export interface SharedCut {
  text: string;
  before?: LinePos;
}

/**
 * Cuts a merged row's shared `text` wherever its before copy breaks off (a reflow, or whitespace that differs),
 * reading positions from `skeleton[from]` on. Whitespace joins a piece only when the before copy has it too;
 * otherwise it stands alone, placed on the after side only.
 */
export function cutShared(
  text: string,
  skeleton: readonly LinePos[],
  from: number,
): { cuts: SharedCut[]; next: number } {
  const cuts: SharedCut[] = [];
  let next = from;
  let piece = "";
  let gap = "";
  let start: LinePos | undefined;
  let end: LinePos | undefined;
  const flush = () => {
    if (piece !== "")
      cuts.push(start ? { text: piece, before: start } : { text: piece });
    if (gap !== "") cuts.push({ text: gap });
    piece = "";
    gap = "";
  };
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    i += ch.length;
    if (space(ch)) {
      gap += ch;
      continue;
    }
    const pos = skeleton[next++];
    const joins =
      pos !== undefined &&
      start !== undefined &&
      end !== undefined &&
      pos.line === end.line &&
      pos.column === end.column + gap.length;
    if (joins) {
      piece += gap + ch;
      gap = "";
    } else {
      flush();
      start = pos;
      piece = ch;
    }
    end = pos && { line: pos.line, column: pos.column + ch.length };
  }
  flush();
  return { cuts, next };
}
