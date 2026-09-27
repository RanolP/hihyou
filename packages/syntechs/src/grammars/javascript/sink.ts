import {
  breakParent,
  conditionalGroup,
  contentsOf,
  type Doc,
  type DocHandle,
  align as docAlign,
  fill as docFill,
  group as docGroup,
  flatOf,
  ifBreak,
  indent as docIndent,
  indentIfBreak,
  isBroken,
  isDocs,
  isHardLine,
  isSoftLine,
  kindOf,
  lineOf,
  lineSuffix,
  lineSuffixBoundary,
  literalToken,
  partsOf,
  synthetic,
  text,
  textOf,
  token,
  willBreak as docWillBreak,
  withContents,
} from "../../fmt/doc.js";
import type { Ctx } from "../../fmt/rules.js";
import * as stream from "../../fmt/stream.js";
import { sDoc } from "../../fmt/stream-doc.js";
import {
  endsLine,
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
  type StreamRule,
} from "../../fmt/stream-format.js";
import { printComment } from "./print/literals.js";
import {
  type Args,
  canBreak as docCanBreak,
  docText,
  type JsCtx,
  type JsOptions,
  type JsRule,
  removeLines as docRemoveLines,
} from "./print/util.js";

// Where the JS rules moved off the Doc write: the rules JS's DSL spec generates (fmt.gen.ts, whose stream imports
// the generator points here) and the hand-written customs. JS still prints by the Doc while its rules move over,
// so a moved rule runs inside `record`, which turns what it writes into a Doc the Doc rules around it read as
// their own; outside a recording the calls go to the stream, which is where they all write once every rule moved.
// A part a rule reads before placing it (willBreak, a hug tried and dropped) is a `Part`: `capture`d, queried,
// then `place`d.

export {
  ALIGN,
  BOUNDARY,
  BROKEN,
  CHOICE,
  FILL,
  FILL_ITEM,
  GROUP,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  LINE_SUFFIX,
  SOFT,
} from "../../fmt/stream.js";

const INDENT_IF_BROKEN = -2;
const INDENT_IF_FLAT = -3;
const STATE = -4;
const ROOT = -5;

interface Frame {
  readonly kind: number;
  readonly id: number;
  readonly ref: number;
  readonly flags: number;
  readonly align: number | string;
  /** What was written into it; in a fill, the separator since the last item. */
  parts: Doc[];
  /** A fill's items and separators so far; a choice's states. */
  readonly list: Doc[];
}

/** The frames of the recordings in progress, innermost last; empty: writes go to the stream. */
const frames: Frame[] = [];
/** A recorded group or choice by the id `open` returned for it; reset when the outermost recording ends. */
let groups: (DocHandle | undefined)[] = [];

const top = () => frames[frames.length - 1] as Frame;
const put = (d: Doc) => void top().parts.push(d);

function openFrame(kind: number, ref = -1, flags = 0, align: number | string = 0): number {
  const id = groups.length;
  groups.push(undefined);
  const parent = frames.length > 0 ? top() : undefined;
  if (parent?.kind === stream.FILL && kind === stream.FILL_ITEM && parent.list.length > 0) {
    parent.list.push(parent.parts);
    parent.parts = [];
  }
  const parts: Doc[] = [];
  // A group's handle exists from its open, holding the parts it is still being written into, so an ifBreak
  // inside it can follow it (the concise array's trailing comma follows the array, not the fill item it sits in).
  if (kind === stream.GROUP) groups[id] = docGroup(parts, (flags & stream.BROKEN) !== 0);
  frames.push({ kind, id, ref, flags, align, parts, list: [] });
  return id;
}

function groupOf(ref: number): DocHandle | undefined {
  if (ref < 0) return undefined;
  const g = groups[ref];
  if (g === undefined)
    throw new Error(`js sink: interval refers to ${ref}, which is no recorded group`);
  return g;
}

