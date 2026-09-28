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
  | LogicCond
  | SplitCond
  | FirstTextCond
  | { readonly t: "ancestor"; readonly kind: string; readonly stop: readonly string[]; readonly holds: Cond };

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
  | { readonly t: "not"; readonly c: Cond }
  | { readonly t: "all" | "any"; readonly cs: readonly Cond[] };

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
    }
  | { readonly t: "lines"; readonly list: Ref }
  | {
      readonly t: "inOrder";
      readonly join: Join;
      readonly tight?: Pairs;
      readonly spaceWhen?: Pairs;
      /** Named children print as their source text, but those of a kind in `except`. */
      readonly verbatim?: { readonly except: readonly string[] };
      /** Children of these kinds (tokens by their spelling) print nothing, as if absent. */
      readonly skip?: readonly string[];
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
  | { readonly t: "spell"; readonly text: string; readonly fn: NormalizerName };

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
      /** Before the first entry: a line break only where the group breaks (`soft`), or always (`hard`). */
      readonly first?: "soft" | "hard";
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
  readonly layout: SplitLayout;
}

/** How one bracket or list frame of a node breaks. */
export interface FrameWrap {
  /** Pack the list's items several to a line when every item is one of these kinds (prettier's number arrays). */
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
  | Piece<{ either: CondIn<G, O>; then: TokenTree<G, O> | Text<G, O>; else: TokenTree<G, O> | Text<G, O> }>
  | Piece<{ spell: TokenOf<G> }>
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
export interface NotCond<C> {
  readonly t: "not";
  readonly c: C;
}
export interface AllCond<C> {
  readonly t: "all" | "any";
  readonly cs: readonly C[];
}
/** Every condition, checked against the grammar's kinds and the options. */
export type CondIn<G extends Grammar, O> =
  | CondOf<O>
  | ParentCond<KindOf<G>>
  | FieldCond
  | HasCond<KindOf<G>>
  | NotCond<CondIn<G, O>>
  | AllCond<CondIn<G, O>>
  | SplitCond
  | FirstTextCond
  | AncestorCond<KindOf<G>, CondIn<G, O>>;

/** The nearest ancestor of kind `kind`, met before any of a `stop` kind, is one where `holds` holds (`ancestor`). */
export interface AncestorCond<K, C> {
  readonly t: "ancestor";
  readonly kind: K;
  readonly stop: readonly K[];
  readonly holds: C;
}

/** `text`'s output, its `when` checked against the grammar's kinds and the options. */
type Text<G extends Grammar, O> = Piece<{ text: CondIn<G, O> }>;

type FrameWrapOf<G extends Grammar, O> = Omit<
  FrameWrap,
  "packWhenAllOf" | "keepExpanded"
> & {
  readonly packWhenAllOf?: readonly KindOf<G>[];
  readonly keepExpanded?: CondOf<O>;
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
  o: { readonly trailing?: T } = {},
) =>
  piece<{ sepBy: S; trailing: T }>({
    t: "sepBy",
    sep,
    list: refOf(list),
    trailing: plain(o.trailing),
  });

/** The items of `list` one per line, then the node's dangling comments, one per line. */
export const lines = (list: List): Piece<"lines"> =>
  piece({ t: "lines", list: refOf(list) });

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
  const v = opts.verbatim;
  return piece({
    t: "inOrder",
    join: opts.join ?? "none",
    ...(tight ? { tight } : {}),
    ...(spaceWhen ? { spaceWhen } : {}),
    ...(v === undefined ? {} : { verbatim: { except: v === true ? [] : v.except } }),
    ...(opts.skip?.length ? { skip: opts.skip } : {}),
  });
}

/** True where the hand-written `PredicateRule` `name` (see `runtime.ts`) says so of the node. */
export const when = (name: string): RuleCond => ({ t: "rule", name });

/** The node is in its parent's field `name`. */
export const fieldIs = (name: string): FieldCond => ({ t: "field", name });

/** The node's field `name` (`children`: its children in no field) holds a child, of `kind` when given. */
export const has = <const K extends string = never>(name: string, kind?: K): HasCond<K> =>
  kind === undefined ? { t: "has", name } : { t: "has", name, kind };

