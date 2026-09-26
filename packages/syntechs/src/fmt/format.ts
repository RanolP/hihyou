import { attachComments } from "./comments.js";
import { type Doc, hardline, type Token, token } from "./doc.js";
import type { EndOfLine } from "./options.js";
import { type Placed, print } from "./printer.js";
import {
  type Ctx,
  type Language,
  printWithComments,
  type Rule,
} from "./rules.js";
import { hasNewlineInRange } from "./text.js";
import type { FormatNode } from "./tree.js";

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
      /** The input, unchanged. */
      text: string;
      detail: string;
    };

/**
 * Lays out the tree of `source` by `language`'s rules, with `options` (by the names the language's own tool
 * uses) over the language's defaults, and `anchors` says where each input token landed. It does not verify that
 * the output says what the input says: `check` does, apart, because a mismatch is a rule or parser bug for the
 * tests to catch rather than a cost every format pays. If a rule throws, the input comes back unformatted with
 * the reason.
 */
export function format<O>(
  root: FormatNode,
  source: string,
  language: Language<O>,
  options: Partial<O> = {},
): Formatted {
  try {
    const resolved: O = { ...language.defaults, ...options };
    const settings = language.settings(resolved);
    const isComment = (n: FormatNode) => language.comments.has(n.kind);
    const isLine = (n: FormatNode) => {
      const prefix = language.lineComments.get(n.kind);
      return prefix !== undefined && source.startsWith(prefix, n.start);
    };
    const comments = attachComments(
      root,
      source,
      isComment,
      language.handleComment,
      resolved,
    );
    const commentToken = (c: FormatNode): Doc => {
      if (language.printComment) return language.printComment(c, ctx);
      const t = source.slice(c.start, c.end);
      return token(c, isLine(c) ? t.trimEnd() : t);
    };
    const fallback: Rule = (node) =>
      token(node, source.slice(node.start, node.end));

    // A node holding a parse error, or a node the parser invented to recover from one, has no reliable
    // structure (which comma belongs to which item?), so it keeps its source text; the nodes around it
    // still format.
    // Found in one walk up front: most trees have none, and then `print` asks no node's children.
    const broken = brokenNodes(root);
    const isBroken = (node: FormatNode) =>
      broken !== undefined && broken.has(node);

    const ctx: Ctx<O> = {
      source,
      options: resolved,
      print(node, args) {
        const printed = ctx.printBare(node, args);
        return !isBroken(node) && language.printsOwnComments?.(node, ctx)
          ? printed
          : ctx.withComments(node, printed);
      },
      printBare(node, args) {
        const rule = (!isBroken(node) && language.rules.get(node.kind)) || fallback;
        return rule(node, ctx, args);
      },
      withComments: (node, printed) =>
        printWithComments(node, printed, comments, ctx, isLine, commentToken),
      items: (node) => node.children.filter((c) => c.named && !isComment(c)),
      dangling: (node) => comments.dangling(node).map(commentToken),
      hasDanglingLineComment: (node) => comments.dangling(node).some(isLine),
      hasComment(node, where) {
        const attached = comments.of(node);
        if (!attached) return false;
        if (where === "leadingLine") return attached.leading.some(isLine);
        return attached.trailing.some(
          (c) => isLine(c) && !hasNewlineInRange(source, node.start, c.end),
        );
      },
      isList(node) {
        const rule = language.rules.get(node.kind);
        return rule !== undefined && language.lists.has(rule);
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

    const doc: Doc = [ctx.print(root), hardline];
    const { text, placed } = print(doc, settings);
    const eol = endOfLine(settings.endOfLine, source);
    // The printer ends lines with `\n`, so only a `\r` inside a token can make an LF output need rewriting.
    const rewrite = eol !== "\n" || text.includes("\r");
    // Most callers never read the anchors, so they are built on first read rather than on every format.
    let anchors: Anchor[] | undefined;
    return {
      ok: true,
      text: rewrite ? text.replace(/\r\n?|\n/g, eol) : text,
      get anchors() {
        return (anchors ??= anchorsOf(
          placed,
          rewrite ? shiftForEndOfLine(text, eol) : undefined,
        ));
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: "formatter-error",
      text: source,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

const NO_COMMENTS = { leading: [], trailing: [], dangling: [] } as const;

/** The nodes with an `ERROR` or missing child, or undefined when the tree has none. */
function brokenNodes(root: FormatNode): Set<FormatNode> | undefined {
  let broken: Set<FormatNode> | undefined;
  const stack = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    for (const c of node.children) {
      if (c.kind === "ERROR" || c.missing) (broken ??= new Set()).add(node);
      stack.push(c);
    }
  }
  return broken;
}

// Prettier's guessEndOfLine (common/end-of-line.js); ruff's `auto` also takes the first line ending.
function endOfLine(eol: EndOfLine, source: string): string {
  if (eol === "auto") {
    const cr = source.indexOf("\r");
    eol = cr === -1 ? "lf" : source.charAt(cr + 1) === "\n" ? "crlf" : "cr";
  }
  return { lf: "\n", crlf: "\r\n", cr: "\r" }[eol];
}

function anchorsOf(
  { tokens, at }: Placed,
  moved: ((at: number) => number) | undefined,
): Anchor[] {
  const anchors: Anchor[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const start = at[i] as number;
    const end = start + t.text.length;
    const anchor: Anchor = {
      from: [t.node.start, t.node.end],
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