function closeFrame(): void {
  const f = frames.pop() as Frame;
  const parts = f.parts;
  let d: Doc;
  switch (f.kind) {
    case stream.GROUP:
      d = groups[f.id] as DocHandle;
      break;
    case stream.INDENT:
      d = docIndent(parts);
      break;
    case stream.IF_BROKEN:
      d = ifBreak(parts, [], groupOf(f.ref));
      break;
    case stream.IF_FLAT:
      d = ifBreak([], parts, groupOf(f.ref));
      break;
    case INDENT_IF_BROKEN:
    case INDENT_IF_FLAT: {
      const g = groupOf(f.ref);
      if (g === undefined) throw new Error("js sink: an indentIfBreak names no group");
      d = indentIfBreak(parts, g, f.kind === INDENT_IF_FLAT);
      break;
    }
    case stream.LINE_SUFFIX:
      d = lineSuffix(parts);
      break;
    case stream.ALIGN:
      d = docAlign(f.align, parts);
      break;
    case stream.FILL:
      if (parts.length > 0) f.list.push(parts);
      d = docFill(f.list);
      break;
    case stream.FILL_ITEM:
      if (top().kind !== stream.FILL) throw new Error("js sink: a fill item outside a fill");
      top().list.push(parts);
      return;
    case STATE:
      top().list.push(parts);
      return;
    case stream.CHOICE:
      d = groups[f.id] = conditionalGroup(f.list, (f.flags & stream.BROKEN) !== 0);
      break;
    default:
      throw new Error(`js sink: interval kind ${f.kind} has no Doc`);
  }
  put(d);
}

export function sToken(node: number, s: string, isSynthetic = false): void {
  if (frames.length > 0) put(isSynthetic ? synthetic(node, s) : token(node, s));
  else stream.sToken(node, s, isSynthetic);
}
export function sText(s: string): void {
  if (frames.length > 0) put(text(s));
  else stream.sText(s);
}
/** A token whose line breaks are literal lines: a template literal's text. */
export function sLiteral(node: number, s: string): void {
  if (frames.length > 0) put(literalToken(node, s));
  else stream.sLiteral(node, s);
}
export function sLine(flags: number): void {
  if (frames.length > 0) put(lineOf(flags & (stream.SOFT | stream.HARD)));
  else stream.sLine(flags);
}
export function sBreakParent(): void {
  if (frames.length > 0) put(breakParent);
  else stream.sBreakParent();
}
export function sHardline(): void {
  sLine(stream.HARD);
  sBreakParent();
}
export function sLineSuffixBoundary(): void {
  if (frames.length > 0) put(lineSuffixBoundary);
  else stream.sLineSuffixBoundary();
}
export function open(kind: number, ref = -1, flags = 0): number {
  if (frames.length > 0) return openFrame(kind, ref, flags);
  return stream.open(kind, ref, flags);
}
export function openAlign(n: number | string): number {
  if (frames.length > 0) return openFrame(stream.ALIGN, -1, 0, n);
  return stream.openAlign(n);
}
export function openIndentIfBreak(ref: number, negate = false): number {
  if (frames.length > 0) return openFrame(negate ? INDENT_IF_FLAT : INDENT_IF_BROKEN, ref);
  return stream.openIndentIfBreak(ref, negate);
}
export function openChoice(broken: boolean): number {
  if (frames.length > 0) return openFrame(stream.CHOICE, -1, broken ? stream.BROKEN : 0);
  return stream.openChoice(broken);
}
export function openState(): number {
  if (frames.length > 0) return openFrame(STATE);
  return stream.openState();
}
export function closeState(): void {
  if (frames.length > 0) closeFrame();
  else stream.closeState();
}
export function closeChoice(): void {
  if (frames.length > 0) closeFrame();
  else stream.closeChoice();
}
export function close(): void {
  if (frames.length > 0) closeFrame();
  else stream.close();
}

/**
 * What `fn` writes, as a Doc. If `fn` throws (an ArgExpansionBailout), what it wrote is dropped, as the stream
 * drops a region it abandons.
 */
export function record(fn: () => void): Doc {
  const depth = frames.length;
  openFrame(ROOT);
  try {
    fn();
    if (frames.length !== depth + 1) throw new Error("js sink: a rule left an interval open");
    return (frames.pop() as Frame).parts;
  } finally {
    frames.length = depth;
    if (depth === 0) groups = [];
  }
}

