import type { Tree } from "../core/arena.js";
import type { Comments } from "./comments.js";
import {
  type Anchor,
  brokenNodes,
  endOfLine,
  type Formatted,
  shiftForEndOfLine,
} from "./format.js";
import type { Language, PrintArgs } from "./rules.js";
import {
  close,
  LINE_SUFFIX,
  open,
  printStream,
  resetStream,
  type StreamPrinted,
  sBreakParent,
  sHardline,
  sLine,
  sText,
  sToken,
} from "./stream.js";
import { lfAfter, newlineBetween } from "./text.js";
import { type FormatTree, firstLeaf } from "./tree.js";

/**
 * What a rule reads as it prints: the rules a formatter spec generates (`dsl/`) append to the stream (see
 * `stream.ts`), which `formatStream` prints.
 */
export interface StreamCtx<O = unknown> {
  readonly tree: FormatTree;
  readonly options: O;
  /** What this format's placement pass returned (`LanguageSpec.placeComments`), for a rule that reads it whole. */
  readonly placement: Comments;
  /** Appends `node` as its rule prints it, with its comments; `args` reach that rule, as `ctx.args`. */
  print(node: number, args?: PrintArgs): void;
  /** Appends `node` as its rule prints it (its text when it has none, or is broken), without its comments. */
  printNode(node: number, args?: PrintArgs): void;
  /**
   * What the node printing now was passed (prettier's `print(path, args)`), read while its rule prints. Not a
   * rule parameter, so every rule keeps the one `(node, ctx)` shape.
   */
  readonly args: PrintArgs | undefined;
  items(node: number): number[];
  /** The comments attached before (`leading`) or after (`trailing`) `node`, in source order. */
  leadingComments(node: number): readonly number[];
  trailingComments(node: number): readonly number[];
  danglingComments(node: number): readonly number[];
  isComment(node: number): boolean;
  isLineComment(c: number): boolean;
  /** Whether block comment `c` ends its line as a line comment does (`StreamRules.commentEndsLine`). */
  endsItsLine?(c: number): boolean;
  /** Appends comment `c`. */
  comment(c: number): void;
  isList(node: number): boolean;
  /**
   * Whether `node` lies in a region the parser could not read, or is one the language keeps as written
   * (`StreamRules.keepsSource`), either of which prints as its source text.
   */
  isBroken(node: number): boolean;
  /**
   * Whether `node`'s rule prints the node's comments itself (`StreamRules.printsOwnComments`), so whatever prints
   * `node` inside its comments (`print`, a custom's kid, a `.via` child) leaves them to it.
   */
  ownsComments(node: number): boolean;
}

/** What laying out comment `c` next to its node reads of it. */
export interface CommentFacts {
  readonly c: number;
  /** A line comment, which ends its line. */
  readonly line: boolean;
  /** The line breaks before it (`tree.lf`) and after it (`lfAfter`). */
  readonly lf: number;
  readonly lfAfter: number;
}

export const commentFacts = (ctx: StreamCtx<unknown>, c: number): CommentFacts => ({
  c,
  line: ctx.isLineComment(c) || ctx.endsItsLine?.(c) === true,
  lf: ctx.tree.lf(c),
  lfAfter: lfAfter(ctx.tree, c),
});

// Prettier's printLeadingComment and printTrailingComment (main/comments/print.js), one comment at a time.

/** Leading comment `f`, then what separates it from its node. */
export function printLeadingComment(ctx: StreamCtx<unknown>, f: CommentFacts): void {
  ctx.comment(f.c);
  if (f.line) sHardline();
  else if (f.lfAfter === 0) sText(" ");
  else if (f.lf > 0) sHardline();
  else sLine(0);
  if (f.lfAfter >= 2) sHardline();
}

/** How a trailing comment printed, which decides how the next one of the same node prints. */
export interface Trailed {
  readonly line: boolean;
  readonly suffix: boolean;
}

/** Trailing comment `f`, after the trailing comment of the same node that printed as `previous`, if any. */
export function printTrailingComment(
  ctx: StreamCtx<unknown>,
  f: CommentFacts,
  previous: Trailed | undefined,
): Trailed {
  if ((previous?.suffix && previous.line) || f.lf > 0) {
    open(LINE_SUFFIX);
    sHardline();
    if (f.lf >= 2) sHardline();
    ctx.comment(f.c);
    close();
    return { line: f.line, suffix: true };
  }
  if (f.line || previous?.suffix) {
    open(LINE_SUFFIX);
    sText(" ");
    ctx.comment(f.c);
    close();
    if (f.line) sBreakParent();
    return { line: f.line, suffix: true };
  }
  sText(" ");
  ctx.comment(f.c);
  return { line: f.line, suffix: false };
}

