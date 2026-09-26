import {
  bestFitParenthesize,
  bestFitting,
  type Doc,
  fitsExpanded,
  group,
  ifBreak,
  indent,
  isDocs,
  synthetic,
  type Token,
  text,
  token,
  willBreak,
} from "../../../fmt/doc.js";
import type { FormatNode } from "../../../fmt/tree.js";
import {
  type Arguments,
  type Attribute,
  type BinOp,
  type BoolOp,
  type Call,
  type Comp,
  type Compare,
  type Comprehension,
  type Dict,
  type DictComp,
  type Expr,
  exprAst,
  type FunctionDef,
  type IfExp,
  isExpr,
  outer,
  type Keyword,
  type Lambda,
  type Parameter,
  type Parameters,
  type Py,
  type Sequence,
  type Slice,
  type Str,
  type Subscript,
  type UnaryOp,
} from "./ast.js";
import {
  blockIndent,
  commaIn,
  EXPR,
  type Fmt,
  hard,
  type Level,
  PAREN,
  soft,
  softBlockIndent,
  softOrSpace,
  space,
} from "./builders.js";
import type { Comment } from "./comments.js";
import {
  type Flags,
  formatStr,
  type Hooks,
  implicitConcatenated,
  isInterpolated,
  isMultilineStr,
  multilineToken,
  partOf,
} from "./strings.js";
import { hasLineBreak, tokens } from "./trivia.js";

/**
 * Ruff's expression formatting (expression/*.rs): whether an expression gets parentheses (`maybeParenthesize`,
 * `needsParentheses`, `canOmitOptionalParentheses`), and each kind's layout. A rule reads the node it prints and
 * its comments; the parentheses it prints are the source's own tokens where the source has them.
 */

/** Ruff's `Parentheses`: keep the source's, always print them, or print none. */
export type Parens = "preserve" | "always" | "never";
/** Ruff's `Parenthesize`: how a statement or clause wants the expression it holds parenthesized. */
export type Parenthesize = "optional" | "ifBreaks" | "ifRequired" | "ifBreaksParenthesized" | "ifBreaksParenthesizedNested";
type Needs = "always" | "never" | "multiline" | "bestFit";
type Chain = "default" | "nonFluent" | "fluent";
export type TupleMode = "default" | "preserve" | "optionalParentheses" | "never" | "neverPreserve";

export interface Opts {
  chain?: Chain;
  tuple?: TupleMode;
  /** A generator that is a call's only argument keeps the call's parentheses. */
  genPreserve?: boolean;
  /** An `else` branch's conditional expression, grouped with the one it continues. */
  ifNested?: boolean;
  /** A lambda on an assignment's right side, measured as if its body could break. */
  lambdaAssign?: boolean;
}

const isParenthesizedLevel = (l: Level) => l.k === "paren" || (l.k === "expr" && l.g !== undefined);

function parenTokens(e: Expr): [Token, Token] {
  const p = e.parens[0];
  return p ? [token(p.open, "("), token(p.close, ")")] : [synthetic(e.ts, "("), synthetic(e.ts, ")")];
}

/** Ruff's `FormatExpr`: `e` with its comments, in parentheses per `parens`. */
export function formatExpr(f: Fmt, e: Expr, parens: Parens = "preserve", o: Opts = {}): Doc {
  const parenthesize = parens === "preserve" ? e.parens.length > 0 : parens === "always";
  if (parenthesize) {
    const cs = f.comments;
    const [open, close] = parenTokens(e);
    if (!cs.hasLeading(e) && !cs.hasTrailing(e)) return f.parenthesized(open, () => fields(f, e, o), close);
    return withParenthesesComments(f, e, open, close, o);
  }
  const l = f.level;
  return f.at(l.k === "top" || l.k === "compound" ? EXPR : l, () => node(f, e, o));
}

/** Ruff's `FormatNodeRule::fmt`: the leading comments, the fields, the trailing comments. */
export function node(f: Fmt, e: Expr, o: Opts = {}): Doc {
  const cs = f.comments;
  const leading = f.leading(cs.leading(e));
  const body = fields(f, e, o);
  return [leading, body, f.trailing(cs.trailing(e))];
}

function withParenthesesComments(f: Fmt, e: Expr, open: Token, close: Token, o: Opts): Doc {
  const cs = f.comments;
  const leading = cs.leading(e);
  const trailing = cs.trailing(e);
  const p = e.parens[0];
  const ls = p ? leading.findIndex((c) => c.start >= p.wrapper.start) : 0;
  const ts = p ? trailing.findIndex((c) => c.start >= p.wrapper.end) : -1;
  const leadingSplit = ls < 0 ? leading.length : ls;
  const trailingSplit = ts < 0 ? trailing.length : ts;
  const leadingOuter = leading.slice(0, leadingSplit);
  let leadingInner = leading.slice(leadingSplit);
  const trailingInner = trailing.slice(0, trailingSplit);
  const trailingOuter = trailing.slice(trailingSplit);
  let parenComment: Comment[] = [];
  const first = leadingInner[0];
  if (first && first.line === "eol") {
    parenComment = [first];
    leadingInner = leadingInner.slice(1);
  } else leadingInner = [...leading];
  const out: Doc[] = [f.leading(leadingOuter)];
  out.push(
    f.parenthesized(
      open,
      () => [f.leading(leadingInner), fields(f, e, o), f.trailing(trailingInner)],
      close,
      parenComment,
    ),
    f.trailing(trailingOuter),
  );
  return out;
}

/** Ruff's `maybe_parenthesize_expression`: `e` as a statement or clause holds it. */
export function maybeParenthesize(f: Fmt, e: Expr, parent: Py, mode: Parenthesize): Doc {
  if (mode === "optional" && e.parens.length > 0) return formatExpr(f, e, "always");
  const cs = f.comments;
  if (cs.hasLeading(e) || cs.hasTrailingOwnLine(e)) return formatExpr(f, e, "always");
  let needs = needsParentheses(f, e, parent);
  if (needs !== "always" && isParenthesizedLevel(f.level)) {
    if (mode === "ifBreaksParenthesizedNested")
      return f.parenthesizeIfExpands(e.ts, () => formatExpr(f, e, "never"), true);
    return formatExpr(f, e, "never");
  }
  const omitOr = () =>
    canOmitOptionalParentheses(f, e)
      ? f.optionalParentheses(e.ts, () => formatExpr(f, e, "never"))
      : f.parenthesizeIfExpands(e.ts, () => formatExpr(f, e, "never"));
  switch (needs) {
    case "multiline":
      return mode === "ifRequired" ? formatExpr(f, e, "never") : omitOr();
    case "bestFit":
      if (mode === "ifBreaksParenthesized" || mode === "ifBreaksParenthesizedNested") return omitOr();
      if (mode === "optional" || mode === "ifRequired") return formatExpr(f, e, "never");
      if (cs.hasTrailing(e)) return formatExpr(f, e, "always");
      return bestFit(f, e);
    case "never":
      return formatExpr(f, e, "never");
    default:
      needs = "always";
      return formatExpr(f, e, "always");
  }
}

function bestFit(f: Fmt, e: Expr): Doc {
  const contents: Doc[] = [];
  const b = bestFitParenthesize(synthetic(e.ts, "("), contents, synthetic(e.ts, ")"));
  contents.push(f.at({ k: "expr", g: b }, () => formatExpr(f, e, "never")));
  return b;
}

