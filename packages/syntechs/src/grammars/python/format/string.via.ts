// The customs string.ts's rules name.
import { NO_NODE } from "../../../core/arena.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import { exprAst, type Expr, type Str } from "../fmt/ast.js";
import { PAREN } from "../fmt/builders.js";
import { formatExpr, leftMost } from "../fmt/expr.js";
import {
  capture,
  close,
  COLLAPSE,
  GROUP,
  INDENT,
  open,
  part,
  place,
  removeSoftLines,
  ruffFmt,
  ruffOf,
  SOFT,
  sLine,
  sText,
  sToken,
} from "../fmt/sink.js";
import {
  formatStr,
  isInterpolated,
  normalizeString,
  partArgs,
  type PartArgs,
  partOf,
  quotesOf,
  sMultiline,
} from "../fmt/strings.js";
import { endOf, hasLineBreak, startOf } from "../fmt/trivia.js";

/** The args a string part's custom hands its leaves; every leaf prints only under a part. */
function argsOf(ctx: StreamCtx<unknown>): PartArgs {
  const args = ctx.args as PartArgs | undefined;
  if (!args) throw new Error("python string: a string's leaf printed outside its part");
  return args;
}

/** Whether ruff pads an interpolation's expression from its braces, so `{ {…} }` does not read as `{{`. */
function needsBracketSpacing(e: Expr): boolean {
  if (e.kind === "Tuple" && e.open === undefined && e.elts.length === 1) return false;
  const l = leftMost(e);
  return l.kind === "Dict" || l.kind === "DictComp" || l.kind === "Set" || l.kind === "SetComp";
}

export const stringVia = {
  // A concatenation's layout: its parts joined into one string when they merge, else each on its own.
  "string.concatenated": (c: number) => {
    const { f, e } = ruffOf(c);
    part(formatStr(f, e as Str));
  },
  // A part printed on its own takes the quotes `chooseQuotes` picks; a concatenation passes those it merges into.
  "string.part": (c: number, ctx: StreamCtx<unknown>) => {
    const p = partOf(ctx.tree, c);
    const args = (ctx.args as PartArgs | undefined) ?? partArgs(ruffFmt(), p);
    ctx.printNode(p.start, args);
    for (const e of p.elements) ctx.printNode(e, args);
    ctx.printNode(p.end, args);
  },
  "string.start": (c: number, ctx: StreamCtx<unknown>) => {
    const { flags, opens } = argsOf(ctx);
    sToken(c, opens ? flags.prefix + quotesOf(flags) : "");
  },
  "string.end": (c: number, ctx: StreamCtx<unknown>) => {
    const { flags, closes } = argsOf(ctx);
    sToken(c, closes ? quotesOf(flags) : "");
  },
  // A literal joined into a merged f-string escapes its braces; an f-string's own literals already do.
  "string.content": (c: number, ctx: StreamCtx<unknown>) => {
    const { flags, joined } = argsOf(ctx);
    const text = ctx.tree.text(c);
    if (joined) sToken(c, normalizeString(text, 0, flags, isInterpolated(flags)));
    else sMultiline(c, normalizeString(text, 0, flags, false));
  },
  // Ruff's `FormatInterpolatedElement`. Its expression reads the enclosing string's quotes and layout from
  // `f.fstr`, dynamic context rather than args, since they reach any string or collection nested at any depth.
  "string.interpolation": (interp: number, ctx: StreamCtx<unknown>) => {
    const { flags, multiline } = argsOf(ctx);
    const f = ruffFmt();
    const cs = f.comments;
    const tree = f.tree;
    const n = tree.count(interp);
    let debug = false;
    for (let i = 0; i < n; i++) {
      const c = tree.child(interp, i);
      if (!tree.named(c) && tree.kindName(c) === "=") debug = true;
    }
    const interpStart = startOf(tree, interp);
    const interpEnd = endOf(tree, interp);
    const inside = cs.all.filter((c) => c.start > interpStart && c.end < interpEnd);
    if (debug || inside.length > 0) {
      for (const c of inside) c.formatted = true;
      sMultiline(interp, f.text(interp));
      return;
    }
    const byField = (name: string): number => {
      for (let i = 0; i < n; i++) {
        const c = tree.child(interp, i);
        if (tree.fieldName(c) === name) return c;
      }
      return NO_NODE;
    };
    const exprNode = byField("expression");
    if (exprNode === NO_NODE) {
      sToken(interp, f.text(interp));
      return;
    }
    const lbrace = tree.child(interp, 0);
    const rbrace = tree.child(interp, n - 1);
    const conversion = byField("type_conversion");
    const spec = byField("format_specifier");
    const e = exprAst(tree, exprNode);
    const multiline2 =
      multiline &&
      (flags.triple || hasLineBreak(tree, interpStart, spec !== NO_NODE ? startOf(tree, spec) : interpEnd));
    const spaced = needsBracketSpacing(e);
    const bracket = () => {
      if (!spaced) return;
      if (multiline2) sLine(COLLAPSE);
      else sText(" ");
    };
    const item = () => {
      bracket();
      part(formatExpr(f, e));
      if (conversion !== NO_NODE) ctx.printNode(conversion);
      if (spec !== NO_NODE) ctx.printNode(spec);
      if (conversion === NO_NODE && spec === NO_NODE) bracket();
    };
    const saved = f.fstr;
    f.fstr = { k: saved.k === "outside" ? "inside" : "nested", flags, multiline: multiline2 };
    try {
      sToken(lbrace, f.text(lbrace));
      f.at(PAREN, () => {
        if (!multiline) return place(removeSoftLines(capture(item)));
        // Ruff's `group(indent([soft, item]))` with a spec, else `group(soft_block_indent(item))`.
        open(GROUP);
        open(INDENT);
        sLine(SOFT | COLLAPSE);
        item();
        close();
        if (spec === NO_NODE) sLine(SOFT | COLLAPSE);
        close();
      });
      sToken(rbrace, f.text(rbrace));
    } finally {
      f.fstr = saved;
    }
  },
};
