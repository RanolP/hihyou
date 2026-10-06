import type { AstSteps, SideMove } from "@hihyou/engine";
import {
  type Cell,
  type DiffFile,
  mergeLines,
  type SideName,
  splitLines,
  type UnifiedRow,
} from "./rows.js";
import type { ViewedSubject } from "./viewed.js";

/** A `diff` fragment's side: file and fragment by index, and which of the side's moves when it names one. */
export interface SideRef {
  file: number;
  fragment: number;
  side: SideName;
  /** Index into the side's `moves`. */
  move?: number;
}

const namesOf = (f: DiffFile) =>
  [f.path, f.change?.oldPath].filter((p) => p !== undefined);

/** One path is a prefix of the other: the same node, or one inside the other. */
const nested = (p: AstSteps, q: AstSteps) =>
  p.length <= q.length
    ? p.every((s, i) => s === q[i])
    : q.every((s, i) => s === p[i]);

/** The move `ref` names, if it names one. */
export function moveAt(
  files: readonly DiffFile[],
  ref: SideRef,
): SideMove | undefined {
  const f = files[ref.file]?.fragments[ref.fragment];
  return f?.kind === "diff" && ref.move !== undefined
    ? f[ref.side].moves?.[ref.move]
    : undefined;
}

/**
 * The other half of the move at `from`: a move on the opposite side, in the counterpart's file, that points
 * back at `from`'s file. One whose own node is a counterpart of `from` and that names `from`'s node as its
 * counterpart beats one that holds the node alone, which beats one that only points back.
 */
export function findCounterpart(
  files: readonly DiffFile[],
  from: SideRef,
): SideRef | undefined {
  const source = files[from.file];
  const move = moveAt(files, from);
  if (!source || !move) return undefined;
  const side: SideName = from.side === "before" ? "after" : "before";
  const back = namesOf(source);
  const meets = (p: AstSteps[], q: AstSteps[]) =>
    p.some((x) => q.some((y) => nested(x, y)));
  let best: { ref: SideRef; score: number } | undefined;
  for (const [file, f] of files.entries()) {
    if (!namesOf(f).includes(move.counterpart.path)) continue;
    for (const [i, g] of f.fragments.entries()) {
      if (g.kind !== "diff") continue;
      const s = g[side];
      for (const [k, m] of (s.moves ?? []).entries()) {
        if (!back.includes(m.counterpart.path)) continue;
        const holds = meets(s.at, move.counterpart.at);
        const score = (holds ? 1 : 0) + (holds && meetsBack(m) ? 1 : 0);
        if (!best || score > best.score)
          best = { ref: { file, fragment: i, side, move: k }, score };
      }
    }
  }
  return best?.ref;

  function meetsBack(m: SideMove): boolean {
    const f = source?.fragments[from.fragment];
    return f?.kind === "diff" && meets(f[from.side].at, m.counterpart.at);
  }
}

/** One half of a move pair, as its own file has it. */
export interface PairHalf {
  ref: SideRef;
  path: string;
  first: number;
  last: number;
  cells: Cell[];
}

/** Both halves of a move, from whichever half it was found; a half whose counterpart was not found is absent. */
export interface MovePair {
  before?: PairHalf;
  after?: PairHalf;
  /** The halves sit in different files. */
  crossFile: boolean;
  /** The other half's file as the move names it, found or not. */
  counterpartPath: string;
  /** See `SideMove.extract`. */
  extract?: string;
}

function halfAt(
  files: readonly DiffFile[],
  ref: SideRef,
): PairHalf | undefined {
  const file = files[ref.file];
  const f = file?.fragments[ref.fragment];
  const move = moveAt(files, ref);
  if (!file || f?.kind !== "diff" || !move) return undefined;
  const { startLine } = f[ref.side];
  const cells = splitLines(f[ref.side].spans)
    .map((spans, i) => ({ line: startLine + i, spans }))
    .filter((c) => move.first <= c.line && c.line <= move.last);
  return { ref, path: file.path, first: move.first, last: move.last, cells };
}

/** The move at `ref` with its counterpart, the same pair whichever half `ref` names. */
export function movePair(
  files: readonly DiffFile[],
  ref: SideRef,
): MovePair | undefined {
  const own = halfAt(files, ref);
  const move = moveAt(files, ref);
  const file = files[ref.file];
  if (!own || !move || !file) return undefined;
  const to = findCounterpart(files, ref);
  const other = to && halfAt(files, to);
  const before = ref.side === "before" ? own : other;
  const after = ref.side === "after" ? own : other;
  return {
    ...(before && { before }),
    ...(after && { after }),
    crossFile: !namesOf(file).includes(move.counterpart.path),
    counterpartPath: move.counterpart.path,
    ...(move.extract !== undefined && { extract: move.extract }),
  };
}

/** The pair as a "viewed" subject; both halves name it alike, so either file marks the other. */
export function pairSubject(pair: MovePair): ViewedSubject {
  const half = (h?: PairHalf) =>
    h && {
      path: h.path,
      first: h.first,
      last: h.last,
      text: h.cells.map((c) => c.spans.map((s) => s.text).join("")).join("\n"),
    };
  const before = half(pair.before);
  const after = half(pair.after);
  return { kind: "move", ...(before && { before }), ...(after && { after }) };
}

/**
 * A pair laid out to read in place, as the inner diff: the halves merged into one run of lines with the edits marked inside, when
 * they share their unchanged text, else the before half's lines ahead of the after half's.
 */
export function pairUnifiedRows(pair: MovePair): UnifiedRow[] {
  const b = pair.before?.cells ?? [];
  const a = pair.after?.cells ?? [];
  const merged =
    b.length > 0 && a.length > 0 ? mergeLines(-1, b, a) : undefined;
  if (merged) return merged;
  return [
    ...b.map((cell) => ({
      kind: "line" as const,
      fragment: -1,
      side: "before" as const,
      cell,
    })),
    ...a.map((cell) => ({
      kind: "line" as const,
      fragment: -1,
      side: "after" as const,
      cell,
    })),
  ];
}
