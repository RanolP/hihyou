import type { Language as Parser } from "../core/language.js";
import { identity, type Normalize } from "./check.js";
import type { CommentHandler, Comments } from "./comments.js";
import {
  breakParent,
  type Doc,
  fill,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  line,
  lineSuffix,
  softline,
  synthetic,
  text,
  token,
} from "./doc.js";
import type { Settings } from "./options.js";
import { lfAfter, newlineBetween, nextLineEmpty } from "./text.js";
import { type FormatTree, firstLeaf } from "./tree.js";

/** A grammar's vocabulary, generated from its `node-types.json` so that rules naming anything else fail to typecheck. */
export interface Grammar {
  /** Named node kinds that can appear in a tree. */
  readonly kinds: readonly string[];
  /** Anonymous tokens: punctuation and keywords. */
  readonly tokens: readonly string[];
  /** Each kind's fields; a kind without fields is absent. */
  readonly fields: { readonly [kind: string]: readonly string[] };
  /** The extras that are comments, which the formatter places as prettier places comments. */
  readonly comments: readonly string[];
}
type KindOf<G extends Grammar> = G["kinds"][number];
type TokenOf<G extends Grammar> = G["tokens"][number];
type FieldsOf<G extends Grammar, K> = K extends keyof G["fields"]
  ? G["fields"][K][number]
  : never;
type FieldOf<G extends Grammar> = FieldsOf<G, keyof G["fields"]>;
type CommentOf<G extends Grammar> = G["comments"][number];

/** What a rule passes down to the rule of a child it prints, as prettier's `print(path, args)` does. */
export type PrintArgs = Readonly<Record<string, unknown>>;

/** `O` is the language's options type (see `LanguageSpec`). A node is a handle into `tree`. */
export interface Ctx<O = unknown> {
  readonly tree: FormatTree;
  /** The options this call formats with: the language's defaults overridden by the caller's. */
  readonly options: O;
  /** `node` as its rule prints it, with the comments attached to it; `args` reach that rule. */
  print(node: number, args?: PrintArgs): Doc;
  /**
   * `node` as its rule prints it, without its own comments, for a rule that lays those out apart (prettier's
   * union aligns each member but not the member's comments); pass the result through `withComments`.
   */
  printBare(node: number, args?: PrintArgs): Doc;
  /**
   * `printed` with the comments attached to `node`, for a rule that prints a child itself instead of through
   * `print`: without it, those comments are lost.
   */
  withComments(node: number, printed: Doc): Doc;
  /** The children that carry meaning: named, and not comments. */
  items(node: number): number[];
  /** Comments inside `node` next to none of its items, printed one per line. */
  dangling(node: number): Doc[];
  hasDanglingLineComment(node: number): boolean;
  /**
   * Whether `node` has a leading line comment (`leadingLine`), or a trailing line comment on the line where
   * `node` starts (`trailingSameLine`).
   */
  hasComment(
    node: number,
    where: "leadingLine" | "trailingSameLine",
  ): boolean;
  isList(node: number): boolean;
  /** Every comment attached to `node`: before it, after it, and inside it next to none of its items. */
  comments(node: number): {
    readonly leading: readonly number[];
    readonly trailing: readonly number[];
    readonly dangling: readonly number[];
  };
  /** Whether comment `c` runs to the end of its line (see `LanguageSpec.lineComments`). */
  isLineComment(c: number): boolean;
}

/**
 * Prints one node. Rules are plain functions; the helpers below build the common shapes. `F` is the fields the
 * rule reads, so that a rule table can check them against the kind the rule is for.
 */
export interface Rule<F extends string = never, O = unknown> {
  (node: number, ctx: Ctx<O>, args?: PrintArgs): Doc;
  /** Type-only, never set: carries `F`, which a function type alone would not. */
  readonly reads?: readonly F[];
}