// --- Part ---

/**
 * Something printed but not yet placed, which a rule reads (`willBreak`, `canBreak`, `flatText`) before placing it.
 * Captured while recording, it is a Doc; on the stream, a span built where nothing prints it, which `place` jumps to.
 */
export interface Part {
  /** The part as a Doc, for a Doc helper; a part captured on the stream has none, and reading it throws. */
  readonly doc: Doc;
  /** On the stream: the closed span it was built in. */
  readonly span?: number;
  /** On the stream: a `removeLines` part. */
  readonly flat?: boolean;
}

function streamPart(span: number, flat = false): Part {
  return {
    span,
    flat,
    get doc(): Doc {
      throw new Error("js sink: a part captured on the stream has no Doc; the Doc helper reading it has not moved");
    },
  };
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
  if (frames.length > 0) return { doc: record(fn) };
  return streamPart(detached(fn));
}
export function place(part: Part): void {
  if (part.span === undefined) writeDoc(part.doc);
  else if (frames.length > 0) throw new Error("js sink: a part captured on the stream placed inside a recording");
  else stream.sJump(part.span);
}
/** Whether `part` holds a forced break: a hard line, a break-parent, or a group that must break. */
export const willBreak = (part: Part): boolean =>
  part.span === undefined ? docWillBreak(part.doc) : stream.willBreak(part.span);
/** Whether `part` holds a line that could break. */
export const canBreak = (part: Part): boolean =>
  part.span === undefined ? docCanBreak(part.doc) : stream.canBreak(part.span);
/** `part`'s text when it holds no line at all, else undefined. */
export function flatText(part: Part): string | undefined {
  if (part.span === undefined) return docText(part.doc);
  // docText reads the lines removeLines turned into text; the stream's flatText reads no flat part.
  if (part.flat) throw new Error("js sink: flatText of a removeLines part is not on the stream");
  return stream.flatText(part.span);
}
/** `part` with its non-hard lines flat, its ifBreaks flat, and its groups no longer forced to break. */
export function removeLines(part: Part): Part {
  const t = part.span;
  if (t === undefined) return { doc: docRemoveLines(part.doc) };
  return streamPart(
    detached(() => {
      stream.openFlat();
      stream.sJump(t);
      stream.closeFlat();
    }),
    true,
  );
}

/**
 * `part` as prettier's printDocToString lays it out at an infinite width, when that is one line: every group
 * flat, each conditional group in its first state. `undefined` when it would hold a line break (a hard line, a
 * group that must break, or a token spanning lines). A template substitution prints so.
 */
export function flatten(part: Part): Part | undefined {
  const t = part.span;
  if (t === undefined) {
    const doc = docFlatten(part.doc);
    return doc === undefined ? undefined : { doc };
  }
  if (stream.flattenBreaks(t)) return undefined;
  return streamPart(
    detached(() => {
      stream.openFlat(true);
      stream.sJump(t);
      stream.closeFlat();
    }),
    true,
  );
}

function docFlatten(doc: Doc): Doc | undefined {
  let broken = false;
  const walk = (d: Doc): Doc => {
    if (broken) return [];
    if (isDocs(d)) return d.map(walk);
    switch (kindOf(d)) {
      case "token":
        if (textOf(d).includes("\n")) broken = true;
        return d;
      case "text":
        if (textOf(d).includes("\n")) broken = true;
        return d;
      case "line":
        if (isHardLine(d)) broken = true;
        return isSoftLine(d) ? [] : text(" ");
      case "breakParent":
        broken = true;
        return [];
      case "group":
        if (isBroken(d)) broken = true;
        return walk(contentsOf(d));
      case "indent":
      case "align":
        return walk(contentsOf(d));
      case "fill":
        return partsOf(d).map(walk);
      case "ifBreak":
        return walk(flatOf(d));
      case "lineSuffix":
        return withContents(d, walk(contentsOf(d)));
      // Ruff's layouts, which a JavaScript doc never holds.
      default:
        return d;
    }
  };
  const out = walk(doc);
  return broken ? undefined : out;
}

