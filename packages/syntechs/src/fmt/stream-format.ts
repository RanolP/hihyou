import type { Tree } from "../core/arena.js";
import { attachComments } from "./comments.js";
import {
  type Anchor,
  brokenNodes,
  endOfLine,
  type Formatted,
  shiftForEndOfLine,
} from "./format.js";
import type { Language } from "./rules.js";
import {
  close,
  LINE_SUFFIX,
  open,
  printStream,
  resetStream,
  sBreakParent,
  sHardline,
  sLine,
  sText,
  sToken,
} from "./stream.js";
import { lfAfter, newlineBetween } from "./text.js";
import { type FormatTree, firstLeaf } from "./tree.js";

/**
 * The stream path (see `stream.ts`) for the rules a formatter spec generates (`dsl/`): a rule appends to the stream instead of
 * returning a Doc, and `format` hands a language with `stream` rules to `formatStream`.
 */
export interface StreamCtx<O = unknown> {
  readonly tree: FormatTree;
  readonly options: O;
  /** Appends `node` as its rule prints it, with its comments. */
  print(node: number): void;
  /** Appends `node` as its rule prints it (its text when it has none, or is broken), without its comments. */
  printNode(node: number): void;
  items(node: number): number[];
  /** The comments attached before (`leading`) or after (`trailing`) `node`, in source order. */
  leadingComments(node: number): readonly number[];
  trailingComments(node: number): readonly number[];
  danglingComments(node: number): readonly number[];
  isComment(node: number): boolean;
  isLineComment(c: number): boolean;
  /** Appends comment `c`. */
  comment(c: number): void;
  isList(node: number): boolean;
  /** Whether `node` lies in a region the parser could not read, which prints as its source text. */
  isBroken(node: number): boolean;
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
  line: ctx.isLineComment(c),
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
  if ((previous?.suffix && !previous.line) || f.lf > 0) {
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
}

/** `format`, over the stream rules of `base` (a language with `stream` rules). */
export function formatStream<O>(
  tree: Tree,
  base: Language<O>,
  options: Partial<O> = {},
): Formatted {
  try {
    const language = base.stream;
    if (!language) throw new Error("formatStream: a language without stream rules");
    if (base.printComment || base.printsOwnComments)
      throw new Error("formatStream: a language that prints its own comments");
    resetStream();
    const resolved: O = { ...base.defaults, ...options };
    const settings = base.settings(resolved);
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
    const comments = attachComments(
      tree,
      isComment,
      base.handleComment,
      resolved,
    );
    const comment = (c: number) => {
      const t = tree.text(c);
      sToken(c, isLine(c) ? t.trimEnd() : t);
    };
    const broken = brokenNodes(tree);
    const isBroken = (node: number) => broken !== undefined && broken.has(node);

    const none: readonly number[] = [];
    const printNode = (node: number) => {
      const rule = (!isBroken(node) && ruleOf(node)) || null;
      if (rule) rule(node, ctx);
      else sToken(node, tree.text(node));
    };

    const ctx: StreamCtx<O> = {
      tree,
      options: resolved,
      // `printWithComments` of rules.ts.
      print(node) {
        printLeadingComments(ctx, node);
        printNode(node);
        printTrailingComments(ctx, node);
      },
      printNode,
      items(node) {
        const items: number[] = [];
        for (let i = 0, count = tree.count(node); i < count; i++) {
          const c = tree.child(node, i);
          if (tree.named(c) && !isComment(c)) items.push(c);
        }
        return items;
      },
      leadingComments: (node) => comments.of(node)?.leading ?? none,
      trailingComments: (node) => comments.of(node)?.trailing ?? none,
      danglingComments: (node) => comments.dangling(node),
      isComment,
      isLineComment: isLine,
      comment,
      isList(node) {
        const rule = ruleOf(node);
        return rule !== null && language.lists.has(rule);
      },
      isBroken,
    };

    ctx.print(tree.root);
    sHardline();
    const printed = printStream(settings);
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
