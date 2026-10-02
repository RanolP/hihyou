import { diffArrays } from "diff";
import type { Tree } from "syntechs/core";
import type { Mapping } from "syntechs/diff";
import { type HighlightModule, type ScopeRuns, scopeRuns } from "syntechs/highlight";
import type { AstSteps } from "./anchor.js";
import { lineEnd, lineOf, type Version } from "./file.js";
import type { CollapseReason } from "./fold.js";

export interface FileDiff {
  path: string;
  grammar?: string; // absent -> line-diff fallback
  fragments: CodeFragment[]; // SSoT; no separate Edit[]; begin/end always balanced
  /** The engine judges the whole file should be shown folded, and says why. */
  collapsed?: { reason: CollapseReason };
}

export type CodeFragment =
  | { kind: "begin"; label: string; at: AstSteps } // label e.g. "class AA"
  | { kind: "end"; label: string }
  | { kind: "unchanged"; spans: Span[]; at: AstSteps[]; lines: LinePair }
  | { kind: "diff"; before: Side; after: Side } // one side empty = added / deleted
  | { kind: "elided"; lines: LinePair }; // engine decides what to collapse

export interface Side {
  spans: Span[];
  at: AstSteps[];
  /** 1-based; for an empty side, the line the other side's lines take the place of. */
  startLine: number;
  /**
   * The halves of moves on this side, in line order, each pointing at its other half, possibly in another file.
   * A move whose lines cover every line of the side is the side itself moving; any other marks only its own lines.
   */
  moves?: SideMove[];
}

/** One half of a move: the lines its moved node spans on this side, clipped to the side. */
export interface SideMove {
  /** 1-based, inclusive. */
  first: number;
  last: number;
  counterpart: { path: string; at: AstSteps[] };
}

export interface Span {
  text: string;
  scope?: string; // syntax colour: a TextMate scope stack, outermost first, space-separated
  changed?: boolean; // diff emphasis, kept separate from syntax colour
}

/** 1-based line where the fragment's run starts, on each side. */
export interface LinePair {
  before: number;
  after: number;
}

/** Half-open offsets into a version's display text. */
export interface Range {
  start: number;
  end: number;
}

/** A node (of the side's tree) that is one half of a move. */
export interface MoveMark {
  node: number;
  counterpart: { path: string; at: AstSteps[] };
  /** In a move inside one file, the other half's node on the other side. */
  twin?: number;
}

export interface SideInput {
  v: Version;
  /** Text whose lines cannot pair with the other side. */
  changed: Range[];
  /** Text to emphasize inside those lines; a subset of `changed`. */
  emphasis: Range[];
  moves: MoveMark[];
}

export interface FragmentInput {
  a: SideInput;
  b: SideInput;
  /** Syntax diff only: pairs an unchanged line with the line its first token was matched to. */
  mapping?: Mapping;
  indentMatters: boolean;
  /** The grammar's highlighter; spans carry no `scope` without one. */
  highlight?: HighlightModule;
}

/** Unchanged lines kept visible on each side of a change. */
const context = 3;

