import { NO_NODE, type Tree } from "../core/arena.js";
import { SYM_ERROR } from "../core/language.js";
import { attachComments } from "./comments.js";
import { type Doc, docMark, hardline, releaseDocs, token } from "./doc.js";
import type { EndOfLine } from "./options.js";
import { type Placed, type PlacedToken, print } from "./printer.js";
import {
  type Ctx,
  type Language,
  printWithComments,
  type Rule,
} from "./rules.js";
import { newlineBetween } from "./text.js";
import { firstLeaf } from "./tree.js";

/**
 * Where one source token (`from`, in the input) landed (`to`, in the output), as UTF-16 [start, end). A
 * respelled token (`'a'` printed as `"a"`) keeps its node's range; a `synthetic` one (an inserted `;`) has the
 * range of the node it anchors to, and no text there is its own.
 */
export interface Anchor {
  from: readonly [number, number];
  to: readonly [number, number];
  synthetic?: true;
}

export type Formatted =
  | { ok: true; text: string; anchors: Anchor[] }
  | {
      ok: false;
      /** `formatter-error`: a rule threw, so there is no output. */
      reason: "formatter-error";
      detail: string;
    };

/**
 * Lays out `tree` by `language`'s rules, with `options` (by the names the language's own tool uses) over the
 * language's defaults, and `anchors` says where each input token landed. It does not verify that the output
 * says what the input says: `check` does, apart, because a mismatch is a rule or parser bug for the tests to
 * catch rather than a cost every format pays. If a rule throws, there is no output, only the reason.
 */
export function format<O>(
  tree: Tree,
  language: Language<O>,
  options: Partial<O> = {},
): Formatted {
  const mark = docMark();
  try {
    const resolved: O = { ...language.defaults, ...options };
    const settings = language.settings(resolved);
    // Rules and comment kinds by kind id, looked up by name once per kind rather than once per node.
    const rules: (Rule<string, O> | null)[] = [];
    const ruleOf = (n: number) => {
      const k = tree.kind(n);
      let rule = rules[k];
      if (rule === undefined)
        rules[k] = rule = language.rules.get(tree.kindName(n)) ?? null;
      return rule;
    };
    const commentKinds: boolean[] = [];
    const isComment = (n: number) =>
      (commentKinds[tree.kind(n)] ??= language.comments.has(tree.kindName(n)));
    const isLine = (n: number) => {
      const prefix = language.lineComments.get(tree.kindName(n));
      return prefix !== undefined && tree.text(n).startsWith(prefix);
    };
    const comments = attachComments(
      tree,
      isComment,
      language.handleComment,
      resolved,
    );
    const commentToken = (c: number): Doc => {
      if (language.printComment) return language.printComment(c, ctx);
      const t = tree.text(c);
      return token(c, isLine(c) ? t.trimEnd() : t);
    };
    const fallback: Rule = (node) => token(node, tree.text(node));

    // A node holding a parse error, or a node the parser invented to recover from one, has no reliable
    // structure (which comma belongs to which item?), so it keeps its source text; the nodes around it
    // still format.
    // Found in one walk up front: most trees have none, and then `print` asks no node's children.
    const broken = brokenNodes(tree);
    const isBroken = (node: number) =>
      broken !== undefined && broken.has(node);

    const ctx: Ctx<O> = {
      tree,
      options: resolved,
      print(node, args) {
        const printed = ctx.printBare(node, args);
        return !isBroken(node) && language.printsOwnComments?.(node, ctx)
          ? printed
          : ctx.withComments(node, printed);
      },
      printBare(node, args) {
        const rule = (!isBroken(node) && ruleOf(node)) || fallback;
        return rule(node, ctx, args);
      },
      withComments: (node, printed) =>
        printWithComments(node, printed, comments, ctx, isLine, commentToken),
      items(node) {
        const items: number[] = [];
        for (let i = 0, count = tree.count(node); i < count; i++) {
          const c = tree.child(node, i);
          if (tree.named(c) && !isComment(c)) items.push(c);
        }
        return items;
      },
      dangling: (node) => comments.dangling(node).map(commentToken),
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
      comments(node) {
        const attached = comments.of(node);
        const dangling = comments.dangling(node);
        if (!attached && dangling.length === 0) return NO_COMMENTS;
        return {
          leading: attached?.leading ?? [],
          trailing: attached?.trailing ?? [],
          dangling,
        };
      },
      isLineComment: isLine,
    };

    const doc: Doc = [ctx.print(tree.root), hardline];
    const { text, placed } = print(doc, settings);
    const eol = endOfLine(settings.endOfLine, tree);
    // The printer ends lines with `\n`, so only a `\r` inside a token can make an LF output need rewriting.
    const rewrite = eol !== "\n" || text.includes("\r");
    // Most callers never read the anchors, so they are built on first read rather than on every format.
    let anchors: Anchor[] | undefined;
    return {
      ok: true,
      text: rewrite ? text.replace(/\r\n?|\n/g, eol) : text,
      get anchors() {
        return (anchors ??= anchorsOf(
          tree,
          placed,
          rewrite ? shiftForEndOfLine(text, eol) : undefined,
        ));
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: "formatter-error",
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    releaseDocs(mark);
  }
}

const NO_COMMENTS = { leading: [], trailing: [], dangling: [] } as const;

/** The nodes with an `ERROR` or missing child, or undefined when the tree has none. */
function brokenNodes(tree: Tree): Set<number> | undefined {
  let broken: Set<number> | undefined;
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if (tree.kind(n) === SYM_ERROR || tree.missing(n)) {
      const parent = tree.parent(n);
      if (parent !== NO_NODE) (broken ??= new Set()).add(parent);
    }
  }
  return broken;
}

// Prettier's guessEndOfLine (common/end-of-line.js); ruff's `auto` also takes the first line ending.
function endOfLine(eol: EndOfLine, tree: Tree): string {
  if (eol === "auto") return tree.lineEnding();
  return { lf: "\n", crlf: "\r\n", cr: "\r" }[eol];
}

function anchorsOf(
  tree: Tree,
  { tokens, at }: Placed,
  moved: ((at: number) => number) | undefined,
): Anchor[] {
  const anchors: Anchor[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as PlacedToken;
    const n = t.node;
    const start = at[i] as number;
    const end = start + t.text.length;
    const anchor: Anchor = {
      from:
        typeof n === "number" ? [tree.start(n), tree.end(n)] : [n.start, n.end],
      to: moved ? [moved(start), moved(end)] : [start, end],
    };
    if (t.synthetic) anchor.synthetic = true;
    anchors.push(anchor);
  }
  return anchors;
}

/**
 * Maps an offset in the printed `text` to the same place once every line break is written as `eol`, those
 * inside tokens too (a block comment's), as prettier does by normalizing its input. Offsets must be asked in
 * ascending order: anchors run in output order, so one pass over the breaks moves them all.
 */
function shiftForEndOfLine(text: string, eol: string) {
  const breaks = [...text.matchAll(/\r\n?|\n/g)].filter((m) => m[0] !== eol);
  let next = 0;
  let shift = 0;
  return (at: number) => {
    for (let b = breaks[next]; b && b.index < at; b = breaks[++next])
      shift += eol.length - b[0].length;
    return at + shift;
  };
}
