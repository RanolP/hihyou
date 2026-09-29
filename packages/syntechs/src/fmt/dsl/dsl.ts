// The formatter DSL: a language's layout written per node kind, in two independent parts.
//
//   structure  what a node prints, in order: its source tokens, its children, spaces, and idioms such as
//              `grpBrace(sepBy(",", $.children))`. Flattened into a token sequence (`reference.ts`'s
//              `flatten`) that says nothing about where lines break.
//   wrapping   where that sequence breaks: groups, fill, and the break policy of each bracket or list frame,
//              keyed by node kind and applied over the node's range of the sequence (`reference.ts`'s `wrap`).
//
// The two are independent passes over the whole document: flatten builds one sequence for the whole token
// tree, then wrapping runs over it, node range by node range. `generate.node.ts` compiles a spec ahead of time
// into straight-line stream calls (`emit.ts`), fusing the two passes into one per node; a test holds the fused
// code to the two-pass reference, output and anchors.
import type { Grammar } from "../rules.js";
import type { DocCommentStyle } from "./doc-comment.js";
import type { NormalizerName } from "./normalizers.js";

/** What node-types.json says fills a field or the children in no field (see the bundle's `fieldTypes`). */
export interface Slot {
  readonly required: boolean;
  readonly multiple: boolean;
  readonly types: readonly string[];
}

/** A bundle's `grammar`, with the slots the DSL types `$` from. */
export interface DslGrammar extends Grammar {
  readonly fieldTypes: {
    readonly [kind: string]: { readonly [field: string]: Slot };
  };
  readonly childTypes: { readonly [kind: string]: Slot };
}

type KindOf<G extends Grammar> = G["kinds"][number];
type TokenOf<G extends Grammar> = G["tokens"][number];

// ---- IR: what a spec is once called, plain data ----

/**
 * A field of the node, or (`name` "children") its children in no field; `at`: the one at that index among them,
 * or with `split`, the first of them in the `at`th stretch of the node between its `split` tokens; `via`: printed
 * by that custom rule in place of its own.
 */
export interface Ref {
  readonly t: "ref";
  readonly name: string;
  readonly at?: number;
  readonly split?: string;
  readonly via?: string;
  /** Printed by the language's `ParensRule` in mode `parens` (`Node.parens`), in place of its own rule. */
  readonly parens?: string;
  /** A list's children from index `from` on (`.from(i)`). */
  readonly from?: number;
}

export type Cond =
  | boolean
  | {
      readonly t: "option";
      readonly key: string;
      readonly op: "truthy" | "is" | "isNot";
      readonly value?: unknown;
    }
  /** The node's parent is of kind `kind`. */
  | { readonly t: "parent"; readonly kind: string }
  /** The hand-written `PredicateRule` `name` (see `runtime.ts`), asked of the node (`when(name)`). */
  | { readonly t: "rule"; readonly name: string }
  | PredCond
  | LogicCond
  | SplitCond
  | FirstTextCond
  | { readonly t: "ancestor"; readonly kinds: readonly string[]; readonly stop: readonly string[] | "*"; readonly holds: Cond };

/**
 * The hand-written `PredicateRule` `name`, asked of the node with `args` (`pred(name, ...args)`): a query the
 * grammar cannot state, parameterized so one predicate serves many kinds, like where the node sits once
 * parentheses are seen through.
 */
export interface PredCond {
  readonly t: "pred";
  readonly name: string;
  readonly args: readonly string[];
}

/**
 * The source text of the node's first child but comments (with `after`, of its first child after its first `after`
 * token), lowercased with `anyCase`, is one of `is` or starts with one of `prefix` (`firstText`): what a child names,
 * like the property a CSS declaration sets.
 */
export interface FirstTextCond {
  readonly t: "firstText";
  readonly after?: string;
  readonly is: readonly string[];
  readonly prefix: readonly string[];
  readonly anyCase: boolean;
}

/**
 * Conditions on a `splitOn` run, valid only inside one (its `keepLines` and `layout`): it has `n` entries
 * (`entryCount`); an entry has several items (`many`) or a first item whose text starts with one of `startsWith`
 * (`anyEntry`).
 */
export type SplitCond =
  | { readonly t: "entryCount"; readonly n: number }
  | { readonly t: "anyEntry"; readonly many: boolean; readonly startsWith: readonly string[] };

/** Conditions on where the node sits and what it holds, and their negation and combinations. */
export type LogicCond =
  /** The node is in its parent's field `name` (`fieldIs`). */
  | { readonly t: "field"; readonly name: string }
  /** The node's field `name` (`children`: its children in no field) holds a child, of `kind` if given (`has`). */
  | { readonly t: "has"; readonly name: string; readonly kind?: string }
  /** The node holds no item and no dangling comment (`isEmpty`). */
  | { readonly t: "empty" }
  | { readonly t: "not"; readonly c: Cond }
  | { readonly t: "all" | "any"; readonly cs: readonly Cond[] }
  /** The node is of one of `kinds` (`kindIs`). */
  | { readonly t: "kind"; readonly kinds: readonly string[] }
  /** `c` holds of every item (named, not a comment) before the node among its parent's (`allBefore`). */
  | { readonly t: "allBefore"; readonly c: Cond }
  /**
   * `c` holds of the item just before the node among its parent's (`prevItem`), or of the node's own last item
   * (`lastItem`); false where there is none.
   */
  | { readonly t: "prevItem" | "lastItem"; readonly c: Cond }
  /** The node's source text spans more than one line (`spansLines`). */
  | { readonly t: "spansLines" };

/**
 * Which consecutive entries of an `inOrder` a spacing rule applies to: those after an entry of a kind (a token by
 * its spelling) in `after`, those before one in `before`, or, while `when` holds for the node, all of them.
 */
export interface Pairs {
  readonly after?: readonly string[];
  readonly before?: readonly string[];
  readonly when?: Cond;
}

/** What goes between two entries of an `inOrder` no spacing rule claims (see `inOrder`). */
export type Join = "none" | "space" | "gap" | "line";

