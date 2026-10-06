// What the generated formatters (`fmt.gen.ts`) and the two-pass reference (`reference.ts`) share: how a spec's
// references bind to a node's children, so both print the same source token for the same spec token; the
// entries of the flattened sequence; and the types of the hand-written rules a spec names.
import {
  close,
  closeChoice,
  closeDead,
  closeSpan,
  closeState,
  GROUP,
  IF_FLAT,
  INDENT,
  open,
  openChoice,
  openDead,
  openSpan,
  openState,
  SOFT,
  sBreakParent,
  sHardline,
  sJump,
  sLine,
  sLiteral,
  sText,
  sToken,
} from "../stream.js";
import {
  type CommentFacts,
  commentFacts,
  endsLine,
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
} from "../stream-format.js";
import { NO_NODE, type Tree } from "../../core/arena.js";
import { newlineBetween } from "../text.js";
import { type FormatTree, firstLeaf, nextLeaf, prevLeaf } from "../tree.js";

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
      /** A `text`'s spelling, printed as the emitter prints it: through `sLiteral`, whose line breaks are literal. */
      readonly literal?: true;
    }
  | { readonly e: "space" }
  | { readonly e: "hardline" }
  /** A space, or a line break where the enclosing group breaks (an `inOrder`'s `line` join). */
  | { readonly e: "line" }
  /** A child node. In the whole-document sequence it opens the node's range, which an `exit` closes. */
  | {
      readonly e: "child";
      readonly node: number;
      readonly kind: string;
      /** Printed by this custom rule in place of its own (`Node.via`); `parens` for the `ParensRule`. */
      readonly via?: string;
      /** The `ParensRule`'s mode (`Node.parens`). */
      readonly parens?: string;
    }
  | { readonly e: "exit" }
  /** A `tok(text).via(name)` of `node`: `token` its source token, undefined where the source has none. */
  | {
      readonly e: "tokVia";
      readonly token: number | undefined;
      readonly node: number;
      readonly via: string;
    }
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
  | { readonly e: "brackets"; readonly label: string; readonly via?: string }
  | {
      readonly e: "list";
      readonly items: readonly number[];
      readonly label: string;
    }
  | { readonly e: "lines"; readonly label: string }
  | { readonly e: "end" }
  /** After each item but the last: its separator token (-1: none in the source). */
  | { readonly e: "sep"; readonly tok: number }
  /** An item of a list with holes that is a hole, printed as `text`, anchored at its separator `tok`. */
  | { readonly e: "hole"; readonly tok: number; readonly text: string }
  /** After an item's separator or an item of `lines`: the source keeps a blank line there. */
  | { readonly e: "blank" }
  /** Only while the enclosing frame stays flat: a space, inserted beside a padded bracket. */
  | { readonly e: "ifFlat"; readonly text: string }
  /** After the last item, only while the list breaks: a separator the source has no trailing copy of. */
  | {
      readonly e: "ifBroken";
      readonly after: number;
      readonly text: string;
      /** It counts no width toward its line (see `sepBy`'s `imaginary`). */
      readonly imaginary?: true;
    }
  /**
   * Opens a `splitOn` run of `entry` frames, which an `end` closes, with the flags of the layout its conditions
   * chose.
   */
  | {
      readonly e: "split";
      readonly group: boolean;
      readonly indent: boolean;
      readonly first: "soft" | "line" | "hard" | undefined;
      readonly between: "line" | "hardline" | undefined;
      readonly fill: boolean;
    }
  /**
   * Opens an entry of a `splitOn` run: its `count` items with a `joint` between each two, then a `sep`; `grid`: its
   * words keep the source's lines; `keep`: its `keepLines` holds, so words on one line stay a space apart.
   */
  | {
      readonly e: "entry";
      readonly item: "adjacent" | "space" | "words";
      readonly count: number;
      readonly grid: boolean;
      readonly keep: boolean;
    }
  /**
   * Between two items of an entry: whether they print apart (a gap in the source, or a comment on either side),
   * the source has a line break there (`breaks`), or a break there drops to the enclosing indentation (`dedent`).
   */
  | {
      readonly e: "joint";
      readonly apart: boolean;
      readonly breaks: boolean;
      readonly dedent: boolean;
      /** A `space` item prints no space here: the item before is of a `tightAfter` kind. */
      readonly tight: boolean;
    }
  /** Opens a `splitOn` item in a group and an indent of its own, which an `end` closes. */
  | { readonly e: "wrap" }
  /** Opens a `group`, `indent` or `indentIfBreak` frame, which an `end` closes. */
  | { readonly e: "layout"; readonly kind: "group" | "indent" | "indentIfBreak"; readonly id?: string }
  /** A `softline` or `lineSuffixBoundary` (a `line` or `hardline` is its own entry). */
  | { readonly e: "doc"; readonly kind: "softline" | "lineSuffixBoundary" | "breakParent" };

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
 * A `tok(text).via(name)` rule: prints the token `text` of `node`, given its source token, or undefined where
 * the source has none.
 */