// Whitespace separates tokens and is never one itself, as in syntechs' `lineDiff`.
const token =
  /(?<![\p{L}\p{N}_])(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

interface Line {
  side: 0 | 1;
  index: number;
  key: string;
  changed: boolean;
  /** Side 0 only: the side-1 line this one may pair with; -1 for none, -2 when any equal line may. */
  pair: number;
}

type Row =
  | { same: true; a: number; b: number }
  | { same: false; a0: number; a1: number; b0: number; b1: number };

interface Box {
  id: string;
  label: string;
  at: AstSteps;
}

/**
 * The fragments of one file. Lines touched by an edit never pair; the remaining lines pair in order
 * where they read the same (and, in a syntax diff, where the matcher paired their first tokens). Runs of
 * pairs far from any change are elided, and begin/end come from a stack, so they always balance.
 */
export function buildFragments(input: FragmentInput): CodeFragment[] {
  const { mapping, highlight } = input;
  const a = {
    ...input.a,
    emphasis: paintRanges(input.a.v.text, wholeNodes(input.a.v, input.a.emphasis)),
  };
  const b = {
    ...input.b,
    emphasis: paintRanges(input.b.v.text, wholeNodes(input.b.v, input.b.emphasis)),
  };
  const scopes = (v: Version) =>
    highlight && v.tree ? scopeRuns(v.tree, highlight, v.text.length, v.start, v.end) : undefined;
  const scopesA = scopes(a.v);
  const scopesB = scopes(b.v);
  const pairs = mapping ? pairLines(a.v, b.v, mapping) : undefined;
  const linesA = lines(a, 0, input.indentMatters, pairs);
  const linesB = lines(b, 1, input.indentMatters, undefined);
  const rows = alignRows(linesA, linesB);
  // A move whose halves land in one `diff` fragment reads as its edits alone: both halves sit side by side,
  // so a box would only claim the fragment's other changes moved too.
  const rowsA = lineRows(rows, a.v, 0);
  const rowsB = lineRows(rows, b.v, 1);
  const rowOf = (v: Version, at: Int32Array, n: number) => {
    const first = at[lineOf(v, v.start(n))] ?? -1;
    const last = at[lineOf(v, Math.max(v.start(n), v.end(n) - 1))] ?? -1;
    return first === last ? first : -1;
  };
  const inPlaceA = new Set<number>();
  const inPlaceB = new Set<number>();
  for (const m of a.moves) {
    if (m.twin === undefined) continue;
    const r = rowOf(a.v, rowsA, m.node);
    if (r >= 0 && r === rowOf(b.v, rowsB, m.twin)) {
      inPlaceA.add(m.node);
      inPlaceB.add(m.twin);
    }
  }
  a.moves = a.moves.filter((m) => !inPlaceA.has(m.node));
  b.moves = b.moves.filter((m) => !inPlaceB.has(m.node));

  const pathsB = b.v.tree ? linePaths(b.v, b.v.tree, (n) => `b${n}`) : [];
  const pathsA = a.v.tree
    ? linePaths(a.v, a.v.tree, (n) => {
        const partner = mapping?.src[mapping.a.index(n)] ?? -1;
        return partner >= 0 && mapping
          ? `b${mapping.b.node(partner)}`
          : `a${n}`;
      })
    : [];
  const pathOf = (r: Row): Box[] => {
    if (r.same) return pathsB[r.b] ?? [];
    if (r.b1 > r.b0) return common(pathsB[r.b0] ?? [], pathsB[r.b1 - 1] ?? []);
    if (r.a1 > r.a0) return common(pathsA[r.a0] ?? [], pathsA[r.a1 - 1] ?? []);
    return [];
  };

  const visible = rows.map((r) => !r.same);
  rows.forEach((r, i) => {
    if (r.same) return;
    for (let k = Math.max(0, i - context); k <= i + context; k++)
      if (k < rows.length) visible[k] = true;
  });

  const items: { path: Box[]; fragment: CodeFragment }[] = [];
  for (let i = 0; i < rows.length;) {
    const r = rows[i] as Row;
    if (!r.same) {
      items.push({ path: pathOf(r), fragment: diffFragment(a, b, r, scopesA, scopesB) });
      i++;
      continue;
    }
    let j = i + 1;
    while (j < rows.length && visible[j] === visible[i] && rows[j]?.same) j++;
    // Eliding a single line hides nothing worth the marker.
    const elide = !visible[i] && j - i > 1;
    const run = rows.slice(i, j) as (Row & { same: true })[];
    if (elide) {
      const path = run.map(pathOf).reduce(common);
      items.push({
        path,
        fragment: {
          kind: "elided",
          lines: { before: r.a + 1, after: r.b + 1 },
        },
      });
    } else {
      // One unchanged fragment per stretch that sits in the same containers.
      let k = 0;
      while (k < run.length) {
        const first = run[k] as Row & { same: true };
        const path = pathOf(first);
        let m = k + 1;
        while (m < run.length && samePath(pathOf(run[m] as Row), path)) m++;
        items.push({
          path,
          fragment: unchangedFragment(
            b.v,
            scopesB,
            { before: first.a + 1, after: first.b + 1 },
            m - k,
          ),
        });
        k = m;
      }
    }
    i = j;
  }

  const out: CodeFragment[] = [];
  const open: Box[] = [];
  for (const { path, fragment } of items) {
    let k = 0;
    while (k < open.length && k < path.length && open[k]?.id === path[k]?.id)
      k++;
    while (open.length > k) {
      const box = open.pop() as Box;
      out.push({ kind: "end", label: box.label });
    }
    for (const box of path.slice(k)) {
      out.push({ kind: "begin", label: box.label, at: box.at });
      open.push(box);
    }
    out.push(fragment);
  }
  while (open.length > 0) {
    const box = open.pop() as Box;
    out.push({ kind: "end", label: box.label });
  }
  return out;
}

function lines(
  s: SideInput,
  side: 0 | 1,
  indentMatters: boolean,
  pairs: Int32Array | undefined,
): Line[] {
  const { v } = s;
  const changed = new Uint8Array(v.lineStarts.length);
  for (const r of [...s.changed, ...s.moves.map((m) => nodeRange(v, m.node))]) {
    if (r.end <= r.start) continue;
    changed.fill(1, lineOf(v, r.start), lineOf(v, r.end - 1) + 1);
  }
  return v.lineStarts.map((start, index) => {
    const text = v.text.slice(start, lineEnd(v, index));
    const tokens = text.match(token);
    return {
      side,
      index,
      key: tokens
        ? JSON.stringify(
            indentMatters ? [indentDepth(text), ...tokens] : tokens,
          )
        : "",
      changed: changed[index] === 1,
      pair: pairs ? (pairs[index] as number) : -2,
    };
  });
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

/**
 * Per line of `a`, the line of `b` holding the partner of its first token; -1 when unmatched. A line no token
 * starts on lies inside a token spanning lines (a block comment, a template string): it pairs with the line
 * at the same offset inside that token's partner.
 */
function pairLines(a: Version, b: Version, m: Mapping): Int32Array {
  const pairs = new Int32Array(a.lineStarts.length).fill(-1);
  const seen = new Uint8Array(a.lineStarts.length);
  const tree = m.a.tree;
  for (let ord = 0; ord < tree.nodeCount; ord++) {
    const n = tree.at(ord);
    if (tree.count(n) !== 0 || a.end(n) <= a.start(n)) continue;
    const first = lineOf(a, a.start(n));
    const last = lineOf(a, a.end(n) - 1);
    const partner = m.src[m.a.index(n)] ?? -1;
    const p = partner >= 0 ? m.b.node(partner) : undefined;
    const pFirst = p === undefined ? -1 : lineOf(b, b.start(p));
    const pLast = p === undefined ? -1 : lineOf(b, b.end(p) - 1);
    for (let line = first; line <= last; line++) {
      if (seen[line] === 1) continue;
      seen[line] = 1;
      const to = pFirst + (line - first);
      if (p !== undefined && to <= pLast) pairs[line] = to;
    }
  }
  return pairs;
}

/** Per line of a side, the index of the `diff` row holding it; -1 on an unchanged line. */
function lineRows(rows: Row[], v: Version, side: 0 | 1): Int32Array {
  const out = new Int32Array(v.lineStarts.length).fill(-1);
  rows.forEach((r, i) => {
    if (!r.same) out.fill(i, side === 0 ? r.a0 : r.b0, side === 0 ? r.a1 : r.b1);
  });
  return out;
}

function alignRows(linesA: Line[], linesB: Line[]): Row[] {
  const equal = (p: Line, q: Line) => {
    const [x, y] = p.side === 0 ? [p, q] : [q, p];
    if (x.changed || y.changed || x.key !== y.key) return false;
    return x.pair === -2 || x.key === "" || x.pair === y.index;
  };
  const rows: Row[] = [];
  let ia = 0;
  let ib = 0;
  let pending: (Row & { same: false }) | undefined;
  const flush = () => {
    if (pending) rows.push(pending);
    pending = undefined;
  };
  for (const c of diffArrays(linesA, linesB, { comparator: equal })) {
    if (!c.added && !c.removed) {
      flush();
      for (let k = 0; k < c.count; k++)
        rows.push({ same: true, a: ia + k, b: ib + k });
      ia += c.count;
      ib += c.count;
      continue;
    }
    pending ??= { same: false, a0: ia, a1: ia, b0: ib, b1: ib };
    if (c.removed) pending.a1 = ia += c.count;
    else pending.b1 = ib += c.count;
  }
  flush();
  return rows;
}

/**
 * Per line, the chain of named declarations (a node with its own `name` field, over two lines or more)
 * enclosing it, outermost first. `idOf` gives a declaration the identity it shares with its counterpart
 * on the other side.
 */
function linePaths(
  v: Version,
  tree: Tree,
  idOf: (n: number) => string,
): Box[][] {
  const paths: Box[][] = Array.from({ length: v.lineStarts.length }, () => []);
  const stack: { n: number; steps: AstSteps; path: Box[] }[] = [
    { n: tree.root, steps: [], path: [] },
  ];
  while (stack.length > 0) {
    const { n, steps, path } = stack.pop() as (typeof stack)[number];
    const first = lineOf(v, v.start(n));
    const last = lineOf(v, Math.max(v.start(n), v.end(n) - 1));
    if (last <= first) continue;
    let inner = path;
    if (n !== tree.root && tree.named(n)) {
      const label = declarationLabel(tree, n);
      if (label !== undefined) {
        inner = [...path, { id: idOf(n), label, at: steps }];
        for (let l = first; l <= last; l++) paths[l] = inner;
      }
    }
    const kids: { n: number; steps: AstSteps; path: Box[] }[] = [];
    let named = 0;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (!tree.named(c)) continue;
      kids.push({ n: c, steps: [...steps, named++], path: inner });
    }
    stack.push(...kids.reverse());
  }
  return paths;
}

/** "class AA", "def run", "method_definition render"; undefined for a node that declares no name. */
function declarationLabel(tree: Tree, n: number): string | undefined {
  let name: number | undefined;
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.named(c) && tree.fieldName(c) === "name") name = c;
  }
  if (name === undefined) return undefined;
  // "class Shop", "function f"; a method has no keyword and reads as its bare name.
  const first = tree.child(n, 0);
  return !tree.named(first) && /^[a-z]+$/.test(tree.text(first))
    ? `${tree.text(first)} ${tree.text(name)}`
    : tree.text(name);
}

