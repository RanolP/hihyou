import * as stream from "../../fmt/stream.js";
import {
  endsLine,
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
} from "../../fmt/stream-format.js";
import type { Args, JsCtx, JsOptions } from "./print/util.js";

// What the JS rules write through: the rules JS's DSL spec generates (fmt.gen.ts, whose stream imports the
// generator points here) and the hand-written customs. A part a rule reads before placing it (willBreak, a hug
// tried and dropped) is a `Part`: `capture`d, queried, then `place`d.

export {
  ALIGN,
  BOUNDARY,
  BROKEN,
  CHOICE,
  close,
  closeChoice,
  closeState,
  FILL,
  FILL_ITEM,
  GROUP,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  LINE_SUFFIX,
  open,
  openAlign,
  openChoice,
  openIndentIfBreak,
  openState,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sLineSuffixBoundary,
  sLiteral,
  sText,
  sToken,
} from "../../fmt/stream.js";

// --- Part ---

/**
 * Something printed but not yet placed, which a rule reads (`willBreak`, `canBreak`, `flatText`) before placing it:
 * a span built where nothing prints it, which `place` jumps to.
 */
export interface Part {
  /** The closed span it was built in. */
  readonly span: number;
  /** A `removeLines` or `flatten` part. */
  readonly flat: boolean;
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

/**
 * What `fn` writes, as a `Part` to query and then `place` (once or more; a part placed twice is shared). If `fn`
 * throws (an ArgExpansionBailout), what it wrote is dropped.
 */
export function capture(fn: () => void): Part {
  return { span: detached(fn), flat: false };
}
export function place(part: Part): void {
  stream.sJump(part.span);
}
/** Whether `part` holds a forced break: a hard line, a break-parent, or a group that must break. */
export const willBreak = (part: Part): boolean => stream.willBreak(part.span);
/** Whether `part` holds a line that could break. */
export const canBreak = (part: Part): boolean => stream.canBreak(part.span);
/** `part`'s text when it holds no line at all, else undefined. */
export function flatText(part: Part): string | undefined {
  // The stream's flatText reads no flat part: nothing asks it of one.
  if (part.flat) throw new Error("js sink: flatText of a flat part is not on the stream");
  return stream.flatText(part.span);
}
/** `part`'s width laid out on one line. */
export const flatWidth = (part: Part): number => stream.flatWidth(part.span);
/** `part` with its non-hard lines flat, its ifBreaks flat, and its groups no longer forced to break. */
export function removeLines(part: Part): Part {
  return {
    span: detached(() => {
      stream.openFlat();
      stream.sJump(part.span);
      stream.closeFlat();
    }),
    flat: true,
  };
}

/**
 * `part` as prettier's printDocToString lays it out at an infinite width, when that is one line: every group
 * flat, each conditional group in its first state. `undefined` when it would hold a line break (a hard line, a
 * group that must break, or a token spanning lines). A template substitution prints so.
 */
export function flatten(part: Part): Part | undefined {
  if (stream.flattenBreaks(part.span)) return undefined;
  return {
    span: detached(() => {
      stream.openFlat(true);
      stream.sJump(part.span);
      stream.closeFlat();
    }),
    flat: true,
  };
}

/**
 * What `fn` writes, between the comments attached to `node`: for a rule that prints a child's own tokens rather
 * than through `print`, as a statement prints its `(condition)`, or a child that owns its comments.
 */
export function withComments(ctx: JsStreamCtx, node: number, fn: () => void): void {
  printLeadingComments(ctx, node);
  fn();
  printTrailingComments(ctx, node);
}

/**
 * What separates a head from its body: a space, but a line break when the body's first leading comment stands on a
 * line of its own (`function f()⏎// c⏎{`), which stays before the `{`.
 */
export function sBeforeBody(ctx: StreamCtx<JsOptions>, body: number): void {
  if (bodyBelowHead(ctx, body)) stream.sHardline();
  else stream.sText(" ");
}

export function bodyBelowHead(ctx: StreamCtx<JsOptions>, body: number): boolean {
  const first = ctx.leadingComments(body)[0];
  return first !== undefined && ctx.tree.lf(first) > 0;
}

/**
 * The comments attached to `node` as two writes, its leading ones and its trailing ones, for a rule that lays out
 * what goes between them across intervals of its own rather than inside one (a binaryish chain's flat parts, an
 * operand's own-line comment moved above its operator); undefined when `node` has none.
 */
export function commentsOf(
  ctx: JsStreamCtx,
  node: number,
): readonly [leading: () => void, trailing: () => void] | undefined {
  if (ctx.leadingComments(node).length === 0 && ctx.trailingComments(node).length === 0) return undefined;
  return [() => printLeadingComments(ctx, node), () => printTrailingComments(ctx, node)];
}

// --- ctx ---

/** The ctx a JS rule prints with: the stream's, where a node prints with the args its parent gave it. */
export interface JsStreamCtx extends StreamCtx<JsOptions> {
  /** Appends `node` as its rule prints it with `args`, with its comments. */
  print(node: number, args?: Args): void;
  /** Appends `node` as its rule prints it with `args`, without its comments. */
  printNode(node: number, args?: Args): void;
  /** Appends `node` without its comments: `printNode`, by the name prettier's printers give it. */
  printBare(node: number, args?: Args): void;
  /** What this node's parent asked of its print (`expandLastArg`, ...). */
  readonly args: Args;
  /** The tree queries the JS helpers (`print/util.ts`) read. */
  readonly js: JsCtx;
}

const NO_COMMENTS = { leading: [], trailing: [], dangling: [] } as const;

/** The ctx a generated rule or a custom receives, as the JS ctx: its queries attached on first use. */
export function jsCtx(ctx: StreamCtx<JsOptions>): JsStreamCtx {
  const own = ctx as Partial<JsStreamCtx> & StreamCtx<JsOptions>;
  if (own.js !== undefined) return own as JsStreamCtx;
  const js: JsCtx = {
    tree: ctx.tree,
    options: ctx.options,
    placement: ctx.placement,
    items: (node) => ctx.items(node),
    comments(node) {
      const leading = ctx.leadingComments(node);
      const trailing = ctx.trailingComments(node);
      const dangling = ctx.danglingComments(node);
      if (leading.length === 0 && trailing.length === 0 && dangling.length === 0) return NO_COMMENTS;
      return { leading, trailing, dangling };
    },
    isLineComment: (c) => ctx.isLineComment(c),
    isList: (node) => ctx.isList(node),
    hasComment: (node, where) =>
      where === "leadingLine"
        ? ctx.leadingComments(node).some((c) => ctx.isLineComment(c))
        : ctx.trailingComments(node).some((c) => endsLine(ctx, node, c)),
    hasDanglingLineComment: (node) => ctx.danglingComments(node).some((c) => ctx.isLineComment(c)),
  };
  // A broken child still prints through its parent's rule (as its source token, which formatStream prints it
  // as), with the parent's ASI guard and parentheses around it, so the generated rules see no child as broken.
  return Object.assign(own, { js, printBare: ctx.printNode, isBroken: () => false });
}