export type TokenRule<O = unknown> = (
  token: number | undefined,
  node: number,
  ctx: StreamCtx<O>,
) => void;

/**
 * What a `FrameRule` lays out: each callback prints its part as the spec has it, the brackets from the source or
 * synthetic where it has none, and the body as its idioms print it (a list: items, separators and lines, then the
 * node's dangling comments).
 */
export interface Frame {
  open(): void;
  body(): void;
  close(): void;
}

/** A `grpParen(body).via(name)` rule: lays out the bracket frame of `node`, empty or not. */
export type FrameRule<O = unknown> = (
  node: number,
  ctx: StreamCtx<O>,
  frame: Frame,
) => void;

/** A `custom` rule: prints `node`, its children through `ctx.print`. */
export type CustomRule<O = unknown> = (node: number, ctx: StreamCtx<O>) => void;

/**
 * The language's one `parens` rule: prints child `node` in the parenthesization mode its parent names
 * (`$.x.parens(mode)`), deciding by the language's precedence whether the parentheses show.
 */
export type ParensRule<O = unknown> = (node: number, mode: string, ctx: StreamCtx<O>) => void;

/** A `when(name)` or `pred(name, ...args)` condition: whether it holds for `node`, given `args`. */
export type PredicateRule<O = unknown> = (node: number, ctx: StreamCtx<O>, ...args: string[]) => boolean;

/** A `hook(name, ...args)`: the text it prints for `node`, given `args` ("" for none). */
export type TextRule<O = unknown> = (node: number, ctx: StreamCtx<O>, ...args: string[]) => string;

/** A `fill(words, ...)`'s words of `node`. */
export type WordsRule<O = unknown> = (node: number, ctx: StreamCtx<O>) => readonly string[];

/** What goes between two items of a `flow`: a line, a soft line, a hard line, or nothing. */
export type Gap = "line" | "softline" | "hardline" | "";
/** A `flow`'s `gap`: what goes between items `prev` and `next`. */
export type GapRule<O = unknown> = (prev: number, next: number, ctx: StreamCtx<O>) => Gap;

/** A `hook`'s or a `fill` word's text: "" prints nothing, and each line break in it is literal (prettier's replaceEndOfLine). */
export function printText(s: string): void {
  const parts = s.split("\n");
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      sLiteral(0, "\n");
      sBreakParent();
    }
    const p = parts[i] as string;
    if (p !== "") sText(p);
  }
}

function printGap(g: Gap): void {
  if (g === "line") sLine(0);
  else if (g === "softline") sLine(SOFT);
  else if (g === "hardline") sHardline();
}

/**
 * A `flow` (prettier's HTML print/children.js): `items` with `gap` between each two, a text-like item bare and any
 * other in a group of its own whose leading gap stays flat with the item before and whose trailing gap breaks with
 * it; a blank line after an item where `blank` holds; every gap broken where `breakAll`. It writes to the stream
 * itself rather than through a spec's sink, so only a spec writing to the stream uses it.
 */