function common(p: Box[], q: Box[]): Box[] {
  let k = 0;
  while (k < p.length && k < q.length && p[k]?.id === q[k]?.id) k++;
  return p.slice(0, k);
}

const samePath = (p: Box[], q: Box[]) =>
  p.length === q.length && common(p, q).length === p.length;

const nodeRange = (v: Version, n: number): Range => ({
  start: v.start(n),
  end: v.end(n),
});

function unchangedFragment(
  v: Version,
  scopes: ScopeRuns | undefined,
  lines: LinePair,
  count: number,
): CodeFragment & { kind: "unchanged" } {
  const start = v.lineStarts[lines.after - 1] as number;
  const end = lineEnd(v, lines.after + count - 2);
  return {
    kind: "unchanged",
    spans: split(v.text, start, end, [], scopes),
    at: v.tree ? nodesIn(v, v.tree, start, end) : [],
    lines,
  };
}

/**
 * The unchanged lines an `elided` fragment at `lines` hid, read off the after side's display text `v` and
 * coloured as `buildFragments` colours the lines it shows. `count` absent runs to the end of the file.
 * Undefined when the lines fall outside the text.
 */
export function elidedLines(
  v: Version,
  highlight: HighlightModule | undefined,
  lines: LinePair,
  count?: number,
): (CodeFragment & { kind: "unchanged" }) | undefined {
  const total = v.lineStarts.length;
  const n = count ?? total - (lines.after - 1);
  if (lines.after < 1 || n < 1 || lines.after - 1 + n > total) return undefined;
  const scopes =
    highlight && v.tree ? scopeRuns(v.tree, highlight, v.text.length, v.start, v.end) : undefined;
  return unchangedFragment(v, scopes, lines, n);
}

