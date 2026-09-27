import * as stream from "../../../fmt/stream.js";
import type { Expr, Stmt } from "./ast.js";
import type { Fmt } from "./builders.js";
import type { PrintArgs } from "../../../fmt/rules.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";

// Where Python's rules write: the rules its DSL spec generates (fmt.gen.ts, whose stream imports the generator
// points here) and ruff's rules, all straight to the stream. A part a rule reads before placing it (`willBreak`,
// `removeSoftLines`, several best-fitting variants) is a `Part`: `capture`d, queried, then `place`d.

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

export function sToken(node: number, s: string, synthetic = false): void {
  stream.sToken(node, s, synthetic);
}
export function sText(s: string): void {
  stream.sText(s);
}
/** A token whose line breaks print as they are, the column restarting after the last. */
export function sLiteral(node: number, s: string): void {
  stream.sLiteral(node, s);
}
/** A line: `SOFT` (nothing when flat) or a space when flat, `HARD` always breaking; `COLLAPSE` and `BLANK` are ruff's. */
export function sLine(flags: number): void {
  if (flags & (stream.COLLAPSE | stream.BLANK)) stream.sRuffLine(flags);
  else stream.sLine(flags & (stream.SOFT | stream.HARD));
}
/** `sLine`, by the name the stream gives a line with ruff's flags. */
export const sRuffLine = sLine;
export function sBreakParent(): void {
  stream.sBreakParent();
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
  return stream.open(kind, ref, flags);
}
/** Opens a line suffix whose `reserved` columns count against the line now (ruff's trailing comments). */
export function openReservedSuffix(reserved: number): number {
  return stream.openReservedSuffix(reserved);
}
/** Ruff's `indent_if_group_breaks`: the contents indented when the group `ref` prints broken. */
export function openIndentIfBreak(ref: number): number {
  return stream.openIndentIfBreak(ref);
}
/** Ruff's `fits_expanded`, while the group `whenFlat` (-1: always) prints flat. */
export function openFitsExpanded(whenFlat: number): number {
  return stream.openFitsExpanded(whenFlat);
}
/** Ruff's `best_fitting`: each variant between `openVariant` and `closeVariant`, then `close`. */
export function openBestFitting(allLines: boolean): number {
  return stream.openBestFitting(allLines);
}
export function openVariant(k: number): number {
  return stream.openVariant(k);
}
export function closeVariant(v: number): void {
  stream.closeVariant(v);
}
/**
 * Ruff's `best_fit_parenthesize`: `open0` written here, then the contents, then `closeBestFitParenthesize`. The
 * id it returns is a group other intervals may ask.
 */
export function openBestFitParenthesize(open0: () => void): number {
  return stream.openBestFitParenthesize(open0);
}
export function closeBestFitParenthesize(k: number, close0: () => void): void {
  stream.closeBestFitParenthesize(k, close0);
}
export function close(): void {
  stream.close();
}

// --- Part ---

/**
 * Something written but not yet placed, which a rule reads (`willBreak`) or reshapes (`removeSoftLines`) before
 * placing it, once or several times (ruff's `memoized`, as several best-fitting variants): a span built where
 * nothing prints it, which `place` jumps to.
 */
export interface Part {
  readonly span: number;
}

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
  return { span: detached(fn) };
}
/** Writes `p` here; a part placed twice is shared, as ruff's `memoized`. */
export function place(p: Part): void {
  stream.sJump(p.span);
}
/** Ruff's `will_break`: whether `p` holds a hard line, a break parent or a group built broken. */
export const willBreak = (p: Part): boolean => stream.willBreak(p.span);
/** Ruff's `RemoveSoftLinesBuffer`: `p` as it prints when nothing in it may break. */
export function removeSoftLines(p: Part): Part {
  return {
    span: detached(() => {
      stream.openFlat();
      stream.sJump(p.span);
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

/** Runs `fn` with `ctx` as the context `sDsl` prints through, the module rule's, and `r` as `ruffOf`'s. */
export function within<T>(ctx: StreamCtx<unknown>, r: Ruff, fn: () => T): T {
  const outer = [current, ruff] as const;
  current = ctx;
  ruff = r;
  try {
    return fn();
  } finally {
    [current, ruff] = outer;
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

/** The `Fmt` printing, for a custom whose node was read as no expression or statement (a string's part). */
export function ruffFmt(): Fmt {
  if (!ruff) throw new Error("python sink: a custom outside the module rule");
  return ruff.f;
}

/** The statement tree-sitter node `child` is a child of, for a `.via` custom that prints by the whole statement. */
export function ruffStmtOf(child: number): { f: Fmt; s: Stmt } {
  const s = current && ruff?.stmts.get(current.tree.parent(child));
  if (!ruff || !s) throw new Error("python sink: a .via custom on a child of no statement");
  return { f: ruff.f, s };
}

/**
 * Writes tree-sitter node `node` as its rule of Python's DSL spec prints it, without its comments (ruff prints
 * those). `args` carry what ruff's caller chose for the node (its `Opts`); the rule and its `.via` customs read
 * them as `ctx.args`.
 */
export function sDsl(node: number, args?: PrintArgs): void {
  const ctx = current;
  if (!ctx) throw new Error("python sink: sDsl outside the module rule");
  if (ctx.isBroken(node)) throw new Error("python sink: sDsl of a broken node");
  ctx.printNode(node, args);
}