export function printLeadingComments(ctx: StreamCtx<unknown>, node: number): void {
  for (const c of ctx.leadingComments(node)) printLeadingComment(ctx, commentFacts(ctx, c));
}

export function printTrailingComments(ctx: StreamCtx<unknown>, node: number): void {
  let previous: Trailed | undefined;
  for (const c of ctx.trailingComments(node))
    previous = printTrailingComment(ctx, commentFacts(ctx, c), previous);
}

/** A trailing line comment of `node` on the line its first token starts, which must end that line. */
export const endsLine = (ctx: StreamCtx<unknown>, node: number, c: number): boolean =>
  ctx.isLineComment(c) &&
  !newlineBetween(ctx.tree, firstLeaf(ctx.tree, node), c) &&
  !ctx.tree.text(c).includes("\n");

export type StreamRule<O = unknown> = (node: number, ctx: StreamCtx<O>) => void;

export interface StreamRules<O = unknown> {
  readonly rules: ReadonlyMap<string, StreamRule<O>>;
  readonly lists: ReadonlySet<StreamRule<O>>;
  /**
   * Appends comment `c` as printed, when it is not its source text (prettier re-indents a block comment whose
   * lines all start with `*`).
   */
  readonly printComment?: (c: number, ctx: StreamCtx<O>) => void;
  /** Whether block comment `c` ends its line all the same: ktfmt breaks after a KDoc wherever it stood. */
  readonly commentEndsLine?: (c: number, ctx: StreamCtx<O>) => boolean;
  /** Whether `node` prints as its source text though it parsed, as a broken node does (prettier-ignore). */
  readonly keepsSource?: (node: number, ctx: StreamCtx<O>) => boolean;
  /**
   * Whether `node`'s rule prints the node's comments itself, with `printLeadingComments` and
   * `printTrailingComments`, so they can go inside what the rule wraps around them (prettier's
   * willPrintOwnComments: a JSX element's parentheses).
   */
  readonly printsOwnComments?: (node: number, ctx: StreamCtx<O>) => boolean;
  /** Whether a node with no rule and a named child fails the format, rather than printing as written. */
  readonly bailUnknown?: boolean;
  /**
   * Prints every node that is not broken, inside its comments, in place of its rule, which `print` appends:
   * prettier's genericPrint around a printer's own (the parentheses needsParens adds), its prettier-ignore
   * (the source text instead of `print`), and its cache of printed nodes (a span the first print builds, which
   * a later print jumps to).
   */
  readonly wrap?: (node: number, ctx: StreamCtx<O>, print: () => void, args: PrintArgs | undefined) => void;
  /** Whether the output ends with a line break, as it does unless this says not: ruff prints a blank file as "". */
  readonly finalLine?: (ctx: StreamCtx<O>) => boolean;
  /** Whether a line comment past the width wraps as google-java-format's does (`wrapLineComments`): ktfmt's. */
  readonly wrapsLineComments?: boolean;
}

