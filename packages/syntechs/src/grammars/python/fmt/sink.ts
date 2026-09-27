import * as stream from "../../../fmt/stream.js";
import type { Expr, Stmt } from "./ast.js";
import type { Fmt } from "./builders.js";
import type { PrintArgs } from "../../../fmt/rules.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import * as el from "./elements.js";
import type { Format, Group, GroupRef } from "./elements.js";

// Where Python's rules write: the rules its DSL spec generates (fmt.gen.ts, whose stream imports the generator
// points here) and the ruff rules moving off elements.ts's `Format`s. Ruff's rules around still read a part as a
// `Format`, so a rule they call runs inside `record` (`dslPart` for a generated one), which turns what it writes
// into one; outside a recording the calls go to the stream. Every writer here records the element that writes the
// same stream entries, so a rule prints the same recorded or not. A part a rule reads before placing it
// (`willBreak`, `removeSoftLines`, several best-fitting variants) is a `Part`: `capture`d, queried, then `place`d.

export {
  BLANK,
  BROKEN,
  COLLAPSE,
  FILL,
  FILL_ITEM,
  GROUP,
  GROUP_IF_BROKEN,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  LINE_SUFFIX,
  SOFT,
} from "../../../fmt/stream.js";

// Recorded interval kinds of ruff's layouts, apart from the stream's own kinds.
const BEST_FITTING = -2;
const VARIANT = -3;
const BEST_FIT_PARENTHESIZE = -4;
const FITS_EXPANDED = -5;
const INDENT_IF_BREAK = -6;
const ROOT = -7;

interface Frame {
  readonly kind: number;
  readonly id: number;
  /** The group an `ifBreak`-like interval asks; a line suffix's reserved columns are in `flags`. */
  readonly ref: GroupRef | undefined;
  readonly flags: number;
  /** What was written into it. */
  readonly parts: Format[];
  /** A best-fitting's variants; a best-fit-parenthesize's closing part. */
  readonly list: Format[];
}

/** The frames of the recordings in progress, innermost last; empty: writes go to the stream. */
const frames: Frame[] = [];
/**
 * The id `open` returns in a recording is `RECORDED` plus an index here, apart from the stream's interval ids, so
 * a recorded interval may ask a group already written to the stream and a stream write one already recorded. The
 * index holds the group (or best-fit-parenthesize) it opened, which exists from its open.
 */
const RECORDED = 1 << 30;
let handles: (Group | undefined)[] = [];

const top = () => frames[frames.length - 1] as Frame;
const put = (f: Format) => void top().parts.push(f);

function handleOf(ref: number): Group {
  const g = handles[ref - RECORDED];
  if (g === undefined) throw new Error(`python sink: interval refers to ${ref}, which is no recorded group`);
  return g;
}

/** In a recording, the group `ref` names: one recorded, or one already written to the stream. */
function refOf(ref: number): GroupRef | undefined {
  if (ref < 0) return undefined;
  return ref >= RECORDED ? handleOf(ref) : { k: ref };
}

/** On the stream, the interval `ref` names: a recorded group must have been written since. */
function streamRef(ref: number): number {
  if (ref < RECORDED) return ref;
  const k = handleOf(ref).k;
  if (k < 0) throw new Error("python sink: a stream write asks the mode of a recorded group not yet written");
  return k;
}

function openFrame(kind: number, ref: GroupRef | undefined, flags = 0, open0?: Format): number {
  const id = RECORDED + handles.length;
  const parts: Format[] = [];
  const list: Format[] = [];
  let handle: Group | undefined;
  // A group's handle exists from its open, holding the parts it is still being written into, so an interval
  // inside it may ask it.
  if (kind === stream.GROUP) handle = el.group(parts, (flags & stream.BROKEN) !== 0);
  else if (kind === BEST_FIT_PARENTHESIZE) handle = el.bestFitParenthesize(open0 ?? [], parts, list);
  handles.push(handle);
  frames.push({ kind, id, ref, flags, parts, list });
  return id;
}

