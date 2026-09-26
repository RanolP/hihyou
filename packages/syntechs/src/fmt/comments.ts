import { hasNewline } from "./text.js";
import type { FormatNode } from "./tree.js";

export interface Attached {
  leading: FormatNode[];
  trailing: FormatNode[];
}

export interface Comments {
  /** Comments printed before (`leading`) or after (`trailing`) a node, in source order. */
  of(node: FormatNode): Attached | undefined;
  /** Comments inside `node` that sit next to none of its items, such as those in an empty list. */
  dangling(node: FormatNode): readonly FormatNode[];
}

/**
 * Attaches every comment to a neighbouring node the way prettier's `attach` does (main/comments/attach.js),
 * minus its language-specific handlers. The parser already put each comment among the children of the
 * smallest node enclosing it, so the neighbours are that node's items on either side.
 */
export function attachComments(
  root: FormatNode,
  text: string,
  isComment: (n: FormatNode) => boolean,
): Comments {
  const attached = new Map<FormatNode, Attached>();
  const dangling = new Map<FormatNode, FormatNode[]>();
  const at = (n: FormatNode) => {
    const a = attached.get(n) ?? { leading: [], trailing: [] };
    attached.set(n, a);
    return a;
  };
  const addDangling = (parent: FormatNode, c: FormatNode) => {
    const list = dangling.get(parent);
    if (list) list.push(c);
    else dangling.set(parent, [c]);
  };
  const sameLineGap = (from: number, to: number) =>
    /^[^\S\n]*$/.test(text.slice(from, to));

  type Placed = {
    comment: FormatNode;
    preceding: FormatNode | undefined;
    following: FormatNode | undefined;
  };
  // The enclosing node of each comment, with its comments in source order.
  const enclosed = new Map<FormatNode, Placed[]>();
  const isCode = (n: FormatNode) => !isComment(n);
  const collect = (node: FormatNode) => {
    for (const c of node.children) {
      if (isCode(c)) {
        collect(c);
        continue;
      }
      // A tree-sitter node swallows a comment that follows its last token (`{} // x`), where prettier's node
      // ends at that token, so a comment with no code on one side inside its node belongs to the node's parent.
      // `at` is the child of `enclosing` holding the comment; once hoisted, prettier sees that child end before
      // the comment (`after`) or start after it.
      let enclosing = node;
      let at: FormatNode = c;
      let after = false;
      while (enclosing.parent) {
        const i = enclosing.children.indexOf(at);
        const siblings = enclosing.children;
        if (!siblings.some((n, j) => j > i && isCode(n))) after = true;
        else if (!siblings.some((n, j) => j < i && isCode(n))) after = false;
        else break;
        at = enclosing;
        enclosing = enclosing.parent;
      }
      const i = enclosing.children.indexOf(at);
      const named = (n: FormatNode) => n.named && isCode(n);
      const hoisted = at !== c && named(at);
      const preceding =
        hoisted && after
          ? at
          : enclosing.children.findLast((n, j) => j < i && named(n));
      const following =
        hoisted && !after
          ? at
          : enclosing.children.find((n, j) => j > i && named(n));
      const list = enclosed.get(enclosing);
      const placed = { comment: c, preceding, following };
      if (list) list.push(placed);
      else enclosed.set(enclosing, [placed]);
    }
  };
  collect(root);

  for (const [node, comments] of enclosed) {
    let ties: typeof comments = [];
    const breakTies = () => {
      const first = ties[0];
      if (!first?.preceding || !first.following) return;
      let gapEnd = first.following.start;
      let firstLeading = ties.length;
      for (const tie of ties.toReversed()) {
        if (!sameLineGap(tie.comment.end, gapEnd)) break;
        gapEnd = tie.comment.start;
        firstLeading--;
      }
      for (const [i, tie] of ties.entries()) {
        if (i < firstLeading) at(first.preceding).trailing.push(tie.comment);
        else at(first.following).leading.push(tie.comment);
      }
      ties = [];
    };

    for (const [i, { comment, preceding, following }] of comments.entries()) {
      // A run of comments on one line counts as one: its first decides "own line", its last "end of line".
      let start = comment.start;
      for (let j = i - 1; preceding && j >= 0; j--) {
        const prev = comments[j];
        if (
          !prev ||
          prev.preceding !== preceding ||
          !sameLineGap(prev.comment.end, start)
        )
          break;
        start = prev.comment.start;
      }
      let end = comment.end;
      for (let j = i + 1; following && j < comments.length; j++) {
        const next = comments[j];
        if (
          !next ||
          next.following !== following ||
          !sameLineGap(end, next.comment.start)
        )
          break;
        end = next.comment.end;
      }

      if (hasNewline(text, start, true)) {
        if (following) at(following).leading.push(comment);
        else if (preceding) at(preceding).trailing.push(comment);
        else addDangling(node, comment);
      } else if (hasNewline(text, end)) {
        if (preceding) at(preceding).trailing.push(comment);
        else if (following) at(following).leading.push(comment);
        else addDangling(node, comment);
      } else if (preceding && following) {
        const last = ties.at(-1);
        if (last && last.following !== following) breakTies();
        ties.push({ comment, preceding, following });
      } else if (preceding) at(preceding).trailing.push(comment);
      else if (following) at(following).leading.push(comment);
      else addDangling(node, comment);
    }
    breakTies();
  }

  return {
    of: (n) => attached.get(n),
    dangling: (n) => dangling.get(n) ?? [],
  };
}