/** `format`: lays `tree` out on the stream by the `stream` rules of `base`, and prints it. */
export function formatStream<O>(
  tree: Tree,
  base: Language<O>,
  options: Partial<O> = {},
): Formatted {
  try {
    const language = base.stream;
    const resolved: O = { ...base.defaults, ...options };
    const settings = base.settings(resolved);
    resetStream(settings.ruff === true);
    const rules: (StreamRule<O> | null)[] = [];
    const ruleOf = (n: number) => {
      const k = tree.kind(n);
      let rule = rules[k];
      if (rule === undefined)
        rules[k] = rule = language.rules.get(tree.kindName(n)) ?? null;
      return rule;
    };
    const commentKinds: boolean[] = [];
    const isComment = (n: number) =>
      (commentKinds[tree.kind(n)] ??= base.comments.has(tree.kindName(n)));
    const isLine = (n: number) => {
      const prefix = base.lineComments.get(tree.kindName(n));
      return prefix !== undefined && tree.text(n).startsWith(prefix);
    };
    const comments = base.placeComments(tree, isComment, resolved);
    const printComment = language.printComment;
    const comment = printComment
      ? (c: number) => printComment(c, ctx)
      : (c: number) => {
          const t = tree.text(c);
          sToken(c, isLine(c) ? t.trimEnd() : t);
        };
    const broken = brokenNodes(tree);
    const { keepsSource } = language;
    const isBroken = (node: number) =>
      (broken !== undefined && broken.has(node)) ||
      (keepsSource !== undefined && keepsSource(node, ctx));

    const hasNamedChild = (node: number) => {
      for (let i = 0, count = tree.count(node); i < count; i++) {
        const c = tree.child(node, i);
        if (tree.named(c) && !isComment(c)) return true;
      }
      return false;
    };
    const none: readonly number[] = [];
    const { wrap, printsOwnComments, commentEndsLine } = language;
    let current: PrintArgs | undefined;
    const printNode = (node: number, args?: PrintArgs) => {
      if (isBroken(node)) {
        sToken(node, tree.text(node));
        return;
      }
      const rule = ruleOf(node);
      if (!rule) {
        if (language.bailUnknown === true && hasNamedChild(node))
          throw new Error(`no rule: ${tree.kindName(node)} at ${tree.start(node)}`);
        if (wrap) wrap(node, ctx, () => sToken(node, tree.text(node)), args);
        else sToken(node, tree.text(node));
        return;
      }
      const outer = current;
      current = args;
      if (wrap) wrap(node, ctx, () => rule(node, ctx), args);
      else rule(node, ctx);
      current = outer;
    };

    const ctx: StreamCtx<O> = {
      tree,
      options: resolved,
      placement: comments,
      // Prettier's printComments (main/comments/print.js).
      print(node, args) {
        if (ctx.ownsComments(node)) {
          printNode(node, args);
          return;
        }
        printLeadingComments(ctx, node);
        printNode(node, args);
        printTrailingComments(ctx, node);
      },
      printNode,
      get args() {
        return current;
      },
      items(node) {
        const items: number[] = [];
        for (let i = 0, count = tree.count(node); i < count; i++) {
          const c = tree.child(node, i);
          if (tree.named(c) && !isComment(c) && !base.dropped.has(tree.kindName(c))) items.push(c);
        }
        return items;
      },
      leadingComments: (node) => comments.of(node)?.leading ?? none,
      trailingComments: (node) => comments.of(node)?.trailing ?? none,
      danglingComments: (node) => comments.dangling(node),
      isComment,
      isLineComment: isLine,
      ...(commentEndsLine === undefined ? {} : { endsItsLine: (c: number) => commentEndsLine(c, ctx) }),
      comment,
      isList(node) {
        const rule = ruleOf(node);
        return rule !== null && language.lists.has(rule);
      },
      isBroken,
      ownsComments: (node) =>
        printsOwnComments !== undefined && !isBroken(node) && printsOwnComments(node, ctx),
    };

    ctx.print(tree.root);
    if (language.finalLine?.(ctx) !== false) sHardline();
    const printed = printStream(settings);
    if (language.wrapsLineComments) wrapLineComments(printed, isLine, settings.lineWidth);
    const { text } = printed;
    const eol = endOfLine(settings.endOfLine, tree);
    const rewrite = eol !== "\n" || text.includes("\r");
    let anchors: Anchor[] | undefined;
    return {
      ok: true,
      text: rewrite ? text.replace(/\r\n?|\n/g, eol) : text,
      get anchors() {
        if (anchors) return anchors;
        const moved = rewrite ? shiftForEndOfLine(text, eol) : undefined;
        anchors = [];
        for (let t = 0; t < printed.at.length; t++) {
          const nd = printed.nodes[t] as number;
          const start = printed.at[t] as number;
          const end = start + (printed.lengths[t] as number);
          const anchor: Anchor = {
            from: [tree.start(nd), tree.end(nd)],
            to: moved ? [moved(start), moved(end)] : [start, end],
          };
          if (printed.synthetic[t]) anchor.synthetic = true;
          anchors.push(anchor);
        }
        return anchors;
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: "formatter-error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * google-java-format's wrapLineComments, which ktfmt's KDocCommentsHelper keeps: a line comment reaching past
 * `width` breaks before its last blank that keeps the line within the width, and goes on as `//` at the column
 * the comment starts. The line comments are the printed tokens, so this rewrites `printed` in place, shifting the
 * tokens after each break.
 */
function wrapLineComments(printed: StreamPrinted, isLine: (n: number) => boolean, width: number): void {
  const { text, nodes, lengths, at } = printed;
  let out = "";
  let from = 0;
  let shift = 0;
  for (let t = 0; t < at.length; t++) {
    const start = at[t] as number;
    at[t] = start + shift;
    const length = lengths[t] as number;
    if (!isLine(nodes[t] as number)) continue;
    const column = start - (text.lastIndexOf("\n", start - 1) + 1);
    let line = text.slice(start, start + length);
    if (line.length + column <= width) continue;
    const lines: string[] = [];
    while (line.length + column > width) {
      let idx = width - column;
      while (idx >= 2 && !/\s/.test(line[idx] as string)) idx--;
      if (idx <= 2) break;
      lines.push(line.slice(0, idx).trim());
      line = `//${line.slice(idx)}`;
    }
    lines.push(line.trim());
    const wrapped = lines.join(`\n${" ".repeat(column)}`);
    out += text.slice(from, start) + wrapped;
    from = start + length;
    shift += wrapped.length - length;
    lengths[t] = wrapped.length;
  }
  if (from > 0) printed.text = out + text.slice(from);
}
