import {
  breakParent,
  conditionalGroup,
  type Doc,
  type DocHandle,
  align as docAlign,
  fill as docFill,
  group as docGroup,
  ifBreak,
  indent as docIndent,
  indentIfBreak,
  lineOf,
  lineSuffix,
  lineSuffixBoundary,
  literalToken,
  synthetic,
  text,
  token,
  willBreak as docWillBreak,
} from "../../fmt/doc.js";
import * as stream from "../../fmt/stream.js";
import { sDoc } from "../../fmt/stream-doc.js";
import {
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

/** Something printed but not yet placed, which a rule reads (`willBreak`, `canBreak`, `flatText`) before placing it. */
export interface Part {
  readonly doc: Doc;
}

/** What `fn` writes, as a `Part` to query and then `place` (once or more; a part placed twice is shared). */
export function capture(fn: () => void): Part {
  if (frames.length === 0) throw new Error("js sink: capture on the stream awaits the stream's detached regions");
  return { doc: record(fn) };
}
export function place(part: Part): void {
  writeDoc(part.doc);
}
/** Whether `part` holds a forced break: a hard line, a break-parent, or a group that must break. */
export const willBreak = (part: Part): boolean => docWillBreak(part.doc);
/** Whether `part` holds a line that could break. */
export const canBreak = (part: Part): boolean => docCanBreak(part.doc);
/** `part`'s text when it holds no line at all, else undefined. */
export const flatText = (part: Part): string | undefined => docText(part.doc);
/** `part` with its non-hard lines flat, its ifBreaks flat, and its groups no longer forced to break. */
export const removeLines = (part: Part): Part => ({ doc: docRemoveLines(part.doc) });

/**
 * What `fn` writes, between the comments attached to `node`: for a rule that prints a child's own tokens rather
 * than through `print`, as a statement prints its `(condition)`. On the Doc, the Doc ctx places them, since the
 * comment lists `onDoc` gives are empty.
 */
export function withComments(ctx: JsStreamCtx, node: number, fn: () => void): void {
  if (frames.length > 0) {
    put(ctx.js.withComments(node, record(fn)));
    return;
  }
  printLeadingComments(ctx, node);
  fn();
  printTrailingComments(ctx, node);
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

/** The ctx a generated rule or a custom receives, as the JS ctx it is. */
export const jsCtx = (ctx: StreamCtx<JsOptions>): JsStreamCtx => ctx as JsStreamCtx;

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
      comment: (c) => writeDoc(printComment(c, js)),
      isList: (node) => js.isList(node),
      isBroken: () => false,
    };
    return record(() => rule(n, ctx));
  };
}