export type Tree =
  /** A source token; `via`: printed by that token rule (`tok(text).via(name)`), present or not. */
  | { readonly t: "tok"; readonly text: string; readonly via?: string }
  | Ref
  | { readonly t: "opt"; readonly ref: Ref; readonly then: Tree }
  | { readonly t: "space" }
  | { readonly t: "seq"; readonly parts: readonly Tree[] }
  | {
      readonly t: "brackets";
      readonly open: string;
      readonly close: string;
      readonly pad: Cond;
      readonly body: Tree;
      /** The frame's name for the kind's wrapping rule (see `Wrap.frames`). */
      readonly label: string;
      /** The frame is laid out by this `FrameRule` (`grpParen(body).via(name)`) in place of the wrapping rule. */
      readonly via?: string;
    }
  | {
      readonly t: "sepBy";
      readonly sep: string;
      readonly list: Ref;
      readonly trailing: Cond;
      /** What a hole prints as (see `sepBy`'s `holes`); undefined: the list has none. */
      readonly holes?: string;
      /** A blank line is kept when it follows an item's separator, not the item (see `sepBy`). */
      readonly blankAfterSep?: true;
    }
  /**
   * `attach`: the field whose children print with the next item, before it; `blank`: a blank line before each item
   * but the first where it holds of the item; `follow`: an item where it holds goes on the next line, indented
   * (see `lines`).
   */
  | {
      readonly t: "lines";
      readonly list: Ref;
      readonly attach?: string;
      readonly blank?: Cond;
      readonly follow?: Cond;
      readonly tokens?: true;
      /** Each run of consecutive `kind` items prints as one import block by the `ImportRule` `via` (see `lines`). */
      readonly imports?: { readonly kind: string; readonly via: string };
    }
  | {
      readonly t: "inOrder";
      readonly join: Join;
      readonly tight?: Pairs;
      readonly spaceWhen?: Pairs;
      /** Named children print as their source text, but those of a kind in `except`. */
      readonly verbatim?: { readonly except: readonly string[] };
      /** Children of these kinds (tokens by their spelling) print nothing, as if absent. */
      readonly skip?: readonly string[];
      /** A line break between the pairs this claims, before `tight`, `spaceWhen` and `join` are asked. */
      readonly hardWhen?: Pairs;
      /** The child after a token of these goes after a line, indented, in a group of its own (a hanging break). */
      readonly hangAfter?: readonly string[];
      /** Of the child after a `hangAfter` token: where it holds, the child follows a space instead of hanging. */
      readonly hug?: Cond;
      /** A child of these kinds goes on a line of its own, indented. */
      readonly lineBefore?: readonly string[];
      /** The children between a `{` and its `}` go one per line, indented; `{}` holding none stays `{}`. */
      readonly braces?: boolean;
    }
  | { readonly t: "verbatim" }
  /** The node's source text through normalizer `fn` (`normalizers.ts`) where `when` holds, else as written. */
  | { readonly t: "text"; readonly fn: NormalizerName; readonly when: Cond }
  | { readonly t: "custom"; readonly name: string }
  /**
   * `tok(text).synth(when)` or `tok(text).andThen(f)`: the node's token `text`, with `then` printed where it
   * shows (`self` in it marks the token). Without `synth`, it shows where the source has it. With `synth`, it
   * shows exactly where `when` holds: the source's own, or a synthetic one where the source has none (a zero-width
   * token, such as an inserted `;`, counting as none); where `when` fails, the source's prints as nothing.
   */
  | { readonly t: "tokIf"; readonly text: string; readonly synth?: Cond; readonly then: Tree }
  | { readonly t: "self" }
  /** Where `when` holds, the node is input the formatter must not touch, and the file stays as written (`Bail`). */
  | { readonly t: "bail"; readonly reason: string; readonly when: Cond }
  | SplitOn
  /** `then` where `when` holds of the node, else `else`. */
  | { readonly t: "either"; readonly when: Cond; readonly then: Tree; readonly else: Tree }
  /** The node's token `text` respelled by normalizer `fn` (`normalizers.ts`), where the source has it. */
  | { readonly t: "spell"; readonly text: string; readonly fn: NormalizerName }
  /** `body` in a layout frame of kind `kind`; a `group`'s `id` names it, an `indentIfBreak`'s the group it follows. */
  | { readonly t: "layout"; readonly kind: LayoutKind; readonly id?: string; readonly body: Tree }
  /** A line break of kind `kind` (see `line`, `softline`, `hardline`, `lineSuffixBoundary`). */
  | { readonly t: "doc"; readonly kind: DocKind };

/** A layout frame: a group, an indent, or an indent only while the group `id` breaks. */
export type LayoutKind = "group" | "indent" | "indentIfBreak";
/** A line: a space or break, nothing or a break, always a break, or where pending line-end comments flush. */
export type DocKind = "line" | "softline" | "hardline" | "lineSuffixBoundary" | "breakParent";

/** How a `splitOn` entry prints its items: side by side, a space between, or as `words`. */
export type SplitItem =
  | { readonly t: "adjacent" }
  | { readonly t: "space" }
  /**
   * Packed several to a line in a group of their own, items the source wrote without a gap staying joined; with
   * `keepLines`, one line per source line once the source breaks between any two.
   */
  | { readonly t: "words"; readonly keepLines: Cond };

/** Where a `splitOn` run breaks: flags on its entries, or a choice between two layouts. */
export type SplitLayout =
  | {
      /** The entries are one group. */
      readonly group?: boolean;
      /** Indented, from a break before the first (`first`) onward. */
      readonly indent?: boolean;
      /**
       * Before the first entry: a line break only where the group breaks, else nothing (`soft`) or a space
       * (`line`); or always (`hard`).
       */
      readonly first?: "soft" | "line" | "hard";
      /** Between entries: a space unless the group breaks (`line`), or a line break (`hardline`); else nothing. */
      readonly between?: "line" | "hardline";
      /** Entries pack several to a line. */
      readonly fill?: boolean;
    }
  | { readonly when: Cond; readonly then: SplitLayout; readonly else: SplitLayout };

/**
 * The node's children but comments and `except` kinds, cut into entries at each `sep` token, which prints at the
 * end of the entry before it; then each child of a `trail` kind, after a space.
 */