function diffFragment(
  a: SideInput,
  b: SideInput,
  r: Row & { same: false },
  scopesA: ScopeRuns | undefined,
  scopesB: ScopeRuns | undefined,
): CodeFragment {
  return {
    kind: "diff",
    before: sideFragment(a, r.a0, r.a1, scopesA),
    after: sideFragment(b, r.b0, r.b1, scopesB),
  };
}

function sideFragment(
  s: SideInput,
  l0: number,
  l1: number,
  scopes: ScopeRuns | undefined,
): Side {
  const { v } = s;
  const start = v.lineStarts[l0] ?? v.text.length;
  const end = l1 > l0 ? lineEnd(v, l1 - 1) : start;
  const moves = end > start ? sideMoves(s, l0, l1, start, end) : [];
  return {
    spans: split(v.text, start, end, s.emphasis, scopes),
    at: v.tree && end > start ? nodesIn(v, v.tree, start, end) : [],
    startLine: l0 + 1,
    ...(moves.length > 0 && { moves }),
  };
}

/** A line of nothing but brackets and separators reads as part of whatever code is around it. */
const scaffold = /^[\s()[\]{}<>;,]*$/;

/**
 * The moves overlapping lines `[l0, l1)`, each by the lines its node spans there, overlapping ones joined.
 * When they leave out only blank and bracket lines, the side moves as one: a single move over all its lines.
 */
