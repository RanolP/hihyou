/**
 * A Kakoune-style modal review editor over the AST outline: select first (one or more nodes, hunks or files),
 * then act on the selections. `modalKey` is pure; `bindModal` wires it to keydown on one root element.
 */
import {
  type AtomIndex,
  atomSubject,
  atomsOf,
  contextFragment,
  hunkOf,
  type NodeRef,
  type SideName,
  type SideTree,
  type Target,
  treeOf,
  writeAtoms,
  writeScores,
} from "./atoms.js";
import {
  type KeyOf,
  plainKeyOf,
  type Score,
  type ScoreStore,
  type ViewedStore,
} from "./viewed.js";
import { type CharRange, charsOf, nodeText, wordsOf } from "./comments.js";

export interface ModalState {
  /** "insert" while an editable field inside the root has focus: review keys type into it, Escape leaves it. */
  mode: "normal" | "insert";
  selections: Target[];
  /** Index into `selections`. */
  primary: number;
  /** A prefix key waiting for the key that completes it; any key resolves it. */
  pending?: "s";
  /** Narrows the primary node selection to part of its text, for a comment; dropped when the selection moves. */
  chars?: CharRange;
}

export type ModalEffect =
  /** Engine atom ids to write. */
  | { kind: "setViewed"; atoms: string[]; viewed: boolean }
  /** `null` clears the nodes' scores. */
  | { kind: "setScore"; nodes: NodeRef[]; score: Score | null }
  /** Show the other half of the move this node is part of. */
  | { kind: "expandMove"; at: NodeRef }
  /** Open a comment on the node, narrowed to `chars` when present. */
  | { kind: "comment"; at: NodeRef; chars?: CharRange }
  /** Open a reply on the thread drawn at the node, the latest when there are several. */
  | { kind: "reply"; at: NodeRef }
  /** Publish the pending review, if one is started. */
  | { kind: "submitReview" }
  | { kind: "expandElided"; file: number; fragment: number }
  /** The selection moved into another file; bring it into view. */
  | { kind: "jump"; to: Target }
  | { kind: "leave" }
  /** `?`: show or hide the key table. */
  | { kind: "help" };

export interface Transition {
  state: ModalState;
  effects: ModalEffect[];
}

export interface ModalContext {
  index: AtomIndex;
  isViewed: (atom: string) => boolean;
}

export const emptyModal: ModalState = {
  mode: "normal",
  selections: [],
  primary: 0,
};

const sideOrder = (s: SideName) => (s === "before" ? 0 : 1);

const node = (r: NodeRef): Target => ({ kind: "node", ...r });

