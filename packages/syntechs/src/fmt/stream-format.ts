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
  items(node: number): number[];
  danglingComments(node: number): readonly number[];
  /** Appends comment `c`. */
  comment(c: number): void;
  hasDanglingLineComment(node: number): boolean;
  hasComment(node: number, where: "leadingLine" | "trailingSameLine"): boolean;
  isList(node: number): boolean;
}

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

    // `printWithComments` of rules.ts.
    const print = (node: number) => {
      const rule = (!isBroken(node) && ruleOf(node)) || null;
      const attached = comments.of(node);
      if (attached)
        for (const c of attached.leading) {
          comment(c);
          const lf = lfAfter(tree, c);
          if (isLine(c)) sHardline();
          else if (lf === 0) sText(" ");
          else if (tree.lf(c) > 0) sHardline();
          else sLine(0);
          if (lf >= 2) sHardline();
        }
      if (rule) rule(node, ctx);
      else sToken(node, tree.text(node));
      if (!attached) return;
      let previous: { line: boolean; suffix: boolean } | undefined;
      for (const c of attached.trailing) {
        const lineComment = isLine(c);
        let suffix: boolean;
        if ((previous?.suffix && !previous.line) || tree.lf(c) > 0) {
          open(LINE_SUFFIX);
          sHardline();
          if (tree.lf(c) >= 2) sHardline();
          comment(c);
          close();
          suffix = true;
        } else if (lineComment || previous?.suffix) {
          open(LINE_SUFFIX);
          sText(" ");
          comment(c);
          close();
          if (lineComment) sBreakParent();
          suffix = true;
        } else {
          sText(" ");
          comment(c);
          suffix = false;
        }
        previous = { line: lineComment, suffix };
      }
    };

    const ctx: StreamCtx<O> = {
      tree,
      options: resolved,
      print,
      items(node) {
        const items: number[] = [];
        for (let i = 0, count = tree.count(node); i < count; i++) {
          const c = tree.child(node, i);
          if (tree.named(c) && !isComment(c)) items.push(c);
        }
        return items;
      },
      danglingComments: (node) => comments.dangling(node),
      comment,
      hasDanglingLineComment: (node) => comments.dangling(node).some(isLine),
      hasComment(node, where) {
        const attached = comments.of(node);
        if (!attached) return false;
        if (where === "leadingLine") return attached.leading.some(isLine);
        return attached.trailing.some(
          (c) =>
            isLine(c) &&
            !newlineBetween(tree, firstLeaf(tree, node), c) &&
            !tree.text(c).includes("\n"),
        );
      },
      isList(node) {
        const rule = ruleOf(node);
        return rule !== null && language.lists.has(rule);
      },
    };

    print(tree.root);
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
