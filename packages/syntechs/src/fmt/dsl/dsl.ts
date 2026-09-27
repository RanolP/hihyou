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
    };

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
  | { readonly t: "inOrder"; readonly space: boolean }
  | { readonly t: "verbatim" }
  | { readonly t: "custom"; readonly name: string };

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
export type CondOf<O> =
  | boolean
  | { [K in keyof O & string]: OptionCond<K, O[K]> }[keyof O & string];

/** What a structure rule returns: the grammar's tokens, children, idioms, and arrays of them (sequences). */
export type TokenTree<G extends Grammar, O> =
  | TokenOf<G>
  | Node
  | Piece<"space">
  | Piece<"lines">
  | Piece<"inOrder">
  | Piece<{ tok: TokenOf<G> }>
  | Piece<{ opt: TokenTree<G, O> }>
  | Piece<{ brackets: TokenTree<G, O>; pad: CondOf<O> }>
  | Piece<{ sepBy: TokenOf<G>; trailing: CondOf<O> }>
  | readonly TokenTree<G, O>[];

/** A rule that prints the whole node: `verbatim` or `custom`. */
type Whole = Piece<"whole">;

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
    readonly [K in KindOf<G>]?: ($: Fields<G, K>) => TokenTree<G, O> | Whole;
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
 * The hand-written rule `name` (a `CustomRule`, see `runtime.ts`) prints the node; the generated module takes it
 * as a parameter. The node's structure is then its children in source order with their comments and kept blank
 * lines, the `CustomSeq` the rule receives, and the rule is the node's wrapping: it lays those entries out.
 */
export const custom = (name: string): Whole => piece({ t: "custom", name });

/**
 * `tok(text).via(name)`: the node's token `text`, printed by the hand-written `TokenRule` `name` (see
 * `runtime.ts`), given that token or undefined where the source has none, and the node. For a token the layout
 * inserts, drops or respells, such as JS's `;` under `semi`.
 */
export const tok = <const S extends string>(text: S) => ({
  via: (name: string) => piece<{ tok: S }>({ t: "tok", text, via: name }),
});

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

/**
 * Every child of the node in source order, side by side, or a space apart with `space`: named children as their
 * rules print them, with their comments, and tokens as written. For a kind no field splits into parts (CSS's),
 * where only the order says what each child is.
 */
export const inOrder = (sep?: Piece<"space">): Piece<"inOrder"> =>
  piece({ t: "inOrder", space: sep !== undefined });

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
