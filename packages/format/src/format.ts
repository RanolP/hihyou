import { attachComments } from "./comments.js";
import { type Doc, hardline, token } from "./doc.js";
import { print } from "./printer.js";
import {
  type Ctx,
  type Language,
  printWithComments,
  type Rule,
} from "./rules.js";
import { defaultSettings, type Settings } from "./settings.js";
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
 * Lays out the tree of `source` by `language`'s rules and the reviewer's `settings`. Every token of the input
 * appears exactly once in the output, and `anchors` says where; if the rules break that, the input comes back
 * unformatted with the reason, never a formatting that hides or invents code.
 */
export function format(
  root: FormatNode,
  source: string,
  language: Language,
  settings: Settings = defaultSettings,
): Formatted {
  try {
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

    const ctx: Ctx = {
      source,
      settings,
      print(node) {
        // A node holding a parse error, or a node the parser invented to recover from one, has no reliable
        // structure (which comma belongs to which item?), so it keeps its source text; the nodes around it
        // still format.
        const broken = node.children.some(
          (c) => c.kind === "ERROR" || c.missing,
        );
        const rule = (!broken && language.rules.get(node.kind)) || fallback;
        return printWithComments(node, rule(node, ctx), comments, ctx, isLine);
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
    return { ok: true, text, anchors };
  } catch (e) {
    return {
      ok: false,
      reason: "formatter-error",
      text: source,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
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
