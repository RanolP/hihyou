import { attachComments } from "./comments.js";
import { type Doc, hardline, token } from "./doc.js";
import type { EndOfLine } from "./options.js";
import { print } from "./printer.js";
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
    const isBroken = (node: FormatNode) =>
      node.children.some((c) => c.kind === "ERROR" || c.missing);

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
        return {
          leading: attached?.leading ?? [],
          trailing: attached?.trailing ?? [],
          dangling: comments.dangling(node),
        };
      },
      isLineComment: isLine,
    };

    const doc: Doc = [ctx.print(root), hardline];
    const { text, placed } = print(doc, settings);

    const anchors: Anchor[] = [];
    for (const { token: t, at } of placed) {
      const anchor: Anchor = {
        from: [t.node.start, t.node.end],
        to: [at, at + t.text.length],
      };
      if (t.synthetic) anchor.synthetic = true;
      anchors.push(anchor);
    }
    return withEndOfLine(text, anchors, endOfLine(settings.endOfLine, source));
  } catch (e) {
    return {
      ok: false,
      reason: "formatter-error",
      text: source,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

// Prettier's guessEndOfLine (common/end-of-line.js); ruff's `auto` also takes the first line ending.
function endOfLine(eol: EndOfLine, source: string): string {
  if (eol === "auto") {
    const cr = source.indexOf("\r");
    eol = cr === -1 ? "lf" : source.charAt(cr + 1) === "\n" ? "crlf" : "cr";
  }
  return { lf: "\n", crlf: "\r\n", cr: "\r" }[eol];
}

/**
 * Writes every line break of `text` as `eol`, those inside tokens too (a block comment's), as prettier does by
 * normalizing its input, and moves each anchor's output range with its text.
 */
function withEndOfLine(
  text: string,
  anchors: Anchor[],
  eol: string,
): Formatted {
  // The printer ends lines with `\n`, so only a `\r` inside a token can make an LF output need rewriting.
  if (eol === "\n" && !text.includes("\r")) return { ok: true, text, anchors };
  const breaks = [...text.matchAll(/\r\n?|\n/g)].filter((m) => m[0] !== eol);
  if (breaks.length === 0) return { ok: true, text, anchors };
  // Anchors run in output order, so their offsets only grow and one pass over the breaks moves them all.
  let next = 0;
  let shift = 0;
  const moved = (at: number) => {
    for (let b = breaks[next]; b && b.index < at; b = breaks[++next])
      shift += eol.length - b[0].length;
    return at + shift;
  };
  return {
    ok: true,
    text: text.replace(/\r\n?|\n/g, eol),
    anchors: anchors.map((a) => ({
      ...a,
      to: [moved(a.to[0]), moved(a.to[1])],
    })),
  };
}
