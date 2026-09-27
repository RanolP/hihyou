// The customs collection.ts's `.via`s name: what ruff puts between a collection's brackets.
import { fieldChild } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import { type Dict, type DictComp, outer, type Sequence } from "../fmt/ast.js";
import { commaIn, space, softOrSpace } from "../fmt/builders.js";
import { type Format, group } from "../fmt/elements.js";
import { comprehension, formatExpr, itemStart, sequenceContent } from "../fmt/expr.js";
import { dslPart, part, ruffOf } from "../fmt/sink.js";

/** The expression a dict's item `c` starts with: a pair's key, else the `**` splat. */
const itemExpr = (c: number, ctx: StreamCtx<unknown>) =>
  ruffOf(ctx.tree.kindName(c) === "pair" ? fieldChild(ctx.tree, c, "key") : c);

export const collectionVia = {
  // Given the first item, prints them all: the layout is the list's or set's.
  "collection.sequence": (c: number) => {
    const { f, e: first } = ruffOf(c);
    const e = first.parent as Sequence;
    part(f.parenthesizedContent(() => sequenceContent(f, e), f.comments.dangling(e)));
  },
  "collection.tuple": (c: number) => {
    const { f, e: first } = ruffOf(c);
    const e = first.parent as Sequence;
    const comma = commaIn(f.tree, e.ts, e.ts);
    const [single] = e.elts;
    part(
      f.parenthesizedContent(
        () =>
          e.elts.length === 1 && single
            ? [formatExpr(f, single), comma(single.end)]
            : sequenceContent(f, e),
        f.comments.dangling(e),
      ),
    );
  },
  "collection.dict": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e: first } = itemExpr(c, ctx);
    const e = first.parent as Dict;
    const dangling = f.comments.dangling(e);
    const firstStart = itemStart(e.items[0] as Dict["items"][number]);
    const openComments = dangling.filter((c) => c.end < firstStart);
    const content = () =>
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
      );
    part(f.parenthesizedContent(content, openComments));
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
    const dangling = f.comments.dangling(e);
    const firstStart = outer(e.key).start;
    const openComments = dangling.filter((c) => c.end < firstStart);
    const content = () =>
      group([
        dslPart(c),
        softOrSpace,
        e.generators.flatMap((g, i) =>
          i > 0 ? [softOrSpace, comprehension(f, g)] : [comprehension(f, g)],
        ),
      ]);
    part(f.parenthesizedContent(content, openComments));
  },
};
