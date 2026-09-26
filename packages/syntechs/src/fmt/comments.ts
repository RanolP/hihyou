import { NO_NODE } from "../core/arena.js";
import { lfAfter } from "./text.js";
import { type FormatTree, firstLeaf, nextLeaf } from "./tree.js";

export interface Attached {
  leading: number[];
  trailing: number[];
}

export interface Comments {
  /** Comments printed before (`leading`) or after (`trailing`) a node, in source order. */
  of(node: number): Attached | undefined;
  /** Comments inside `node` that sit next to none of its items, such as those in an empty list. */
  dangling(node: number): readonly number[];
}

/** Where prettier's attach classifies a comment: alone on its line, ending one, or between code on one line. */
export type Placement = "ownLine" | "endOfLine" | "remaining";

/** A comment with the neighbours the core found for it, as prettier's handleComments hooks receive it. */
export interface CommentContext<O = unknown> {
  readonly tree: FormatTree;
  readonly comment: number;
  /** The comment's own text. */
  readonly text: string;
  readonly placement: Placement;
  readonly enclosing: number;
  readonly preceding: number | undefined;
  readonly following: number | undefined;
  readonly options: O;
}

/** A node to attach a comment to, and how it prints there. */
export interface CommentTarget {
  readonly node: number;
  readonly as: "leading" | "trailing" | "dangling";
}

/**
 * A language's own placement for a comment, where its syntax tree differs from prettier's AST or prettier's
 * handlers move a comment (a union member's comment trails the member before it); `undefined` keeps the
 * core's.
 */
export type CommentHandler<O = unknown> = (
  c: CommentContext<O>,
) => CommentTarget | undefined;

/**
 * Attaches every comment to a neighbouring node the way prettier's `attach` does (main/comments/attach.js),
 * with `handle` standing for its language-specific handlers. The parser already put each comment among the children of the
 * smallest node enclosing it, so the neighbours are that node's items on either side.
 */