export const not = <const C>(c: C): NotCond<C> => ({ t: "not", c });
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
 * The node's nearest ancestor of kind `kind` exists, no ancestor of a `stop` kind lies before it, and `holds` (true
 * without it) holds of it: what the node sits inside, like the function around a CSS value.
 */
export const ancestor = <const K extends string, const C = true>(
  kind: K,
  o: { readonly stop?: readonly K[]; readonly holds?: C } = {},
): AncestorCond<K, C> =>
  ({ t: "ancestor", kind, stop: o.stop ?? [], holds: o.holds ?? true }) as AncestorCond<K, C>;

/** A `splitOn` layout, its conditions checked against the grammar's kinds and the options through `C`. */
export type SplitLayoutOf<C> =
  | Extract<SplitLayout, { readonly group?: boolean }>
  | { readonly when: C; readonly then: SplitLayoutOf<C>; readonly else: SplitLayoutOf<C> };

export interface SplitOnOf<K, C> {
  readonly except?: readonly K[];
  readonly trail?: readonly K[];
  readonly item?: "adjacent" | "space" | { readonly t: "words"; readonly keepLines?: C };
  readonly wrapItem?: C;
  readonly layout?: SplitLayoutOf<C>;
}

/**
 * The node's children but comments and `except` kinds, cut into entries at each top-level `sep` token; each entry
 * prints its items as `item` says (`adjacent` by default), each named item where `wrapItem` holds in a group and an
 * indent of its own, then its separator. `layout` places the entries; with no flag set it prints them one after
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
export const spell = <const S extends string>(text: S, fn: NormalizerName): Piece<{ spell: S }> =>
  piece({ t: "spell", text, fn });

function plain(c: unknown): Cond {
  if (c === undefined || typeof c === "boolean") return c === true;
  const x = c as Exclude<Cond, boolean>;
  switch (x.t) {
    case "rule":
      return { t: "rule", name: x.name };
    case "parent":
      return { t: "parent", kind: x.kind };
    case "field":
      return { t: "field", name: x.name };
    case "has":
      return x.kind === undefined ? { t: "has", name: x.name } : { t: "has", name: x.name, kind: x.kind };
    case "not":
      return { t: "not", c: plain(x.c) };
    case "all":
    case "any":
      return { t: x.t, cs: x.cs.map(plain) };
    case "entryCount":
      return { t: "entryCount", n: x.n };
    case "anyEntry":
      return { t: "anyEntry", many: x.many, startsWith: x.startsWith };
    case "firstText":
      return firstText(x);
    case "ancestor":
      return { t: "ancestor", kind: x.kind, stop: x.stop, holds: plain(x.holds) };
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
  };
  const at = r.atIndex ?? (typeof r.at === "number" ? r.at : undefined);
  const split = r.splitSep ?? (typeof r.split === "string" ? r.split : undefined);
  const via = r.viaName ?? (typeof r.via === "string" ? r.via : undefined);
  return {
    t: "ref",
    name: r.name,
    ...(at === undefined ? {} : { at }),
    ...(split === undefined ? {} : { split }),
    ...(via === undefined ? {} : { via }),
  };
};

/**
 * `$.<name>` (or `.at(i)` of it), a `Node`, a `List` and an `Option` at once; `atIndex`, `splitSep` and `viaName`
 * hold its `.at`, `.split` and `.via`, since those names are the methods.
 */
const nodeRef = (name: string, atIndex?: number, viaName?: string, splitSep?: string): unknown => ({
  t: "ref",
  name,
  atIndex,
  splitSep,
  viaName,
  at: (i: number) => nodeRef(name, i, undefined, splitSep),
  split: (sep: string) => ({ at: (i: number) => nodeRef(name, i, undefined, sep) }),
  via: (v: string) => nodeRef(name, atIndex, v, splitSep),
  andThen: (f: (a: unknown) => unknown): Tree => ({
    t: "opt",
    ref: refOf(nodeRef(name, atIndex, undefined, splitSep)),
    then: toTree(f(nodeRef(name, atIndex, viaName, splitSep))),
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
      rule.keepExpanded === undefined
        ? rule
        : { ...rule, keepExpanded: plain(rule.keepExpanded) };
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
    return { structure, wrapping };
  };
