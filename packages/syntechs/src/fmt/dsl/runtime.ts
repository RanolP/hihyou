// What the generated formatters (`fmt.gen.ts`) and the two-pass reference (`reference.ts`) share: how a spec's
// references bind to a node's children, so both print the same source token for the same spec token; the
// entries of the flattened sequence; and the sequence a `custom` rule receives.
import { sToken } from "../stream.js";
import {
  type CommentFacts,
  commentFacts,
  endsLine,
  printLeadingComment,
  printLeadingComments,
  printTrailingComment,
  printTrailingComments,
  type StreamCtx,
  type Trailed,
} from "../stream-format.js";
import { nextLineEmpty } from "../text.js";
import type { FormatTree } from "../tree.js";

/**
 * An entry of the flattened sequence (`reference.ts`'s `flatten`): the whole document as tokens, spaces, hard
 * lines, comments and frames, with nothing yet decided about where lines break.
 */
export type Entry =
  | {
      readonly e: "tok";
      readonly node: number;
      readonly text: string;
      readonly synthetic: boolean;
    }
  | { readonly e: "space" }
  | { readonly e: "hardline" }
  /** A child node. In the whole-document sequence it opens the node's range, which an `exit` closes. */
  | {
      readonly e: "child";
      readonly node: number;
      readonly kind: string;
      /** Printed by this custom rule in place of its own (`Node.via`). */
      readonly via?: string;
    }
  | { readonly e: "exit" }
  /**
   * A comment attached before (`leading`) or after (`trailing`) the `child` entry next to it, or one of the
   * node's comments next to no child (`dangling`); `endsLine`: a trailing line comment on its child's first line.
   */
  | ({
      readonly e: "comment";
      readonly at: "leading" | "trailing" | "dangling";
      readonly endsLine: boolean;
    } & CommentFacts)
  /**
   * Opens a frame, which an `end` closes: brackets (its first and last entries are the bracket tokens), a
   * separated list of `items`, or `lines`; `label` names it for the kind's wrapping rule (`Wrap.frames`).
   */
  | { readonly e: "brackets"; readonly label: string }
  | {
      readonly e: "list";
      readonly items: readonly number[];
      readonly label: string;
    }
  | { readonly e: "lines"; readonly label: string }
  | { readonly e: "end" }
  /** After each item but the last: its separator token (-1: none in the source). */
  | { readonly e: "sep"; readonly tok: number }
  /** After an item's separator, an item of `lines`, or a child of a `custom` node: the source keeps a blank line there. */
  | { readonly e: "blank" }
  /** Only while the enclosing frame stays flat: a space, inserted beside a padded bracket. */
  | { readonly e: "ifFlat"; readonly text: string }
  /** After the last item, only while the list breaks: a separator the source has no trailing copy of. */
  | {
      readonly e: "ifBroken";
      readonly after: number;
      readonly text: string;
    };

export type CommentEntry = Extract<Entry, { e: "comment" }>;

/** Comment `c`'s entry: attached `at` its neighbour, and (`trailing`) whether it must end the line of `node`. */
export const commentEntry = (
  ctx: StreamCtx<unknown>,
  c: number,
  at: CommentEntry["at"],
  node = -1,
): CommentEntry => ({
  e: "comment",
  at,
  endsLine: at === "trailing" && endsLine(ctx, node, c),
  ...commentFacts(ctx, c),
});

/**
 * What a `custom` rule receives: the node's structure as the flattened sequence has it, each child (named or a
 * token) in source order between its comment entries, a `blank` after a child the source follows with a blank
 * line (not after the last), then the node's dangling comments.
 */
export interface CustomSeq {
  readonly entries: readonly Entry[];
  /** The children, named ones and tokens, in source order: every child but comments. */
  readonly kids: readonly number[];
  /** Prints `kid` between the comments attached to it: `body` in place of the kid, else the kid as its rule prints it. */
  print(kid: number, body?: () => void): void;
}

/** A `custom` rule: the node's wrapping, laying out its `CustomSeq`. */
export type CustomRule<O = unknown> = (
  node: number,
  ctx: StreamCtx<O>,
  seq: CustomSeq,
) => void;

const kidsOf = (ctx: StreamCtx<unknown>, node: number): number[] => {
  const t = ctx.tree;
  const out: number[] = [];
  for (let i = 0, count = t.count(node); i < count; i++) {
    const c = t.child(node, i);
    if (!ctx.isComment(c)) out.push(c);
  }
  return out;
};