export interface SplitOn {
  readonly t: "splitOn";
  readonly sep: string;
  readonly except: readonly string[];
  readonly trail: readonly string[];
  readonly item: SplitItem;
  /** Each named item where this holds of it prints in a group and an indent of its own. */
  readonly wrapItem: Cond;
  /** The last entry's separator: the source's is dropped, and one prints only while the enclosing group breaks. */
  readonly trailing: boolean;
  readonly layout: SplitLayout;
}

/** How one bracket or list frame of a node breaks. */
export interface FrameWrap {
  /**
   * Pack the list's items several to a line when every item is one of these kinds, or a `+`/`-` sign before one
   * (prettier's number arrays).
   */
  readonly packWhenAllOf?: readonly string[];
  /** Break the list when 2+ items are all lists of one kind with 2+ items each (prettier's matrix rule). */
  readonly breakMatrix?: boolean;
  /** Each item of the list is a group of its own, staying flat or breaking on its own. */
  readonly itemsAsGroups?: boolean;
  /** Keep the list broken when the source broke after its opening bracket (prettier's `objectWrap: "preserve"`). */
  readonly keepExpanded?: Cond;
  /**
   * "always" breaks every non-empty list, one item per line (prettier's json-stringify), and every bracket idiom
   * around anything but a list (CSS's blocks).
   */
  readonly expand?: "fit" | "always";
  /**
   * A kept blank line between items forces the list to break, or shows only when it breaks anyway (default).
   * Between `lines`, which always break, either value keeps it, and leaving it unset drops it.
   */
  readonly blankLines?: "force" | "ifBroken";
  /** Break the list where this holds of the node. */
  readonly breakWhen?: Cond;
}

/**
 * A node kind's wrapping, over the node's range of the sequence: any kind, whatever its structure. The frame
 * options at the top apply to every frame of the node that `frames` does not name.
 */
export interface Wrap extends FrameWrap {
  /** The node's output is one group, which stays on one line or breaks as a unit. */
  readonly group?: boolean;
  /**
   * Per frame, its own options in place of the top-level ones. A frame is named by the field it lays out
   * (`children` for the children in no field): a list idiom by its list, a bracket idiom by the field its body
   * is, holds or lists, and `body` when the body is anything else. A kind with two lists names both here.
   */
  readonly frames?: { readonly [label: string]: FrameWrap };
}

/** The options `w` gives its node's frame `label`. */
export const frameWrap = (w: Wrap, label: string): FrameWrap =>
  w.frames?.[label] ?? w;

/** A spec as data: each kind's structure tree and wrapping rule. */
export interface FormatIR {
  readonly structure: { readonly [kind: string]: Tree };
  readonly wrapping: { readonly [kind: string]: Wrap };
  readonly unknown?: "bail";
  /** Doc comments of this style reflowed (doc-comment.ts); other comments print as written. */
  readonly docComment?: DocCommentStyle;
}

// ---- the typed surface: brands only the typecheck sees ----

declare const brand: unique symbol;
/** An idiom's output; `T` says what it holds, so a spec's tokens and options are checked through it. */
export interface Piece<T> {
  readonly [brand]: T;
}
/** A child node, printed as its own rule prints it, with its comments. */
export interface Node extends Piece<"node"> {
  /**
   * The child printed by the custom rule `name` (a `CustomRule`, given the child) in place of its own rule, with
   * its comments: a hand-written layout at one position, such as a parenthesization its parent decides.
   */
  via(name: string): Node;
  /**
   * The child printed by the language's one `ParensRule` (see `runtime.ts`) in mode `mode`, with its comments: the
   * parentheses its parent asks for, such as ruff's `Parenthesize::IfBreaks`, which the language's precedence decides.
   */
  parens(mode: string): Node;
}
/** Several children, which only a list idiom (`sepBy`, `lines`) lays out, or one of them by index. */
export interface List extends Piece<"list"> {
  /** The `i`th of the children, absent when there are fewer. */
  at(i: number): Option<Node>;
  /**
   * The children cut at each `sep` token of the node, for a child known only by its place among them, like a
   * slice's bounds: `.at(i)` is the first one in the `i`th stretch.
   */
  split(sep: string): { at(i: number): Option<Node> };
  /** The children from the `i`th on, for a list idiom over all but the first few. */
  from(i: number): List;
}
/** A child that may be absent: `andThen` prints what `f` makes of it when present, and nothing otherwise. */
export interface Option<A> {
  andThen<T>(f: (a: A) => T): Piece<{ opt: T }>;
}

type RefOf<S> = S extends { readonly multiple: true }
  ? List
  : S extends { readonly required: true }
    ? Node
    : Option<Node>;

/** `$` of kind `K`: each field of `K` as a node, an Option or a list, and `children`, the children in no field. */
export type Fields<G extends DslGrammar, K> = (K extends keyof G["fieldTypes"]
  ? { readonly [F in keyof G["fieldTypes"][K]]: RefOf<G["fieldTypes"][K][F]> }
  : unknown) &
  (K extends keyof G["childTypes"]
    ? { readonly children: RefOf<G["childTypes"][K]> }
    : unknown);

/** A condition on the options a call formats with. */
export interface OptionCond<K, V> {
  readonly t: "option";
  readonly key: K;
  readonly value?: V;
}
/** A condition a hand-written predicate decides (`when`). */
export interface RuleCond {
  readonly t: "rule";
  readonly name: string;
}
export type CondOf<O> =
  | boolean
  | RuleCond
  | { [K in keyof O & string]: OptionCond<K, O[K]> }[keyof O & string];

/** What a structure rule returns: the grammar's tokens, children, idioms, and arrays of them (sequences). */
export type TokenTree<G extends Grammar, O> =
  | TokenOf<G>
  | Node
  | Piece<"space">
  | Piece<"lines">
  | Piece<"inOrder">
  | Piece<{ inOrder: KindOf<G> | TokenOf<G>; cond: CondIn<G, O> }>
  | Piece<{ tok: TokenOf<G> }>
  | Piece<{ opt: TokenTree<G, O> }>
  | Piece<{ brackets: TokenTree<G, O>; pad: CondOf<O> }>
  | Piece<{ sepBy: TokenOf<G>; trailing: CondOf<O> }>
  | Piece<{ tokIf: TokenOf<G>; synth: CondIn<G, O>; then: TokenTree<G, O> }>
  | Piece<"self">
  | Piece<{ bail: CondIn<G, O> }>
  | Piece<{ splitOn: KindOf<G> | TokenOf<G>; cond: CondIn<G, O> }>
  | Piece<{
      either: CondIn<G, O>;
      then: TokenTree<G, O> | Text<G, O> | readonly [Piece<"doc">, Text<G, O>];
      else: TokenTree<G, O> | Text<G, O>;
    }>
  | Piece<{ spell: TokenOf<G> }>
  | Piece<"doc">
  | readonly TokenTree<G, O>[];