export function printFlow<O>(
  ctx: StreamCtx<O>,
  items: readonly number[],
  gap: GapRule<O>,
  textLike: (c: number) => boolean,
  blank: (c: number) => boolean,
  breakAll: boolean,
): void {
  if (breakAll) {
    sBreakParent();
    for (let i = 0; i < items.length; i++) {
      const c = items[i] as number;
      if (i > 0) {
        const prev = items[i - 1] as number;
        const between = gap(prev, c, ctx);
        if (between !== "") {
          printGap(between);
          if (blank(prev)) sHardline();
        }
      }
      ctx.print(c);
    }
    return;
  }
  const groups: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const c = items[i] as number;
    const prev = i > 0 ? (items[i - 1] as number) : -1;
    const next = i + 1 < items.length ? (items[i + 1] as number) : -1;
    if (textLike(c)) {
      if (prev !== -1 && textLike(prev)) {
        const between = gap(prev, c, ctx);
        if (between !== "") {
          if (blank(prev)) {
            sHardline();
            sHardline();
          } else printGap(between);
        }
      }
      groups.push(-1);
      ctx.print(c);
      continue;
    }
    const prevBetween: Gap = prev === -1 ? "" : gap(prev, c, ctx);
    const nextBetween: Gap = next === -1 ? "" : gap(c, next, ctx);
    let leading: (() => void) | undefined;
    if (prevBetween !== "") {
      if (blank(prev)) {
        sHardline();
        sHardline();
      } else if (prevBetween === "hardline") sHardline();
      else if (textLike(prev)) leading = () => printGap(prevBetween);
      else {
        const ref = groups[groups.length - 1] as number;
        leading = () => {
          open(IF_FLAT, ref);
          sLine(SOFT);
          close();
        };
      }
    }
    let trailing: Gap = "";
    let after: (() => void) | undefined;
    if (nextBetween !== "") {
      if (blank(c)) {
        if (textLike(next))
          after = () => {
            sHardline();
            sHardline();
          };
      } else if (nextBetween === "hardline") {
        if (textLike(next)) after = () => sHardline();
      } else trailing = nextBetween;
    }
    open(GROUP);
    leading?.();
    groups.push(open(GROUP));
    ctx.print(c);
    printGap(trailing);
    close();
    close();
    after?.();
  }
}

/**
 * A language's imports, which `lines`'s `imports` option names: the key they sort by, the name each binds, and
 * what spells a use of a name. Unused-import detection is syntactic, like ktfmt's RedundantImportDetector: an
 * import is unused when no identifier outside `skip`, no name a comment refers to, and no implicit use matches
 * the name it binds.
 */
export interface ImportRule<O = unknown> {
  /** The key imports sort by, compared by code unit; equal keys keep their source order. */
  key(tree: FormatTree, imp: number, ctx: StreamCtx<O>): string;
  /** The name `imp` binds (its simple name or alias); undefined when it is never unused, like a wildcard. */
  binds(tree: FormatTree, imp: number): string | undefined;
  /** Kinds whose text uses the name it spells. */
  readonly identifiers: ReadonlySet<string>;
  /** The name identifier `text` spells, like Kotlin's without its backticks; the text itself by default. */
  name?(text: string): string;
  /** Kinds whose identifiers are no use: the imports themselves, a package header. */
  readonly skip: ReadonlySet<string>;
  /** The names comment `text` refers to, like a doc comment's links. */
  commentNames?(text: string): Iterable<string>;
  /** Whether `name` counts as used though no identifier spells it, like an operator convention's. */
  implicit?(name: string): boolean;
  /** Whether `imp` is dropped however it is used, like Kotlin's import of a name from the file's own package. */
  redundant?(tree: FormatTree, imp: number): boolean;
}

/** A run of import lists printed as one: its imports in print order, between the run's outer comments. */
export interface ImportBlock {
  readonly imports: readonly number[];
  readonly first: number;
  readonly last: number;
}