function closeFrame(expect?: number): Frame {
  const f = frames.pop();
  if (!f || f.kind === ROOT) throw new Error("python sink: a close with no open");
  if (expect !== undefined && f.kind !== expect)
    throw new Error(`python sink: closing interval kind ${f.kind} as ${expect}`);
  return f;
}

const needRef = (f: Frame): GroupRef => {
  if (!f.ref) throw new Error(`python sink: interval kind ${f.kind} asks no group`);
  return f.ref;
};

export function sToken(node: number, s: string, synthetic = false): void {
  if (frames.length > 0) put(synthetic ? el.synthetic(node, s) : el.token(node, s));
  else stream.sToken(node, s, synthetic);
}
export function sText(s: string): void {
  if (frames.length > 0) put(el.text(s));
  else stream.sText(s);
}
/** A token whose line breaks print as they are, the column restarting after the last. */
export function sLiteral(node: number, s: string): void {
  if (frames.length > 0) put(el.literalToken(node, s));
  else stream.sLiteral(node, s);
}
/** A line: `SOFT` (nothing when flat) or a space when flat, `HARD` always breaking; `COLLAPSE` and `BLANK` are ruff's. */
export function sLine(flags: number): void {
  if (frames.length > 0) put(el.lineOf(flags));
  else if (flags & (stream.COLLAPSE | stream.BLANK)) stream.sRuffLine(flags);
  else stream.sLine(flags & (stream.SOFT | stream.HARD));
}
/** `sLine`, by the name the stream gives a line with ruff's flags. */
export const sRuffLine = sLine;
export function sBreakParent(): void {
  if (frames.length > 0) put(el.breakParent);
  else stream.sBreakParent();
}
export function sHardline(): void {
  sLine(stream.HARD);
  sBreakParent();
}

/**
 * Opens a `GROUP` (`BROKEN`: built broken), an `INDENT`, an `IF_BROKEN`/`IF_FLAT` on the group `ref` (-1: the
 * enclosing mode), a `GROUP_IF_BROKEN` on the group `ref` (ruff's `conditional_group`) or a `LINE_SUFFIX`. Close
 * it with `close`.
 */
export function open(kind: number, ref = -1, flags = 0): number {
  if (frames.length === 0)
    return stream.open(kind, kind === stream.LINE_SUFFIX ? ref : streamRef(ref), flags);
  switch (kind) {
    case stream.GROUP:
    case stream.INDENT:
      return openFrame(kind, undefined, flags);
    case stream.IF_BROKEN:
    case stream.IF_FLAT:
    case stream.GROUP_IF_BROKEN:
      return openFrame(kind, refOf(ref));
    case stream.LINE_SUFFIX:
      return openFrame(kind, undefined, Math.max(ref, 0));
    default:
      throw new Error(`python sink: interval kind ${kind} has no ruff element`);
  }
}
/** Opens a line suffix whose `reserved` columns count against the line now (ruff's trailing comments). */
export function openReservedSuffix(reserved: number): number {
  if (frames.length === 0) return stream.openReservedSuffix(reserved);
  return openFrame(stream.LINE_SUFFIX, undefined, reserved);
}
/** Ruff's `indent_if_group_breaks`: the contents indented when the group `ref` prints broken. */
export function openIndentIfBreak(ref: number): number {
  if (frames.length === 0) return stream.openIndentIfBreak(streamRef(ref));
  return openFrame(INDENT_IF_BREAK, refOf(ref));
}
/** Ruff's `fits_expanded`, while the group `whenFlat` (-1: always) prints flat. */
export function openFitsExpanded(whenFlat: number): number {
  if (frames.length === 0) return stream.openFitsExpanded(streamRef(whenFlat));
  return openFrame(FITS_EXPANDED, refOf(whenFlat));
}
/** Ruff's `best_fitting`: each variant between `openVariant` and `closeVariant`, then `close`. */
export function openBestFitting(allLines: boolean): number {
  if (frames.length === 0) return stream.openBestFitting(allLines);
  return openFrame(BEST_FITTING, undefined, allLines ? 1 : 0);
}
export function openVariant(k: number): number {
  if (frames.length === 0) return stream.openVariant(k);
  if (top().kind !== BEST_FITTING || top().id !== k)
    throw new Error("python sink: a variant outside its best-fitting");
  return openFrame(VARIANT, undefined);
}
export function closeVariant(v: number): void {
  if (frames.length === 0) {
    stream.closeVariant(v);
    return;
  }
  const f = closeFrame(VARIANT);
  top().list.push(f.parts);
}
/**
 * Ruff's `best_fit_parenthesize`: `open0` written here, then the contents, then `closeBestFitParenthesize`. The
 * id it returns is a group other intervals may ask.
 */
