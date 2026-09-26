import { type Doc, group, ifBreak, synthetic } from "../../../../fmt/doc.js";
import type { Alias, Expr, Simple } from "../ast.js";
import {
  commaIn,
  type Fmt,
  soft,
  softBlockIndent,
  space,
} from "../builders.js";
import { formatExpr, maybeParenthesize, node } from "../expr.js";
import type { StmtRules } from "./suite.js";

/** Ruff's one-line statements (statement/stmt_{expr,pass,return,raise,assert,delete,global,import,...}.rs). */

// Ruff's `is_arithmetic_like`: an expression statement it wraps in optional parentheses to break.
const arithmeticOps = new Set(["|", "^", "<<", ">>", "+", "-"]);

const keywordOnly = (f: Fmt, s: Simple) => f.tok(s.kw);

function names(f: Fmt, s: Simple, sep: Doc): Doc {
  return s.names.map((n, i) => {
    const comma = s.commas[i - 1];
    return i === 0 || !comma ? f.tok(n) : [f.tok(comma), sep, f.tok(n)];
  });
}

/** Ruff's `FormatStmtGlobal` / `FormatStmtNonlocal`: breaks with a backslash, since the names take no brackets. */
function global(f: Fmt, s: Simple): Doc {
  if (f.comments.hasTrailing(s))
    return [f.tok(s.kw), space, names(f, s, space)];
  const backslash = ifBreak(synthetic(s.kw, "\\"));
  return [
    f.tok(s.kw),
    space,
    group([
      backslash,
      soft,
      softBlockIndent(names(f, s, [space, backslash, soft])),
    ]),
  ];
}

function alias(f: Fmt, a: Alias): Doc {
  const cs = f.comments;
  const out: Doc[] = [f.leading(cs.leading(a)), a.name.map((t) => f.tok(t))];
  if (a.asTok && a.asname)
    out.push(space, f.tok(a.asTok), space, f.tok(a.asname));
  out.push(f.trailing(cs.dangling(a)), f.trailing(cs.trailing(a)));
  return out;
}

export const simpleRules: StmtRules = {
  Expr(f, s) {
    const v = s.value;
    if (v.kind === "BinOp" && arithmeticOps.has(v.op.kind))
      return maybeParenthesize(f, v, s, "optional");
    return formatExpr(f, v);
  },
  Pass: keywordOnly,
  Break: keywordOnly,
  Continue: keywordOnly,
  Return(f, s) {
    const v = s.values[0];
    if (!v) return f.tok(s.kw);
    if (v.kind === "Tuple" && !f.comments.hasLeading(v))
      return [f.tok(s.kw), space, node(f, v, { tuple: "optionalParentheses" })];
    // TODO(C2): ruff's `FormatStatementsLastExpression::left_to_right`.
    return [f.tok(s.kw), space, maybeParenthesize(f, v, s, "ifBreaks")];
  },
  Raise(f, s) {
    const [exc, cause] = s.values;
    const out: Doc[] = [f.tok(s.kw)];
    if (exc) out.push(space, maybeParenthesize(f, exc, s, "optional"));
    if (cause && s.sep)
      out.push(
        space,
        f.tok(s.sep),
        space,
        maybeParenthesize(f, cause, s, "optional"),
      );
    return out;
  },
  Assert(f, s) {
    const [test, msg] = s.values;
    const out: Doc[] = [f.tok(s.kw)];
    if (test) out.push(space, maybeParenthesize(f, test, s, "ifBreaks"));
    if (msg && s.sep)
      out.push(
        f.tok(s.sep),
        space,
        maybeParenthesize(f, msg, s, "ifBreaksParenthesized"),
      );
    return out;
  },
  Delete(f, s) {
    const v = s.values[0];
    if (!v) return f.tok(s.kw);
    // `del a, b` has several targets; `del (a, b)` has one, a tuple.
    const targets: Expr[] = v.kind === "Tuple" && !v.open ? v.elts : [v];
    const [single] = targets;
    if (targets.length === 1 && single)
      return [f.tok(s.kw), space, maybeParenthesize(f, single, s, "ifBreaks")];
    const comma = commaIn(v.ts, v.ts);
    const entries = targets.map((t) => ({ end: t.end, doc: formatExpr(f, t) }));
    return [
      f.tok(s.kw),
      space,
      f.parenthesizeIfExpands(s.kw, () =>
        f.joinCommaSeparated(entries, s.end, comma),
      ),
    ];
  },
  Global: global,
  Nonlocal: global,
  Import(f, s) {
    const comma = commaIn(s.ts, s.kw);
    return [
      f.tok(s.kw),
      space,
      s.names.map((a, i) =>
        i === 0
          ? alias(f, a)
          : [comma(s.names[i - 1]?.end ?? a.start), space, alias(f, a)],
      ),
    ];
  },
  ImportFrom(f, s) {
    const head: Doc = [
      f.tok(s.fromKw),
      space,
      s.module.map((t) => f.tok(t)),
      space,
      f.tok(s.importKw),
      space,
    ];
    if (s.star) return [head, f.tok(s.star)];
    const comma = commaIn(s.ts, s.importKw);
    const entries = s.names.map((a) => ({ end: a.end, doc: alias(f, a) }));
    const list = () => f.joinCommaSeparated(entries, s.end, comma, true);
    const dangling = f.comments.dangling(s);
    if (dangling.length === 0)
      return [head, f.parenthesizeIfExpands(s.importKw, list)];
    const open = s.open ? f.tok(s.open) : synthetic(s.importKw, "(");
    const close = s.close ? f.tok(s.close) : synthetic(s.importKw, ")");
    return [head, f.parenthesized(open, list, close, dangling)];
  },
};