/** `tok(text).synth(when)`'s and `tok(text).andThen(f)`'s output. */
export type TokIf<S, W, T> = Piece<{ tokIf: S; synth: W; then: T }>;

/** A rule that prints the whole node: `verbatim` or `custom`. */
type Whole = Piece<"whole">;

/** A condition on where the node sits (`parentIs`). */
export interface ParentCond<K> {
  readonly t: "parent";
  readonly kind: K;
}
export interface FieldCond {
  readonly t: "field";
  readonly name: string;
}
export interface HasCond<K> {
  readonly t: "has";
  readonly name: string;
  readonly kind?: K;
}
export interface EmptyCond {
  readonly t: "empty";
}
export interface NotCond<C> {
  readonly t: "not";
  readonly c: C;
}
export interface AllCond<C> {
  readonly t: "all" | "any";
  readonly cs: readonly C[];
}
export interface KindCond<K> {
  readonly t: "kind";
  readonly kinds: readonly K[];
}
export interface AllBeforeCond<C> {
  readonly t: "allBefore";
  readonly c: C;
}
export interface ItemCond<C> {
  readonly t: "prevItem" | "lastItem";
  readonly c: C;
}
export interface SpansLinesCond {
  readonly t: "spansLines";
}
/** Every condition, checked against the grammar's kinds and the options. */
export type CondIn<G extends Grammar, O> =
  | CondOf<O>
  | ParentCond<KindOf<G>>
  | FieldCond
  | HasCond<KindOf<G>>
  | EmptyCond
  | NotCond<CondIn<G, O>>
  | AllCond<CondIn<G, O>>
  | KindCond<KindOf<G>>
  | AllBeforeCond<CondIn<G, O>>
  | ItemCond<CondIn<G, O>>
  | SpansLinesCond
  | SplitCond
  | FirstTextCond
  | PredCond
  | AncestorCond<KindOf<G>, CondIn<G, O>>;

/**
 * The nearest ancestor of one of `kinds`, met before any of a `stop` kind (`"*"`: before any other kind, so only the
 * parent), is one where `holds` holds (`ancestor`).
 */
export interface AncestorCond<K, C> {
  readonly t: "ancestor";
  readonly kinds: readonly K[];
  readonly stop: readonly K[] | "*";
  readonly holds: C;
}

/** `text`'s output, its `when` checked against the grammar's kinds and the options. */
type Text<G extends Grammar, O> = Piece<{ text: CondIn<G, O> }>;

type FrameWrapOf<G extends Grammar, O> = Omit<
  FrameWrap,
  "packWhenAllOf" | "keepExpanded" | "breakWhen"
> & {
  readonly packWhenAllOf?: readonly KindOf<G>[];
  readonly keepExpanded?: CondOf<O>;
  readonly breakWhen?: CondIn<G, O>;
};

/** The names a frame of kind `K` can have: its fields, `children`, and `body`. */
type FrameName<G extends DslGrammar, K> =
  | "body"
  | (K extends keyof G["fieldTypes"] ? keyof G["fieldTypes"][K] & string : never)
  | (K extends keyof G["childTypes"] ? "children" : never);

type WrapOf<G extends DslGrammar, O, K> = FrameWrapOf<G, O> & {
  readonly group?: boolean;
  readonly frames?: { readonly [F in FrameName<G, K>]?: FrameWrapOf<G, O> };
};

export interface FormatSpec<G extends DslGrammar, O> {
  readonly structure: {
    readonly [K in KindOf<G>]?: ($: Fields<G, K>) => TokenTree<G, O> | Whole | Text<G, O>;
  };
  readonly wrapping?: { readonly [K in KindOf<G>]?: WrapOf<G, O, K> };
  /**
   * `"bail"`: a kind with no rule here that has named children leaves the file unformatted, rather than printing
   * as written; for a spec still growing its rules, where the source's layout of an unhandled node is not the
   * formatter's.
   */
  readonly unknown?: "bail";
  /** Reflows the doc comments of this style to the print width, keeping their code, lists and tags as blocks. */
  readonly docComment?: DocCommentStyle;
}

// ---- builder ----

const piece = <T>(tree: Tree) => tree as unknown as Piece<T>;

/** A space. */
export const space: Piece<"space"> = piece({ t: "space" });

/** The node's source text as one token. */
export const verbatim: Whole = piece({ t: "verbatim" });

/**
 * The node's source text as one token, respelled by the normalizer `fn` (`normalizers.ts`, which says what options
 * each reads); with `when`, only where it holds, and as written elsewhere. For a spelling the layout canonicalizes:
 * a number, a keyword's case, a string's quotes.
 */
export const text = <const W = never>(fn: NormalizerName, when?: W): Piece<{ text: W }> =>
  piece({ t: "text", fn, when: when === undefined ? true : plain(when) });

/** The node's parent is of kind `kind`: a `text` rule's `when`, for a spelling only some parents canonicalize. */
export const parentIs = <const K extends string>(kind: K): ParentCond<K> => ({ t: "parent", kind });

/**
 * The hand-written rule `name` (a `CustomRule`, see `runtime.ts`) prints the node, its structure and its wrapping
 * both, reaching its children through `ctx.print`; the generated module takes it as a parameter.
 */
export const custom = (name: string): Whole => piece({ t: "custom", name });

/**
 * `tok(text).via(name)`: the node's token `text`, printed by the hand-written `TokenRule` `name` (see
 * `runtime.ts`), given that token or undefined where the source has none, and the node. For a token the layout
 * inserts, drops or respells, such as JS's `;` under `semi`.
 */