function sideMoves(
  s: SideInput,
  l0: number,
  l1: number,
  start: number,
  end: number,
): SideMove[] {
  const { v } = s;
  const out: SideMove[] = [];
  const found = s.moves
    .filter((m) => v.start(m.node) < end && v.end(m.node) > start)
    .map((m) => ({
      first: Math.max(l0, lineOf(v, v.start(m.node))) + 1,
      last:
        Math.min(l1 - 1, lineOf(v, Math.max(v.start(m.node), v.end(m.node) - 1))) + 1,
      counterpart: { path: m.counterpart.path, at: [...m.counterpart.at] },
    }))
    .sort((p, q) => p.first - q.first);
  for (const m of found) {
    const prev = out.at(-1);
    if (!prev || m.first > prev.last) {
      out.push(m);
      continue;
    }
    prev.last = Math.max(prev.last, m.last);
    if (prev.counterpart.path === m.counterpart.path)
      prev.counterpart.at.push(...m.counterpart.at);
  }
  const first = out[0];
  if (!first) return out;
  const covered = new Uint8Array(l1 - l0);
  for (const m of out) covered.fill(1, m.first - 1 - l0, m.last - l0);
  for (let l = l0; l < l1; l++) {
    const text = v.text.slice(v.lineStarts[l], lineEnd(v, l));
    if (covered[l - l0] === 0 && !scaffold.test(text)) return out;
  }
  const { path } = first.counterpart;
  const at = out.flatMap((m) => (m.counterpart.path === path ? m.counterpart.at : []));
  return [{ first: l0 + 1, last: l1, counterpart: { path, at } }];
}

/**
 * `text[start, end)` cut into spans at the edges of `emphasis` (sorted, disjoint), emphasized ones marked
 * `changed`, and at the edges of the syntax scope runs, each carrying its innermost-last scope stack.
 */
function split(
  text: string,
  start: number,
  end: number,
  emphasis: Range[],
  scopes: ScopeRuns | undefined,
): Span[] {
  const spans: Span[] = [];
  const runs = scopes?.runs;
  // First run that ends after `start`; runs are sorted and disjoint.
  let r = 0;
  if (runs) {
    let lo = 0;
    let hi = runs.length / 3;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((runs[mid * 3 + 1] as number) <= start) lo = mid + 1;
      else hi = mid;
    }
    r = lo * 3;
  }
  let e = 0;
  for (let at = start; at < end; ) {
    while (e < emphasis.length && (emphasis[e] as Range).end <= at) e++;
    const em = emphasis[e];
    const inEmphasis = em !== undefined && em.start <= at;
    let to = inEmphasis ? Math.min(end, em.end) : Math.min(end, em?.start ?? end);
    let scope: string | undefined;
    if (runs) {
      while (r < runs.length && (runs[r + 1] as number) <= at) r += 3;
      if (r < runs.length) {
        const rs = runs[r] as number;
        if (rs <= at) {
          scope = scopes.stacks[runs[r + 2] as number];
          to = Math.min(to, runs[r + 1] as number);
        } else to = Math.min(to, rs);
      }
    }
    spans.push({
      text: text.slice(at, to),
      ...(scope !== undefined && { scope }),
      ...(inEmphasis && { changed: true }),
    });
    at = to;
  }
  return spans;
}

