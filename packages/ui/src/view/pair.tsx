import type { SideMove } from "@hihyou/engine";
import { type Accessor, createSignal, type JSX } from "solid-js";
import { writeAtoms } from "../atoms.js";
import { type MovePair, movePair, pairSubject } from "../moves.js";
import type { DiffFile, SideName } from "../rows.js";
import type { KeyOf, ViewedStore } from "../viewed.js";
import { useDraw } from "./context.js";
import { ViewedToggle } from "./viewed-toggle.jsx";

/** A move as one file draws it: the pair it belongs to, from the half `side` this file holds. */
export interface PairView {
  pair: MovePair;
  key: string;
  side: SideName;
  /** The pair in this file: its path and key. */
  id: string;
  /** The edit atoms inside either half; empty for code without an outline, which keeps the `move` subject. */
  atoms: string[];
}

/** Finds each move's pair, and keeps which pairs are viewed and which are drawn expanded. */
export function createPairs(opts: {
  files: Accessor<readonly DiffFile[]>;
  viewed: ViewedStore;
  keyOf: KeyOf;
  isViewed: (atom: string) => boolean;
  /** Read to track the viewed store, which changes without a redraw. */
  viewedTick: Accessor<number>;
}) {
  const { files, viewed, keyOf, isViewed, viewedTick } = opts;
  /** A move's pair, found once per draw: `movePair` reads every file. */
  let cache = new Map<string, PairView | undefined>();
  /** Move pairs drawn expanded, by `PairView.id`: per file, so expanding one half leaves the other file as it was. */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());

  /** Both halves share their atoms, so viewing the move in one file dims it in the other. */
  const pairAtoms = (pair: MovePair): string[] => {
    const out = new Set<string>();
    for (const half of [pair.before, pair.after]) {
      const f = half && files()[half.ref.file]?.fragments[half.ref.fragment];
      if (!half || f?.kind !== "diff") continue;
      const side = f[half.ref.side];
      for (const n of side.nodes ?? []) {
        const line = side.startLine + n.start.line;
        if (n.atom !== undefined && half.first <= line && line <= half.last)
          out.add(n.atom);
      }
    }
    return [...out];
  };
  const of = (
    file: number,
    fragment: number,
    side: SideName,
    move: SideMove,
  ): PairView | undefined => {
    const cacheKey = `${file}:${fragment}:${side}:${move.first}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const current = files();
    const f = current[file]?.fragments[fragment];
    const index = f?.kind === "diff" ? (f[side].moves ?? []).indexOf(move) : -1;
    const pair =
      index < 0
        ? undefined
        : movePair(current, { file, fragment, side, move: index });
    const key = pair && keyOf(pairSubject(pair));
    const view =
      pair && key !== undefined
        ? {
            pair,
            key,
            side,
            id: `${current[file]?.path ?? ""}\n${key}`,
            atoms: pairAtoms(pair),
          }
        : undefined;
    cache.set(cacheKey, view);
    return view;
  };
  const isPairViewed = (view: PairView) => {
    viewedTick();
    return view.atoms.length > 0
      ? view.atoms.every(isViewed)
      : viewed.get(view.key);
  };
  const setPairViewed = (view: PairView, on: boolean) => {
    if (view.atoms.length > 0) writeAtoms(view.atoms, on, viewed, keyOf);
    else viewed.set(view.key, on);
  };
  const setOpen = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  return {
    of,
    expanded,
    isExpanded: (id: string) => expanded().has(id),
    isViewed: isPairViewed,
    setViewed: setPairViewed,
    /** Folds the pair away again. */
    collapse: (view: PairView) => setOpen(view.id, false),
    /** Expanding a cross-file move is looking at it, so it marks the pair viewed in both files. */
    toggle(view: PairView) {
      if (expanded().has(view.id)) return setOpen(view.id, false);
      setOpen(view.id, true);
      if (!isPairViewed(view)) setPairViewed(view, true);
    },
    /** Before a draw: pairs are found anew against the files drawn. */
    reset() {
      cache = new Map();
    },
  };
}
export type Pairs = ReturnType<typeof createPairs>;

/**
 * "Moved to/from". A cross-file move's label expands the pair in place; a move within the file jumps to the
 * other half when it is found.
 */
export function MoveLabel(props: {
  file: number;
  fragment: number;
  side: SideName;
  move: SideMove;
}): JSX.Element {
  const ctx = useDraw();
  const { file, side, move } = props;
  const view = ctx.pairs.of(file, props.fragment, side, move);
  const other = view && (side === "before" ? view.pair.after : view.pair.before);
  const where = other
    ? `${other.ref.file === file ? "line " : `${other.path}:`}${other.first}`
    : move.counterpart.path;
  const text = `${side === "before" ? "Moved to" : "Moved from"} ${where}`;
  if (!view) return <span>{text}</span>;
  let label: JSX.Element;
  if (view.pair.crossFile) {
    const open = ctx.pairs.isExpanded(view.id);
    label = (
      <button
        ref={(b) => ctx.focusable(b, `toggle\n${view.id}`)}
        type="button"
        class="hh-button"
        aria-expanded={open}
        on:click={() => ctx.pairs.toggle(view)}
      >
        {`${open ? "▾" : "▸"} ${text}`}
      </button>
    );
  } else
    label = other ? (
      <button
        type="button"
        class="hh-button"
        on:click={() => ctx.jump(other.ref)}
      >
        {text}
      </button>
    ) : (
      <span>{text}</span>
    );
  return [
    label,
    " ",
    <ViewedToggle
      on={() => ctx.pairs.isViewed(view)}
      set={(on) => ctx.pairs.setViewed(view, on)}
      id={view.id}
      what="moved code"
    />,
  ];
}