export interface Language<O = unknown> {
  readonly rules: ReadonlyMap<string, Rule<string, O>>;
  readonly lists: ReadonlySet<Rule<string, O>>;
  readonly comments: ReadonlySet<string>;
  /** Comment kinds that run to the end of the line, each with the prefix that marks it (see `LanguageSpec`). */
  readonly lineComments: ReadonlyMap<string, string>;
  readonly defaults: O;
  settings(options: O): Settings;
  /** The parser `check` reads both texts with; see `LanguageSpec`. */
  readonly parser: Parser;
  readonly atoms: ReadonlySet<string>;
  readonly normalize: Normalize;
  readonly layoutBlind: boolean;
  readonly printComment?: (comment: number, ctx: Ctx<O>) => Doc;
  readonly handleComment?: CommentHandler<O>;
  readonly printsOwnComments?: (node: number, ctx: Ctx<O>) => boolean;
  /** How `check` spells a comment before comparing; see `LanguageSpec`. */
  readonly comment: ((text: string) => string | readonly string[]) | undefined;
}

/**
 * What a language declares besides its rules. `O` is its options type, named as the tool its users configure
 * names them (prettier's `printWidth`, ruff's `line-length`), so resolved config passes through unchanged.
 */
export interface LanguageSpec<G extends Grammar, O> {
  /** Every option's value when the caller gives none: the tool's own defaults. */
  readonly defaults: O;
  /** The layout the core applies for `options`; `prettierSettings` and `ruffSettings` cover the two families. */
  readonly settings: (options: O) => Settings;
  /** The parser of this grammar, which `check` reads the input and the output with. */
  readonly parser: Parser;
  /**
   * Kinds `check` reads as one lexeme, whole, rather than leaf by leaf, so `normalize` sees the value a rule
   * respells in one piece (a string, whose quotes and escapes are separate leaves). A node that holds text of its
   * own besides its children (CSS's `1.5px`, whose only child is the unit) is read whole without being listed.
   */
  readonly atoms?: readonly KindOf<G>[];
  /**
   * What `check` compares instead of raw token text, so that rules may respell, insert and drop tokens without
   * changing meaning. The default compares text as is, which rejects any respelling.
   */
  readonly normalize?: Normalize;
  /**
   * `normalize` reads only each lexeme's node and text, never `at` nor the side's whole text, so `check` passes
   * an output whose code tokens have the input's texts, in order, without normalizing. The default `normalize`
   * is.
   */
  readonly layoutBlind?: boolean;
  /**
   * A comment as the formatter respells it, which `check` applies to both sides before comparing (ruff writes
   * `#x` as `# x`). The default compares comments as written. Several strings compare as several comments:
   * ruff joins trailing comments onto one line, where `# a  # b` reads back as one.
   */
  readonly comment?: (text: string) => string | readonly string[];
  /**
   * The comment kinds that run to the end of the line, so code never follows one on its line. A kind maps to the
   * prefix its line comments start with, because one kind can hold both forms (tree-sitter-json's `comment` is
   * `// ...` and `/* ... *\/`); `""` makes every comment of the kind a line comment (Python's `#`).
   */
  readonly lineComments: { readonly [K in CommentOf<G>]?: string };
  /**
   * A comment as printed, when it is not its source text (prettier re-indents a block comment whose lines all
   * start with `*`).
   */
  readonly printComment?: (comment: number, ctx: Ctx<O>) => Doc;
  /** Where a comment attaches when not where the core would put it (see `CommentHandler`). */
  readonly handleComment?: CommentHandler<O>;
  /**
   * Whether `node`'s rule prints the node's comments itself, through `ctx.withComments`, so they can go inside
   * something the rule wraps around them (prettier's willPrintOwnComments: a JSX element's parentheses).
   */
  readonly printsOwnComments?: (node: number, ctx: Ctx<O>) => boolean;
}

/** A list setting fixed by the rule, or read from the options of each call. */
export type ByOptions<O, T> = T | ((options: O) => T);

