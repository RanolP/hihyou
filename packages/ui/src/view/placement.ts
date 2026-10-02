import type { Span } from "@hihyou/engine";
import { cutShared, type LinePos, type Placed, skeletonOf } from "../highlight.js";
import type { Point } from "../modal.js";
import type { SideRef } from "../moves.js";
import type { Cell, DiffFile, MergedSpan, Row, SideName } from "../rows.js";

/**
 * Where each drawn text node of a diff side sits, so the highlight painter turns a node's span into Ranges and a
 * click turns a caret back into a side position. One draw fills it in document order: a merged row places its
 * before text from a queue the section's before cells filled, so the rows must be drawn in order.
 */
export interface Placer {
  /** Each drawn text node of a diff side, per side line: key `file:fragment:side:line`, the line 0-based into the side. */
  readonly placed: Map<string, Placed<Text>[]>;
  placeOf(text: Text): Point | undefined;
  /** Forgets every placement, before a draw. */
  reset(): void;
  /** Records `text` at each of `at`; a click on it stands for the first. */
  place(text: Text, at: Point | readonly Point[] | undefined): void;
  lineCursor(
    file: number,
    fragment: number,
    side: SideName,
    line: number,
  ): ((span: Span) => Point) | undefined;
  takeBefore(
    file: number,
    fragment: number,
    text: string,
    line?: number,
  ): Point | undefined;
  /** Readies the merged rows of each fragment's `before` cells, in line order, to be placed on the before side. */
  queueBefore(sides: ReadonlyMap<number, readonly Cell[]>): void;
  shareBefore(
    file: number,
    fragment: number,
    span: MergedSpan,
  ): { span: MergedSpan; before: Point | undefined }[];
  /**
   * Draws an expanded move pair: its rows carry fragment -1, and each side places into the half's own file and
   * fragment, so a node there lights in both copies. The pair's before queue stands in for the section's until done.
   */
  inPair(
    refs: Record<SideName, SideRef | undefined>,
    before: readonly Cell[],
    draw: () => void,
  ): void;
}

export const lineKey = (p: Omit<Point, "column">) =>
  `${p.file}:${p.fragment}:${p.side}:${p.line}`;

export const beforeCells = (rows: readonly Row[]) => {
  const sides = new Map<number, Cell[]>();
  for (const r of rows) {
    if (r.kind !== "diff" || !r.before) continue;
    const list = sides.get(r.fragment) ?? [];
    list.push(r.before);
    sides.set(r.fragment, list);
  }
  return sides;
};

export function createPlacer(files: () => readonly DiffFile[]): Placer {
  const placed = new Map<string, Placed<Text>[]>();
  let placeOf = new WeakMap<Text, Point>();
  let pairRefs: Record<SideName, SideRef | undefined> | undefined;
  /** Per fragment of the section being drawn, its before side's changed spans not yet placed in a merged row. */
  let beforeRuns = new Map<
    number,
    { text: string; line: number; column: number }[]
  >();
  /** Per fragment, its before side's skeleton and how much of it the merged rows drawn so far took. */
  let skeletons = new Map<number, { at: LinePos[]; used: number }>();

  const resolve = (file: number, fragment: number, side: SideName) => {
    const ref = pairRefs ? pairRefs[side] : { file, fragment };
    const f = ref && files()[ref.file]?.fragments[ref.fragment];
    return ref && f?.kind === "diff"
      ? { file: ref.file, fragment: ref.fragment, start: f[side].startLine }
      : undefined;
  };
  const placeAt = (
    file: number,
    fragment: number,
    side: SideName,
    at: LinePos,
  ): Point | undefined => {
    const r = resolve(file, fragment, side);
    return r && { ...r, side, line: at.line - r.start, column: at.column };
  };
  const queueBefore = (sides: ReadonlyMap<number, readonly Cell[]>) => {
    beforeRuns = new Map();
    skeletons = new Map();
    for (const [fragment, cells] of sides) {
      const list: { text: string; line: number; column: number }[] = [];
      for (const cell of cells) {
        let column = 0;
        for (const span of cell.spans) {
          if (span.changed) list.push({ text: span.text, line: cell.line, column });
          column += span.text.length;
        }
      }
      beforeRuns.set(fragment, list);
      skeletons.set(fragment, { at: skeletonOf(cells), used: 0 });
    }
  };

  return {
    placed,
    placeOf: (text) => placeOf.get(text),
    reset() {
      placed.clear();
      placeOf = new WeakMap();
    },
    place(text, at) {
      const places = at === undefined ? [] : "file" in at ? [at] : at;
      for (const p of places) {
        const key = lineKey(p);
        const list = placed.get(key) ?? [];
        list.push({ item: text, start: p.column, length: text.data.length });
        placed.set(key, list);
      }
      if (places[0]) placeOf.set(text, places[0]);
    },
    lineCursor(file, fragment, side, line) {
      const r = resolve(file, fragment, side);
      if (!r) return undefined;
      let column = 0;
      return (span: Span): Point => {
        const at = {
          file: r.file,
          fragment: r.fragment,
          side,
          line: line - r.start,
          column,
        };
        column += span.text.length;
        return at;
      };
    },
    /**
     * A merged row draws a before span apart from its line, so its place comes from the before cells: the first
     * unplaced changed span of the same text, on `line` when the row is a before line of its own.
     */
    takeBefore(file, fragment, text, line) {
      const runs = beforeRuns.get(fragment);
      const at =
        runs?.findIndex(
          (r) => r.text === text && (line === undefined || r.line === line),
        ) ?? -1;
      const run = at < 0 ? undefined : runs?.splice(at, 1)[0];
      return run && placeAt(file, fragment, "before", run);
    },
    queueBefore,
    /** A merged row's shared span, cut where its before copy breaks off, each piece with its before place. */
    shareBefore(file, fragment, span) {
      const skeleton = skeletons.get(fragment);
      if (!skeleton) return [{ span, before: undefined }];
      const { cuts, next } = cutShared(span.text, skeleton.at, skeleton.used);
      skeleton.used = next;
      return cuts.map((c) => ({
        span: { ...span, text: c.text },
        before: c.before && placeAt(file, fragment, "before", c.before),
      }));
    },
    inPair(refs, before, draw) {
      const section = { beforeRuns, skeletons };
      pairRefs = refs;
      queueBefore(new Map([[-1, before]]));
      try {
        draw();
      } finally {
        pairRefs = undefined;
        ({ beforeRuns, skeletons } = section);
      }
    },
  };
}