/** The identifier names and comment references of the whole file; identifiers under `rule.skip` spell no use. */
function usedNames<O>(ctx: StreamCtx<O>, rule: ImportRule<O>): Set<string> {
  const tree = ctx.tree;
  const used = new Set<string>();
  // A comment under a skipped kind, however deep (the parser may put the file's next doc comment inside the
  // import list), still refers to names.
  const stack: [number, boolean][] = [[tree.root, false]];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [n, skipped] = top;
    if (ctx.isComment(n)) {
      if (rule.commentNames) for (const name of rule.commentNames(tree.text(n))) used.add(name);
      continue;
    }
    const kind = tree.kindName(n);
    const skip = skipped || rule.skip.has(kind);
    if (!skip && rule.identifiers.has(kind)) {
      const text = tree.text(n);
      used.add(rule.name ? rule.name(text) : text);
    }
    for (let i = 0, count = tree.count(n); i < count; i++) stack.push([tree.child(n, i), skip]);
  }
  return used;
}

/** The texts of `node`'s leaves, in order. */
function leafTexts(tree: FormatTree, node: number, out: string[] = []): string[] {
  const count = tree.count(node);
  if (count === 0) out.push(tree.text(node));
  for (let i = 0; i < count; i++) leafTexts(tree, tree.child(node, i), out);
  return out;
}

/**
 * `items` with each run of consecutive `kind` items (import lists) folded into its first, which `blocks` maps to
 * the run's imports: sorted by `rule.key`, and, unless the `keepImports` option is set, without exact duplicates
 * or unused imports; a run left with none is dropped. A run with comments between its lists, or a broken list,
 * stays as written. An import with a comment before it is never dropped; one with only a comment after it goes
 * with that comment, as ktfmt drops an unused `import a.B // note`.
 */
export function importBlocks<O>(
  ctx: StreamCtx<O>,
  items: readonly number[],
  kind: string,
  rule: ImportRule<O>,
): { items: number[]; blocks: Map<number, ImportBlock> } {
  const tree = ctx.tree;
  const out: number[] = [];
  const blocks = new Map<number, ImportBlock>();
  const keep = (ctx.options as { readonly keepImports?: unknown }).keepImports === true;
  let used: Set<string> | undefined;
  const commented = (n: number) => ctx.leadingComments(n).length > 0 || ctx.trailingComments(n).length > 0;
  for (let i = 0; i < items.length; ) {
    const first = items[i] as number;
    if (tree.kindName(first) !== kind) {
      out.push(first);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < items.length && tree.kindName(items[j] as number) === kind) j++;
    const run = items.slice(i, j);
    i = j;
    const last = run[run.length - 1] as number;
    if (
      run.some(
        (l, k) =>
          ctx.isBroken(l) ||
          ctx.danglingComments(l).length > 0 ||
          (k > 0 && ctx.leadingComments(l).length > 0) ||
          (l !== last && ctx.trailingComments(l).length > 0),
      )
    ) {
      out.push(...run);
      continue;
    }
    const all = run.flatMap((l) => ctx.items(l));
    let imports = all
      .map((imp, at) => ({ imp, at, key: rule.key(tree, imp, ctx) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.at - b.at))
      .map((e) => e.imp);
    if (!keep) {
      used ??= usedNames(ctx, rule);
      const seen = new Set<string>();
      imports = imports.filter((imp) => {
        if (ctx.leadingComments(imp).length > 0) return true;
        const text = leafTexts(tree, imp).join(" ");
        if (seen.has(text)) return false;
        seen.add(text);
        if (rule.redundant?.(tree, imp) === true) return false;
        const name = rule.binds(tree, imp);
        return name === undefined || (used as Set<string>).has(name) || rule.implicit?.(name) === true;
      });
      if (imports.length === 0) {
        if (!commented(first) && !commented(last)) continue;
        // The run's comments need a place to stay.
        imports = all;
      }
    }
    out.push(first);
    blocks.set(first, { imports, first, last });
  }
  return { items: out, blocks };
}

/** Prints an `importBlocks` block: its imports one per line, between the comments around its run. */
export function printImports<O>(ctx: StreamCtx<O>, block: ImportBlock): void {
  printLeadingComments(ctx, block.first);
  for (let i = 0; i < block.imports.length; i++) {
    if (i > 0) sHardline();
    ctx.print(block.imports[i] as number);
  }
  printTrailingComments(ctx, block.last);
}

/** Prints `kid` between the comments attached to it: `body` in place of the kid, else the kid as its rule prints it. */
export function printKid(
  ctx: StreamCtx<unknown>,
  kid: number,
  body?: () => void,
): void {
  const comments = !ctx.ownsComments(kid);
  if (comments) printLeadingComments(ctx, kid);
  if (body) body();
  else if (ctx.tree.named(kid)) ctx.printNode(kid);
  else sToken(kid, ctx.tree.text(kid));
  if (comments) printTrailingComments(ctx, kid);
}

/** The first child of `node` in field `name`; -1 when there is none. */
export function fieldChild(tree: FormatTree, node: number, name: string): number {
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (tree.fieldName(c) === name) return c;
  }
  return -1;
}