export const tok = <const S extends string>(text: S) => ({
  via: (name: string) => piece<{ tok: S }>({ t: "tok", text, via: name }),
  ...tokIf<S, false>(text, undefined),
  /**
   * The token exactly where `when` holds: the source's own, or a synthetic one where the source has none (a
   * zero-width token counting as none); where `when` fails, the source's prints as nothing. For a token the layout
   * inserts or drops, such as JS's `;` under `semi`. `.andThen(f)` prints `f` of it where it shows.
   */
  synth: <const W>(when: W): TokIf<S, W, Piece<"self">> & ReturnType<typeof tokIf<S, W>> =>
    Object.assign(tokIf<S, W>(text, when).andThen((t) => t), tokIf<S, W>(text, when)),
});

const tokIfTree = (text: string, when: unknown, then: unknown): Tree =>
  when === undefined ? { t: "tokIf", text, then: toTree(then) } : { t: "tokIf", text, synth: plain(when), then: toTree(then) };

/** `f` of the token, printed only where the token shows: the spaces around a token the source may lack. */
const tokIf = <S extends string, W>(text: S, when: unknown) => ({
  andThen: <T>(f: (t: Piece<"self">) => T): TokIf<S, W, T> => piece(tokIfTree(text, when, f(self))),
});

/**
 * The node, where `when` holds (always, without it), is input the formatter must not touch, such as Python 2's
 * `print` statement: formatting stops with `reason`, and the file stays as written.
 */
export const bail = <const W = true>(reason: string, when?: W): Piece<{ bail: W }> =>
  piece({ t: "bail", reason, when: when === undefined ? true : plain(when) });

/** Where a `tok(...).andThen(f)` prints its token, in what `f` returns. */
const self: Piece<"self"> = piece({ t: "self" });

/** A bracket idiom's output, whose `via(name)` hands the same frame to a hand-written layout. */
export type Brackets<T, P> = Piece<{ brackets: T; pad: P }> & {
  /**
   * The frame laid out by the hand-written `FrameRule` `name` (see `runtime.ts`), given the node and callbacks that
   * print its opening bracket, its body and its closing bracket; it runs whether or not the body is empty. For a
   * layout owning the whole frame, such as ruff's `parenthesized` with the dangling comments after its opening
   * bracket, while the brackets stay the spec's tokens. The body binds no source token by its spelling (no literal,
   * no nested bracket idiom), and the frame takes no `pad`.
   */
  via(name: string): Piece<{ brackets: T; pad: P }>;
};

const brackets =
  (open: string, close: string) =>
  <T, P = false>(body: T, o: { readonly pad?: P } = {}): Brackets<T, P> => {
    const tree = toTree(body);
    const frame: Tree = {
      t: "brackets",
      open,
      close,
      pad: plain(o.pad),
      body: tree,
      label: labelOf(tree),
    };
    // `toTree` drops the method, so the IR stays plain data.
    return Object.assign(piece<{ brackets: T; pad: P }>(frame), {
      via: (name: string) => piece<{ brackets: T; pad: P }>({ ...frame, via: name }),
    });
  };

/** A bracket frame's name: the field its body is, holds or lists, else `body`. */
function labelOf(x: Tree): string {
  switch (x.t) {
    case "ref":
      return x.name;
    case "opt":
      return x.ref.name;
    case "sepBy":
    case "lines":
      return x.list.name;
    default:
      return "body";
  }
}

/**
 * `body` between brackets, the node's own tokens where the source has them and synthetic ones where it does not;
 * `pad` puts a space inside them while they stay on one line (prettier's `bracketSpacing`).
 */
export const grpParen = brackets("(", ")");
export const grpBrace = brackets("{", "}");
export const grpBracket = brackets("[", "]");

/**
 * The items of `list`, each followed by its source separator `sep`; with `trailing`, a synthetic one after the
 * last item while the list is broken. The node's dangling comments show when the list is empty.
 */
export const sepBy = <const S extends string, T = false>(
  sep: S,
  list: List,
  o: {
    readonly trailing?: T;
    /**
     * The list has holes, a `sep` right after the opening bracket or another `sep` (`[1, , 2]`), each printed as
     * this text and never packed or grouped. An empty one keeps its own `sep` even when last, which it needs to
     * stay a hole.
     */
    readonly holes?: string;
    /**
     * Keep a blank line where the line after an item's separator is blank (`1\n,\n\n2`), where by default the
     * line after the item itself must be (`1\n\n,2`): prettier's arrays against its objects and argument lists.
     */
    readonly blankAfterSep?: boolean;
  } = {},
) =>
  piece<{ sepBy: S; trailing: T }>({
    t: "sepBy",
    sep,
    list: refOf(list),
    trailing: plain(o.trailing),
    ...(o.holes === undefined ? {} : { holes: o.holes }),
    ...(o.blankAfterSep === true ? { blankAfterSep: true } : {}),
  });

/** The items of `list` one per line, then the node's dangling comments, one per line. */
export const lines = (
  list: List,
  o: {
    /**
     * Children that print before the next item rather than on lines of their own, like a class member's
     * decorators: joined by a line in a group, then a line break where the source breaks after one of them, else a
     * line. With it, the lines are every other item of the node, whatever field holds them.
     */
    readonly attach?: List;
    /** A blank line before each item but the first where this holds of the item, whatever the source has. */
    readonly blank?: unknown;
    /**
     * An item where this holds continues the item before it: on the next line, indented, with no blank line
     * (Kotlin's getter, which the grammar makes a sibling of its property).
     */
    readonly follow?: unknown;
    /** The node's tokens are lines too, as written: tree-sitter-kotlin's `null` statement is an anonymous child. */
    readonly tokens?: boolean;
    /**
     * Items of kind `kind` are import lists: each run of them prints as one block of their imports, sorted, without
     * duplicates or unused ones unless the `keepImports` option is set, by the `ImportRule` `via` (runtime.ts); a
     * run left with no import prints nothing.
     */
    readonly imports?: { readonly kind: string; readonly via: string };
  } = {},
): Piece<"lines"> =>
  piece({
    t: "lines",
    list: refOf(list),
    ...(o.attach === undefined ? {} : { attach: refOf(o.attach).name }),
    ...(o.blank === undefined ? {} : { blank: plain(o.blank) }),
    ...(o.follow === undefined ? {} : { follow: plain(o.follow) }),
    ...(o.tokens ? { tokens: true } : {}),
    ...(o.imports === undefined ? {} : { imports: o.imports }),
  });

