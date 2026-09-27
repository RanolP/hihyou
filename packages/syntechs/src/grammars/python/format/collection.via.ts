// The customs collection.ts's `.via`s name: what ruff puts between a collection's brackets.
import { type Frame, fieldChild } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import {
  type Comp,
  type Comprehension,
  type Dict,
  type DictComp,
  outer,
  type Sequence,
} from "../fmt/ast.js";
import { commaIn, PAREN, space, softOrSpace } from "../fmt/builders.js";
import { type Format, group } from "../fmt/elements.js";
import {
  type ComprehensionComments,
  comprehension,
  comprehensionComments,
  comprehensionSpacer,
  formatExpr,
  itemStart,
  sequenceContent,
} from "../fmt/expr.js";
import { dslPart, frameParts, part, ruffOf } from "../fmt/sink.js";

/** The expression a dict's item `c` starts with: a pair's key, else the `**` splat. */
const itemExpr = (c: number, ctx: StreamCtx<unknown>) =>
  ruffOf(ctx.tree.kindName(c) === "pair" ? fieldChild(ctx.tree, c, "key") : c);

export const collectionVia = {
  // Ruff's frame of a collection or comprehension: its dangling comments after the opening bracket (a dict's and a
  // dict comprehension's only those before the first item), or all of them between the brackets of an empty one.
  "collection.brackets": (node: number, _: StreamCtx<unknown>, frame: Frame) => {
    const { f, e } = ruffOf(node);
    const { open, body, close } = frameParts(frame);
    const dangling = f.comments.dangling(e);
    if (e.kind === "Dict" || e.kind === "DictComp") {
      const first = e.kind === "Dict" ? e.items[0] : e;
      if (first === undefined)
        return part(f.at(PAREN, () => f.emptyParenthesized(open, dangling, close)));
      const firstStart = e.kind === "Dict" ? itemStart(first as Dict["items"][number]) : outer(e.key).start;
      return part(f.parenthesized(open, body, close, dangling.filter((c) => c.end < firstStart)));
    }
    if (e.kind !== "ListComp" && e.kind !== "SetComp" && e.kind !== "Generator" && (e as Sequence).elts.length === 0)
      return part(f.at(PAREN, () => f.emptyParenthesized(open, dangling, close)));
    part(f.parenthesized(open, body, close, dangling));
  },
  // Given the first item, prints them all: the layout is the list's or set's.
  "collection.sequence": (c: number) => {
    const { f, e: first } = ruffOf(c);
    part(sequenceContent(f, first.parent as Sequence));
  },
  "collection.tuple": (c: number) => {
    const { f, e: first } = ruffOf(c);
    const e = first.parent as Sequence;
    const comma = commaIn(f.tree, e.ts, e.ts);
    const [single] = e.elts;
    part(
      e.elts.length === 1 && single
        ? [formatExpr(f, single), comma(single.end)]
        : sequenceContent(f, e),
    );
  },
  "collection.dict": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e: first } = itemExpr(c, ctx);
    const e = first.parent as Dict;
    part(
      f.joinCommaSeparated(
        e.items.map((item) => {
          const end = item.value.end;
          let doc: Format;
          if (item.key && item.colon !== undefined) doc = group(dslPart(f.tree.parent(item.colon)));
          else if (item.value.kind === "Starred") {
            const s = item.value;
            const cs = f.comments;
            doc = [
              f.leading(cs.leading(s)),
              f.leading(cs.leading(s.value)),
              group([f.tok(s.op), f.dangling(cs.dangling(s)), formatExpr(f, s.value)]),
              f.trailing(cs.trailing(s)),
            ];
          } else doc = formatExpr(f, item.value);
          return { end, doc };
        }),
        e.end,
        commaIn(f.tree, e.ts, e.ts),
      ),
    );
  },
  "collection.pairKey": (c: number) => {
    const { f, e } = ruffOf(c);
    part(e.parent?.kind === "DictComp" ? group(formatExpr(f, e)) : formatExpr(f, e));
  },
  // The comments between the colon and the value, which ruff keeps there, else a space.
  "collection.pairValue": (c: number) => {
    const { f, e } = ruffOf(c);
    const p = e.parent as Dict | DictComp;
    const dangling = f.comments.dangling(p);
    let mine: typeof dangling;
    if (p.kind === "DictComp") {
      const firstStart = outer(p.key).start;
      mine = dangling.filter((c) => c.end >= firstStart);
    } else {
      // Each item takes the dict's comments that end past the first item and start inside it.
      const i = p.items.findIndex((item) => item.value === e);
      const firstStart = itemStart(p.items[0] as Dict["items"][number]);
      const prevEnd = i > 0 ? (p.items[i - 1] as Dict["items"][number]).value.end : -Infinity;
      mine = dangling.filter((c) => c.end >= firstStart && c.start >= prevEnd && c.start < e.end);
    }
    part([mine.length === 0 ? space : f.dangling(mine), formatExpr(f, e)]);
  },
  // Given the key and value's pair, prints the comprehension's body: the pair and its clauses in one group.
  "collection.dictComp": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e: key } = ruffOf(fieldChild(ctx.tree, c, "key"));
    const e = key.parent as DictComp;
    part(
      group([
        dslPart(c),
        softOrSpace,
        e.generators.flatMap((g, i) =>
          i > 0 ? [softOrSpace, comprehension(f, g)] : [comprehension(f, g)],
        ),
      ]),
    );
  },
  // Given the element, prints a list, set or generator comprehension's body: the element and its clauses in one group.
  "collection.comp": (c: number) => {
    const { f, e: elt } = ruffOf(c);
    const e = elt.parent as Comp;
    part(
      group([
        group(formatExpr(f, e.elt)),
        softOrSpace,
        e.generators.flatMap((g, i) =>
          i > 0 ? [softOrSpace, comprehension(f, g)] : [comprehension(f, g)],
        ),
      ]),
    );
  },
  "collection.async": (t: number | undefined, node: number, ctx: StreamCtx<unknown>) => {
    if (t === undefined) return;
    const { f } = ruffOf(fieldChild(ctx.tree, node, "left"));
    part([f.tok(t), space]);
  },
  // The for clause's target between the comments ruff keeps before and after it.
  "collection.forTarget": (c: number) => {
    const { f, e: target } = ruffOf(c);
    const { beforeTarget, beforeIn } = comprehensionComments(f, target.parent as Comprehension);
    part([
      f.trailing(beforeTarget),
      comprehensionSpacer(f, target, target.kind !== "Tuple"),
      target.kind === "Tuple"
        ? formatExpr(f, target, "preserve", { tuple: "never" })
        : formatExpr(f, target),
      beforeIn.length === 0 ? space : softOrSpace,
      f.leading(beforeIn),
    ]);
  },
  // Given the iterable's first expression, prints the whole iterable, an unparenthesized tuple included.
  "collection.forIter": (c: number, ctx: StreamCtx<unknown>) => {
    const clause = ctx.tree.parent(c);
    const { f, e: target } = ruffOf(fieldChild(ctx.tree, clause, "left"));
    const comp = target.parent as Comprehension;
    const { trailingIn } = comprehensionComments(f, comp);
    part([f.trailing(trailingIn), comprehensionSpacer(f, comp.iter, true), formatExpr(f, comp.iter)]);
  },
  "collection.ifTest": (c: number) => {
    const { f, e: test } = ruffOf(c);
    const comp = test.parent as Comprehension;
    const i = comp.ifs.findIndex((x) => x.test === test);
    const { eol } = comprehensionComments(f, comp).ifs[i] as ComprehensionComments["ifs"][number];
    part([f.trailing(eol), comprehensionSpacer(f, test, true), formatExpr(f, test)]);
  },
};