export interface ListOptions<G extends Grammar, O> {
  open: TokenOf<G>;
  close: TokenOf<G>;
  sep: TokenOf<G>;
  /** A space inside the brackets on one line (prettier's `bracketSpacing`). */
  pad?: ByOptions<O, boolean>;
  /** Stay broken when the input broke after the opening bracket (prettier's `objectWrap: "preserve"`). */
  keepExpanded?: ByOptions<O, boolean>;
  /** Pack items several to a line when every item is one of these kinds (prettier's number arrays). */
  fillIfAll?: readonly KindOf<G>[];
  /** Break when 2+ items are all lists of one kind with 2+ items each (prettier's matrix rule). */
  breakNestedLists?: boolean;
  /** Wrap each item in its own group, so each fits or breaks on its own. */
  groupItems?: boolean;
  /** A kept blank line either forces the list to break or shows only when it breaks anyway. */
  blankLines: "force" | "ifBroken";
  /** "always" breaks every non-empty list, one item per line (prettier's json-stringify). */
  expand?: "fit" | "always";
  /**
   * A separator after the last item when the list breaks (prettier's `trailingComma` in JSONC), inserted as a
   * synthetic token after the last item, which the language's `normalize` must declare optional.
   */
  trailingSep?: ByOptions<O, boolean>;
}

/**
 * One slot of a `seq`, each taking the first child not yet taken that it matches: an anonymous token by its text,
 * a child in a field, the first named child of a kind (for children in no field, such as the expression of a
 * `return_statement`), or the `nth` item (counted as `Ctx.items` counts, from 0). `space` prints a space.
 */
export type SeqPart<G extends Grammar> =
  | TokenOf<G>
  | { readonly field: FieldOf<G> }
  | { readonly kind: KindOf<G> }
  | { readonly nth: number }
  | { readonly space: true };

type FieldIn<P> = P extends { readonly field: infer F extends string }
  ? F
  : never;

export interface Helpers<G extends Grammar, O> {
  list(options: ListOptions<G, O>): Rule<never, O>;
  /** The parts in this order, as one group. */
  seq<const P extends readonly SeqPart<G>[]>(
    ...parts: P
  ): Rule<FieldIn<P[number]>>;
  /** Each item on its own line. */
  block(): Rule;
  verbatim(): Rule;
  field<F extends FieldOf<G>>(name: F): { readonly field: F };
  readonly space: { readonly space: true };
}

/**
 * A rule table whose every key is a kind of `G`, with a rule that reads only that kind's fields: a returned
 * object literal is not checked for excess keys, and a rule's own type does not know which kind it is for.
 */
type RuleTable<G extends Grammar, T, O> = {
  [K in keyof T]: K extends KindOf<G> ? Rule<FieldsOf<G, K>, O> : never;
};

export function defineLanguage<
  const G extends Grammar,
  O,
  T extends RuleTable<G, T, O>,
>(
  grammar: G,
  spec: LanguageSpec<G, O>,
  define: (
    h: Helpers<G, O>,
  ) => T & { [K in KindOf<G>]?: Rule<FieldsOf<G, K>, O> },
): Language<O> {
  const lists = new Set<Rule<string, O>>();
  const helpers: Helpers<G, O> = {
    list(o) {
      const rule = listRule(o);
      lists.add(rule);
      return rule;
    },
    seq: (...parts) => seqRule(parts),
    block: () => blockRule,
    verbatim: () => verbatimRule,
    field: (field) => ({ field }),
    space: { space: true },
  };
  const table: Partial<Record<string, Rule<string, O>>> = define(helpers);
  const rules = new Map<string, Rule<string, O>>();
  for (const [kind, rule] of Object.entries(table))
    if (rule) rules.set(kind, rule);
  return {
    rules,
    lists,
    comments: new Set(grammar.comments),
    lineComments: new Map(
      grammar.comments.flatMap((kind: CommentOf<G>): [string, string][] => {
        const prefix = spec.lineComments[kind];
        return prefix === undefined ? [] : [[kind, prefix]];
      }),
    ),
    defaults: spec.defaults,
    settings: spec.settings,
    parser: spec.parser,
    atoms: new Set(spec.atoms),
    normalize: spec.normalize ?? identity,
    layoutBlind: spec.layoutBlind ?? spec.normalize === undefined,
    ...(spec.printComment && { printComment: spec.printComment }),
    ...(spec.handleComment && { handleComment: spec.handleComment }),
    ...(spec.printsOwnComments && {
      printsOwnComments: spec.printsOwnComments,
    }),
    comment: spec.comment,
  };
}

