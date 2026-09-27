// The formatter DSL: a language's layout written per node kind, in two independent parts.
//
//   structure  what a node prints, in order: its source tokens, its children, spaces, and idioms such as
//              `grpBrace(sepBy(",", $.children))`. Flattened, one node at a time, into a token sequence
//              (`reference.ts`'s `flatten`) that says nothing about where lines break.
//   wrapping   where that sequence breaks: groups, fill, and the break policy of a node's bracketed list, keyed
//              by node kind, applied over the flattened sequence (`reference.ts`'s `wrap`).
//
// `generate.node.ts` compiles a spec ahead of time into straight-line stream calls (`emit.ts`), fusing the two
// passes into one; a test holds the fused code to the two-pass reference, output and anchors.
import type { Grammar } from "../rules.js";

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

/** A field of the node, or (`name` "children") its children in no field. */
export interface Ref {
  readonly t: "ref";
  readonly name: string;
}

export type Cond =
  | boolean
  | {
      readonly t: "option";
      readonly key: string;
      readonly op: "truthy" | "is" | "isNot";
      readonly value?: unknown;
    };

export type Tree =
  | { readonly t: "tok"; readonly text: string }
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
    }
  | {
      readonly t: "sepBy";
      readonly sep: string;
      readonly list: Ref;
      readonly trailing: Cond;
    }
  | { readonly t: "lines"; readonly list: Ref }
  | { readonly t: "verbatim" }
  | { readonly t: "custom"; readonly name: string };

export interface Wrap {
  /** The node's output is one group, which stays on one line or breaks as a unit. */
  readonly group?: boolean;
  /** Pack the list's items several to a line when every item is one of these kinds (prettier's number arrays). */
  readonly fillIfAll?: readonly string[];
  /** Break the list when 2+ items are all lists of one kind with 2+ items each (prettier's matrix rule). */
  readonly breakNestedLists?: boolean;
  /** Each item of the list is a group of its own, staying flat or breaking on its own. */
  readonly groupItems?: boolean;
  /** Keep the list broken when the source broke after its opening bracket (prettier's `objectWrap: "preserve"`). */
  readonly keepExpanded?: Cond;
  /** "always" breaks every non-empty list, one item per line (prettier's json-stringify). */
  readonly expand?: "fit" | "always";
  /** A kept blank line between items forces the list to break, or shows only when it breaks anyway (default). */
  readonly blankLines?: "force" | "ifBroken";
}

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
export type Node = Piece<"node">;
/** Several children, which only a list idiom (`sepBy`, `lines`) lays out. */
export type List = Piece<"list">;
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
export type CondOf<O> =
  | boolean
  | { [K in keyof O & string]: OptionCond<K, O[K]> }[keyof O & string];

/** What a structure rule returns: the grammar's tokens, children, idioms, and arrays of them (sequences). */
export type TokenTree<G extends Grammar, O> =
  | TokenOf<G>
  | Node
  | Piece<"space">
  | Piece<"lines">
  | Piece<{ opt: TokenTree<G, O> }>
  | Piece<{ brackets: TokenTree<G, O>; pad: CondOf<O> }>
  | Piece<{ sepBy: TokenOf<G>; trailing: CondOf<O> }>
  | readonly TokenTree<G, O>[];

/** A rule that prints the whole node: `verbatim` or `custom`. */
type Whole = Piece<"whole">;

type WrapOf<G extends Grammar, O> = Omit<Wrap, "fillIfAll" | "keepExpanded"> & {
  readonly fillIfAll?: readonly KindOf<G>[];
  readonly keepExpanded?: CondOf<O>;
};

export interface FormatSpec<G extends DslGrammar, O> {
  readonly structure: {
    readonly [K in KindOf<G>]?: ($: Fields<G, K>) => TokenTree<G, O> | Whole;
  };
  readonly wrapping?: { readonly [K in KindOf<G>]?: WrapOf<G, O> };
}

// ---- builder ----

const piece = <T>(tree: Tree) => tree as unknown as Piece<T>;

/** A space. */
export const space: Piece<"space"> = piece({ t: "space" });

/** The node's source text as one token. */
export const verbatim: Whole = piece({ t: "verbatim" });

/** The hand-written stream rule `name` prints the node; the generated module takes it as a parameter. */
export const custom = (name: string): Whole => piece({ t: "custom", name });

const brackets =
  (open: string, close: string) =>
  <T, P = false>(body: T, o: { readonly pad?: P } = {}) =>
    piece<{ brackets: T; pad: P }>({
      t: "brackets",
      open,
      close,
      pad: plain(o.pad),
      body: toTree(body),
    });

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

/** The items of `list` one per line, then the node's dangling comments. */
export const lines = (list: List): Piece<"lines"> =>
  piece({ t: "lines", list: refOf(list) });

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

function plain(c: unknown): Cond {
  if (c === undefined || typeof c === "boolean") return c === true;
  const { key, op, value } = c as Exclude<Cond, boolean>;
  return op === "truthy"
    ? { t: "option", key, op }
    : { t: "option", key, op, value };
}

const refOf = (x: unknown): Ref => ({ t: "ref", name: (x as Ref).name });

function toTree(x: unknown): Tree {
  if (typeof x === "string") return { t: "tok", text: x };
  if (Array.isArray(x)) return { t: "seq", parts: x.map(toTree) };
  const tree = x as Tree;
  return tree.t === "ref" ? refOf(tree) : tree;
}

/** `$` as a spec's rules receive it: every property is a `Ref`, which also serves as an `Option`. */
const dollar = new Proxy(
  {},
  {
    get: (_, name) =>
      typeof name !== "string"
        ? undefined
        : {
            t: "ref",
            name,
            andThen: (f: (a: unknown) => unknown): Tree => ({
              t: "opt",
              ref: { t: "ref", name },
              then: toTree(f({ t: "ref", name })),
            }),
          },
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
    const wrapping: Record<string, Wrap> = {};
    for (const [kind, w] of Object.entries(spec.wrapping ?? {})) {
      const rule = w as Wrap;
      wrapping[kind] =
        rule.keepExpanded === undefined
          ? rule
          : { ...rule, keepExpanded: plain(rule.keepExpanded) };
    }
    return { structure, wrapping };
  };