/**
 * An item a `packWhenAllOf` list packs: one of `kinds`, or a `+` or `-` sign before one (`-1`, which a grammar
 * like javascript's parses as a unary expression, as prettier's signed numeric literal).
 */
export function packable(t: FormatTree, item: number, kinds: readonly string[]): boolean {
  if (kinds.includes(t.kindName(item))) return true;
  if (t.count(item) !== 2) return false;
  const sign = t.text(t.child(item, 0));
  return (sign === "+" || sign === "-") && kinds.includes(t.kindName(t.child(item, 1)));
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

/** The first of `listItems` in the `at`th stretch of the node's children between its `sep` tokens; -1 when none. */
export function splitChild<O>(
  ctx: StreamCtx<O>,
  node: number,
  name: string,
  sep: string,
  at: number,
  kindHasFields: boolean,
): number {
  const items = new Set(listItems(ctx, node, name, kindHasFields));
  const tree = ctx.tree;
  let stretch = 0;
  for (let i = 0, count = tree.count(node); i < count && stretch <= at; i++) {
    const c = tree.child(node, i);
    if (!tree.named(c) && tree.kindName(c) === sep) stretch++;
    else if (stretch === at && items.has(c)) return c;
  }
  return -1;
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

/** A hole's slot in `holeSlots`. */
export const HOLE = -1;

/**
 * A list with holes (`[1, , 2]`) as its slots: its items, and `HOLE` for each separator `sep` that follows the
 * node's start or another separator; with the separator after each slot (a hole's is its own), -1 where none.
 */
export function holeSlots(
  tree: FormatTree,
  node: number,
  items: readonly number[],
  sep: string,
): { slots: number[]; seps: number[] } {
  const slots: number[] = [];
  const seps: number[] = [];
  let seen = 0;
  let expecting = true;
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (c === items[seen]) {
      seen++;
      slots.push(c);
      seps.push(-1);
      expecting = false;
    } else if (!tree.named(c) && tree.kindName(c) === sep) {
      if (expecting) {
        slots.push(HOLE);
        seps.push(c);
      } else seps[seps.length - 1] = c;
      expecting = true;
    }
  }
  return { slots, seps };
}

/**
 * Thrown by a `bail(reason)` rule: `node` is input the formatter must not touch (Python 2), so the file stays as
 * written. The offset is for the message only, read off the `Tree` a `FormatTree` always is.
 */
export class Bail extends Error {
  constructor(tree: FormatTree, node: number, reason: string) {
    super(`${reason}: ${tree.kindName(node)} at ${(tree as unknown as Tree).start(firstLeaf(tree, node))}`);
  }
}

/** Whether `node`'s parent is of kind `kind` (a `parentIs` condition). */
export function parentIs(tree: FormatTree, node: number, kind: string): boolean {
  const p = tree.parent(node);
  return p !== -1 && tree.kindName(p) === kind;
}

/** Whether `holds` of every item before `node` among its parent's items (an `allBefore` condition). */
export function allBefore<O>(ctx: StreamCtx<O>, node: number, holds: (c: number) => boolean): boolean {
  const p = ctx.tree.parent(node);
  if (p === -1) return true;
  for (const c of ctx.items(p)) {
    if (c === node) return true;
    if (!holds(c)) return false;
  }
  return true;
}

/** Whether `holds` of the item just before `node` among its parent's items (a `prevItem` condition). */
export function prevItem<O>(ctx: StreamCtx<O>, node: number, holds: (c: number) => boolean): boolean {
  const p = ctx.tree.parent(node);
  if (p === -1) return false;
  const items = ctx.items(p);
  const i = items.indexOf(node);
  return i > 0 && holds(items[i - 1] as number);
}

/** Whether `holds` of `node`'s last item (a `lastItem` condition). */
export function lastItem<O>(ctx: StreamCtx<O>, node: number, holds: (c: number) => boolean): boolean {
  const items = ctx.items(node);
  const last = items[items.length - 1];
  return last !== undefined && holds(last);
}

/** Whether `node`'s field `name` (`children`: its `listItems`) holds a child, of `kind` if given (a `has` condition). */
export function hasChild<O>(
  ctx: StreamCtx<O>,
  node: number,
  name: string,
  kind: string | undefined,
  kindHasFields: boolean,
): boolean {
  const tree = ctx.tree;
  if (name === "children")
    return listItems(ctx, node, name, kindHasFields).some((c) => kind === undefined || tree.kindName(c) === kind);
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (tree.fieldName(c) === name && (kind === undefined || tree.kindName(c) === kind)) return true;
  }
  return false;
}