const isAnnotationOf = (e: Expr, parent: Py | undefined) =>
  (parent?.kind === "AnnAssign" && parent.annotation === e) || (parent?.kind === "FunctionDef" && parent.returns === e);

const isCallLike = (e: Expr): e is Attribute | Call | Subscript =>
  e.kind === "Attribute" || e.kind === "Call" || e.kind === "Subscript";

/** Ruff's `NeedsParentheses`: whether `e`, standing in `parent`, needs parentheses to parse or to break. */
export function needsParentheses(f: Fmt, e: Expr, parent: Py | undefined): Needs {
  const cs = f.comments;
  const awaitParent = parent?.kind === "Await";
  switch (e.kind) {
    case "Attribute": {
      if (chainFrom(e) === "fluent") return "multiline";
      if (cs.hasDangling(e)) return "always";
      if (e.value.parens.length > 0)
        return cs.trailing(e.value).some((c) => c.line === "eol") ? "multiline" : "never";
      return needsParentheses(f, e.value, e);
    }
    case "Call":
      if (chainFrom(e) === "fluent") return "multiline";
      if (cs.hasDangling(e)) return "always";
      if (e.func.parens.length > 0) return "never";
      return needsParentheses(f, e.func, e);
    case "Subscript": {
      if (chainFrom(e) === "fluent") return "multiline";
      if (e.value.parens.length > 0) return "never";
      const n = needsParentheses(f, e.value, e);
      if (n === "bestFit" && parent?.kind === "FunctionDef" && parent.returns === e) {
        const params = parent.params;
        return params.items.length === 0 && !cs.has(params) ? "multiline" : "never";
      }
      return n;
    }
    case "BinOp": {
      if (awaitParent) return "always";
      const left = e.left;
      if (
        left.kind === "Str" &&
        left.parts.length === 1 &&
        left.parens.length === 0 &&
        isMultilineStr(f, left) &&
        hasParentheses(f, e.right) !== undefined &&
        !cs.hasDangling(e) &&
        !cs.has(left) &&
        !cs.has(e.right)
      )
        return "never";
      return "multiline";
    }
    case "Compare": {
      if (awaitParent) return "always";
      const left = e.left;
      const right = e.comparators[0];
      if (
        right &&
        left.kind === "Str" &&
        left.parts.length === 1 &&
        left.parens.length === 0 &&
        isMultilineStr(f, left) &&
        hasParentheses(f, right) !== undefined &&
        !cs.hasDangling(e) &&
        !cs.has(left) &&
        !cs.has(right)
      )
        return "never";
      return "multiline";
    }
    case "BoolOp":
    case "IfExp":
    case "Lambda":
      return awaitParent ? "always" : "multiline";
    case "Name":
    case "Number":
    case "Bool":
    case "None":
    case "Ellipsis":
      return "bestFit";
    case "Str":
      if (e.parts.length > 1) return "multiline";
      if (isMultilineStr(f, e)) return "never";
      if (e.flavor === "f" || e.flavor === "t") {
        const p = partOf(f.src, e.parts[0] as FormatNode);
        if (p.elements.some((x) => x.kind === "interpolation" && hasLineBreak(f.src, x.start, x.end))) return "never";
      }
      return "bestFit";
    case "Named":
      switch (parent?.kind) {
        case "AnnAssign":
        case "Assign":
        case "AugAssign":
        case "Assert":
        case "Return":
        case "ExceptHandler":
        case "WithItem":
        case "Yield":
        case "Await":
        case "Delete":
        case "For":
        case "FunctionDef":
        case "Lambda":
          return "always";
        default:
          return "multiline";
      }
    case "Starred":
    case "Slice":
      return "multiline";
    case "Yield": {
      if (isAnnotationOf(e, parent)) return "always";
      if (parent?.kind === "Assign" || parent?.kind === "AnnAssign" || parent?.kind === "AugAssign") {
        const v = e.value;
        if (!v) return "never";
        if (v.parens.length > 0) return "never";
        const n = needsParentheses(f, v, e);
        return n === "bestFit" ? "never" : n;
      }
      return "always";
    }
    case "Generator":
      return awaitParent ? "always" : "never";
    case "Await":
      if (awaitParent || isAnnotationOf(e, parent)) return "always";
      if (e.value.parens.length > 0) return "never";
      return needsParentheses(f, e.value, e);
    case "UnaryOp":
      if (awaitParent) return "always";
      if (unaryNeedsLineBreak(f, e)) return "always";
      if (e.operand.parens.length > 0) return "never";
      if (cs.has(e.operand)) return "always";
      return needsParentheses(f, e.operand, e);
    default:
      return "never";
  }
}

// ---- ruff's parenthesization heuristics (expression/mod.rs) ----

type Own = "empty" | "nonEmpty";

export function hasOwnParentheses(f: Fmt, e: Expr): Own | undefined {
  const cs = f.comments;
  switch (e.kind) {
    case "ListComp":
    case "SetComp":
    case "DictComp":
    case "Subscript":
      return "nonEmpty";
    case "Generator":
      return e.open ? "nonEmpty" : undefined;
    case "List":
    case "Set":
      return e.elts.length > 0 || cs.hasDangling(e) ? "nonEmpty" : "empty";
    case "Tuple":
      if (!e.open) return undefined;
      return e.elts.length > 0 || cs.hasDangling(e) ? "nonEmpty" : "empty";
    case "Dict":
      return e.items.length > 0 || cs.hasDangling(e) ? "nonEmpty" : "empty";
    case "Call":
      return e.args.items.length > 0 || cs.hasDangling(e) ? "nonEmpty" : "empty";
    default:
      return undefined;
  }
}

export function hasParentheses(f: Fmt, e: Expr): Own | undefined {
  const own = hasOwnParentheses(f, e);
  if (own === "nonEmpty") return own;
  if (e.parens.length > 0) return "nonEmpty";
  return own;
}

enum Prec {
  None,
  Attribute,
  Exponential,
  BitwiseInversion,
  Multiplicative,
  Additive,
  Shift,
  BitwiseAnd,
  BitwiseXor,
  BitwiseOr,
  Comparator,
  BooleanOperation,
  Conditional,
}

function binPrec(op: string): Prec {
  switch (op) {
    case "+":
    case "-":
      return Prec.Additive;
    case "**":
      return Prec.Exponential;
    case "<<":
    case ">>":
      return Prec.Shift;
    case "|":
      return Prec.BitwiseOr;
    case "^":
      return Prec.BitwiseXor;
    case "&":
      return Prec.BitwiseAnd;
    default:
      return Prec.Multiplicative;
  }
}

const exprKids = (p: Py): Expr[] => {
  const out: Expr[] = [];
  const walk = (k: Py) => {
    if (isExpr(k)) out.push(k);
    else for (const x of k.kids) walk(x);
  };
  for (const k of p.kids) walk(k);
  return out;
};