const verbatimRule: Rule = (node, ctx) => token(node, ctx.tree.text(node));

const blockRule: Rule = (node, ctx) => [
  join(
    hardline,
    ctx.items(node).map((n) => ctx.print(n)),
  ),
  ctx.dangling(node),
];

type SeqMatcher =
  | { readonly space: true }
  | {
      readonly space: false;
      readonly literal: boolean;
      readonly is: (tree: FormatTree, c: number, items: readonly number[]) => boolean;
    };

const noItems: readonly number[] = [];

// Each part takes the first child no earlier part took, so a part may still match a child before an earlier part's.
function seqRule(parts: readonly SeqPart<Grammar>[]): Rule {
  const matchers = parts.map((part): SeqMatcher => {
    const named = (
      is: (tree: FormatTree, c: number, items: readonly number[]) => boolean,
    ) => ({ space: false, literal: false, is }) as const;
    if (typeof part === "string")
      return {
        space: false,
        literal: true,
        is: (tree, c) => !tree.named(c) && tree.kindName(c) === part,
      };
    if ("space" in part) return { space: true };
    if ("field" in part)
      return named((tree, c) => tree.fieldName(c) === part.field);
    if ("kind" in part)
      return named((tree, c) => tree.named(c) && tree.kindName(c) === part.kind);
    return named((_, c, items) => c === items[part.nth]);
  });
  const needsItems = parts.some((p) => typeof p === "object" && "nth" in p);
  return (node, ctx) => {
    const { tree } = ctx;
    const items = needsItems ? ctx.items(node) : noItems;
    const count = tree.count(node);
    const used: number[] = [];
    const docs: Doc[] = [];
    for (const m of matchers) {
      if (m.space) {
        docs.push(text(" "));
        continue;
      }
      let at = 0;
      while (
        at < count &&
        (!m.is(tree, tree.child(node, at), items) || used.includes(at))
      )
        at++;
      if (at === count) {
        docs.push([]);
        continue;
      }
      used.push(at);
      const child = tree.child(node, at);
      docs.push(m.literal ? token(child, tree.text(child)) : ctx.print(child));
    }
    return group(docs);
  };
}