/** An entry of a `splitOn` run: its items in source order, and the separator token ending it (-1: none). */
export interface SplitEntry {
  readonly items: number[];
  sep: number;
}

/** A `splitOn` run: its entries, and the children of its `trail` kinds, which print after it. */
export interface SplitRun {
  readonly entries: SplitEntry[];
  readonly trail: number[];
}

/**
 * The items and tokens of `node` but comments and `except` and `trail` kinds, cut at each `sep` token, which ends the
 * entry before it; a last entry left empty (by a trailing separator, or no children at all) is dropped. With
 * `comments`, the node's dangling comments past its first item or separator and before its trail are items too.
 */
export function splitRun<O>(
  ctx: StreamCtx<O>,
  node: number,
  sep: string,
  except: readonly string[],
  trail: readonly string[],
  comments: boolean | "all" = false,
): SplitRun {
  const tree = ctx.tree;
  let entry: SplitEntry = { items: [], sep: -1 };
  const entries = [entry];
  const trailing: number[] = [];
  const dangling = comments ? ctx.danglingComments(node) : [];
  let started = comments === "all";
  const items = new Set(ctx.items(node));
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    const named = tree.named(c);
    if (named && ctx.isComment(c)) {
      if (started && trailing.length === 0 && dangling.includes(c)) entry.items.push(c);
      continue;
    }
    // A child the language leaves out of the node's items (a dropped kind, a recovered separator) prints nowhere.
    if (named ? !items.has(c) : ctx.drops(c)) continue;
    const kind = tree.kindName(c);
    if (except.includes(kind)) continue;
    if (trail.includes(kind)) trailing.push(c);
    else if (!named && kind === sep) {
      entry.sep = c;
      entries.push((entry = { items: [], sep: -1 }));
      started = true;
    } else {
      entry.items.push(c);
      started = true;
    }
  }
  if (entry.items.length === 0) entries.pop();
  return { entries, trail: trailing };
}