/** Ruff's `can_omit_optional_parentheses`. */
export function canOmitOptionalParentheses(f: Fmt, root: Expr): boolean {
  let max = Prec.None;
  let count = 0;
  let anyParenthesized = false;
  type First = { k: "none" } | { k: "token" } | { k: "expr"; e: Expr };
  const st: { first: First; last: Expr | undefined } = { first: { k: "none" }, last: undefined };
  const update = (p: Prec, n = 1) => {
    if (max < p) {
      max = p;
      count = n;
    } else if (max === p) count += n;
  };
  const setFirst = (v: First) => {
    if (st.first.k === "none") st.first = v;
  };
  const visitExpr = (e: Expr) => {
    st.last = e;
    if (e.parens.length > 0) anyParenthesized = true;
    else visitSub(e);
    setFirst({ k: "expr", e });
  };
  const visitSub = (e: Expr): void => {
    switch (e.kind) {
      case "Dict":
      case "List":
      case "Set":
      case "ListComp":
      case "SetComp":
      case "DictComp":
        anyParenthesized = true;
        return;
      case "Tuple":
        if (e.open) {
          anyParenthesized = true;
          return;
        }
        break;
      case "Generator":
        if (e.open) {
          anyParenthesized = true;
          return;
        }
        break;
      case "BoolOp":
        update(Prec.BooleanOperation, Math.max(0, e.values.length - 1));
        break;
      case "BinOp":
        update(binPrec(f.text(e.op)));
        break;
      case "IfExp":
        update(Prec.Conditional, 2);
        break;
      case "Compare":
        update(Prec.Comparator, e.ops.length);
        break;
      case "Call":
        anyParenthesized = true;
        visitExpr(e.func);
        st.last = e;
        return;
      case "Subscript":
        anyParenthesized = true;
        visitExpr(e.value);
        st.last = e;
        return;
      case "Attribute":
        visitExpr(e.value);
        if (hasParentheses(f, e.value) !== undefined) update(Prec.Attribute);
        st.last = e;
        return;
      case "Named":
        break;
      case "UnaryOp":
        if (f.text(e.op) === "~") update(Prec.BitwiseInversion);
        setFirst({ k: "token" });
        break;
      case "Lambda":
      case "Await":
      case "Yield":
      case "Starred":
        setFirst({ k: "token" });
        break;
      default:
        return;
    }
    for (const k of exprKids(e)) visitExpr(k);
  };
  visitSub(root);
  if (!anyParenthesized) return false;
  if (count > 1) return false;
  if (max === Prec.None || max === Prec.Attribute) return true;
  const isParenthesized = (e: Expr) => e.kind !== "Subscript" && hasParentheses(f, e) === "nonEmpty";
  const lastE = st.last;
  const firstE = st.first.k === "expr" ? st.first.e : undefined;
  return (lastE !== undefined && isParenthesized(lastE)) || (firstE !== undefined && isParenthesized(firstE));
}

/** Ruff's `is_splittable_expression`. */
export function isSplittable(e: Expr): boolean {
  switch (e.kind) {
    case "Named":
    case "Name":
    case "Number":
    case "Bool":
    case "None":
    case "Ellipsis":
    case "Slice":
      return false;
    case "Compare":
    case "BinOp":
    case "BoolOp":
    case "IfExp":
    case "Generator":
    case "Subscript":
    case "ListComp":
    case "SetComp":
    case "DictComp":
      return true;
    case "Await":
      return true;
    case "Tuple":
    case "Set":
    case "List":
      return e.elts.length > 0;
    case "Dict":
      return e.items.length > 0;
    case "UnaryOp":
      return isSplittable(e.operand);
    case "Yield":
      return e.from || e.value !== undefined;
    case "Call":
      return e.args.items.length > 0 || e.func.parens.length > 0;
    case "Str":
      return e.parts.length > 1;
    case "Lambda":
      return e.body.parens.length > 0 || isSplittable(e.body);
    case "Starred":
      return e.value.parens.length > 0 || isSplittable(e.value);
    case "Attribute":
      return e.value.parens.length > 0 || isSplittable(e.value);
    default:
      return false;
  }
}

/** Ruff's `left_most`: the expression a line of `e` starts with, stopping at parentheses. */
export function leftMost(e: Expr): Expr {
  let cur = e;
  for (;;) {
    let left: Expr | undefined;
    switch (cur.kind) {
      case "BinOp":
        left = cur.left;
        break;
      case "IfExp":
        left = cur.body;
        break;
      case "Call":
        left = cur.func;
        break;
      case "Attribute":
      case "Subscript":
        left = cur.value;
        break;
      case "BoolOp":
        left = cur.values[0];
        break;
      case "Compare":
        left = cur.left;
        break;
      case "Generator":
        left = cur.open ? undefined : cur.elt;
        break;
      case "Tuple":
        left = cur.open ? undefined : cur.elts[0];
        break;
      case "Slice":
        left = cur.lower;
        break;
      default:
        left = undefined;
    }
    if (!left || left.parens.length > 0) return cur;
    cur = left;
  }
}

// ---- call chains (ruff's CallChainLayout) ----

function chainFrom(start: Expr): Chain {
  let attributesAfterParentheses = 0;
  let rootParenthesized = false;
  let e = start;
  for (;;) {
    if (e.kind === "Attribute") {
      if (e.value.parens.length > 0) {
        rootParenthesized = true;
        break;
      }
      if (e.value.kind === "Call" || e.value.kind === "Subscript") attributesAfterParentheses++;
      e = e.value;
    } else if (e.kind === "Call" || e.kind === "Subscript") {
      const inner = e.kind === "Call" ? e.func : e.value;
      if (inner.parens.length > 0) break;
      e = inner;
    } else break;
  }
  return attributesAfterParentheses + (rootParenthesized ? 1 : 0) < 2 ? "nonFluent" : "fluent";
}

function applyInNode(f: Fmt, e: Expr, chain: Chain): Chain {
  if (chain !== "default") return chain;
  return isParenthesizedLevel(f.level) ? chainFrom(e) : "nonFluent";
}

/** The value of an attribute, call or subscript, continuing the chain `layout`. */
function chainValue(f: Fmt, v: Expr, layout: Chain): Doc {
  if (v.parens.length > 0) return formatExpr(f, v, "always");
  if (isCallLike(v)) return node(f, v, { chain: layout });
  return formatExpr(f, v, "never");
}

// ---- the kinds ----

function fields(f: Fmt, e: Expr, o: Opts): Doc {
  switch (e.kind) {
    case "Name":
    case "Bool":
    case "None":
    case "Ellipsis":
      return f.tok(e.ts);
    case "Number":
      return f.tok(e.ts, number(f.text(e.ts)));
    case "Str":
      return formatStr(f, e, hooks);
    case "Attribute":
      return attribute(f, e, o.chain ?? "default");
    case "Call":
      return call(f, e, o.chain ?? "default");
    case "Subscript":
      return subscript(f, e, o.chain ?? "default");
    case "Starred":
      return [f.tok(e.op), f.dangling(f.comments.dangling(e)), formatExpr(f, e.value)];
    case "UnaryOp":
      return unary(f, e);
    case "BinOp":
    case "Compare":
    case "BoolOp":
      return binaryLike(f, e);
    case "IfExp":
      return ifExp(f, e, o.ifNested === true);
    case "Lambda":
      return lambda(f, e, o.lambdaAssign === true);
    case "Named": {
      const dangling = f.comments.dangling(e);
      return [
        group([formatExpr(f, e.target), f.softLineOrSpace()]),
        f.tok(e.op),
        dangling.length === 0 ? space : [f.dangling(dangling), hard],
        formatExpr(f, e.value),
      ];
    }
    case "Await":
      return [f.tok(e.kw), space, maybeParenthesize(f, e.value, e, "ifBreaks")];
    case "Yield": {
      const kw = e.kws.flatMap((k, i) => (i > 0 ? [space, f.tok(k)] : [f.tok(k)]));
      return e.value ? [kw, space, maybeParenthesize(f, e.value, e, "optional")] : kw;
    }
    case "Tuple":
      return tuple(f, e, o.tuple ?? "default");
    case "List":
    case "Set":
      return list(f, e);
    case "Dict":
      return dict(f, e);
    case "ListComp":
    case "SetComp":
    case "Generator":
      return comp(f, e, o.genPreserve === true);
    case "DictComp":
      return dictComp(f, e);
    case "Slice":
      return slice(f, e);
  }
}