export function attachComments<O>(
  tree: FormatTree,
  isComment: (n: number) => boolean,
  handle?: CommentHandler<O>,
  options?: O,
): Comments {
  const attached = new Map<number, Attached>();
  const dangling = new Map<number, number[]>();
  const at = (n: number) => {
    const a = attached.get(n) ?? { leading: [], trailing: [] };
    attached.set(n, a);
    return a;
  };
  const addDangling = (parent: number, c: number) => {
    const list = dangling.get(parent);
    if (list) list.push(c);
    else dangling.set(parent, [c]);
  };
  // Whether only spaces and tabs stand between node `a` and node `b`.
  const sameLineGap = (a: number, b: number) =>
    tree.lf(b) === 0 && nextLeaf(tree, a) === firstLeaf(tree, b);
  const indexIn = (parent: number, child: number) => {
    for (let i = 0; ; i++) if (tree.child(parent, i) === child) return i;
  };
  const someCode = (parent: number, from: number, to: number) => {
    for (let j = from; j < to; j++)
      if (isCode(tree.child(parent, j))) return true;
    return false;
  };

  type Placed = {
    comment: number;
    preceding: number | undefined;
    following: number | undefined;
  };
  // The enclosing node of each comment, with its comments in source order.
  const enclosed = new Map<number, Placed[]>();
  const isCode = (n: number) => !isComment(n);
  const collect = (node: number) => {
    const count = tree.count(node);
    for (let k = 0; k < count; k++) {
      const c = tree.child(node, k);
      if (isCode(c)) {
        collect(c);
        continue;
      }
      // A tree-sitter node swallows a comment that follows its last token (`{} // x`), where prettier's node
      // ends at that token, so a comment with no code on one side inside its node belongs to the node's parent.
      // `at` is the child of `enclosing` holding the comment; once hoisted, prettier sees that child end before
      // the comment (`after`) or start after it.
      let enclosing = node;
      let at: number = c;
      let after = false;
      for (let up = tree.parent(enclosing); up !== NO_NODE; ) {
        const i = indexIn(enclosing, at);
        if (!someCode(enclosing, i + 1, tree.count(enclosing))) after = true;
        else if (!someCode(enclosing, 0, i)) after = false;
        else break;
        at = enclosing;
        enclosing = up;
        up = tree.parent(enclosing);
      }
      const i = indexIn(enclosing, at);
      const named = (n: number) => tree.named(n) && isCode(n);
      const hoisted = at !== c && named(at);
      let preceding: number | undefined;
      if (hoisted && after) preceding = at;
      else
        for (let j = i - 1; j >= 0 && preceding === undefined; j--) {
          const n = tree.child(enclosing, j);
          if (named(n)) preceding = n;
        }
      let following: number | undefined;
      if (hoisted && !after) following = at;
      else
        for (let j = i + 1; j < tree.count(enclosing); j++) {
          const n = tree.child(enclosing, j);
          if (named(n)) {
            following = n;
            break;
          }
        }
      const list = enclosed.get(enclosing);
      const placed = { comment: c, preceding, following };
      if (list) list.push(placed);
      else enclosed.set(enclosing, [placed]);
    }
  };
  collect(tree.root);

  for (const [node, comments] of enclosed) {
    let ties: typeof comments = [];
    const breakTies = () => {
      const first = ties[0];
      const preceding = first?.preceding;
      const following = first?.following;
      if (preceding === undefined || following === undefined) return;
      let gapEnd = following;
      let firstLeading = ties.length;
      for (const tie of ties.toReversed()) {
        if (!sameLineGap(tie.comment, gapEnd)) break;
        gapEnd = tie.comment;
        firstLeading--;
      }
      for (const [i, tie] of ties.entries()) {
        if (i < firstLeading) at(preceding).trailing.push(tie.comment);
        else at(following).leading.push(tie.comment);
      }
      ties = [];
    };

    for (const [i, { comment, preceding, following }] of comments.entries()) {
      // A run of comments on one line counts as one: its first decides "own line", its last "end of line".
      let start = comment;
      for (let j = i - 1; preceding !== undefined && j >= 0; j--) {
        const prev = comments[j];
        if (
          !prev ||
          prev.preceding !== preceding ||
          !sameLineGap(prev.comment, start)
        )
          break;
        start = prev.comment;
      }
      let end = comment;
      for (let j = i + 1; following !== undefined && j < comments.length; j++) {
        const next = comments[j];
        if (
          !next ||
          next.following !== following ||
          !sameLineGap(end, next.comment)
        )
          break;
        end = next.comment;
      }

      const placement: Placement =
        tree.lf(start) > 0
          ? "ownLine"
          : lfAfter(tree, end) > 0
            ? "endOfLine"
            : "remaining";
      const target = handle?.({
        tree,
        comment,
        text: tree.text(comment),
        options: options as O,
        placement,
        enclosing: node,
        preceding,
        following,
      });
      if (target) {
        if (target.as === "dangling") addDangling(target.node, comment);
        else at(target.node)[target.as].push(comment);
      } else if (placement === "ownLine") {
        if (following !== undefined) at(following).leading.push(comment);
        else if (preceding !== undefined) at(preceding).trailing.push(comment);
        else addDangling(node, comment);
      } else if (placement === "endOfLine") {
        if (preceding !== undefined) at(preceding).trailing.push(comment);
        else if (following !== undefined) at(following).leading.push(comment);
        else addDangling(node, comment);
      } else if (preceding !== undefined && following !== undefined) {
        const last = ties.at(-1);
        if (last && last.following !== following) breakTies();
        ties.push({ comment, preceding, following });
      } else if (preceding !== undefined) at(preceding).trailing.push(comment);
      else if (following !== undefined) at(following).leading.push(comment);
      else addDangling(node, comment);
    }
    breakTies();
  }

  return {
    of: (n) => attached.get(n),
    dangling: (n) => dangling.get(n) ?? NONE,
  };
}

const NONE: readonly number[] = [];