/**
 * What `fn` writes, between the comments attached to `node`: for a rule that prints a child's own tokens rather
 * than through `print`, as a statement prints its `(condition)`. On the Doc, the Doc ctx places them, since the
 * comment lists `onDoc` gives are empty.
 */
export function withComments(ctx: JsStreamCtx, node: number, fn: () => void): void {
  if (frames.length > 0) {
    put((ctx.js as Ctx<JsOptions>).withComments(node, record(fn)));
    return;
  }
  printLeadingComments(ctx, node);
  fn();
  printTrailingComments(ctx, node);
}

const NO_PRINT: Doc = [];
/**
 * The comments attached to `node` as two writes, its leading ones and its trailing ones, for a rule that lays out
 * what goes between them across intervals of its own rather than inside one (a binaryish chain's flat parts, an
 * operand's own-line comment moved above its operator); undefined when `node` has none.
 */
export function commentsOf(
  ctx: JsStreamCtx,
  node: number,
): readonly [leading: () => void, trailing: () => void] | undefined {
  if (frames.length > 0) {
    const wrapped = (ctx.js as Ctx<JsOptions>).withComments(node, NO_PRINT);
    if (wrapped === NO_PRINT) return undefined;
    const [leading, , trailing] = wrapped as [Doc, Doc, Doc];
    return [() => writeDoc(leading), () => writeDoc(trailing)];
  }
  if (ctx.leadingComments(node).length === 0 && ctx.trailingComments(node).length === 0) return undefined;
  return [() => printLeadingComments(ctx, node), () => printTrailingComments(ctx, node)];
}

/** Writes a Doc built by a rule still on the Doc. */
function writeDoc(d: Doc): void {
  if (frames.length > 0) put(d);
  else sDoc(d);
}

// --- ctx ---

/** The ctx a moved rule prints with: the stream's, where a node prints with the args its parent gave it. */
export interface JsStreamCtx extends StreamCtx<JsOptions> {
  /** Appends `node` as its rule prints it with `args`, with its comments. */
  print(node: number, args?: Args): void;
  /** Appends `node` as its rule prints it with `args`, without its comments. */
  printNode(node: number, args?: Args): void;
  /** Appends `node` without its comments, even while the Doc ctx prints them (see `onDoc`). */
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
  // The Doc path printed a broken child through its parent's rule like any other (the fallback token, with the
  // parent's ASI guard and parens around it), so the generated rules see no child as broken.
  return Object.assign(own, { js, printBare: ctx.printNode, isBroken: () => false });
}

/**
 * `rule` as a Doc rule: it runs recorded, over a ctx whose prints are the Doc ctx's. The Doc ctx prints a
 * child's comments, so the moved rule sees none attached (a node's dangling ones it prints itself).
 */
export function onDoc(rule: StreamRule<JsOptions>): JsRule {
  return (n, js, args?: Args) => {
    const ctx: JsStreamCtx = {
      tree: js.tree,
      options: js.options,
      placement: js.placement,
      args,
      js,
      print: (node, a) => writeDoc(js.print(node, a)),
      // The generated rules print a child as its leading comments, `printNode`, its trailing ones; here the Doc
      // ctx prints them, so the comment lists are empty and `printNode` is `print`.
      printNode: (node, a) => writeDoc(js.print(node, a)),
      printBare: (node, a) => writeDoc(js.printBare(node, a)),
      items: (node) => js.items(node),
      leadingComments: () => [],
      trailingComments: () => [],
      danglingComments: (node) => js.comments(node).dangling,
      isComment: (node) => js.tree.kindName(node) === "comment",
      isLineComment: (c) => js.isLineComment(c),
      comment: (c) => printComment(c, js),
      isList: (node) => js.isList(node),
      isBroken: () => false,
      // The Doc ctx prints every comment, a node's own included, so none is left to the rule.
      ownsComments: () => false,
    };
    return record(() => rule(n, ctx));
  };
}