export function openBestFitParenthesize(open0: () => void): number {
  if (frames.length === 0) return stream.openBestFitParenthesize(open0);
  return openFrame(BEST_FIT_PARENTHESIZE, undefined, 0, record(open0));
}
export function closeBestFitParenthesize(k: number, close0: () => void): void {
  if (frames.length === 0) {
    stream.closeBestFitParenthesize(k, close0);
    return;
  }
  const closing = record(close0);
  const f = closeFrame(BEST_FIT_PARENTHESIZE);
  if (f.id !== k) throw new Error("python sink: closing another best-fit-parenthesize");
  f.list.push(closing);
  put(handleOf(f.id));
}
export function close(): void {
  if (frames.length === 0) {
    stream.close();
    return;
  }
  const f = closeFrame();
  switch (f.kind) {
    case stream.GROUP:
      put(handleOf(f.id));
      return;
    case stream.INDENT:
      put(el.indent(f.parts));
      return;
    case stream.IF_BROKEN:
      put(el.ifBreak(f.parts, [], f.ref));
      return;
    case stream.IF_FLAT:
      put(el.ifBreak([], f.parts, f.ref));
      return;
    case stream.GROUP_IF_BROKEN:
      put(el.groupIfBreak(f.parts, needRef(f)));
      return;
    case stream.LINE_SUFFIX:
      put(el.lineSuffix(f.parts, f.flags));
      return;
    case INDENT_IF_BREAK:
      put(el.indentIfBreak(f.parts, needRef(f)));
      return;
    case FITS_EXPANDED:
      put(el.fitsExpanded(f.parts, f.ref));
      return;
    case BEST_FITTING:
      put(el.bestFitting(f.list, f.flags === 1));
      return;
    default:
      throw new Error(`python sink: interval kind ${f.kind} closed by close`);
  }
}

/** Whether writes are being recorded into a `Format`, rather than going to the stream. */
export const recording = (): boolean => frames.length > 0;

/** What `fn` writes, as a `Format`. If `fn` throws, what it wrote is dropped. */
export function record(fn: () => void): Format {
  const depth = frames.length;
  openFrame(ROOT, undefined);
  try {
    fn();
    if (frames.length !== depth + 1) throw new Error("python sink: a rule left an interval open");
    return top().parts;
  } finally {
    frames.length = depth;
  }
}

/** Writes `f`, a part ruff's rules built: into the recording, or to the stream. */
export function part(f: Format): void {
  if (frames.length > 0) put(f);
  else el.emit(f);
}

// --- Part ---

/**
 * Something written but not yet placed, which a rule reads (`willBreak`) or reshapes (`removeSoftLines`) before
 * placing it, once or several times (ruff's `memoized`, as several best-fitting variants). Captured while
 * recording it is a `Format`; on the stream, a span built where nothing prints it, which `place` jumps to.
 */
export type Part = { readonly f: Format; readonly span?: undefined } | { readonly span: number };