/** Which consecutive entries of an `inOrder` a spacing rule applies to (see `Pairs`). */
export interface PairsOf<K, C> {
  readonly after?: readonly K[];
  readonly before?: readonly K[];
  readonly when?: C;
}

export interface InOrderOf<K, C> {
  readonly join?: Join;
  readonly tight?: PairsOf<K, C>;
  readonly spaceWhen?: PairsOf<K, C>;
  readonly verbatim?: true | { readonly except: readonly K[] };
  readonly skip?: readonly K[];
  readonly hardWhen?: PairsOf<K, C>;
  readonly hangAfter?: readonly K[];
  readonly hug?: C;
  readonly lineBefore?: readonly K[];
  readonly braces?: boolean;
}

/**
 * Every child of the node in source order: named children as their rules print them, with their comments, and
 * tokens as written. For a kind no field splits into parts (CSS's), where only the order says what each child is.
 *
 * Between two entries goes, the first that applies: nothing where `tight` does, a space where `spaceWhen` does,
 * else `join`: nothing (`none`, the default), a space (`space`, which `inOrder(space)` means too), a space where
 * the source has any gap and nothing where it has none (`gap`), or a line (`line`), a space unless the enclosing
 * group breaks. With `verbatim`, named children print as their source text between their comments, but those of a
 * kind in `except`: prettier's raw at-rule parameters. Children of a kind in `skip` print nothing, for one the
 * layout prints after it, like a `;` that `tok(";").synth` adds where the source lacks one.
 */
export function inOrder(sep?: Piece<"space">): Piece<"inOrder">;
export function inOrder<const K extends string = never, C = false>(
  o: InOrderOf<K, C>,
): Piece<{ inOrder: K; cond: C }>;
export function inOrder(o?: Piece<"space"> | InOrderOf<string, unknown>): unknown {
  if (o === undefined || (o as unknown as Tree).t === "space")
    return piece({ t: "inOrder", join: o === undefined ? "none" : "space" });
  const opts = o as InOrderOf<string, unknown>;
  const pairs = (p: PairsOf<string, unknown> | undefined): Pairs | undefined =>
    p === undefined
      ? undefined
      : {
          ...(p.after ? { after: p.after } : {}),
          ...(p.before ? { before: p.before } : {}),
          ...(p.when === undefined ? {} : { when: plain(p.when) }),
        };
  const tight = pairs(opts.tight);
  const spaceWhen = pairs(opts.spaceWhen);
  const hardWhen = pairs(opts.hardWhen);
  const v = opts.verbatim;
  return piece({
    t: "inOrder",
    join: opts.join ?? "none",
    ...(tight ? { tight } : {}),
    ...(spaceWhen ? { spaceWhen } : {}),
    ...(v === undefined ? {} : { verbatim: { except: v === true ? [] : v.except } }),
    ...(opts.skip?.length ? { skip: opts.skip } : {}),
    ...(hardWhen ? { hardWhen } : {}),
    ...(opts.hangAfter?.length ? { hangAfter: opts.hangAfter } : {}),
    ...(opts.hug === undefined ? {} : { hug: plain(opts.hug) }),
    ...(opts.lineBefore?.length ? { lineBefore: opts.lineBefore } : {}),
    ...(opts.braces ? { braces: true } : {}),
  });
}

/** True where the hand-written `PredicateRule` `name` (see `runtime.ts`) says so of the node. */
export const when = (name: string): RuleCond => ({ t: "rule", name });

/** The node is in its parent's field `name`. */
export const fieldIs = (name: string): FieldCond => ({ t: "field", name });

/** The node's field `name` (`children`: its children in no field) holds a child, of `kind` when given. */
export const has = <const K extends string = never>(name: string, kind?: K): HasCond<K> =>
  kind === undefined ? { t: "has", name } : { t: "has", name, kind };

/** The node holds no item, in any field, and no comment next to none of its children: an empty body. */
export const isEmpty: EmptyCond = { t: "empty" };

export const not = <const C>(c: C): NotCond<C> => ({ t: "not", c });

/** The node is of one of `kinds`; under `ancestor` or `allBefore`, the node they ask about. */
export const kindIs = <const K extends string>(...kinds: K[]): KindCond<K> => ({ t: "kind", kinds });

/** `c` holds of every item before the node among its parent's items: JS's directive prologue. */
export const allBefore = <const C>(c: C): AllBeforeCond<C> => ({ t: "allBefore", c });

/** `c` holds of the item just before the node among its parent's items: a blank line only between unlike items. */
export const prevItem = <const C>(c: C): ItemCond<C> => ({ t: "prevItem", c });

/** `c` holds of the node's last item. */
export const lastItem = <const C>(c: C): ItemCond<C> => ({ t: "lastItem", c });

/** The node's source text spans more than one line: a list the author broke, which ktfmt keeps broken. */
export const spansLines: SpansLinesCond = { t: "spansLines" };

export const all = <const C extends readonly unknown[]>(...cs: C): AllCond<C[number]> => ({ t: "all", cs });
export const any = <const C extends readonly unknown[]>(...cs: C): AllCond<C[number]> => ({ t: "any", cs });

/** Option `key`, true when truthy; `.is(v)` and `.isNot(v)` compare it. */
export const option = <const K extends string>(key: K) => ({
  t: "option" as const,
  key,
  op: "truthy" as const,
  is: <const V>(value: V): OptionCond<K, V> =>
    ({ t: "option", key, op: "is", value }) as OptionCond<K, V>,
  isNot: <const V>(value: V): OptionCond<K, V> =>
    ({ t: "option", key, op: "isNot", value }) as OptionCond<K, V>,
});

/** A `splitOn` item mode: the entry's items as words (see `SplitItem`); `keepLines` decided once per node. */
export const words = <const C = false>(o: { readonly keepLines?: C } = {}) =>
  ({ t: "words", keepLines: o.keepLines }) as { readonly t: "words"; readonly keepLines?: C };

/** Inside a `splitOn`: the run has `n` entries. */
export const entryCount = (n: number): SplitCond => ({ t: "entryCount", n });