/** Whether an entry has several items (`many`), or a first item whose text starts with one of `startsWith`. */
export function someEntry(
  tree: FormatTree,
  entries: readonly SplitEntry[],
  many: boolean,
  startsWith: readonly string[],
): boolean {
  return entries.some(({ items }) => {
    if (many && items.length > 1) return true;
    const first = items[0];
    if (first === undefined || startsWith.length === 0) return false;
    const text = tree.text(first);
    return startsWith.some((s) => text.startsWith(s));
  });
}

/** Whether a line break lies between the end of `a` and the start of the later `b`. */
export function breaksBetween(tree: FormatTree, a: number, b: number): boolean {
  const after = nextLeaf(tree, a);
  return tree.lf(after) > 0 || newlineBetween(tree, after, firstLeaf(tree, b));
}

/**
 * Whether `node`'s nearest proper ancestor of one of `kinds` exists with no ancestor of a `stop` kind (`"*"`: of any
 * other kind) before it, and `holds` holds of it (an `ancestor` condition).
 */
export function ancestorWhere(
  tree: FormatTree,
  node: number,
  kinds: readonly string[],
  stop: readonly string[] | "*",
  holds: (a: number) => boolean,
): boolean {
  for (let p = tree.parent(node); p !== -1; p = tree.parent(p)) {
    const k = tree.kindName(p);
    if (kinds.includes(k)) return holds(p);
    if (stop === "*" || stop.includes(k)) return false;
  }
  return false;
}

/**
 * Whether the source text of `node`'s first child but comments (with `after`, its first after its first `after`
 * token), lowercased with `anyCase`, is one of `is` or starts with one of `prefix` (a `firstText` condition).
 */
export function firstTextIs<O>(
  ctx: StreamCtx<O>,
  node: number,
  after: string | undefined,
  is: readonly string[],
  prefix: readonly string[],
  anyCase: boolean,
): boolean {
  const tree = ctx.tree;
  let passed = after === undefined;
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    const named = tree.named(c);
    if (named && ctx.isComment(c)) continue;
    if (!passed) {
      passed = !named && tree.kindName(c) === after;
      continue;
    }
    const text = anyCase ? tree.text(c).toLowerCase() : tree.text(c);
    return is.includes(text) || prefix.some((p) => text.startsWith(p));
  }
  return false;
}

/**
 * Child `c` of an `inOrder`'s `hug`: after a space where its text up to its first forced line break fits (prettier's
 * conditionalGroup), else hanging on a line of its own, indented, as `hangAfter` prints any other child. A block
 * comment leading it on a line of its own keeps it hugged but, once it breaks, on the next line unindented, as
 * ktfmt puts it.
 */
export function printHugged<O>(ctx: StreamCtx<O>, c: number): void {
  const first = ctx.leadingComments(c)[0];
  const commented = first !== undefined && ctx.tree.lf(first) > 0 && !ctx.isLineComment(first);
  const d = openDead();
  let span: number;
  try {
    span = openSpan();
    ctx.print(c);
    closeSpan();
  } finally {
    closeDead(d);
  }
  openChoice(false);
  openState();
  if (commented) {
    open(GROUP);
    sLine(0);
    sJump(span);
    close();
  } else {
    sText(" ");
    sJump(span);
  }
  closeState();
  openState();
  open(GROUP);
  open(INDENT);
  sLine(0);
  sJump(span);
  close();
  close();
  closeState();
  closeChoice();
}

/** Of a `written` join, the `Nest` without its condition, which the generated code asks. */
export interface WrittenNest {
  readonly kind: string;
  readonly opens: readonly string[];
  readonly closes: readonly string[];
}

/**
 * Of a `written` join's `edit`: a token printed as nothing, the separation after it too (`drop`), or after
 * `before`; or a child the node before it printed already, as a custom rule laying out more than its own node
 * does, so neither it nor the separation before it prints (`covered`).
 */
export interface WrittenEdit {
  readonly drop?: boolean;
  readonly before?: string;
  readonly covered?: boolean;
}

/** A `written` join's `edit` rule: how source node `node` changes, or undefined where it prints as written. */
export type WrittenEditRule<O = unknown> = (node: number, ctx: StreamCtx<O>) => WrittenEdit | undefined;