// Prettier's array and object printers (language-js/print/array.js, object.js), as one parameterized helper.
function listRule<O>(o: ListOptions<Grammar, O>): Rule<never, O> {
  const fillKinds: ReadonlySet<string> = new Set(o.fillIfAll);
  const read = (v: ByOptions<O, boolean> | undefined, options: O) =>
    typeof v === "function" ? v(options) : v === true;
  return (node, ctx) => {
    const { tree } = ctx;
    const count = tree.count(node);
    const isToken = (c: number, kind: string) =>
      !tree.named(c) && tree.kindName(c) === kind;
    const tok = (kind: string) => {
      for (let i = 0; i < count; i++) {
        const c = tree.child(node, i);
        if (isToken(c, kind)) return token(c, tree.text(c));
      }
      return [];
    };
    const open = tok(o.open);
    const close = tok(o.close);
    const items = ctx.items(node);
    const first = items[0];
    if (first === undefined) {
      const dangling = ctx.dangling(node);
      if (dangling.length === 0) return group([open, close]);
      return group([
        open,
        indent([softline, join(hardline, dangling)]),
        ctx.hasDanglingLineComment(node) ? hardline : softline,
        close,
      ]);
    }

    const always = o.expand === "always";
    const shouldBreak =
      always ||
      (read(o.keepExpanded, ctx.options) &&
        newlineBetween(tree, firstLeaf(tree, node), firstLeaf(tree, first))) ||
      (o.breakNestedLists === true &&
        items.length > 1 &&
        items.every((item, i) => {
          const next = items[i + 1];
          return (
            ctx.isList(item) &&
            (next === undefined ||
              tree.kindName(next) === tree.kindName(item)) &&
            ctx.items(item).length > 1
          );
        })) ||
      ctx.hasDanglingLineComment(node);
    const blankAfter = (item: number) => !always && nextLineEmpty(tree, item);
    // Each item's separator, found in one pass: a lookup per item would be quadratic in a lockfile's objects.
    // `items` is `children` filtered in order, so one cursor walks both; `seps[i]` follows `items[i]`.
    const seps: (number | undefined)[] = [];
    let seen = 0;
    for (let i = 0; i < count; i++) {
      const c = tree.child(node, i);
      if (c === items[seen]) seen++;
      else if (seen > 0 && isToken(c, o.sep)) seps[seen - 1] ??= c;
    }
    const sep = (i: number) => {
      const c = seps[i];
      return c === undefined ? [] : token(c, tree.text(c));
    };

    const concise =
      !always &&
      items.length > 1 &&
      items.every(
        (item) =>
          fillKinds.has(tree.kindName(item)) &&
          !ctx.hasComment(item, "trailingSameLine"),
      );

    const contents: Doc[] = [];
    const listGroup = group(contents, shouldBreak);
    // A fill prints its items flat even in a broken list, so its trailing separator asks the list itself.
    const last = items.at(-1) ?? first;
    const trailing = read(o.trailingSep, ctx.options)
      ? ifBreak(synthetic(last, o.sep), [], concise ? listGroup : undefined)
      : [];

    const body: Doc = concise
      ? fill(
          items.flatMap((item, i): Doc[] => {
            const next = items[i + 1];
            if (next === undefined) return [[ctx.print(item), trailing]];
            const separator = blankAfter(item)
              ? [hardline, hardline]
              : ctx.hasComment(next, "leadingLine")
                ? hardline
                : line;
            return [[ctx.print(item), sep(i)], separator];
          }),
        )
      : items.map((item, i) => {
          const printed = o.groupItems
            ? group(ctx.print(item))
            : ctx.print(item);
          if (i === items.length - 1) return [printed, trailing];
          const blank = blankAfter(item)
            ? o.blankLines === "force"
              ? hardline
              : softline
            : [];
          return [printed, sep(i), line, blank];
        });
    const pad = read(o.pad, ctx.options) ? line : softline;
    contents.push(open, indent([pad, body]), pad, close);
    return listGroup;
  };
}

/** Prints `node` with its comments, placed as prettier's printComments places them (main/comments/print.js). */
export function printWithComments(
  node: number,
  printed: Doc,
  comments: Comments,
  ctx: Ctx,
  isLine: (c: number) => boolean,
  comment: (c: number) => Doc = (c) => {
    const t = ctx.tree.text(c);
    return token(c, isLine(c) ? t.trimEnd() : t);
  },
): Doc {
  const attached = comments.of(node);
  if (!attached) return printed;
  const { tree } = ctx;

  const leading = attached.leading.map((c): Doc => {
    const lf = lfAfter(tree, c);
    const after = isLine(c)
      ? hardline
      : lf === 0
        ? text(" ")
        : tree.lf(c) > 0
          ? hardline
          : line;
    return [comment(c), after, lf >= 2 ? hardline : []];
  });

  type Previous = { line: boolean; suffix: boolean };
  // `suffix`: printed at the end of the line, where the next trailing comment must follow it.
  const place = (
    c: number,
    lineComment: boolean,
    previous: Previous | undefined,
  ): { doc: Doc; suffix: boolean } =>
    (previous?.suffix && !previous.line) || tree.lf(c) > 0
      ? {
          doc: lineSuffix([
            hardline,
            tree.lf(c) >= 2 ? hardline : [],
            comment(c),
          ]),
          suffix: true,
        }
      : lineComment || previous?.suffix
        ? {
            doc: [
              lineSuffix([text(" "), comment(c)]),
              lineComment ? breakParent : [],
            ],
            suffix: true,
          }
        : { doc: [text(" "), comment(c)], suffix: false };

  let previous: Previous | undefined;
  const trailing = attached.trailing.map((c): Doc => {
    const lineComment = isLine(c);
    const { doc, suffix } = place(c, lineComment, previous);
    previous = { line: lineComment, suffix };
    return doc;
  });
  return [leading, printed, trailing];
}