/** Inside a `splitOn`: an entry has several items (`many`), or a first item starting with one of `startsWith`. */
export const anyEntry = (o: { readonly many?: boolean; readonly startsWith?: readonly string[] }): SplitCond => ({
  t: "anyEntry",
  many: o.many === true,
  startsWith: o.startsWith ?? [],
});

/** The text of the node's first child (after its first `after` token) is one of `is` or starts with a `prefix`. */
export const firstText = (o: {
  readonly after?: string;
  readonly is?: readonly string[];
  readonly prefix?: readonly string[];
  readonly anyCase?: boolean;
}): FirstTextCond => ({
  t: "firstText",
  ...(o.after === undefined ? {} : { after: o.after }),
  is: o.is ?? [],
  prefix: o.prefix ?? [],
  anyCase: o.anyCase === true,
});

/**
 * The node's nearest ancestor of kind `kind` (or one of them) exists, no ancestor of a `stop` kind lies before it,
 * and `holds` (true without it) holds of it: what the node sits inside, like the function around a CSS value.
 * `stop: "*"` stops at any other kind, so only the parent counts: `ancestor(k, { stop: "*" })` is `parentIs(k)`.
 */
export const ancestor = <const K extends string, const C = true>(
  kind: K | readonly K[],
  o: { readonly stop?: readonly K[] | "*"; readonly holds?: C } = {},
): AncestorCond<K, C> =>
  ({
    t: "ancestor",
    kinds: typeof kind === "string" ? [kind] : kind,
    stop: o.stop ?? [],
    holds: o.holds ?? true,
  }) as AncestorCond<K, C>;

/** A `splitOn` layout, its conditions checked against the grammar's kinds and the options through `C`. */
export type SplitLayoutOf<C> =
  | Extract<SplitLayout, { readonly group?: boolean }>
  | { readonly when: C; readonly then: SplitLayoutOf<C>; readonly else: SplitLayoutOf<C> };

export interface SplitOnOf<K, C> {
  readonly except?: readonly K[];
  readonly trail?: readonly K[];
  readonly item?: "adjacent" | "space" | { readonly t: "words"; readonly keepLines?: C };
  readonly wrapItem?: C;
  readonly trailing?: boolean;
  readonly layout?: SplitLayoutOf<C>;
}

/**
 * The node's children but comments and `except` kinds, cut into entries at each top-level `sep` token; each entry
 * prints its items as `item` says (`adjacent` by default), each named item where `wrapItem` holds in a group and an
 * indent of its own, then its separator; with `trailing`, the last entry's separator prints only while the enclosing
 * group breaks, as `sepBy`'s does. `layout` places the entries; with no flag set it prints them one after
 * another, so a lone entry prints bare. Then each child of a `trail` kind, after a space. For a list whose items are
 * runs of children rather than single ones, like CSS's comma-separated values, selectors and queries.
 */
export const splitOn = <const S extends string, const K extends string = never, const C = false>(
  sep: S,
  o: SplitOnOf<K, C> = {},
): Piece<{ splitOn: S | K; cond: C }> => {
  const layout = (l: SplitLayoutOf<unknown>): SplitLayout =>
    "when" in l ? { when: plain(l.when), then: layout(l.then), else: layout(l.else) } : l;
  const item = o.item ?? "adjacent";
  return piece({
    t: "splitOn",
    sep,
    except: o.except ?? [],
    trail: o.trail ?? [],
    item: typeof item === "string" ? { t: item } : { t: "words", keepLines: plain(item.keepLines) },
    wrapItem: plain(o.wrapItem),
    trailing: o.trailing ?? false,
    layout: layout(o.layout ?? {}),
  });
};

/**
 * `then` where `when` holds of the node, else `otherwise`: a layout chosen by what the node is, like CSS's
 * `url(...)` arguments printed as written. A literal after it must bind the same source token whichever ran.
 */
export const either = <const C, const A, const B>(
  when: C,
  then: A,
  otherwise: B,
): Piece<{ either: C; then: A; else: B }> =>
  piece({ t: "either", when: plain(when), then: toTree(then), else: toTree(otherwise) });

/** The node's token `text` respelled by the normalizer `fn`, where the source has it: CSS's `@MEDIA` as `@media`. */
/**
 * True where the hand-written `PredicateRule` `name` (see `runtime.ts`), given `args`, says so of the node: a general
 * query the grammar cannot state, such as JS's `pred("role", "call_expression", "callee")`.
 */
export const pred = (name: string, ...args: readonly string[]): PredCond => ({ t: "pred", name, args });

export const spell = <const S extends string>(text: S, fn: NormalizerName): Piece<{ spell: S }> =>
  piece({ t: "spell", text, fn });

// A layout frame types as its body, so the spec checks the body's tokens and options where it stands.
const layout = <T>(kind: LayoutKind, body: T, id?: string): T =>
  ({ t: "layout", kind, ...(id === undefined ? {} : { id }), body: toTree(body) }) satisfies Tree as unknown as T;

/** `body` in a group, which breaks as a whole; `id` names it for an `indentIfBreak`. */
export const group = <const T>(body: T, o: { readonly id?: string } = {}): T => layout("group", body, o.id);

/** `body` indented one level where its lines break. */
export const indent = <const T>(body: T): T => layout("indent", body);

/** `body` indented one level only while the group named `id` breaks. */
export const indentIfBreak = <const T>(id: string, body: T): T => layout("indentIfBreak", body, id);

/** A space, or a line break where the enclosing group breaks. */
export const line: Piece<"doc"> = piece({ t: "doc", kind: "line" });
/** Nothing, or a line break where the enclosing group breaks. */
export const softline: Piece<"doc"> = piece({ t: "doc", kind: "softline" });
/** A line break, which breaks every group around it. */
export const hardline: Piece<"doc"> = piece({ t: "doc", kind: "hardline" });
/** Where the line comments pending at the end of the line print, a break with them. */
export const lineSuffixBoundary: Piece<"doc"> = piece({ t: "doc", kind: "lineSuffixBoundary" });
/** Prettier's breakParent: every group around it breaks. */
export const breakParent: Piece<"doc"> = piece({ t: "doc", kind: "breakParent" });