/**
 * The children of `node` from child `from` on, each after the separation the source has before it (an `inOrder`'s
 * `written` join): a comment as `ctx.comment` prints it, a named child as its rule does, a token as written but
 * as `edit` changes it, and `nest`'s levels opened and closed between them.
 */
export function printWritten<O>(
  ctx: StreamCtx<O>,
  node: number,
  from = 0,
  nest?: WrittenNest,
  edit?: WrittenEditRule<O>,
): void {
  const t = ctx.tree;
  const token = (leaf: number) => {
    const e = edit?.(leaf, ctx);
    if (e?.drop) return;
    if (e?.before !== undefined) sText(e.before);
    sToken(leaf, t.text(leaf));
  };
  if (t.count(node) === 0) token(node);
  // The separation before the node's first token is its parent's to print; the file's first token has none.
  const own = firstToken(t, node);
  for (let i = from, count = t.count(node); i < count; i++) {
    const c = t.child(node, i);
    if (edit?.(c, ctx)?.covered) continue;
    const lead = nest !== undefined && t.kindName(c) === nest.kind ? t.text(firstLeaf(t, c)) : undefined;
    if (lead !== undefined && nest?.closes.includes(lead)) close();
    const first = firstToken(t, c);
    if (first !== NO_NODE && first !== own && !(edit !== undefined && edit(tokenBefore(t, first), ctx)?.drop))
      writtenGap(t, first);
    if (ctx.isComment(c)) ctx.comment(c);
    else if (t.named(c)) ctx.print(c);
    else token(c);
    if (lead !== undefined && nest?.opens.includes(lead)) open(INDENT);
  }
}

/** The leaf with text before `leaf`, or `NO_NODE` at the file's start. */
function tokenBefore(t: FormatTree, leaf: number): number {
  let prev = prevLeaf(t, leaf);
  while (prev !== NO_NODE && t.text(prev) === "") prev = prevLeaf(t, prev);
  return prev;
}

/** The first leaf of `node` with text, or `NO_NODE` where it has none. */
function firstToken(t: FormatTree, node: number): number {
  let leaf = firstLeaf(t, node);
  while (leaf !== NO_NODE && t.text(leaf) === "") leaf = nextLeaf(t, leaf);
  return leaf !== NO_NODE && within(t, node, leaf) ? leaf : NO_NODE;
}

/**
 * The source's separation before token `next` from the token before it, tokens with no text skipped: on one line,
 * its spaces (a tab counting one); across lines, at most two line breaks, those ending the token before counted,
 * then the column `next` starts at.
 */
function writtenGap(t: FormatTree, next: number): void {
  let prev = prevLeaf(t, next);
  let lf = t.lf(next);
  while (prev !== NO_NODE && t.text(prev) === "") {
    lf += t.lf(prev);
    prev = prevLeaf(t, prev);
  }
  // A node can span text no token covers, at its end (Swift's `\u{...}` past `u`): the separation starts past it.
  let span = prev;
  for (let p = t.parent(prev); prev !== NO_NODE && p !== NO_NODE && !within(t, p, next); p = t.parent(p)) span = p;
  const before = prev === NO_NODE ? "" : t.text(span);
  if (lf === 0) {
    const nl = before.lastIndexOf("\n");
    const end = prev === NO_NODE ? 0 : nl < 0 ? t.col(span) + before.length : before.length - nl - 1;
    if (t.col(next) > end) sText(" ".repeat(t.col(next) - end));
    return;
  }
  const ended = before.length - before.replace(/\n+$/, "").length;
  for (let k = Math.min(ended + lf, 2) - ended; k > 0; k--) sHardline();
  if (t.col(next) > 0) sText(" ".repeat(t.col(next)));
}

function within(t: FormatTree, node: number, leaf: number): boolean {
  for (let n = leaf; n !== NO_NODE; n = t.parent(n)) if (n === node) return true;
  return false;
}
