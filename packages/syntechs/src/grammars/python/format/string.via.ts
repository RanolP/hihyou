// The customs string.ts's rules name.
import { NO_NODE } from "../../../core/arena.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import { sLineSuffixBoundary } from "../../../fmt/stream.js";
import { exprAst, type Expr, type Str } from "../fmt/ast.js";
import { PAREN } from "../fmt/builders.js";
import { attachInterpolation } from "../fmt/comments.js";
import { leftMost, writeExpr } from "../fmt/expr.js";
import {
  capture,
  close,
  COLLAPSE,
  GROUP,
  HARD,
  INDENT,
  open,
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
  isInterpolated,
  normalizeString,
  partArgs,
  type PartArgs,
  partOf,
  quotesOf,
  sMultiline,
  supportsPep701,
  writeStr,
} from "../fmt/strings.js";
import { endOf, hasLineBreak, linesBefore, startOf } from "../fmt/trivia.js";

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
    writeStr(f, e as Str);
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
  // A format spec: its literal characters (hidden tokens between the children) escaped for the string's quotes, its fields formatted.
  "string.spec": (spec: number, ctx: StreamCtx<unknown>) => {
    const tree = ctx.tree;
    const { flags } = argsOf(ctx);
    // A line break in the literal breaks the field's group around it, as ruff's multiline text does.
    const literal = (s: string) => {
      if (s.includes("\n")) sMultiline(spec, normalizeString(s, 0, flags, false));
      else if (s !== "") sText(normalizeString(s, 0, flags, false));
    };
    const text = tree.text(spec);
    let last = 0;
    for (let i = 0, n = tree.count(spec); i < n; i++) {
      const c = tree.child(spec, i);
      // Literal characters hold no brace, so a field (or the leading `:`) is found where it starts.
      const at = text.indexOf(tree.text(c), last);
      if (at > last) literal(text.slice(last, at));
      ctx.printNode(c, ctx.args);
      last = at + tree.text(c).length;
    }
    // The spec runs to the field's `}`, but tree-sitter leaves a trailing line break (never part of a literal
    // token) outside the node.
    const field = tree.text(tree.parent(spec));
    literal(text.slice(last) + field.slice(field.lastIndexOf(text) + text.length, -1));
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
    // A debug field's text through its `=` is its output, so it prints as written, comments and all; ruff's
    // `debug_text`. Its conversion and spec follow with no whitespace, as for any field.
    if (debug) {
      for (const c of inside) c.formatted = true;
      // The tree keeps no offsets, so the text through `=` is what remains once the tail is cut off the end.
      let head = tree.text(interp).slice(0, -1).trimEnd();
      for (const t of [spec, conversion])
        if (t !== NO_NODE) head = head.slice(0, -tree.text(t).trimEnd().length).trimEnd();
      sMultiline(interp, head + tree.text(interp).slice(head.length).match(/^\s*/)?.[0]);
      if (conversion !== NO_NODE) ctx.printNode(conversion);
      // The spec is literal text through the `}`, whitespace included.
      if (spec !== NO_NODE) {
        const whole = tree.text(interp);
        sMultiline(spec, whole.slice(whole.lastIndexOf(tree.text(spec)), -1));
      }
      sToken(rbrace, f.text(rbrace));
      return;
    }
    const e = exprAst(tree, exprNode);
    // A layout that tries this field more than once (best fitting) prints its comments in each attempt.
    for (const c of inside) c.formatted = false;
    // A format spec's own fields place theirs.
    const dangling = attachInterpolation(
      cs,
      tree,
      e,
      spec === NO_NODE ? inside : inside.filter((c) => c.end < startOf(tree, spec)),
    );
    const multiline2 =
      multiline &&
      (supportsPep701(f) || flags.triple || hasLineBreak(tree, interpStart, spec !== NO_NODE ? startOf(tree, spec) : interpEnd));
    const spaced = needsBracketSpacing(e);
    const bracket = () => {
      if (!spaced) return;
      if (multiline2) sLine(COLLAPSE);
      else sText(" ");
    };
    const item = () => {
      bracket();
      // Before a spec, the expression's own-line trailing comments print at once rather than as line suffixes the
      // spec's boundary flushes, so the expression's own groups measure only up to them and stay flat when they fit.
      const own = spec !== NO_NODE ? cs.trailing(e).filter((c) => c.line === "own" && !c.formatted) : [];
      for (const c of own) c.formatted = true;
      writeExpr(f, e);
      for (const c of own) {
        f.writeEmptyLines(linesBefore(tree, c.start));
        f.writeComment(c);
      }
      if (own.length > 0) sLine(HARD | COLLAPSE);
      if (conversion !== NO_NODE) ctx.printNode(conversion);
      // The expression's trailing comments print before the spec, which would otherwise read them as its text.
      if (spec !== NO_NODE) {
        sLineSuffixBoundary();
        ctx.printNode(spec, ctx.args);
      }
      if (conversion === NO_NODE && spec === NO_NODE) bracket();
    };
    const saved = f.fstr;
    // A format spec's field belongs to the string its enclosing field does, one level no deeper (ruff#28218).
    if (tree.kindName(interp) !== "format_expression")
      f.fstr = { k: saved.k === "outside" ? "inside" : "nested", flags, multiline: multiline2 };
    try {
      sToken(lbrace, f.text(lbrace));
      f.at(PAREN, () => {
        if (!multiline) return place(removeSoftLines(capture(item)));
        // Ruff's `group(indent([soft, item]))` with a spec, else `group(soft_block_indent(item))`.
        open(GROUP);
        f.writeDanglingOpenParen(dangling);
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