function plain(c: unknown): Cond {
  if (c === undefined || typeof c === "boolean") return c === true;
  const x = c as Exclude<Cond, boolean>;
  switch (x.t) {
    case "rule":
      return { t: "rule", name: x.name };
    case "pred":
      return { t: "pred", name: x.name, args: x.args };
    case "parent":
      return { t: "parent", kind: x.kind };
    case "field":
      return { t: "field", name: x.name };
    case "has":
      return x.kind === undefined ? { t: "has", name: x.name } : { t: "has", name: x.name, kind: x.kind };
    case "empty":
      return { t: "empty" };
    case "not":
      return { t: "not", c: plain(x.c) };
    case "all":
    case "any":
      return { t: x.t, cs: x.cs.map(plain) };
    case "kind":
      return { t: "kind", kinds: x.kinds };
    case "allBefore":
      return { t: "allBefore", c: plain(x.c) };
    case "prevItem":
    case "lastItem":
      return { t: x.t, c: plain(x.c) };
    case "spansLines":
      return { t: "spansLines" };
    case "entryCount":
      return { t: "entryCount", n: x.n };
    case "anyEntry":
      return { t: "anyEntry", many: x.many, startsWith: x.startsWith };
    case "firstText":
      return firstText(x);
    case "ancestor":
      return { t: "ancestor", kinds: x.kinds, stop: x.stop, holds: plain(x.holds) };
  }
  const { key, op, value } = x;
  return op === "truthy"
    ? { t: "option", key, op }
    : { t: "option", key, op, value };
}

const refOf = (x: unknown): Ref => {
  const r = x as {
    name: string;
    at?: unknown;
    atIndex?: number;
    split?: unknown;
    splitSep?: string;
    via?: unknown;
    viaName?: string;
    parensMode?: string;
    from?: unknown;
    fromIndex?: number;
  };
  const at = r.atIndex ?? (typeof r.at === "number" ? r.at : undefined);
  const split = r.splitSep ?? (typeof r.split === "string" ? r.split : undefined);
  const via = r.viaName ?? (typeof r.via === "string" ? r.via : undefined);
  const from = r.fromIndex ?? (typeof r.from === "number" ? r.from : undefined);
  return {
    t: "ref",
    name: r.name,
    ...(at === undefined ? {} : { at }),
    ...(split === undefined ? {} : { split }),
    ...(via === undefined ? {} : { via }),
    ...(r.parensMode === undefined ? {} : { parens: r.parensMode }),
    ...(from === undefined ? {} : { from }),
  };
};

/**
 * `$.<name>` (or `.at(i)` of it), a `Node`, a `List` and an `Option` at once; `atIndex`, `splitSep` and `viaName`
 * hold its `.at`, `.split` and `.via`, since those names are the methods.
 */
const nodeRef = (
  name: string,
  atIndex?: number,
  viaName?: string,
  splitSep?: string,
  parensMode?: string,
  fromIndex?: number,
): unknown => ({
  t: "ref",
  name,
  atIndex,
  splitSep,
  viaName,
  parensMode,
  fromIndex,
  from: (i: number) => nodeRef(name, undefined, undefined, undefined, undefined, i),
  at: (i: number) => nodeRef(name, i, undefined, splitSep),
  split: (sep: string) => ({ at: (i: number) => nodeRef(name, i, undefined, sep) }),
  via: (v: string) => nodeRef(name, atIndex, v, splitSep),
  parens: (mode: string) => nodeRef(name, atIndex, undefined, splitSep, mode),
  andThen: (f: (a: unknown) => unknown): Tree => ({
    t: "opt",
    ref: refOf(nodeRef(name, atIndex, undefined, splitSep)),
    then: toTree(f(nodeRef(name, atIndex, viaName, splitSep, parensMode))),
  }),
});

function toTree(x: unknown): Tree {
  if (typeof x === "string") return { t: "tok", text: x };
  if (Array.isArray(x)) return { t: "seq", parts: x.map(toTree) };
  const tree = x as Tree;
  if (tree.t === "ref") return refOf(tree);
  if (tree.t === "brackets" && typeof tree.via === "function") {
    const { via: _, ...frame } = tree;
    return frame;
  }
  if (tree.t === "tokIf" && "andThen" in tree) {
    const { andThen: _, ...plainTree } = tree as Tree & { andThen: unknown };
    return plainTree;
  }
  return tree;
}

/** `$` as a spec's rules receive it: every property is a `Ref`, which also serves as an `Option`. */
const dollar = new Proxy(
  {},
  {
    get: (_, name) =>
      typeof name !== "string" ? undefined : nodeRef(name),
  },
);

/**
 * A language's layout, as the IR its rules produce when called once. `G` is the bundle's `typeof grammar` and `O`
 * the language's options, so a kind, field, token or option they do not have fails to typecheck.
 */
export const defineFormat =
  <G extends DslGrammar, O>() =>
  (spec: FormatSpec<G, O>): FormatIR => {
    const structure: Record<string, Tree> = {};
    for (const [kind, rule] of Object.entries(spec.structure))
      if (rule) structure[kind] = toTree((rule as (d: unknown) => unknown)(dollar));
    const conds = <W extends FrameWrap>(rule: W): W =>
      rule.keepExpanded === undefined && rule.breakWhen === undefined
        ? rule
        : {
            ...rule,
            ...(rule.keepExpanded === undefined ? {} : { keepExpanded: plain(rule.keepExpanded) }),
            ...(rule.breakWhen === undefined ? {} : { breakWhen: plain(rule.breakWhen) }),
          };
    const wrapping: Record<string, Wrap> = {};
    for (const [kind, w] of Object.entries(spec.wrapping ?? {})) {
      const rule = conds(w as Wrap);
      const { frames } = rule;
      wrapping[kind] =
        frames === undefined
          ? rule
          : {
              ...rule,
              frames: Object.fromEntries(
                Object.entries(frames).map(([f, fw]) => [f, conds(fw)]),
              ),
            };
    }
    return {
      structure,
      wrapping,
      ...(spec.unknown === undefined ? {} : { unknown: spec.unknown }),
      ...(spec.docComment === undefined ? {} : { docComment: spec.docComment }),
    };
  };