/** Ruff's number normalization: lower-case prefixes and exponents, upper-case hex digits, no bare dots. */
export function number(raw: string): string {
  const complex = /[jJ]$/.test(raw);
  const body = complex ? raw.slice(0, -1) : raw;
  if (/^0[bBoOxX]/.test(body)) {
    const hex = /^0[xX]/.test(body);
    const digits = body.slice(2);
    return `0${(body[1] as string).toLowerCase()}${hex ? digits.replace(/[a-f]/g, (c) => c.toUpperCase()) : digits}${complex ? "j" : ""}`;
  }
  if (!complex && !/[.eE]/.test(body)) return body;
  let out = body.startsWith(".") ? `0${body}` : body;
  out = out.replace(/\.(?=[eE]|$)/, ".0").replace(/E/, "e").replace(/e\+/, "e");
  return complex ? `${out}j` : out;
}

function attribute(f: Fmt, e: Attribute, chain: Chain): Doc {
  const cs = f.comments;
  const layout = applyInNode(f, e, chain);
  const v = e.value;
  const parenthesizeValue = isBaseTenNumber(f, v) || v.parens.length > 0;
  const out: Doc[] = [];
  if (layout === "fluent")
    out.push(parenthesizeValue ? formatExpr(f, v, "always") : isCallLike(v) ? node(f, v, { chain: layout }) : formatExpr(f, v, "never"));
  else out.push(formatExpr(f, v, parenthesizeValue ? "always" : "never"));
  let lastClose: number | undefined;
  for (const t of tokens(f.src, v.end)) {
    if (t.kind !== ")") break;
    lastClose = t.end;
  }
  const eol = lastClose !== undefined && cs.trailing(v).some((c) => c.line === "eol" && c.start > (lastClose as number));
  if (eol) out.push(hard);
  else if (layout === "fluent" && (parenthesizeValue || v.kind === "Call" || v.kind === "Subscript")) out.push(soft);
  const dangling = cs.dangling(e);
  const before = dangling.filter((c) => c.start < e.dot.start);
  const after = dangling.filter((c) => c.start >= e.dot.start);
  out.push(f.dangling(before), f.tok(e.dot), f.dangling(after), f.tok(e.attr));
  return chain === "default" && layout === "fluent" ? group(out) : out;
}

function isBaseTenNumber(f: Fmt, e: Expr): boolean {
  if (e.kind !== "Number") return false;
  const t = f.text(e.ts);
  return !/^0[bBoOxX]/.test(t);
}

function call(f: Fmt, e: Call, chain: Chain): Doc {
  const layout = applyInNode(f, e, chain);
  const out = [chainValue(f, e.func, layout), f.dangling(f.comments.dangling(e)), args(f, e.args)];
  return chain === "default" && layout === "fluent" ? group(out) : out;
}

function subscript(f: Fmt, e: Subscript, chain: Chain): Doc {
  const layout = applyInNode(f, e, chain);
  const s = e.slice;
  const inner = () => (s.kind === "Tuple" ? formatExpr(f, s, "preserve", { tuple: "preserve" }) : formatExpr(f, s));
  const out = [
    chainValue(f, e.value, layout),
    f.parenthesized(f.tok(e.open), inner, f.tok(e.close), f.comments.dangling(e)),
  ];
  return chain === "default" && layout === "fluent" ? group(out) : out;
}

function args(f: Fmt, a: Arguments): Doc {
  const cs = f.comments;
  const dangling = cs.dangling(a);
  const open = f.tok(a.open);
  const close = f.tok(a.close);
  if (a.items.length === 0) return f.at(PAREN, () => f.emptyParenthesized(open, dangling, close));
  const comma = commaIn(a.ts, a.ts);
  const all = () => {
    const [single] = a.items;
    if (a.items.length === 1 && single && isExpr(single)) {
      const doc =
        single.kind === "Generator"
          ? formatExpr(f, single, "preserve", { genPreserve: true })
          : formatExpr(f, single, singleArgumentParenthesized(f, single, a.end) ? "always" : "never");
      return group(f.joinCommaSeparated([{ end: single.end, doc }], a.end, comma));
    }
    return group(
      f.joinCommaSeparated(
        a.items.map((i) => ({ end: i.end, doc: isExpr(i) ? formatExpr(f, i) : keyword(f, i) })),
        a.end,
        comma,
      ),
    );
  };
  return f.parenthesized(open, all, close, dangling, argumentsHuggable(f, a));
}

function singleArgumentParenthesized(f: Fmt, arg: Expr, end: number): boolean {
  let seen = false;
  for (const t of tokens(f.src, arg.end, end)) {
    if (t.kind === ")") {
      if (seen) return true;
      seen = true;
    } else if (t.kind !== ",") break;
  }
  return false;
}

function argumentsHuggable(f: Fmt, a: Arguments): boolean {
  const [only] = a.items;
  if (!only || a.items.length !== 1) return false;
  let arg: Expr;
  if (isExpr(only)) arg = only;
  else if (!only.name && !f.comments.has(only)) arg = only.value;
  else return false;
  if (arg.kind !== "Str" || arg.parts.length > 1 || !isMultilineStr(f, arg)) return false;
  if (!partOf(f.src, arg.parts[0] as FormatNode).flags.triple) return false;
  if (/[\n\r]$/.test(f.src.slice(a.start + 1, outer(arg).start).replace(/[ \t\f]+$/, ""))) return false;
  if (f.comments.hasLeading(arg) || f.comments.hasTrailing(arg)) return false;
  return !f.magicTrailingComma(arg.end, a.end);
}


export function keyword(f: Fmt, k: Keyword): Doc {
  const cs = f.comments;
  const body = k.name ? [f.tok(k.name), f.tok(k.op), formatExpr(f, k.value)] : [f.tok(k.op), formatExpr(f, k.value)];
  return [f.leading(cs.leading(k)), body, f.trailing(cs.trailing(k))];
}

function unaryNeedsLineBreak(f: Fmt, e: UnaryOp): boolean {
  const leading = f.comments.leading(e.operand);
  if (leading.length === 0) return false;
  if (e.operand.parens.length === 0) return true;
  const p = e.operand.parens[0];
  return p !== undefined && leading.some((c) => c.start < p.wrapper.start);
}

function unary(f: Fmt, e: UnaryOp): Doc {
  const op = f.text(e.op);
  const operand = e.operand;
  const lineBreak = unaryNeedsLineBreak(f, e);
  const parens: "always" | "preserve" =
    operand.kind === "BinOp" && operand.parens.length === 0 && f.text(operand.op) === "**" ? "always" : "preserve";
  return [
    f.tok(e.op),
    f.trailing(f.comments.dangling(e)),
    lineBreak ? hard : op === "not" ? space : [],
    formatExpr(f, operand, parens),
  ];
}

function ifExp(f: Fmt, e: IfExp, nested: boolean): Doc {
  const cs = f.comments;
  const orelse = e.orelse;
  const inner = [
    formatExpr(f, e.body),
    f.softLineOrSpace(),
    f.leading(cs.leading(e.test)),
    f.tok(e.ifTok),
    space,
    formatExpr(f, e.test),
    f.softLineOrSpace(),
    f.leading(cs.leading(orelse)),
    f.tok(e.elseTok),
    space,
    orelse.kind === "IfExp" && orelse.parens.length === 0
      ? node(f, orelse, { ifNested: true })
      : f.inParensGroup(formatExpr(f, orelse)),
  ];
  return nested ? inner : f.inParensGroup(inner);
}

