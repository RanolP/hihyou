// TEMPORARY ADAPTER, to delete once the JavaScript and Python formatters read handles (docs/research/tree-arena.md,
// "Migration order"). The core formats the arena `Tree` by node handle; these rules still take `FormatNode`
// objects and probe `ctx.source`. `defineLanguage` below wraps each such rule so the core calls it with a view of
// the node (built once per node, so `===` and Map keys keep working) and a `Ctx` that speaks views.

import { NO_NODE, type Tree } from "../core/arena.js";
import type { Placement } from "./comments.js";
import type { Doc } from "./doc.js";
import * as core from "./rules.js";
import type { FormatNode, FormatTree } from "./tree.js";

export type { Grammar, Language, PrintArgs } from "./rules.js";

/** `core.Ctx` over `FormatNode` views, plus the source text the legacy rules probe. */
export interface Ctx<O = unknown> {
  readonly source: string;
  readonly options: O;
  print(node: FormatNode, args?: core.PrintArgs): Doc;
  printBare(node: FormatNode, args?: core.PrintArgs): Doc;
  withComments(node: FormatNode, printed: Doc): Doc;
  items(node: FormatNode): FormatNode[];
  dangling(node: FormatNode): Doc[];
  hasDanglingLineComment(node: FormatNode): boolean;
  hasComment(
    node: FormatNode,
    where: "leadingLine" | "trailingSameLine",
  ): boolean;
  isList(node: FormatNode): boolean;
  comments(node: FormatNode): {
    readonly leading: readonly FormatNode[];
    readonly trailing: readonly FormatNode[];
    readonly dangling: readonly FormatNode[];
  };
  isLineComment(c: FormatNode): boolean;
}

export interface Rule<F extends string = never, O = unknown> {
  (node: FormatNode, ctx: Ctx<O>, args?: core.PrintArgs): Doc;
  readonly reads?: readonly F[];
}

export interface CommentContext<O = unknown> {
  readonly comment: FormatNode;
  readonly text: string;
  readonly placement: Placement;
  readonly enclosing: FormatNode;
  readonly preceding: FormatNode | undefined;
  readonly following: FormatNode | undefined;
  readonly options: O;
}

export interface CommentTarget {
  readonly node: FormatNode;
  readonly as: "leading" | "trailing" | "dangling";
}

export type CommentHandler<O = unknown> = (
  c: CommentContext<O>,
) => CommentTarget | undefined;

export type LanguageSpec<G extends core.Grammar, O> = Omit<
  core.LanguageSpec<G, O>,
  "printComment" | "handleComment" | "printsOwnComments"
> & {
  readonly printComment?: (comment: FormatNode, ctx: Ctx<O>) => Doc;
  readonly handleComment?: CommentHandler<O>;
  readonly printsOwnComments?: (node: FormatNode, ctx: Ctx<O>) => boolean;
};

class View implements FormatNode {
  readonly kind: string;
  readonly named: boolean;
  readonly field: string | undefined;
  readonly missing: boolean;
  readonly start: number;
  readonly end: number;
  private kids: View[] | undefined;

  constructor(
    private readonly views: Views,
    readonly h: number,
  ) {
    const tree = views.tree;
    this.kind = tree.kindName(h);
    this.named = tree.named(h);
    this.field = tree.fieldName(h);
    this.missing = tree.missing(h);
    this.start = tree.start(h);
    this.end = tree.end(h);
  }

  get parent(): View | undefined {
    const p = this.views.tree.parent(this.h);
    return p === NO_NODE ? undefined : this.views.of(p);
  }

  get children(): readonly View[] {
    if (this.kids) return this.kids;
    const { tree } = this.views;
    const kids: View[] = [];
    for (let i = 0, count = tree.count(this.h); i < count; i++)
      kids.push(this.views.of(tree.child(this.h, i)));
    this.kids = kids;
    return kids;
  }
}

class Views {
  private readonly byOrd: (View | undefined)[] = [];
  /** The text the legacy rules probe: the tree keeps it private, as the new rules must not read it. */
  readonly source: string;

  constructor(readonly tree: Tree) {
    this.source = (tree as unknown as { source: string }).source;
  }

  of(h: number): View {
    const ord = this.tree.ord(h);
    let v = this.byOrd[ord];
    if (!v) this.byOrd[ord] = v = new View(this, h);
    return v;
  }
}

const viewsOf = new WeakMap<FormatTree, Views>();
const views = (tree: FormatTree) => {
  let v = viewsOf.get(tree);
  if (!v) viewsOf.set(tree, (v = new Views(tree as Tree)));
  return v;
};

const handle = (n: FormatNode): number => {
  if (n instanceof View) return n.h;
  throw new TypeError(`${n.kind} is no node of the tree being formatted`);
};

const legacyCtxs = new WeakMap<core.Ctx<never>, Ctx<never>>();

function legacyCtx<O>(ctx: core.Ctx<O>): Ctx<O> {
  const cached = legacyCtxs.get(ctx as core.Ctx<never>);
  if (cached) return cached as Ctx<O>;
  const v = views(ctx.tree);
  const of = (h: number) => v.of(h);
  const legacy: Ctx<O> = {
    source: v.source,
    options: ctx.options,
    print: (n, args) => ctx.print(handle(n), args),
    printBare: (n, args) => ctx.printBare(handle(n), args),
    withComments: (n, printed) => ctx.withComments(handle(n), printed),
    items: (n) => ctx.items(handle(n)).map(of),
    dangling: (n) => ctx.dangling(handle(n)),
    hasDanglingLineComment: (n) => ctx.hasDanglingLineComment(handle(n)),
    hasComment: (n, where) => ctx.hasComment(handle(n), where),
    isList: (n) => ctx.isList(handle(n)),
    comments(n) {
      const c = ctx.comments(handle(n));
      return {
        leading: c.leading.map(of),
        trailing: c.trailing.map(of),
        dangling: c.dangling.map(of),
      };
    },
    isLineComment: (c) => ctx.isLineComment(handle(c)),
  };
  legacyCtxs.set(ctx as core.Ctx<never>, legacy as Ctx<never>);
  return legacy;
}

/** `core.defineLanguage` for rules over `FormatNode`. */
export function defineLanguage<const G extends core.Grammar, O>(
  grammar: G,
  spec: LanguageSpec<G, O>,
  define: () => { readonly [kind: string]: Rule<string, O> | undefined },
): core.Language<O> {
  const { printComment, handleComment, printsOwnComments } = spec;
  const table: Record<string, core.Rule<string, O>> = {};
  for (const [kind, rule] of Object.entries(define()))
    if (rule)
      table[kind] = (h, ctx, args) =>
        rule(views(ctx.tree).of(h), legacyCtx(ctx), args);
  return core.defineLanguage(
    grammar,
    {
      ...spec,
      printComment:
        printComment &&
        ((c, ctx) => printComment(views(ctx.tree).of(c), legacyCtx(ctx))),
      handleComment:
        handleComment &&
        ((c) => {
          const v = views(c.tree);
          const opt = (h: number | undefined) =>
            h === undefined ? undefined : v.of(h);
          const target = handleComment({
            comment: v.of(c.comment),
            text: c.text,
            placement: c.placement,
            enclosing: v.of(c.enclosing),
            preceding: opt(c.preceding),
            following: opt(c.following),
            options: c.options,
          });
          return target && { node: handle(target.node), as: target.as };
        }),
      printsOwnComments:
        printsOwnComments &&
        ((n, ctx) => printsOwnComments(views(ctx.tree).of(n), legacyCtx(ctx))),
    } as core.LanguageSpec<G, O>,
    () => table as never,
  );
}
