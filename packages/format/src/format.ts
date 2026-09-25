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
      /** `token-mismatch`: the rules dropped or repeated a source token, so the output would misstate the code. */
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
    const isLine = (n: FormatNode) =>
      source.startsWith(language.lineComment, n.start);
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
        // A node holding a parse error has no reliable structure (which comma belongs to which item?), so
        // it keeps its source text; the nodes around it still format.
        const broken = node.children.some((c) => c.kind === "ERROR");
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

    const emitted = new Map<FormatNode, number>();
    const anchors: Anchor[] = [];
    for (const { token: t, at } of placed) {
      emitted.set(t.node, (emitted.get(t.node) ?? 0) + 1);
      if (text.slice(at, at + t.text.length) !== t.text)
        return mismatch(
          source,
          `token at ${t.node.start} printed out of place`,
        );
      anchors.push({
        from: [t.node.start, t.node.end],
        to: [at, at + t.text.length],
      });
    }
    const problem = coverage(root, emitted);
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

/** Checks that every leaf is emitted exactly once, where one token for a node covers its whole subtree. */
function coverage(
  root: FormatNode,
  emitted: Map<FormatNode, number>,
): string | undefined {
  const stack = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    const count = emitted.get(node) ?? 0;
    if (count > 1)
      return `${node.kind} at ${node.start} printed ${count} times`;
    if (count === 1) {
      const inner = [...node.children];
      for (let n = inner.pop(); n; n = inner.pop()) {
        if (emitted.has(n))
          return `${n.kind} at ${n.start} printed twice, inside ${node.kind}`;
        inner.push(...n.children);
      }
      continue;
    }
    if (node.children.length === 0) {
      if (node.end > node.start) return `${node.kind} at ${node.start} dropped`;
      continue;
    }
    stack.push(...node.children);
  }
  return undefined;
}