function lambda(f: Fmt, e: Lambda, assignment: boolean): Doc {
  const cs = f.comments;
  const dangling = cs.dangling(e);
  const out: Doc[] = [f.tok(e.lambdaTok)];
  let header: readonly Comment[] = dangling;
  const p = e.params;
  if (p) {
    const before = dangling.filter((c) => c.end < p.start);
    header = dangling.filter((c) => c.end >= p.start);
    if (before.length === 0) out.push(cs.hasLeading(p) ? hard : space);
    else out.push(f.dangling(before));
    const params = parameters(f, p, "never");
    out.push(cs.hasAnyIn(p.start, p.end) || cs.has(p) ? params : removeSoftLines(params));
  }
  out.push(f.tok(e.colon));
  if (header.length === 0) out.push(space);
  const bodyDoc = lambdaBody(f, e, header);
  out.push(assignment ? fitsExpanded(bodyDoc) : bodyDoc);
  return out;
}

function lambdaBody(f: Fmt, e: Lambda, header: readonly Comment[]): Doc {
  const cs = f.comments;
  const body = e.body;
  if (header.length > 0) {
    const split = header.findIndex((c) => c.line === "own");
    const trailingHeader = split < 0 ? header : header.slice(0, split);
    const leadingBody = split < 0 ? [] : header.slice(split);
    if (body.parens.length > 0 && cs.hasLeading(body))
      return [f.trailing(header), leadingBody.length === 0 ? space : hard, formatExpr(f, body, "always")];
    return [
      space,
      synthetic(body.ts, "("),
      f.trailing(trailingHeader),
      blockIndent([f.leading(leadingBody), formatExpr(f, body, "never")]),
      synthetic(body.ts, ")"),
    ];
  }
  if (cs.hasLeading(body) || cs.hasTrailingOwnLine(body)) return formatExpr(f, body, "always");
  const needs = needsParentheses(f, body, e);
  if (needs === "always") return formatExpr(f, body, "always");
  if (needs === "multiline") return f.parenthesizeIfExpands(body.ts, () => formatExpr(f, body, "never"));
  if (body.kind === "Call" || body.kind === "Subscript") {
    const unparenthesized = formatExpr(f, body, "never");
    return [
      willBreak(unparenthesized) ? { k: "breakParent" } : [],
      bestFitting([
        unparenthesized,
        group(unparenthesized, true),
        [synthetic(body.ts, "("), blockIndent(unparenthesized), synthetic(body.ts, ")")],
      ]),
    ];
  }
  if (hasOwnParentheses(f, body) !== undefined) return formatExpr(f, body);
  return f.parenthesizeIfExpands(body.ts, () => formatExpr(f, body, "never"));
}

/** Ruff's `FormatParameters`, `Preserve` (a `def`'s parentheses) or `Never` (a lambda's). */
export function parameters(f: Fmt, p: Parameters, mode: "preserve" | "never"): Doc {
  const cs = f.comments;
  const dangling = cs.dangling(p);
  let parenComments: Comment[] = [];
  let rest: readonly Comment[] = dangling;
  const first = dangling[0];
  if (first && first.line === "eol") {
    let only = true;
    for (const t of tokens(f.src, p.start, first.start))
      if (t.kind !== "(" && t.kind !== "[" && t.kind !== "{") {
        only = false;
        break;
      }
    if (only) {
      parenComments = [first];
      rest = dangling.slice(1);
    }
  }
  const inner = () => {
    const out: Doc[] = [];
    const sep = isParenthesizedLevel(f.level) ? softOrSpace : space;
    let lastEnd: number | undefined;
    for (const [i, item] of p.items.entries()) {
      if (i > 0) out.push(f.tok(commaBefore(p, item.start)), sep);
      if (item.kind === "Separator") {
        const mine = rest.filter((c) => separatorOwns(p, i, c));
        const own = mine.filter((c) => c.line === "own");
        const eol = mine.filter((c) => c.line !== "own");
        out.push(f.leading(own), f.tok(item.tok), f.trailing(eol));
      } else out.push(parameter(f, item));
      lastEnd = item.end;
    }
    const trailingComma = lastEnd !== undefined && firstTokenAfter(f, lastEnd) === ",";
    if (mode === "never") {
      if (trailingComma && lastEnd !== undefined) out.push(f.tok(commaBefore(p, lastEnd)));
    } else {
      out.push(ifBreak(lastEnd !== undefined ? f.tok(commaBefore(p, lastEnd)) : synthetic(p.ts, ",")));
      if (!f.options["skip-magic-trailing-comma"] && trailingComma) out.push(hard);
    }
    return out;
  };
  if (mode === "never") return [group(inner()), f.dangling(rest.filter((c) => !c.formatted))];
  const open = p.open ? f.tok(p.open) : synthetic(p.ts, "(");
  const close = p.close ? f.tok(p.close) : synthetic(p.ts, ")");
  return f.at(PAREN, () => {
    if (p.items.length === 0) return f.emptyParenthesized(open, dangling, close);
    const body = p.items.length === 1 ? inner() : group(inner());
    return [open, f.danglingOpenParen(parenComments), softBlockIndent(body), close];
  });
}

/** Whether dangling comment `c` of `p` sits around the separator at `items[i]`. */
function separatorOwns(p: Parameters, i: number, c: Comment): boolean {
  const sep = p.items[i];
  if (!sep) return false;
  const prevEnd = p.items[i - 1]?.end ?? p.start;
  const nextStart = p.items[i + 1]?.start ?? p.end;
  if (c.line === "own") return c.start > prevEnd && c.start < sep.start;
  return c.start > sep.end && c.start < nextStart;
}

function commaBefore(p: Parameters, from: number): FormatNode {
  for (const c of p.ts.children) if (!c.named && c.kind === "," && c.start >= from) return c;
  // A position past the last comma: the comma before `from`.
  const commas = p.ts.children.filter((c) => !c.named && c.kind === ",");
  const before = commas.filter((c) => c.end <= from).at(-1);
  return before ?? (commas[0] as FormatNode);
}

function firstTokenAfter(f: Fmt, at: number): string | undefined {
  for (const t of tokens(f.src, at)) return t.kind;
  return undefined;
}