/** Builds `fn` as a span inside a dead interval: closed, a jump target, printed only where a jump names it. */
function detached(fn: () => void): number {
  const d = stream.openDead();
  try {
    const t = stream.openSpan();
    fn();
    stream.closeSpan();
    return t;
  } finally {
    stream.closeDead(d);
  }
}

/** What `fn` writes, as a `Part` to query and then `place`. */
export function capture(fn: () => void): Part {
  if (frames.length > 0) return { f: record(fn) };
  return { span: detached(fn) };
}
/** Writes `p` here; a part placed twice is shared, as ruff's `memoized`. */
export function place(p: Part): void {
  if (p.span === undefined) part(p.f);
  else if (frames.length > 0) throw new Error("python sink: a part captured on the stream placed inside a recording");
  else stream.sJump(p.span);
}
/** Ruff's `will_break`: whether `p` holds a hard line, a break parent or a group built broken. */
export const willBreak = (p: Part): boolean =>
  p.span === undefined ? el.willBreak(p.f) : stream.willBreak(p.span);
/** Ruff's `RemoveSoftLinesBuffer`: `p` as it prints when nothing in it may break (elements.ts's `removeSoftLines`). */
export function removeSoftLines(p: Part): Part {
  const t = p.span;
  if (t === undefined) return { f: el.removeSoftLines(p.f) };
  return {
    span: detached(() => {
      stream.openFlat();
      stream.sJump(t);
      stream.closeFlat();
    }),
  };
}

// --- ruff ---

/** What a custom rule `.via` names reads to print its child by ruff's rules. */
export interface Ruff {
  readonly f: Fmt;
  /** Each expression by the tree-sitter node it was read from (`toAst`). */
  readonly byTs: ReadonlyMap<number, Expr>;
  /** Each statement by the tree-sitter node it was read from. */
  readonly stmts: ReadonlyMap<number, Stmt>;
}

let current: StreamCtx<unknown> | undefined;
let ruff: Ruff | undefined;

/** Runs `fn` with `ctx` as the context `dslPart` prints through, the module rule's, and `r` as `ruffOf`'s. */
export function within<T>(ctx: StreamCtx<unknown>, r: Ruff, fn: () => T): T {
  const outer = [current, ruff] as const;
  current = ctx;
  ruff = r;
  try {
    return fn();
  } finally {
    [current, ruff] = outer;
    // A recorded id stays valid through the module rule, whichever recording it came from.
    if (current === undefined) handles = [];
  }
}

/** Whether the module rule is printing: ruff's rules then print every comment. */
export const printing = (): boolean => current !== undefined;

/** The expression tree-sitter node `node` was read as, with the `Fmt` printing it. */
export function ruffOf(node: number): { f: Fmt; e: Expr } {
  const e = ruff?.byTs.get(node);
  if (!ruff || !e) throw new Error("python sink: a .via custom on a node read as no expression");
  return { f: ruff.f, e };
}

/** The statement tree-sitter node `child` is a child of, for a `.via` custom that prints by the whole statement. */
export function ruffStmtOf(child: number): { f: Fmt; s: Stmt } {
  const s = current && ruff?.stmts.get(current.tree.parent(child));
  if (!ruff || !s) throw new Error("python sink: a .via custom on a child of no statement");
  return { f: ruff.f, s };
}

/**
 * Tree-sitter node `node` as its rule of Python's DSL spec prints it, without its comments (ruff prints those),
 * as a `Format`. `args` carry what ruff's caller chose for the node (its `Opts`); the rule and its `.via` customs
 * read them as `ctx.args`.
 */
export function dslPart(node: number, args?: PrintArgs): Format {
  const ctx = current;
  if (!ctx) throw new Error("python sink: dslPart outside the module rule");
  // A broken node prints as its text straight into the stream, past this recording.
  if (ctx.isBroken(node)) throw new Error("python sink: dslPart of a broken node");
  return record(() => ctx.printNode(node, args));
}