/** The entries of `custom` node `node`, as `CustomSeq.entries` holds them. */
export function customEntries(ctx: StreamCtx<unknown>, node: number): Entry[] {
  const t = ctx.tree;
  const out: Entry[] = [];
  const kids = kidsOf(ctx, node);
  kids.forEach((c, i) => {
    for (const x of ctx.leadingComments(c))
      out.push(commentEntry(ctx, x, "leading"));
    out.push(
      t.named(c)
        ? { e: "child", node: c, kind: t.kindName(c) }
        : { e: "tok", node: c, text: t.text(c), synthetic: false },
    );
    for (const x of ctx.trailingComments(c))
      out.push(commentEntry(ctx, x, "trailing", c));
    if (i < kids.length - 1 && nextLineEmpty(t, c)) out.push({ e: "blank" });
  });
  for (const x of ctx.danglingComments(node))
    out.push(commentEntry(ctx, x, "dangling"));
  return out;
}

/** Prints `kid` of a custom node between its comments (`CustomSeq.print`). */
export function printKid(
  ctx: StreamCtx<unknown>,
  kid: number,
  body?: () => void,
): void {
  printLeadingComments(ctx, kid);
  if (body) body();
  else if (ctx.tree.named(kid)) ctx.printNode(kid);
  else sToken(kid, ctx.tree.text(kid));
  printTrailingComments(ctx, kid);
}

/**
 * Prints `entries` of a `CustomSeq` in order: children as their rules print them, tokens as written, comments
 * as prettier places them next to their neighbour, dangling ones as they are; `blank` prints a kept blank line
 * (nothing by default).
 */
export function printEntries(
  ctx: StreamCtx<unknown>,
  entries: readonly Entry[],
  blank?: () => void,
): void {
  let trailed: Trailed | undefined;
  for (const x of entries)
    switch (x.e) {
      case "child":
        trailed = undefined;
        ctx.printNode(x.node);
        break;
      case "tok":
        trailed = undefined;
        sToken(x.node, x.text, x.synthetic);
        break;
      case "comment":
        if (x.at === "leading") printLeadingComment(ctx, x);
        else if (x.at === "trailing")
          trailed = printTrailingComment(ctx, x, trailed);
        else ctx.comment(x.c);
        break;
      case "blank":
        blank?.();
        break;
      default:
        break;
    }
}

/** The `CustomSeq` of `node` for a generated rule: its entries built only when read. */
export function customSeq(ctx: StreamCtx<unknown>, node: number): CustomSeq {
  let entries: Entry[] | undefined;
  let kids: number[] | undefined;
  return {
    get entries() {
      entries ??= customEntries(ctx, node);
      return entries;
    },
    get kids() {
      kids ??= kidsOf(ctx, node);
      return kids;
    },
    print: (kid, body) => printKid(ctx, kid, body),
  };
}

/** The first child of `node` in field `name`; -1 when there is none. */
export function fieldChild(tree: FormatTree, node: number, name: string): number {
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (tree.fieldName(c) === name) return c;
  }
  return -1;
}

/** The `nth` anonymous child of `node` spelled `text` (a spec's `nth` token `text` binds to it); -1 when none. */
export function tokenChild(
  tree: FormatTree,
  node: number,
  text: string,
  nth: number,
): number {
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (!tree.named(c) && tree.kindName(c) === text && nth-- === 0) return c;
  }
  return -1;
}

/**
 * The items of a list reference: `children` (named, not comments, in no field; every item when the kind has no
 * fields at all) or the children in field `name`.
 */
export function listItems<O>(
  ctx: StreamCtx<O>,
  node: number,
  name: string,
  kindHasFields: boolean,
): number[] {
  const items = ctx.items(node);
  if (name !== "children")
    return items.filter((c) => ctx.tree.fieldName(c) === name);
  return kindHasFields
    ? items.filter((c) => ctx.tree.fieldName(c) === undefined)
    : items;
}

/** For each item but the last, the separator token `sep` after it; -1 where the source has none. */
export function separators(
  tree: FormatTree,
  node: number,
  items: readonly number[],
  sep: string,
): number[] {
  const seps: number[] = new Array(Math.max(items.length - 1, 0)).fill(-1);
  let seen = 0;
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (c === items[seen]) seen++;
    else if (
      seen > 0 &&
      seen <= seps.length &&
      seps[seen - 1] === -1 &&
      !tree.named(c) &&
      tree.kindName(c) === sep
    )
      seps[seen - 1] = c;
  }
  return seps;
}
