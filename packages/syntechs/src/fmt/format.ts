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

/** Where one source token (`from`, in the input) landed (`to`, in the output), as UTF-16 [start, end). */
export interface Anchor {
  from: readonly [number, number];
  to: readonly [number, number];
}

export type Formatted =
  | { ok: true; text: string; anchors: Anchor[] }
  | {
      ok: false;
      /** `token-mismatch`: the rules dropped, repeated or reordered a source token, so the output would misstate the code. */
      reason: "token-mismatch" | "formatter-error";
      /** The input, unchanged. */
      text: string;
      detail: string;
    };

/**
 * Lays out the tree of `source` by `language`'s rules, with `options` (by the names the language's own tool
 * uses) over the language's defaults. Every token of the input appears exactly once in the output, and
 * `anchors` says where; if the rules break that, the input comes back unformatted with the reason, never a
 * formatting that hides or invents code.
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
    const comments = attachComments(root, source, isComment);
    const commentToken = (c: FormatNode) => {
      const t = source.slice(c.start, c.end);
      return token(c, isLine(c) ? t.trimEnd() : t);
    };
    const fallback: Rule = (node) =>
      token(node, source.slice(node.start, node.end));

    const ctx: Ctx<O> = {
      source,
      options: resolved,
      print(node, args) {
        // A node holding a parse error, or a node the parser invented to recover from one, has no reliable
        // structure (which comma belongs to which item?), so it keeps its source text; the nodes around it
        // still format.
        const broken = node.children.some(
          (c) => c.kind === "ERROR" || c.missing,
        );
        const rule = (!broken && language.rules.get(node.kind)) || fallback;
        return printWithComments(
          node,
          rule(node, ctx, args),
          comments,
          ctx,
          isLine,
        );
      },
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
    };

    const doc: Doc = [ctx.print(root), hardline];
    const { text, placed } = print(doc, settings);

    const anchors: Anchor[] = [];
    // Code tokens must come out in source order, or a rule that swaps two fields shows code that does not
    // exist; comments are exempt because prettier moves them (a trailing comment past a comma).
    let codeEnd = 0;
    for (const { token: t, at } of placed) {
      if (!isComment(t.node)) {
        if (t.node.start < codeEnd)
          return mismatch(
            source,
            `token at ${t.node.start} printed out of order`,
          );
        codeEnd = t.node.end;
      }
      anchors.push({
        from: [t.node.start, t.node.end],
        to: [at, at + t.text.length],
      });
    }
    const problem = coverage(source, anchors);
    if (problem) return mismatch(source, problem);
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

const mismatch = (source: string, detail: string): Formatted => ({
  ok: false,
  reason: "token-mismatch",
  text: source,
  detail,
});

/**
 * Checks that the printed tokens cover every non-blank character of the input exactly once: a dropped token
 * leaves a gap, a repeated one (or a node printed along with its own child) overlaps. Tree-sitter puts every
 * character outside whitespace into some leaf, so this is "each leaf printed once" without walking the tree.
 */
function coverage(source: string, anchors: Anchor[]): string | undefined {
  // Output order is source order but for the few comments a rule moves, so this sort is near linear.
  const ranges = anchors.map((a) => a.from).sort((x, y) => x[0] - y[0]);
  let covered = 0;
  for (const [start, end] of ranges) {
    if (start < covered) return `input at ${start} printed twice`;
    if (/\S/.test(source.slice(covered, start)))
      return `input at ${covered} dropped`;
    covered = end;
  }
  if (/\S/.test(source.slice(covered))) return `input at ${covered} dropped`;
  return undefined;
}