/** The outermost named nodes lying wholly inside `[start, end)`, in document order. */
function nodesIn(
  v: Version,
  tree: Tree,
  start: number,
  end: number,
): AstSteps[] {
  const out: AstSteps[] = [];
  const stack: { n: number; steps: AstSteps }[] = [{ n: tree.root, steps: [] }];
  while (stack.length > 0) {
    const { n, steps } = stack.pop() as (typeof stack)[number];
    const s = v.start(n);
    const e = v.end(n);
    if (e <= s || e <= start || s >= end) continue;
    if (n !== tree.root && s >= start && e <= end) {
      out.push(steps);
      continue;
    }
    const kids: { n: number; steps: AstSteps }[] = [];
    let named = 0;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (tree.named(c)) kids.push({ n: c, steps: [...steps, named++] });
    }
    stack.push(...kids.reverse());
  }
  return out;
}

/** Tokens that only join or close the code around them; a node keeping nothing else kept nothing of note. */
const joiner = /^(?:[.,;()[\]{}]|\?\.)+$/;

/**
 * `emphasis` grown to cover each node whose every other token is emphasized and which keeps only joiners
 * unchanged: `basicColor.DARKGRAY400` replaced whole reads as one removed run, not two islands around a kept
 * `.`. A node keeping any word or literal (`theme.colors.a` becoming `theme.colors.b`) keeps its fine emphasis,
 * and so does one spanning lines, whose kept brackets sit on lines that otherwise read unchanged.
 */
function wholeNodes(v: Version, emphasis: Range[]): Range[] {
  const tree = v.tree;
  const merged = mergeRanges(emphasis);
  if (!tree || merged.length === 0) return merged;
  const emphasized = (start: number, end: number) => {
    let lo = 0;
    let hi = merged.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((merged[mid] as Range).end <= start) lo = mid + 1;
      else hi = mid;
    }
    const r = merged[lo];
    return r !== undefined && r.start <= start && end <= r.end;
  };
  // Per node: -1 keeps a word or literal unchanged, else how many changed words it holds between its joiners.
  const out = [...merged];
  const state = new Map<number, number>();
  const stack: { n: number; open: boolean }[] = [{ n: tree.root, open: false }];
  while (stack.length > 0) {
    const top = stack.pop() as (typeof stack)[number];
    const { n } = top;
    const start = v.start(n);
    const end = v.end(n);
    const count = tree.count(n);
    if (count === 0) {
      const t = v.text.slice(start, end).trim();
      state.set(n, t === "" || joiner.test(t) ? 0 : emphasized(start, end) ? 1 : -1);
      continue;
    }
    if (!top.open) {
      stack.push({ n, open: true });
      for (let i = 0; i < count; i++)
        stack.push({ n: tree.child(n, i), open: false });
      continue;
    }
    let s = 0;
    for (let i = 0; i < count; i++) {
      const c = state.get(tree.child(n, i)) ?? -1;
      state.delete(tree.child(n, i));
      s = c === -1 || s === -1 ? -1 : s + c;
    }
    state.set(n, s);
    // One changed word already reads as one del and one ins; only two or more interleave around a kept joiner.
    if (s >= 2 && n !== tree.root && !v.text.slice(start, end).includes("\n") && !emphasized(start, end))
      out.push({ start, end });
  }
  return mergeRanges(out);
}

/** Sorted, overlapping ranges merged: the shape `split` reads. */
export function mergeRanges(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of ranges.toSorted((p, q) => p.start - q.start)) {
    if (r.end <= r.start) continue;
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * The emphasis a viewer paints: changed nodes merged, two of them joined across the spaces between them on
 * one line, so an inserted `, b` reads as one range rather than two islands, and cut at line breaks with
 * each line's indentation left out.
 */
export function paintRanges(text: string, ranges: Range[]): Range[] {
  const out: Range[] = [];
  const push = (start: number, end: number) => {
    if (end <= start) return;
    const last = out.at(-1);
    if (last && /^[ \t]*$/.test(text.slice(last.end, start))) last.end = end;
    else out.push({ start, end });
  };
  for (const r of mergeRanges(ranges)) {
    let at = r.start;
    for (;;) {
      const nl = text.indexOf("\n", at);
      const stop = nl === -1 || nl >= r.end ? r.end : nl;
      push(at, stop);
      if (stop >= r.end) break;
      at = stop + 1;
      while (at < r.end && (text[at] === " " || text[at] === "\t")) at++;
    }
  }
  return out;
}
