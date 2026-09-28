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
import { type Fmt, PAREN, writeCommaIn } from "../fmt/builders.js";
import {
  type ComprehensionComments,
  comprehensionComments,
  itemStart,
  writeComprehensionBody,
  writeComprehensionSpacer,
  writeExpr,
  writeSequenceContent,
} from "../fmt/expr.js";
import { COLLAPSE, close as sClose, GROUP, open as sOpen, ruffOf, sDsl, sLine, sText } from "../fmt/sink.js";

/** The expression a dict's item `c` starts with: a pair's key, else the `**` splat. */
const itemExpr = (c: number, ctx: StreamCtx<unknown>) =>
  ruffOf(ctx.tree.kindName(c) === "pair" ? fieldChild(ctx.tree, c, "key") : c);

/** A dict's item as ruff prints it: a pair from its DSL spec in one group, else a `**` splat or a bare value. */
function writeDictItem(f: Fmt, item: Dict["items"][number]): void {
  if (item.key && item.colon !== undefined) {
    sOpen(GROUP);
    sDsl(f.tree.parent(item.colon));
    sClose();
  } else if (item.value.kind === "Starred") {
    const s = item.value;
    const cs = f.comments;
    f.writeLeading(cs.leading(s));
    f.writeLeading(cs.leading(s.value));
    sOpen(GROUP);
    f.writeTok(s.op);
    f.writeDangling(cs.dangling(s));
    writeExpr(f, s.value);
    sClose();
    f.writeTrailing(cs.trailing(s));
  } else writeExpr(f, item.value);
}

export const collectionVia = {
  // Ruff's frame of a collection or comprehension: its dangling comments after the opening bracket (a dict's and a
  // dict comprehension's only those before the first item), or all of them between the brackets of an empty one.
  "collection.brackets": (node: number, _: StreamCtx<unknown>, frame: Frame) => {
    const { f, e } = ruffOf(node);
    const { open, body, close } = frame;
    const dangling = f.comments.dangling(e);
    if (e.kind === "Dict" || e.kind === "DictComp") {
      const first = e.kind === "Dict" ? e.items[0] : e;
      if (first === undefined)
        return f.at(PAREN, () => f.writeEmptyParenthesized(open, dangling, close));
      const firstStart = e.kind === "Dict" ? itemStart(first as Dict["items"][number]) : outer(e.key).start;
      return f.writeParenthesized(open, body, close, dangling.filter((c) => c.end < firstStart));
    }
    if (e.kind !== "ListComp" && e.kind !== "SetComp" && e.kind !== "Generator" && (e as Sequence).elts.length === 0)
      return f.at(PAREN, () => f.writeEmptyParenthesized(open, dangling, close));
    f.writeParenthesized(open, body, close, dangling);
  },
  // Given the first item, prints them all: the layout is the list's or set's.
  "collection.sequence": (c: number) => {
    const { f, e: first } = ruffOf(c);
    writeSequenceContent(f, first.parent as Sequence);
  },
  "collection.tuple": (c: number) => {
    const { f, e: first } = ruffOf(c);
    const e = first.parent as Sequence;
    const [single] = e.elts;
    if (e.elts.length === 1 && single) {
      writeExpr(f, single);
      writeCommaIn(f.tree, e.ts, e.ts)(single.end);
    } else writeSequenceContent(f, e);
  },
  "collection.dict": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e: first } = itemExpr(c, ctx);
    const e = first.parent as Dict;
    f.writeJoinCommaSeparated(
      e.items.map((item) => ({ end: item.value.end, write: () => writeDictItem(f, item) })),
      e.end,
      writeCommaIn(f.tree, e.ts, e.ts),
    );
  },
  "collection.pairKey": (c: number) => {
    const { f, e } = ruffOf(c);
    if (e.parent?.kind !== "DictComp") return writeExpr(f, e);
    sOpen(GROUP);
    writeExpr(f, e);
    sClose();
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
    if (mine.length === 0) sText(" ");
    else f.writeDangling(mine);
    writeExpr(f, e);
  },
  // Given the key and value's pair, prints the comprehension's body: the pair and its clauses in one group.
  "collection.dictComp": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e: key } = ruffOf(fieldChild(ctx.tree, c, "key"));
    const e = key.parent as DictComp;
    sOpen(GROUP);
    writeComprehensionBody(f, e, () => sDsl(c));
    sClose();
  },
  // Given the element, prints a list, set or generator comprehension's body: the element and its clauses in one group.
  "collection.comp": (c: number) => {
    const { f, e: elt } = ruffOf(c);
    const e = elt.parent as Comp;
    sOpen(GROUP);
    writeComprehensionBody(f, e, () => {
      sOpen(GROUP);
      writeExpr(f, e.elt);
      sClose();
    });
    sClose();
  },
  // The for clause's target between the comments ruff keeps before and after it.
  "collection.forTarget": (c: number) => {
    const { f, e: target } = ruffOf(c);
    const { beforeTarget, beforeIn } = comprehensionComments(f, target.parent as Comprehension);
    f.writeTrailing(beforeTarget);
    writeComprehensionSpacer(f, target, target.kind !== "Tuple");
    if (target.kind === "Tuple") writeExpr(f, target, "preserve", { tuple: "never" });
    else writeExpr(f, target);
    if (beforeIn.length === 0) sText(" ");
    else sLine(COLLAPSE);
    f.writeLeading(beforeIn);
  },
  // Given the iterable's first expression, prints the whole iterable, an unparenthesized tuple included.
  "collection.forIter": (c: number, ctx: StreamCtx<unknown>) => {
    const clause = ctx.tree.parent(c);
    const { f, e: target } = ruffOf(fieldChild(ctx.tree, clause, "left"));
    const comp = target.parent as Comprehension;
    const { trailingIn } = comprehensionComments(f, comp);
    f.writeTrailing(trailingIn);
    writeComprehensionSpacer(f, comp.iter, true);
    writeExpr(f, comp.iter);
  },
  "collection.ifTest": (c: number) => {
    const { f, e: test } = ruffOf(c);
    const comp = test.parent as Comprehension;
    const i = comp.ifs.findIndex((x) => x.test === test);
    const { eol } = comprehensionComments(f, comp).ifs[i] as ComprehensionComments["ifs"][number];
    f.writeTrailing(eol);
    writeComprehensionSpacer(f, test, true);
    writeExpr(f, test);
  },
};
