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

  const stack = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    const comments: {
      comment: FormatNode;
      preceding: FormatNode | undefined;
      following: FormatNode | undefined;
    }[] = [];
    let preceding: FormatNode | undefined;
    for (const [i, c] of node.children.entries()) {
      if (!isComment(c)) {
        if (c.named) preceding = c;
        stack.push(c);
        continue;
      }
      let following: FormatNode | undefined;
      for (let j = i + 1; j < node.children.length && !following; j++) {
        const n = node.children[j] as FormatNode;
        if (n.named && !isComment(n)) following = n;
      }
      comments.push({ comment: c, preceding, following });
    }

    let ties: typeof comments = [];
    const breakTies = () => {
      const first = ties[0];
      if (!first?.preceding || !first.following) return;
      let gapEnd = first.following.start;
      let firstLeading = ties.length;
      for (; firstLeading > 0; firstLeading--) {
        const tie = ties[firstLeading - 1] as (typeof ties)[number];
        if (!sameLineGap(tie.comment.end, gapEnd)) break;
        gapEnd = tie.comment.start;
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
        const prev = comments[j] as (typeof comments)[number];
        if (
          prev.preceding !== preceding ||
          !sameLineGap(prev.comment.end, start)
        )
          break;
        start = prev.comment.start;
      }
      let end = comment.end;
      for (let j = i + 1; following && j < comments.length; j++) {
        const next = comments[j] as (typeof comments)[number];
        if (
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
