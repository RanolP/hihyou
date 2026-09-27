// The customs stmt-def.ts's `.via`s name: a definition's part as ruff lays it out, looked up by the definition.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { Frame } from "../../../fmt/dsl/runtime.js";
import type { ClassDef, Decorator, FunctionDef, Lambda, Parameter, TypeAlias } from "../fmt/ast.js";
import { writeAliasTypeParams } from "../fmt/stmt/assign.js";
import { type Format, group } from "../fmt/elements.js";
import { hard, space } from "../fmt/builders.js";
import { args, formatExpr, maybeParenthesize, writeParameters } from "../fmt/expr.js";
import { dslPart, part, ruffOf, ruffStmtOf } from "../fmt/sink.js";
import { body, decorators, splitDangling, writeSimpleType, writeTypeParams } from "../fmt/stmt/defs.js";
import { endOf, tokens } from "../fmt/trivia.js";

export const stmtDefVia = {
  // Given the first decorator, prints them all, then what separates the last from the header.
  "def.decorators": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    const def = s as FunctionDef | ClassDef;
    const [leadingDef] = splitDangling(f, def);
    part(decorators(f, def.decorators, leadingDef));
  },
  "def.decorator": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Decorator, "optional"));
  },
  "def.async": (token: number | undefined) => {
    if (token === undefined) return;
    const { f } = ruffStmtOf(token);
    part([f.tok(token), space]);
  },
  // A definition's or a type alias's (under its `generic_type`) type parameters in their brackets.
  "def.typeParams": (node: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const t = ctx.tree;
    const parent = t.parent(node);
    if (t.kindName(parent) === "generic_type") {
      // The alias's left side, which tree-sitter may wrap in a `type`.
      const left = t.kindName(t.parent(parent)) === "type" ? t.parent(parent) : parent;
      const { f, s } = ruffStmtOf(left);
      const tp = (s as TypeAlias).typeParams;
      // A subscript's `list[int]` is a `generic_type` too, whose brackets ruff prints as a subscript's.
      if (s.kind !== "TypeAlias" || tp?.ts !== node)
        throw new Error("python: def.typeParams on a generic_type's brackets other than a type alias's");
      writeAliasTypeParams(f, tp, frame);
    } else {
      const { f, s } = ruffStmtOf(node);
      const tp = (s as FunctionDef | ClassDef).typeParams;
      if (tp) writeTypeParams(f, tp, frame);
    }
  },
  // A definition's bound prints from its tokens (`ctx.args.boundTokens`), a type alias's as an expression.
  "def.bound": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(c);
    if (ctx.args?.boundTokens === true) writeSimpleType(f, c);
    else part(formatExpr(f, e));
  },
  // Ruff's `format_function_header` from the parameters on: they and the return type break as one group.
  "def.signature": (c: number) => {
    const { f, s: def } = ruffStmtOf(c);
    const s = def as FunctionDef;
    const cs = f.comments;
    const p = s.params;
    const emptyParams = p.items.length === 0 && !cs.has(p);
    const inner: Format[] = [dslPart(p.ts)];
    const ret = s.returns;
    if (ret && s.arrow !== undefined) {
      inner.push(space, f.tok(s.arrow), space);
      if (ret.kind === "Tuple")
        inner.push(formatExpr(f, ret, cs.hasLeading(ret) ? "always" : "never"));
      // Parenthesized so the comment cannot become the header's own on the next run.
      else if (cs.hasTrailing(ret)) inner.push(formatExpr(f, ret, "always"));
      else
        inner.push(
          maybeParenthesize(
            f,
            ret,
            s,
            emptyParams ? "ifBreaksParenthesized" : "ifBreaks",
          ),
        );
    }
    part(group(inner));
  },
  // A `def`'s parameters in their parentheses: ruff lays out the list, splitting its comments by position.
  "def.parameters": (node: number, _: StreamCtx<unknown>, frame: Frame) => {
    const { f, s } = ruffStmtOf(node);
    const p = (s as FunctionDef).params;
    // Ruff's empty `soft_block_indent` prints nothing, where the shared `emptyParenthesized` still breaks.
    const empty =
      p.items.length === 0 && !f.comments.has(p) && p.open !== undefined && p.close !== undefined;
    if (empty) {
      frame.open();
      frame.close();
    } else writeParameters(f, p, frame);
  },
  "def.lambdaParameters": (node: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(node));
    const p = (e as Lambda).params;
    if (p) writeParameters(f, p, "never");
  },
  // Ruff's `class` arguments: an empty list is dropped, keeping its end-of-line comments.
  "def.classArgs": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    const a = (s as ClassDef).args;
    if (a) {
      const dangling = f.comments.dangling(a);
      if (a.items.length === 0 && dangling.every((c) => c.line === "eol"))
        part(f.trailing(dangling));
      else part(args(f, a));
    }
  },
  // The comments after the colon, then the body.
  "def.body": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    const def = s as FunctionDef | ClassDef;
    const [, trailingDef] = splitDangling(f, def);
    part([
      f.trailing(trailingDef),
      body(f, def, def.body, def.kind === "FunctionDef" ? "function" : "class", trailingDef),
    ]);
  },
  // An annotation with a leading comment of its own starts on the next line, unless parenthesized.
  "def.annotation": (c: number) => {
    const { f, e } = ruffOf(c);
    part([f.comments.hasLeading(e) && e.parens.length === 0 ? hard : space, formatExpr(f, e)]);
  },
  // A default whose leading comment follows the `=` starts on the next line.
  "def.default": (c: number) => {
    const { f, e } = ruffOf(c);
    const p = e.parent as Parameter;
    const cs = f.comments;
    const lead = cs.leading(e)[0];
    let breakLeading = false;
    if (lead) {
      let sawEq = false;
      breakLeading = true;
      const from = p.annotation ? p.annotation.end : endOf(f.tree, p.name);
      for (const t of tokens(f.tree, from, lead.start)) {
        if (t.kind === ")" && !sawEq) continue;
        if (t.kind === "=" && !sawEq) {
          sawEq = true;
          continue;
        }
        if (t.kind === "(") breakLeading = false;
        break;
      }
    }
    const lineBreak = breakLeading;
    const sp = p.annotation ? space : [];
    part([lineBreak ? hard : sp, formatExpr(f, e)]);
  },
};