function parameter(f: Fmt, p: Parameter): Doc {
  const cs = f.comments;
  const out: Doc[] = [f.leading(cs.leading(p))];
  if (p.star) out.push(f.tok(p.star));
  out.push(f.tok(p.name));
  if (p.annotation && p.colon) {
    out.push(f.tok(p.colon));
    out.push(cs.hasLeading(p.annotation) && p.annotation.parens.length === 0 ? hard : space);
    out.push(formatExpr(f, p.annotation));
  }
  if (p.default && p.eq) {
    const lead = cs.leading(p.default)[0];
    let breakLeading = false;
    if (lead) {
      let sawEq = false;
      breakLeading = true;
      for (const t of tokens(f.src, (p.annotation ?? p.name).end, lead.start)) {
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
    out.push(sp, f.tok(p.eq), lineBreak ? hard : sp, formatExpr(f, p.default));
  }
  out.push(f.trailing(cs.trailing(p)));
  return out;
}

function sequenceEntries(f: Fmt, e: Sequence, o: Opts = {}) {
  return e.elts.map((x) => ({ end: x.end, doc: formatExpr(f, x, "preserve", o) }));
}

function tuple(f: Fmt, e: Sequence, mode: TupleMode): Doc {
  const cs = f.comments;
  const dangling = cs.dangling(e);
  const parenthesized = e.open !== undefined;
  const open = e.open ? f.tok(e.open) : synthetic(e.ts, "(");
  const close = e.close ? f.tok(e.close) : synthetic(e.ts, ")");
  const comma = commaIn(e.ts, e.ts);
  if (e.elts.length === 0) return f.at(PAREN, () => f.emptyParenthesized(open, dangling, close));
  const sequence = () => f.joinCommaSeparated(sequenceEntries(f, e), e.end, comma);
  if (e.elts.length === 1) {
    const single = e.elts[0] as Expr;
    if (mode === "preserve" && !parenthesized) {
      const c = e.commas[0];
      return [formatExpr(f, single), c && c.start >= single.end ? f.tok(c) : []];
    }
    return f.parenthesized(open, () => [formatExpr(f, single), comma(single.end)], close, dangling);
  }
  if (parenthesized && !(mode === "neverPreserve" && dangling.length === 0))
    return f.parenthesized(open, sequence, close, dangling);
  switch (mode) {
    case "never":
      return e.elts.map((x, i) => (i > 0 ? [group([comma((e.elts[i - 1] as Expr).end), space]), formatExpr(f, x)] : formatExpr(f, x)));
    case "preserve":
      return group(sequence());
    case "neverPreserve":
      return f.optionalParentheses(e.ts, sequence);
    case "optionalParentheses":
      if (e.elts.length === 2) return f.optionalParentheses(e.ts, sequence);
      return f.parenthesizeIfExpands(e.ts, sequence);
    default:
      return f.parenthesizeIfExpands(e.ts, sequence);
  }
}

function list(f: Fmt, e: Sequence): Doc {
  const dangling = f.comments.dangling(e);
  const open = f.tok(e.open as FormatNode);
  const close = f.tok(e.close as FormatNode);
  if (e.elts.length === 0) return f.at(PAREN, () => f.emptyParenthesized(open, dangling, close));
  return f.parenthesized(open, () => f.joinCommaSeparated(sequenceEntries(f, e), e.end, commaIn(e.ts, e.ts)), close, dangling);
}

function dict(f: Fmt, e: Dict): Doc {
  const dangling = f.comments.dangling(e);
  const open = f.tok(e.open);
  const close = f.tok(e.close);
  if (e.items.length === 0) return f.at(PAREN, () => f.emptyParenthesized(open, dangling, close));
  const firstStart = itemStart(e.items[0] as Dict["items"][number]);
  const openComments = dangling.filter((c) => c.end < firstStart);
  let rest = dangling.filter((c) => c.end >= firstStart);
  const content = () =>
    f.joinCommaSeparated(
      e.items.map((item) => {
        const end = item.value.end;
        const mine = rest.filter((c) => c.start < end);
        rest = rest.filter((c) => c.start >= end);
        let doc: Doc;
        if (item.key && item.colon)
          doc = group([
            formatExpr(f, item.key),
            f.tok(item.colon),
            mine.length === 0 ? space : f.dangling(mine),
            formatExpr(f, item.value),
          ]);
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
      commaIn(e.ts, e.ts),
    );
  return f.parenthesized(open, content, close, openComments);
}

function itemStart(i: Dict["items"][number]): number {
  const k = i.key ?? i.value;
  return outer(k).start;
}

function comp(f: Fmt, e: Comp, preserve: boolean): Doc {
  const dangling = f.comments.dangling(e);
  const joined = () => e.generators.flatMap((g, i) => (i > 0 ? [softOrSpace, comprehension(f, g)] : [comprehension(f, g)]));
  const body = () => group([group(formatExpr(f, e.elt)), softOrSpace, joined()]);
  if (e.kind === "Generator" && preserve && dangling.length === 0 && !e.open)
    return [group(formatExpr(f, e.elt)), softOrSpace, joined()];
  const open = e.open ? f.tok(e.open) : synthetic(e.ts, "(");
  const close = e.close ? f.tok(e.close) : synthetic(e.ts, ")");
  return f.parenthesized(open, body, close, dangling);
}

function dictComp(f: Fmt, e: DictComp): Doc {
  const dangling = f.comments.dangling(e);
  const firstStart = outer(e.key).start;
  const openComments = dangling.filter((c) => c.end < firstStart);
  const kv = dangling.filter((c) => c.end >= firstStart);
  const content = () =>
    group([
      group(formatExpr(f, e.key)),
      f.tok(e.colon),
      kv.length === 0 ? space : f.dangling(kv),
      formatExpr(f, e.value),
      softOrSpace,
      e.generators.flatMap((g, i) => (i > 0 ? [softOrSpace, comprehension(f, g)] : [comprehension(f, g)])),
    ]);
  return f.parenthesized(f.tok(e.open), content, f.tok(e.close), openComments);
}

function comprehension(f: Fmt, c: Comprehension): Doc {
  const cs = f.comments;
  const spacer = (e: Expr, preserve: boolean) =>
    cs.hasLeading(e) && !(preserve && e.parens.length > 0) ? softOrSpace : space;
  const out: Doc[] = [f.leading(cs.leading(c))];
  const kws = c.kws;
  const inKw = kws.at(-1) as FormatNode;
  const forKw = kws.at(-2) as FormatNode;
  if (kws.length === 3) out.push(f.tok(kws[0] as FormatNode), space);
  const dangling = cs.dangling(c);
  const targetStart = outer(c.target).start;
  const iterStart = outer(c.iter).start;
  const beforeTarget = dangling.filter((d) => d.end < targetStart);
  const afterTarget = dangling.filter((d) => d.end >= targetStart);
  const beforeIn = afterTarget.filter((d) => d.end < inKw.start);
  const afterIn = afterTarget.filter((d) => d.end >= inKw.start);
  const trailingIn = afterIn.filter((d) => d.start < iterStart);
  let ifComments = afterIn.filter((d) => d.start >= iterStart);
  out.push(
    f.tok(forKw),
    f.trailing(beforeTarget),
    spacer(c.target, c.target.kind !== "Tuple"),
    c.target.kind === "Tuple" ? formatExpr(f, c.target, "preserve", { tuple: "never" }) : formatExpr(f, c.target),
    beforeIn.length === 0 ? space : softOrSpace,
    f.leading(beforeIn),
    f.tok(inKw),
    f.trailing(trailingIn),
    spacer(c.iter, true),
    formatExpr(f, c.iter),
  );
  if (c.ifs.length > 0) {
    const joined: Doc[] = [];
    for (const [i, cond] of c.ifs.entries()) {
      const mine = ifComments.filter((d) => d.start < cond.kw.start);
      ifComments = ifComments.filter((d) => d.start >= cond.kw.start);
      const own = mine.filter((d) => d.line === "own");
      const eol = mine.filter((d) => d.line !== "own");
      if (i > 0) joined.push(softOrSpace);
      joined.push(f.leading(own), f.tok(cond.kw), f.trailing(eol), spacer(cond.test, true), formatExpr(f, cond.test));
    }
    out.push(softOrSpace, joined);
  }
  out.push(f.trailing(cs.trailing(c)));
  return out;
}

function slice(f: Fmt, e: Slice): Doc {
  const cs = f.comments;
  const [c1, c2] = e.colons;
  const { lower, upper, step } = e;
  const simple = (x: Expr | undefined): boolean =>
    x === undefined ||
    x.kind === "Name" ||
    x.kind === "Number" ||
    x.kind === "Bool" ||
    x.kind === "None" ||
    x.kind === "Ellipsis" ||
    x.kind === "Str" ||
    (x.kind === "UnaryOp" && f.text(x.op) !== "not" && simple(x.operand));
  const allSimple = simple(lower) && simple(upper) && simple(step);
  const spaced = !allSimple;
  const dangling = cs.dangling(e);
  const firstColon = dangling.filter((c) => c1 === undefined || c.start < c1.start);
  const rest = dangling.filter((c) => c1 !== undefined && c.start >= c1.start);
  const secondColon = rest.filter((c) => c2 === undefined || c.start < c2.start);
  const afterSecond = rest.filter((c) => c2 !== undefined && c.start >= c2.start);
  const out: Doc[] = [];
  if (lower) out.push(formatExpr(f, lower));
  if (c1) {
    const hasSpaceBefore = spaced && lower !== undefined;
    if (hasSpaceBefore) out.push(space);
    if (firstColon.length > 0) out.push(f.dangling(firstColon));
    else if (!hasSpaceBefore && lower !== undefined && spaced) out.push(space);
    out.push(f.tok(c1));
  }
  if (upper) {
    const lead = cs.leading(upper);
    if (spaced || lead.length > 0) out.push(leadingSpace(lead, spaced));
    out.push(formatExpr(f, upper));
  }
  if (c2) {
    if (spaced && upper) out.push(space);
    out.push(f.dangling(secondColon), f.tok(c2));
    if (step) {
      const lead = cs.leading(step);
      if (spaced || lead.length > 0) out.push(leadingSpace(lead, spaced));
      out.push(formatExpr(f, step));
    }
  } else if (secondColon.length > 0) out.push(f.dangling(secondColon));
  out.push(f.dangling(afterSecond));
  return out;
}

function leadingSpace(lead: readonly Comment[], spaced: boolean): Doc {
  const first = lead[0];
  if (first) return first.line === "own" ? hard : text("  ");
  return spaced ? space : [];
}

// ---- binary-like expressions (expression/binary_like.rs) ----

type Operand = {
  k: "operand";
  e: Expr;
  /** Comments from the chain around: the left operand's leading, the right operand's trailing. */
  leadingBinary: readonly Comment[] | undefined;
  trailingBinary: readonly Comment[] | undefined;
};
type Operator = { k: "operator"; tok: FormatNode; prec: Prec; pow: boolean; trailing: readonly Comment[] };
type Part = Operand | Operator;

function flatten(f: Fmt, root: BinOp | Compare | BoolOp): Part[] {
  const cs = f.comments;
  const parts: Part[] = [];
  const isFlattened = (e: Expr): e is BinOp | Compare | BoolOp =>
    (e.kind === "BinOp" || e.kind === "Compare" || e.kind === "BoolOp") && e.parens.length === 0;
  const rec = (e: Expr, position: "left" | "middle" | "right", leading: readonly Comment[], trailing: readonly Comment[]) => {
    if (isFlattened(e))
      walk(e, position === "left" ? leading : cs.leading(e), position === "right" ? trailing : cs.trailing(e));
    else
      parts.push({
        k: "operand",
        e,
        leadingBinary: position === "left" ? leading : undefined,
        trailingBinary: position === "right" ? trailing : undefined,
      });
  };
  const op = (tok: FormatNode, prec: Prec, trailing: readonly Comment[] = []) =>
    parts.push({ k: "operator", tok, prec, pow: f.text(tok) === "**", trailing });
  const walk = (e: BinOp | Compare | BoolOp, leading: readonly Comment[], trailing: readonly Comment[]) => {
    if (e.kind === "BinOp") {
      rec(e.left, "left", leading, []);
      op(e.op, binPrec(f.text(e.op)), cs.dangling(e));
      rec(e.right, "right", [], trailing);
    } else if (e.kind === "Compare") {
      rec(e.left, "left", leading, []);
      for (const [i, c] of e.comparators.entries()) {
        op(e.ops[i] as FormatNode, Prec.Comparator);
        rec(c, i === e.comparators.length - 1 ? "right" : "middle", [], trailing);
      }
    } else {
      for (const [i, v] of e.values.entries()) {
        if (i > 0) op(e.ops[i - 1] as FormatNode, Prec.BooleanOperation);
        rec(v, i === 0 ? "left" : i === e.values.length - 1 ? "right" : "middle", leading, trailing);
      }
    }
  };
  walk(root, [], []);
  return parts;
}

function operatorDoc(f: Fmt, o: Operator): Doc {
  const t = o.tok;
  const words = t.children.filter((c) => c.kind !== "comment");
  const symbol = words.length > 1 ? words.flatMap((w, i) => (i > 0 ? [space, f.tok(w)] : [f.tok(w)])) : f.tok(t);
  return [symbol, f.trailing(o.trailing)];
}

function hasUnparenthesizedLeadingComments(f: Fmt, o: Operand): boolean {
  if (o.leadingBinary !== undefined) return o.leadingBinary.length > 0;
  const leading = f.comments.leading(o.e);
  if (o.e.parens.length > 0)
    return leading.some((c) => !c.formatted && firstTokenAfter(f, c.end) === "(" && c.end <= o.e.start);
  return leading.length > 0;
}

function operandDoc(f: Fmt, o: Operand): Doc {
  const e = o.e;
  if (e.parens.length === 0) return formatExpr(f, e, "never");
  const cs = f.comments;
  const leading = cs.leading(e);
  let beforeEnd = 0;
  for (const [i, c] of leading.entries()) if (!c.formatted && tokenAfter(f, c.end, e.start) === "(") beforeEnd = i + 1;
  const before = leading.slice(0, beforeEnd);
  const trailing = cs.trailing(e);
  let afterStart = trailing.length;
  for (const [i, c] of trailing.entries())
    if (!c.formatted && tokenAfter(f, e.end, c.start) === ")") {
      afterStart = i;
      break;
    }
  const after = trailing.slice(afterStart);
  for (const c of after) c.formatted = true;
  const out: Doc[] = [before.length > 0 ? f.leading(before) : []];
  out.push(formatExpr(f, e, "always"));
  for (const c of after) c.formatted = false;
  out.push(after.length > 0 ? f.trailing(after) : []);
  return out;
}

function tokenAfter(f: Fmt, from: number, to: number): string | undefined {
  for (const t of tokens(f.src, from, to)) return t.kind;
  return undefined;
}

const isSimplePowerOperand = (f: Fmt, e: Expr): boolean => {
  switch (e.kind) {
    case "UnaryOp":
      return f.text(e.op) !== "not" && isSimplePowerOperand(f, e.operand);
    case "Number":
    case "None":
    case "Bool":
    case "Name":
      return true;
    case "Attribute":
      return isSimplePowerOperand(f, e.value);
    default:
      return false;
  }
};

function sliceDoc(f: Fmt, parts: readonly Part[]): Doc {
  const [only] = parts;
  if (parts.length === 1 && only?.k === "operand") return operandDoc(f, only);
  let lowest = Prec.None;
  for (const p of parts) if (p.k === "operator" && p.prec > lowest) lowest = p.prec;
  const out: Doc[] = [];
  let last = -1;
  const sub = (from: number, to: number) => parts.slice(from, to);
  const piece = (s: readonly Part[]) => {
    const [one] = s;
    return s.length === 1 && one?.k === "operand" ? operandDoc(f, one) : f.inParensGroup(sliceDoc(f, s));
  };
  for (const [i, p] of parts.entries()) {
    if (p.k !== "operator" || p.prec !== lowest) continue;
    const left = sub(last + 1, i);
    const right = sub(i + 1, parts.length);
    const leftLast = left.at(-1) as Operand;
    const leftFirst = left[0] as Operand;
    const rightFirst = right[0] as Operand;
    const isPow =
      p.pow &&
      isSimplePowerOperand(f, leftLast.e) &&
      isSimplePowerOperand(f, rightFirst.e) &&
      leftLast.e.parens.length === 0 &&
      rightFirst.e.parens.length === 0;
    if (leftFirst.leadingBinary) out.push(f.leading(leftFirst.leadingBinary));
    out.push(piece(left));
    if (leftLast.trailingBinary) out.push(f.trailing(leftLast.trailingBinary));
    out.push(isPow ? f.softLine() : f.softLineOrSpace());
    out.push(operatorDoc(f, p));
    if (p.trailing.length > 0 || hasUnparenthesizedLeadingComments(f, rightFirst)) out.push(hard);
    else if (isPow) out.push(f.inParensIfBreaks(space));
    else out.push(space);
    last = i;
  }
  const right = sub(last + 1, parts.length);
  const rightFirst = right[0] as Operand;
  if (rightFirst.leadingBinary) out.push(f.leading(rightFirst.leadingBinary));
  out.push(piece(right));
  return out;
}

function binaryLike(f: Fmt, e: BinOp | Compare | BoolOp): Doc {
  const parts = flatten(f, e);
  if (e.kind === "BoolOp") return f.inParensGroup(sliceDoc(f, parts));
  const strings: number[] = [];
  for (const [i, p] of parts.entries())
    if (p.k === "operand" && p.e.kind === "Str" && p.e.parts.length > 1 && p.e.parens.length === 0) strings.push(i);
  if (strings.length === 0) return f.inParensGroup(sliceDoc(f, parts));

  // The implicit concatenations each get a group of their own, the operands between them another.
  const cs = f.comments;
  const stack: Doc[][] = [[]];
  const emit = (...d: Doc[]) => (stack.at(-1) as Doc[]).push(...d);
  const start = () => stack.push([]);
  const end = () => {
    const d = stack.pop() as Doc[];
    emit(f.inParensGroup(d));
  };
  start();
  if (strings[0] !== 0) start();
  let lastOp: number | undefined;
  for (const i of strings) {
    const operand = parts[i] as Operand;
    const s = operand.e as Str;
    if (i > 0) {
      const leftOp = i - 1;
      if (lastOp === leftOp) end();
      else {
        const left = parts.slice(lastOp === undefined ? 0 : lastOp + 1, leftOp);
        const leftOperator = parts[leftOp] as Operator;
        const leftFirst = left[0] as Operand;
        const leftLast = left.at(-1) as Operand;
        if (leftFirst.leadingBinary) emit(f.leading(leftFirst.leadingBinary));
        emit(sliceDoc(f, left));
        if (leftLast.trailingBinary) emit(f.trailing(leftLast.trailingBinary));
        emit(f.softLineOrSpace(), operatorDoc(f, leftOperator));
        end();
        emit(hasUnparenthesizedLeadingComments(f, operand) || leftOperator.trailing.length > 0 ? hard : space);
      }
      emit(
        operand.leadingBinary ? f.leading(operand.leadingBinary) : [],
        f.leading(cs.leading(s)),
        implicitConcatenated(f, s, hooks),
        f.trailing(cs.trailing(s)),
        operand.trailingBinary ? f.trailing(operand.trailingBinary) : [],
      );
    } else emit(f.leading(cs.leading(s)), implicitConcatenated(f, s, hooks), f.trailing(cs.trailing(s)));
    const rightOp = parts[i + 1] as Operator | undefined;
    if (!rightOp) {
      lastOp = undefined;
      break;
    }
    start();
    const rightOperand = parts[i + 2] as Operand;
    const hasLeading = hasUnparenthesizedLeadingComments(f, rightOperand);
    emit(hasLeading ? space : f.softLineOrSpace(), operatorDoc(f, rightOp));
    emit((hasLeading && rightOperand.e.parens.length === 0) || rightOp.trailing.length > 0 ? hard : space);
    lastOp = i + 1;
  }
  if (lastOp !== undefined && strings.at(-1) !== undefined && (strings.at(-1) as number) + 1 === lastOp) {
    emit(sliceDoc(f, parts.slice(lastOp + 1)));
    end();
  }
  end();
  return stack[0] as Doc[];
}

// ---- f-string interpolations ----

export const hooks: Hooks = {
  interpolation(f, interp, flags, multiline) {
    const cs = f.comments;
    const debug = interp.children.some((c) => !c.named && c.kind === "=");
    const inside = cs.all.filter((c) => c.start > interp.start && c.end < interp.end);
    if (debug || inside.length > 0) {
      for (const c of inside) c.formatted = true;
      return multilineToken(interp, f.text(interp));
    }
    const exprNode = interp.children.find((c) => c.field === "expression");
    const open = interp.children[0] as FormatNode;
    const close = interp.children.at(-1) as FormatNode;
    if (!exprNode) return f.tok(interp);
    const conversion = interp.children.find((c) => c.field === "type_conversion");
    const spec = interp.children.find((c) => c.field === "format_specifier");
    const e = exprAst(exprNode, f.src);
    const multiline2 = multiline && (flags.triple || hasLineBreak(f.src, interp.start, spec ? spec.start : interp.end));
    const bracket = needsBracketSpacing(e) ? (multiline2 ? softOrSpace : space) : [];
    const saved = f.fstr;
    f.fstr = { k: saved.k === "nested" ? "nested" : "inside", flags, multiline: multiline2 };
    try {
      return [
        f.tok(open),
        f.at(PAREN, () => {
          const item: Doc[] = [bracket, formatExpr(f, e)];
          if (conversion) item.push(f.tok(conversion));
          if (spec) item.push(f.tok(spec));
          if (!conversion && !spec) item.push(bracket);
          if (multiline) return spec ? group(indent([soft, item])) : group(softBlockIndent(item));
          return removeSoftLines(item);
        }),
        f.tok(close),
      ];
    } finally {
      f.fstr = saved;
    }
  },
};

function needsBracketSpacing(e: Expr): boolean {
  if (e.kind === "Tuple" && !e.open && e.elts.length === 1) return false;
  const l = leftMost(e);
  return l.kind === "Dict" || l.kind === "DictComp" || l.kind === "Set" || l.kind === "SetComp";
}

/** Ruff's `RemoveSoftLinesBuffer`: the doc as it prints when nothing in it may break. */
export function removeSoftLines(d: Doc): Doc {
  if (isDocs(d)) return d.map(removeSoftLines);
  switch (d.k) {
    case "line":
      if (d.hard) return d;
      return d.soft ? [] : space;
    case "ifBreak":
      return removeSoftLines(d.flat);
    case "group":
    case "groupIfBreak":
    case "fitsExpanded":
    case "bestFitParenthesize":
      return removeSoftLines(d.contents);
    case "indent":
      return removeSoftLines(d.contents);
    case "bestFitting":
      return removeSoftLines(d.variants[0] ?? []);
    default:
      return d;
  }
}

export { isInterpolated };