/** A target's place in document order; a hunk or file sorts just before its contents. */
function position(index: AtomIndex, t: Target): number[] {
  if (t.kind === "file") return [t.file, -1];
  if (t.kind === "hunk") return [t.file, t.fragment, -1];
  const n = treeOf(index, t)?.nodes[t.node];
  return [
    t.file,
    t.fragment,
    sideOrder(t.side),
    n?.start.line ?? 0,
    n?.start.column ?? 0,
    t.node,
  ];
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

const keyOfTarget = (t: Target) =>
  t.kind === "file"
    ? `f${t.file}`
    : t.kind === "hunk"
      ? `h${t.file}:${t.fragment}`
      : `n${t.file}:${t.fragment}:${t.side}:${t.node}`;

/** The atom a node itself is, if any. */
function ownAtom(index: AtomIndex, t: Target): string | undefined {
  return t.kind === "node" ? treeOf(index, t)?.nodes[t.node]?.atom : undefined;
}

/** j/k and ]/[: the next (or previous) stop past `t`, skipping `t`'s own atom (an update's other half). */
function step(
  ctx: ModalContext,
  t: Target | undefined,
  dir: 1 | -1,
  unviewedOnly: boolean,
): Target | undefined {
  const { index } = ctx;
  const here = t && position(index, t);
  const own = t && ownAtom(index, t);
  const ok = (r: NodeRef) => {
    const atom = treeOf(index, r)?.nodes[r.node]?.atom;
    if (atom === undefined || atom === own) return false;
    if (unviewedOnly && ctx.isViewed(atom)) return false;
    if (!here) return true;
    const c = compare(position(index, node(r)), here);
    return dir > 0 ? c > 0 : c < 0;
  };
  const stops = dir > 0 ? index.stops : [...index.stops].reverse();
  const r = stops.find(ok);
  return r && node(r);
}

function parent(index: AtomIndex, t: Target): Target {
  if (t.kind === "file") return t;
  if (t.kind === "hunk") return { kind: "file", file: t.file };
  const p = treeOf(index, t)?.nodes[t.node]?.parent ?? -1;
  if (p >= 0) return { ...t, node: p };
  // Context holds no hunk to widen to.
  return t.fragment === contextFragment
    ? t
    : { kind: "hunk", file: t.file, fragment: t.fragment };
}

/** Whether i, n and p may land on the node: one with an atom beneath it, or any node of context, which has none. */
const reachable = (t: Target, tree: SideTree, i: number) =>
  t.kind === "node" &&
  (t.fragment === contextFragment || (tree.atoms[i]?.length ?? 0) > 0);

/** The first child that has an atom beneath it. */
function child(index: AtomIndex, t: Target): Target {
  if (t.kind === "file") {
    const h = index.hunks[t.file]?.find((h) => h.atoms.length > 0);
    return h ? { kind: "hunk", file: t.file, fragment: h.fragment } : t;
  }
  if (t.kind === "hunk") {
    for (const side of ["before", "after"] as const) {
      const tree = treeOf(index, { ...t, side });
      const r = tree?.roots.find((i) => (tree.atoms[i]?.length ?? 0) > 0);
      if (r !== undefined)
        return node({ file: t.file, fragment: t.fragment, side, node: r });
    }
    return t;
  }
  const tree = treeOf(index, t);
  const c = tree?.children[t.node]?.find((i) => reachable(t, tree, i));
  return c === undefined ? t : { ...t, node: c };
}

/** The next (or previous) sibling that has an atom beneath it. */
function sibling(index: AtomIndex, t: Target, dir: 1 | -1): Target {
  const pick = <T>(list: readonly T[], at: number, ok: (x: T) => boolean) => {
    for (let i = at + dir; i >= 0 && i < list.length; i += dir) {
      const x = list[i];
      if (x !== undefined && ok(x)) return x;
    }
    return undefined;
  };
  if (t.kind === "file") {
    const f = pick(index.fileAtoms, t.file, (a) => a.length > 0);
    return f ? { kind: "file", file: index.fileAtoms.indexOf(f) } : t;
  }
  if (t.kind === "hunk") {
    const hunks = index.hunks[t.file] ?? [];
    const at = hunks.findIndex((h) => h.fragment === t.fragment);
    const h = pick(hunks, at, (h) => h.atoms.length > 0);
    return h ? { kind: "hunk", file: t.file, fragment: h.fragment } : t;
  }
  const tree = treeOf(index, t);
  if (!tree) return t;
  const p = tree.nodes[t.node]?.parent ?? -1;
  const list = p >= 0 ? (tree.children[p] ?? []) : tree.roots;
  const s = pick(list, list.indexOf(t.node), (i) => reachable(t, tree, i));
  return s === undefined ? t : { ...t, node: s };
}

/** `g`: the next other occurrence of the node's own atom (an update's twin, a move's other half). */
function counterpart(index: AtomIndex, t: Target): Target {
  const own = ownAtom(index, t);
  const atom =
    own === undefined ? undefined : index.atoms.find((a) => a.id === own);
  if (!atom || t.kind !== "node") return t;
  const k = keyOfTarget(t);
  const at = atom.occurrences.findIndex((r) => keyOfTarget(node(r)) === k);
  const next = atom.occurrences[(at + 1) % atom.occurrences.length];
  return next ? node(next) : t;
}

/** Selections mapped one to one, duplicates folded, the primary following its own selection. */
function mapSelections(
  s: ModalState,
  f: (t: Target) => Target | undefined,
): ModalState {
  const seen = new Map<string, number>();
  const selections: Target[] = [];
  let primary = 0;
  s.selections.forEach((t, i) => {
    const next = f(t) ?? t;
    const k = keyOfTarget(next);
    let at = seen.get(k);
    if (at === undefined) {
      at = selections.length;
      seen.set(k, at);
      selections.push(next);
    }
    if (i === s.primary) primary = at;
  });
  return { ...s, selections, primary };
}

const keepPrimary = (s: ModalState): ModalState => {
  const p = s.selections[s.primary];
  return { ...s, selections: p ? [p] : [], primary: 0 };
};

const only = (s: ModalState, t: Target | undefined): ModalState =>
  t ? { ...s, selections: [t], primary: 0 } : s;

/** The new target joins the selections as primary; one already selected just becomes primary. */
function add(s: ModalState, t: Target | undefined): ModalState {
  if (!t) return s;
  const k = keyOfTarget(t);
  const at = s.selections.findIndex((x) => keyOfTarget(x) === k);
  return at >= 0
    ? { ...s, primary: at }
    : {
        ...s,
        selections: [...s.selections, t],
        primary: s.selections.length,
      };
}

/** The keys after `s`, on Gerrit's Code-Review scale; `0` clears. */
const scoreKeys: Record<string, Score | null> = {
  "2": 2,
  "1": 1,
  q: -1,
  w: -2,
  "0": null,
};

/** The state with no prefix pending. */
const settled = ({
  mode,
  selections,
  primary,
  chars,
}: ModalState): ModalState => ({
  mode,
  selections,
  primary,
  ...(chars && { chars }),
});

const nodeRef = ({ file, fragment, side, node }: NodeRef): NodeRef => ({
  file,
  fragment,
  side,
  node,
});

/** Kakoune's Shift extends: each adds its lowercase motion's target, taken from the primary. */
const extensions: Record<string, string> = {
  J: "j",
  K: "k",
  "}": "]",
  "{": "[",
  N: "n",
  P: "p",
};

const motions: Record<
  string,
  (ctx: ModalContext, t: Target) => Target | undefined
> = {
  j: (ctx, t) => step(ctx, t, 1, false),
  k: (ctx, t) => step(ctx, t, -1, false),
  "]": (ctx, t) => step(ctx, t, 1, true),
  "[": (ctx, t) => step(ctx, t, -1, true),
  o: (ctx, t) => parent(ctx.index, t),
  i: (ctx, t) => child(ctx.index, t),
  n: (ctx, t) => sibling(ctx.index, t, 1),
  p: (ctx, t) => sibling(ctx.index, t, -1),
  x: (_, t) =>
    t.kind === "file" || t.fragment === contextFragment
      ? t
      : { kind: "hunk", file: t.file, fragment: t.fragment },
};

/** w/b move the narrowing to the next or previous word of the primary node; W/B grow it by one. */
function narrow(
  ctx: ModalContext,
  s: ModalState,
  key: "w" | "b" | "W" | "B",
): ModalState {
  const p = s.selections[s.primary];
  const tree = p?.kind === "node" ? treeOf(ctx.index, p) : undefined;
  const text = p?.kind === "node" && tree ? nodeText(tree, p.node) : undefined;
  if (text === undefined) return s;
  const words = wordsOf(text);
  const at = s.chars;
  const next = words.find((w) => !at || w.start >= at.end);
  const prev = words.findLast((w) => !at || w.end <= at.start);
  const word = key === "w" || key === "W" ? next : prev;
  if (!word) return s;
  const chars =
    !at || key === "w" || key === "b"
      ? word
      : key === "W"
        ? { start: at.start, end: word.end }
        : { start: word.start, end: at.end };
  return { ...s, chars };
}

/** One normal-mode key; `undefined` when the key is not bound, so the caller lets it through. */
export function modalKey(
  s: ModalState,
  key: string,
  ctx: ModalContext,
): Transition | undefined {
  if (s.mode !== "normal") return undefined;
  const { index } = ctx;
  const done = (state: ModalState, effects: ModalEffect[] = []) => {
    if (
      state.chars &&
      (state.selections !== s.selections || state.primary !== s.primary)
    ) {
      const { chars: _, ...rest } = state;
      return { state: rest, effects };
    }
    return { state, effects };
  };
  if (s.pending === "s") {
    const rest = settled(s);
    const score = scoreKeys[key];
    if (score === undefined) return done(rest);
    const nodes = s.selections.flatMap((t) =>
      t.kind === "node" ? [nodeRef(t)] : [],
    );
    return done(rest, nodes.length ? [{ kind: "setScore", nodes, score }] : []);
  }
  if (key === "s") return done({ ...s, pending: "s" });
  const extended = extensions[key];
  if (extended !== undefined) {
    const p = s.selections[s.primary];
    if (!p) return modalKey(s, extended, ctx);
    return done(add(s, motions[extended]?.(ctx, p)));
  }
  const motion = motions[key];
  if (motion) {
    if (s.selections.length === 0) {
      const first =
        key === "k" || key === "["
          ? step(ctx, undefined, -1, key === "[")
          : step(ctx, undefined, 1, key === "]");
      return done(only(s, first));
    }
    return done(mapSelections(s, (t) => motion(ctx, t)));
  }
  switch (key) {
    case "w":
    case "b":
    case "W":
    case "B":
      return done(narrow(ctx, s, key));
    case "c": {
      const p = s.selections[s.primary];
      if (p?.kind !== "node") return done(s);
      const at = nodeRef(p);
      return done(s, [
        { kind: "comment", at, ...(s.chars && { chars: s.chars }) },
      ]);
    }
    case "r": {
      const p = s.selections[s.primary];
      if (p?.kind !== "node") return done(s);
      return done(s, [{ kind: "reply", at: nodeRef(p) }]);
    }
    case "%": {
      const p = s.selections[s.primary];
      if (!p) return done(s);
      const all = index.stops.filter((r) => r.file === p.file).map(node);
      return done(all.length ? { ...s, selections: all, primary: 0 } : s);
    }
    case ",":
      return done(keepPrimary(s));
    case ")":
    case "(": {
      const len = s.selections.length;
      if (len === 0) return done(s);
      const by = key === ")" ? 1 : len - 1;
      return done({ ...s, primary: (s.primary + by) % len });
    }
    case "-": {
      const len = s.selections.length;
      if (len <= 1) return done(s);
      const selections = s.selections.filter((_, i) => i !== s.primary);
      return done({ ...s, selections, primary: s.primary % (len - 1) });
    }
    case "R":
      return done(s, [{ kind: "submitReview" }]);
    case "?":
      return done(s, [{ kind: "help" }]);
    case "Escape": {
      // Escape first drops a narrowing back to the whole node, then leaves.
      if (s.chars) {
        const { chars: _, ...whole } = s;
        return done(whole);
      }
      return done(keepPrimary(s), [{ kind: "leave" }]);
    }
    case "v": {
      const ids = [
        ...new Set(
          s.selections.flatMap((t) =>
            atomsOf(index, t).map((a) => index.atoms[a]?.id ?? ""),
          ),
        ),
      ];
      if (ids.length === 0) return done(s);
      const viewed = !ids.every(ctx.isViewed);
      return done(s, [{ kind: "setViewed", atoms: ids, viewed }]);
    }
    case "Enter":
      return done(
        s,
        s.selections.flatMap((t) => expand(index, t)),
      );
    case "g": {
      const effects: ModalEffect[] = [];
      const state = mapSelections(s, (t) => {
        const to = counterpart(index, t);
        if (to.file !== t.file) effects.push({ kind: "jump", to });
        return to;
      });
      return done(state, effects);
    }
  }
  return undefined;
}

/** Enter: a node in a move shows its other half; a hunk opens the elided runs beside it. */
function expand(index: AtomIndex, t: Target): ModalEffect[] {
  if (t.kind === "node") {
    const own = ownAtom(index, t);
    const atom =
      own === undefined ? undefined : index.atoms.find((a) => a.id === own);
    const moved = atom?.occurrences.some((r) => r.file !== t.file);
    const side = index.files[t.file]?.fragments[t.fragment];
    const n = treeOf(index, t)?.nodes[t.node];
    const inMove =
      side?.kind === "diff" &&
      n !== undefined &&
      (side[t.side].moves ?? []).some((m) => {
        const first = m.first - side[t.side].startLine;
        const last = m.last - side[t.side].startLine;
        return n.start.line >= first && n.start.line <= last;
      });
    return moved || inMove ? [{ kind: "expandMove", at: t }] : [];
  }
  if (t.kind === "file") return [];
  const frags = index.files[t.file]?.fragments ?? [];
  const out: ModalEffect[] = [];
  for (const dir of [-1, 1]) {
    for (let i = t.fragment + dir; i >= 0 && i < frags.length; i += dir) {
      const k = frags[i]?.kind;
      if (k === "diff") break;
      if (k === "elided") {
        out.push({ kind: "expandElided", file: t.file, fragment: i });
        break;
      }
    }
  }
  return out;
}

export interface Point {
  file: number;
  fragment: number;
  side: SideName;
  /** 0-based into the side's lines. */
  line: number;
  /** UTF-16 into that line. */
  column: number;
}

/** The innermost changed node containing the point, else the hunk, else nothing outside a hunk. */
function targetAt(index: AtomIndex, at: Point): Target | undefined {
  const context = at.fragment === contextFragment;
  if (!context && !hunkOf(index, at.file, at.fragment)) return undefined;
  const tree = treeOf(index, at);
  const p = [at.line, at.column];
  let best: number | undefined;
  let bestDepth = -1;
  tree?.nodes.forEach((n, i) => {
    // Context has no changed node; any of its nodes is a place to comment.
    if (!n.changed && !context) return;
    if (compare([n.start.line, n.start.column], p) > 0) return;
    if (compare(p, [n.end.line, n.end.column]) >= 0) return;
    let depth = 0;
    for (let q = n.parent; q >= 0; q = tree.nodes[q]?.parent ?? -1) depth++;
    if (depth > bestDepth) [best, bestDepth] = [i, depth];
  });
  if (best === undefined)
    return context
      ? undefined
      : { kind: "hunk", file: at.file, fragment: at.fragment };
  return node({
    file: at.file,
    fragment: at.fragment,
    side: at.side,
    node: best,
  });
}

/** A click: the target at the point becomes the only selection; the state is unchanged outside a hunk. */
export function selectAt(
  s: ModalState,
  index: AtomIndex,
  at: Point,
): ModalState {
  const t = targetAt(index, at);
  return t ? only({ ...s, mode: "normal" }, t) : s;
}

/** A Shift+click: the target at the point joins the selections as primary. */
export function addAt(s: ModalState, index: AtomIndex, at: Point): ModalState {
  const t = targetAt(index, at);
  return t ? add({ ...s, mode: "normal" }, t) : s;
}

/**
 * A text selection from `from` to `to` (a drag): the node holding both becomes the only selection, narrowed to
 * the dragged characters. The state is unchanged when no node holds both.
 */
export function narrowAt(
  s: ModalState,
  index: AtomIndex,
  from: Point,
  to: Point,
): ModalState {
  const t = targetAt(index, from);
  if (t?.kind !== "node") return s;
  const tree = treeOf(index, t);
  if (
    !tree ||
    to.file !== t.file ||
    to.fragment !== t.fragment ||
    to.side !== t.side
  )
    return s;
  const end = [to.line, to.column];
  let i = t.node;
  for (;;) {
    const n = tree.nodes[i];
    if (!n) return s;
    if (compare(end, [n.end.line, n.end.column]) <= 0) break;
    i = n.parent;
  }
  const n = tree.nodes[i];
  const text = nodeText(tree, i);
  if (!n || text === undefined) return s;
  /** A point as a display offset into the node's text. */
  const offset = (q: Point) => {
    let o = 0;
    for (let line = n.start.line; line < q.line; line++)
      o +=
        (tree.lines[line]?.length ?? 0) -
        (line === n.start.line ? n.start.column : 0) +
        1;
    return o + q.column - (q.line === n.start.line ? n.start.column : 0);
  };
  const chars = charsOf(text, offset(from), offset(to));
  const { chars: _, ...rest } = settled(s);
  const state = only({ ...rest, mode: "normal" }, { ...t, node: i });
  return chars.end > chars.start ? { ...state, chars } : state;
}

export const modalKeymap: readonly {
  key: string;
  label: string;
  group: "move" | "extend" | "act" | "score";
  /** Bound only right after this prefix key. */
  prefix?: "s";
}[] = [
  { key: "j", label: "next change", group: "move" },
  { key: "k", label: "previous change", group: "move" },
  { key: "]", label: "next unviewed", group: "move" },
  { key: "[", label: "previous unviewed", group: "move" },
  { key: "o", label: "expand to parent", group: "move" },
  { key: "i", label: "shrink to child", group: "move" },
  { key: "n", label: "next sibling", group: "move" },
  { key: "p", label: "previous sibling", group: "move" },
  { key: "x", label: "select hunk", group: "move" },
  { key: "g", label: "go to counterpart", group: "move" },
  { key: "w", label: "narrow to next word", group: "move" },
  { key: "b", label: "narrow to previous word", group: "move" },
  { key: "%", label: "select whole file", group: "extend" },
  { key: "J", label: "add next change", group: "extend" },
  { key: "K", label: "add previous change", group: "extend" },
  { key: "}", label: "add next unviewed", group: "extend" },
  { key: "{", label: "add previous unviewed", group: "extend" },
  { key: "N", label: "add next sibling", group: "extend" },
  { key: "P", label: "add previous sibling", group: "extend" },
  { key: ")", label: "rotate primary forward", group: "extend" },
  { key: "(", label: "rotate primary backward", group: "extend" },
  { key: "-", label: "drop primary selection", group: "extend" },
  { key: ",", label: "keep only primary", group: "extend" },
  { key: "W", label: "grow narrowing to next word", group: "extend" },
  { key: "B", label: "grow narrowing to previous word", group: "extend" },
  { key: "v", label: "toggle viewed", group: "act" },
  { key: "s", label: "score…", group: "act" },
  { key: "c", label: "comment", group: "act" },
  { key: "r", label: "reply to thread", group: "act" },
  { key: "R", label: "submit review", group: "act" },
  { key: "2", label: "+2 good to merge", group: "score", prefix: "s" },
  { key: "1", label: "+1 looks good", group: "score", prefix: "s" },
  { key: "q", label: "-1 would rather not", group: "score", prefix: "s" },
  { key: "w", label: "-2 must not merge", group: "score", prefix: "s" },
  { key: "0", label: "clear score", group: "score", prefix: "s" },
  { key: "Enter", label: "expand move or context", group: "act" },
  { key: "?", label: "toggle this help", group: "act" },
  {
    key: "Escape",
    label: "drop narrowing, or leave review keys",
    group: "act",
  },
];

/** The few members of an element the binding uses, so a test can hand in a plain object. */
export interface ModalRoot {
  addEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
  removeEventListener(
    type: "keydown",
    listener: (e: KeyboardEvent) => void,
  ): void;
  contains(other: Node | null): boolean;
  readonly ownerDocument: { readonly activeElement: Element | null };
}

export interface ModalBindingOptions {
  index: AtomIndex;
  viewed: ViewedStore;
  /** Where `setScore` writes; without one, scoring reaches only `onEffect`. */
  scores?: ScoreStore;
  /** `plainKeyOf` when absent. */
  keyOf?: KeyOf;
  initial?: ModalState;
  onChange?: (state: ModalState) => void;
  /** Every effect, after the binding applied `setViewed`, `setScore` and `leave` itself. */
  onEffect?: (effect: ModalEffect) => void;
}

export interface ModalBinding {
  state(): ModalState;
  /** Replaces the state, as a click does through `selectAt`. */
  set(state: ModalState): void;
  /** Runs one key as a keydown inside the root would, whatever has focus; `false` when it is unbound. */
  press(key: string): boolean;
  dispose(): void;
}

const editable = (el: Element) =>
  ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
  (el as Partial<HTMLElement>).isContentEditable === true;

/** Handles keys only while focus is inside `root`, and never a key combined with Ctrl, Meta or Alt. */
export function bindModal(
  root: ModalRoot,
  opts: ModalBindingOptions,
): ModalBinding {
  const keyOf = opts.keyOf ?? plainKeyOf;
  let state = opts.initial ?? emptyModal;
  const ctx: ModalContext = {
    index: opts.index,
    isViewed: (atom) => opts.viewed.get(keyOf(atomSubject(atom))),
  };
  const set = (next: ModalState) => {
    state = next;
    opts.onChange?.(state);
  };
  const press = (key: string) => {
    const active = root.ownerDocument.activeElement;
    const blur = () => (active as Partial<HTMLElement> | null)?.blur?.();
    const mode =
      active && root.contains(active) && editable(active) ? "insert" : "normal";
    if (state.mode !== mode) set({ ...settled(state), mode });
    if (mode === "insert") {
      if (key !== "Escape") return false;
      blur();
      set({ ...state, mode: "normal" });
      return true;
    }
    const t = modalKey(state, key, ctx);
    if (!t) return false;
    if (t.state !== state) set(t.state);
    for (const effect of t.effects) {
      if (effect.kind === "setViewed")
        writeAtoms(effect.atoms, effect.viewed, opts.viewed, keyOf);
      if (effect.kind === "setScore" && opts.scores)
        writeScores(opts.index, effect.nodes, effect.score, opts.scores, keyOf);
      if (effect.kind === "leave") blur();
      opts.onEffect?.(effect);
    }
    return true;
  };
  const onKey = (e: KeyboardEvent) => {
    if (
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.isComposing ||
      e.defaultPrevented
    )
      return;
    const active = root.ownerDocument.activeElement;
    if (!active || !root.contains(active)) return;
    if (press(e.key)) e.preventDefault();
  };
  root.addEventListener("keydown", onKey);
  return {
    state: () => state,
    set,
    press,
    dispose: () => root.removeEventListener("keydown", onKey),
  };
}
