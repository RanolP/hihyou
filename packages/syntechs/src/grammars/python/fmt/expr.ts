import { NO_NODE } from "../../../core/arena.js";
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
  type IfExp,
  isExpr,
  type Keyword,
  type Lambda,
  outer,
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
  EXPR,
  type Fmt,
  type Level,
  PAREN,
  writeCommaIn,
} from "./builders.js";
import type { Comment } from "./comments.js";
import * as sink from "./sink.js";
import type { Frame } from "../../../fmt/dsl/runtime.js";
import {
  COLLAPSE,
  close as sClose,
  GROUP,
  open as sOpen,
  sLine,
  sLineSuffixBoundary,
  sText,
} from "./sink.js";
import {
  isInterpolated,
  isMultilineStr,
  partOf,
  writeImplicitConcatenated,
} from "./strings.js";
import {
  endOf,
  hasLineBreak,
  leafFrom,
  startOf,
  startsLine,
  tokens,
} from "./trivia.js";

/**
 * Ruff's expression formatting (expression/*.rs): whether an expression gets parentheses (`maybeParenthesize`,
 * `needsParentheses`, `canOmitOptionalParentheses`), and each kind's layout. A rule reads the node it prints and
 * its comments; the parentheses it prints are the source's own tokens where the source has them.
 */

/** Ruff's `Parentheses`: keep the source's, always print them, or print none. */
export type Parens = "preserve" | "always" | "never";
/** Ruff's `Parenthesize`: how a statement or clause wants the expression it holds parenthesized. */
export type Parenthesize =
  | "optional"
  | "ifBreaks"
  | "ifRequired"
  | "ifBreaksParenthesized"
  | "ifBreaksParenthesizedNested";
type Needs = "always" | "never" | "multiline" | "bestFit";
export type Chain = "default" | "nonFluent" | "fluent";
export type TupleMode =
  | "default"
  | "preserve"
  | "optionalParentheses"
  | "never"
  | "neverPreserve";

export interface Opts {
  chain?: Chain;
  tuple?: TupleMode;
  /** A generator that is a call's only argument keeps the call's parentheses. */
  genPreserve?: boolean;
  /** An `else` branch's conditional expression, grouped with the one it continues. */
  ifNested?: boolean;
  /** A lambda on an assignment's right side, measured as if its body could break. */
  lambdaAssign?: boolean;
  /** An attribute a call or subscript applies to, as the chain passes it on (ruff's `decrement_call_like_count`). */
  called?: boolean;
}

const isParenthesizedLevel = (l: Level) =>
  l.k === "paren" || (l.k === "expr" && l.g !== undefined);

/** Writers of `e`'s parentheses: the source's own, or synthetic ones. */
function parenTokens(e: Expr): [() => void, () => void] {
  const p = e.parens[0];
  return p
    ? [() => sink.sToken(p.open, "("), () => sink.sToken(p.close, ")")]
    : [() => sink.sToken(e.ts, "(", true), () => sink.sToken(e.ts, ")", true)];
}

/** Ruff's `FormatExpr`: `e` with its comments, in parentheses per `parens`. */
export function writeExpr(
  f: Fmt,
  e: Expr,
  parens: Parens = "preserve",
  o: Opts = {},
): void {
  const parenthesize =
    parens === "preserve" ? e.parens.length > 0 : parens === "always";
  if (parenthesize) {
    const cs = f.comments;
    const [open, close] = parenTokens(e);
    if (!cs.hasLeading(e) && !cs.hasTrailing(e))
      writeInParens(f, e, open, () => writeFields(f, e, o), close, [], isHuggable(f, e));
    else withParenthesesComments(f, e, open, close, o);
    return;
  }
  const l = f.level;
  f.at(l.k === "top" || l.k === "compound" ? EXPR : l, () => writeNode(f, e, o));
}

/** Ruff's `FormatNodeRule::fmt`: the leading comments, the fields, the trailing comments. */
export function writeNode(f: Fmt, e: Expr, o: Opts = {}): void {
  const cs = f.comments;
  f.writeLeading(cs.leading(e));
  writeFields(f, e, o);
  f.writeTrailing(cs.trailing(e));
}

/** `content` in parentheses: `e`'s own print by their parenthesized_expression's rule, given the content. */
function writeInParens(
  f: Fmt,
  e: Expr,
  open: () => void,
  content: () => void,
  close: () => void,
  dangling: readonly Comment[],
  hug = false,
): void {
  const p = e.parens[0];
  if (p && f.tree.kindName(p.wrapper) === "parenthesized_expression")
    sink.sDsl(p.wrapper, { content, dangling, hug });
  else f.writeParenthesized(open, content, close, dangling, hug);
}

function withParenthesesComments(
  f: Fmt,
  e: Expr,
  open: () => void,
  close: () => void,
  o: Opts,
): void {
  const cs = f.comments;
  const leading = cs.leading(e);
  const trailing = cs.trailing(e);
  const p = e.parens[0];
  const ls = p ? leading.findIndex((c) => c.start >= p.start) : 0;
  const ts = p ? trailing.findIndex((c) => c.start >= p.end) : -1;
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
  f.writeLeading(leadingOuter);
  writeInParens(
    f,
    e,
    open,
    () => {
      f.writeLeading(leadingInner);
      writeFields(f, e, o);
      f.writeTrailing(trailingInner);
    },
    close,
    parenComment,
  );
  f.writeTrailing(trailingOuter);
}

/** Ruff's `maybe_parenthesize_expression`: `e` as a statement or clause holds it. */
export function writeMaybeParenthesize(
  f: Fmt,
  e: Expr,
  parent: Py,
  mode: Parenthesize,
): void {
  const bare = () => writeExpr(f, e, "never");
  if (mode === "optional" && e.parens.length > 0) {
    writeExpr(f, e, "always");
    return;
  }
  const cs = f.comments;
  if (cs.hasLeading(e) || cs.hasTrailingOwnLine(e)) {
    writeExpr(f, e, "always");
    return;
  }
  const needs = needsParentheses(f, e, parent);
  if (needs !== "always" && isParenthesizedLevel(f.level)) {
    if (mode === "ifBreaksParenthesizedNested")
      f.writeParenthesizeIfExpands(e.ts, bare, true);
    else bare();
    return;
  }
  const omitOr = () => {
    if (canOmitOptionalParentheses(f, e)) f.writeOptionalParentheses(e.ts, bare);
    else f.writeParenthesizeIfExpands(e.ts, bare);
  };
  switch (needs) {
    case "multiline":
      if (mode === "ifRequired") bare();
      else omitOr();
      return;
    case "bestFit":
      if (
        mode === "ifBreaksParenthesized" ||
        mode === "ifBreaksParenthesizedNested"
      )
        omitOr();
      else if (mode === "optional" || mode === "ifRequired") bare();
      else if (cs.hasTrailing(e)) writeExpr(f, e, "always");
      else writeBestFit(f, e);
      return;
    case "never":
      bare();
      return;
    default:
      writeExpr(f, e, "always");
  }
}

function writeBestFit(f: Fmt, e: Expr): void {
  const b = sink.openBestFitParenthesize(() => sink.sToken(e.ts, "(", true));
  f.at({ k: "expr", g: b }, () => writeExpr(f, e, "never"));
  sink.closeBestFitParenthesize(b, () => sink.sToken(e.ts, ")", true));
}

const isAnnotationOf = (e: Expr, parent: Py | undefined) =>
  (parent?.kind === "AnnAssign" && parent.annotation === e) ||
  (parent?.kind === "FunctionDef" && parent.returns === e);

export const isCallLike = (e: Expr): e is Attribute | Call | Subscript =>
  e.kind === "Attribute" || e.kind === "Call" || e.kind === "Subscript";

/** Ruff's `NeedsParentheses`: whether `e`, standing in `parent`, needs parentheses to parse or to break. */
export function needsParentheses(
  f: Fmt,
  e: Expr,
  parent: Py | undefined,
): Needs {
  const cs = f.comments;
  const awaitParent = parent?.kind === "Await";
  switch (e.kind) {
    case "Attribute": {
      if (chainFrom(e) === "fluent") return "multiline";
      if (cs.hasDangling(e)) return "always";
      if (e.value.parens.length > 0)
        return cs.trailing(e.value).some((c) => c.line === "eol")
          ? "multiline"
          : "never";
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
      if (
        n === "bestFit" &&
        parent?.kind === "FunctionDef" &&
        parent.returns === e
      ) {
        const params = parent.params;
        return params.items.length === 0 && !cs.has(params)
          ? "multiline"
          : "never";
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
        const p = partOf(f.tree, e.parts[0] as number);
        if (
          p.elements.some(
            (x) =>
              f.tree.kindName(x) === "interpolation" &&
              hasLineBreak(f.tree, startOf(f.tree, x), endOf(f.tree, x)),
          )
        )
          return "never";
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
      if (
        parent?.kind === "Assign" ||
        parent?.kind === "AnnAssign" ||
        parent?.kind === "AugAssign"
      ) {
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
      return e.open !== undefined ? "nonEmpty" : undefined;
    case "List":
    case "Set":
      return e.elts.length > 0 || cs.hasDangling(e) ? "nonEmpty" : "empty";
    case "Tuple":
      if (e.open === undefined) return undefined;
      return e.elts.length > 0 || cs.hasDangling(e) ? "nonEmpty" : "empty";
    case "Dict":
      return e.items.length > 0 || cs.hasDangling(e) ? "nonEmpty" : "empty";
    case "Call":
      return e.args.items.length > 0 || cs.hasDangling(e)
        ? "nonEmpty"
        : "empty";
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
  const st: { first: First; last: Expr | undefined } = {
    first: { k: "none" },
    last: undefined,
  };
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
        if (e.open !== undefined) {
          anyParenthesized = true;
          return;
        }
        break;
      case "Generator":
        if (e.open !== undefined) {
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
  const isParenthesized = (e: Expr) =>
    e.kind !== "Subscript" && hasParentheses(f, e) === "nonEmpty";
  const lastE = st.last;
  const firstE = st.first.k === "expr" ? st.first.e : undefined;
  return (
    (lastE !== undefined && isParenthesized(lastE)) ||
    (firstE !== undefined && isParenthesized(firstE))
  );
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
        left = cur.open !== undefined ? undefined : cur.elt;
        break;
      case "Tuple":
        left = cur.open !== undefined ? undefined : cur.elts[0];
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
      if (e.value.kind === "Call" || e.value.kind === "Subscript")
        attributesAfterParentheses++;
      e = e.value;
    } else if (e.kind === "Call" || e.kind === "Subscript") {
      const inner = e.kind === "Call" ? e.func : e.value;
      if (inner.parens.length > 0) break;
      e = inner;
    } else break;
  }
  return attributesAfterParentheses + (rootParenthesized ? 1 : 0) < 2
    ? "nonFluent"
    : "fluent";
}

function applyInNode(f: Fmt, e: Expr, chain: Chain): Chain {
  if (chain !== "default") return chain;
  return isParenthesizedLevel(f.level) ? chainFrom(e) : "nonFluent";
}

/** The value of an attribute, call or subscript, continuing the chain `layout`. */
export function writeChainValue(f: Fmt, v: Expr, layout: Chain): void {
  if (v.parens.length > 0) writeExpr(f, v, "always");
  else if (isCallLike(v)) writeNode(f, v, { chain: layout, called: v.kind === "Attribute" });
  else writeExpr(f, v, "never");
}

// ---- the kinds ----

function writeFields(f: Fmt, e: Expr, o: Opts): void {
  switch (e.kind) {
    case "Name":
    case "Bool":
    case "None":
    case "Ellipsis":
    case "Number":
    case "Str":
    case "Starred":
    case "UnaryOp":
    case "BinOp":
    case "Compare":
    case "BoolOp":
    case "Named":
    case "Await":
    case "Yield":
    case "DictComp":
    case "Slice":
      sink.sDsl(e.ts);
      return;
    case "IfExp":
      // An `else` branch's conditional continues the group of the one it is in.
      if (o.ifNested === true) sink.sDsl(e.ts);
      else f.writeInParensGroup(() => sink.sDsl(e.ts));
      return;
    case "Lambda":
      sink.sDsl(e.ts, { lambdaAssign: o.lambdaAssign === true });
      return;
    case "Attribute":
    case "Call":
    case "Subscript": {
      // The rule continues the chain `layout`; a fluent chain starting here is one group.
      const chain = o.chain ?? "default";
      const layout = applyInNode(f, e, chain);
      const grouped = chain === "default" && layout === "fluent";
      if (grouped) sink.open(sink.GROUP);
      sink.sDsl(e.ts, { chain: layout, called: o.called === true });
      if (grouped) sink.close();
      return;
    }
    case "Tuple":
      // A bare `a, b` of its own node prints by its rule, given the mode.
      if (["expression_list", "pattern_list"].includes(f.tree.kindName(e.ts)))
        sink.sDsl(e.ts, { tuple: o.tuple ?? "default" });
      else writeTuple(f, e, o.tuple ?? "default");
      return;
    case "List":
    case "Set":
      writeList(f, e);
      return;
    case "Dict":
      sink.sDsl(e.ts);
      return;
    case "ListComp":
    case "SetComp":
    case "Generator":
      writeComp(f, e, o.genPreserve === true);
      return;
  }
}

/** A call's or class's arguments: an argument list prints by its rule; a sole generator's parentheses are ruff's. */
export function writeArgs(f: Fmt, a: Arguments): void {
  if (f.tree.kindName(a.ts) === "argument_list") sink.sDsl(a.ts);
  else
    writeArgumentsFrame(
      f,
      a,
      () => f.writeTok(a.open),
      () => writeArgumentItems(f, a),
      () => f.writeTok(a.close),
    );
}

/** Ruff's frame of arguments: `items` between the brackets, or the dangling comments of an empty list. */
export function writeArgumentsFrame(
  f: Fmt,
  a: Arguments,
  open: () => void,
  items: () => void,
  close: () => void,
): void {
  const dangling = f.comments.dangling(a);
  if (a.items.length === 0)
    f.at(PAREN, () => f.writeEmptyParenthesized(open, dangling, close));
  else f.writeParenthesized(open, items, close, dangling, argumentsHuggable(f, a));
}

/** Ruff's arguments between their brackets, comma-separated in one group. */
export function writeArgumentItems(f: Fmt, a: Arguments): void {
  const comma = writeCommaIn(f.tree, a.ts, a.ts);
  const [single] = a.items;
  sOpen(GROUP);
  if (a.items.length === 1 && single && isExpr(single)) {
    const write =
      single.kind === "Generator"
        ? () => writeExpr(f, single, "preserve", { genPreserve: true })
        : () =>
            writeExpr(
              f,
              single,
              singleArgumentParenthesized(f, single, a.end) ? "always" : "never",
            );
    f.writeJoinCommaSeparated([{ end: single.end, write }], a.end, comma);
  } else
    f.writeJoinCommaSeparated(
      a.items.map((i) => ({
        end: i.end,
        write: () => (isExpr(i) ? writeExpr(f, i) : writeKeyword(f, i)),
      })),
      a.end,
      comma,
    );
  sClose();
}

function singleArgumentParenthesized(f: Fmt, arg: Expr, end: number): boolean {
  let seen = false;
  for (const t of tokens(f.tree, arg.end, end)) {
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
  else if (only.name === undefined && !f.comments.has(only)) arg = only.value;
  else return false;
  if (!isHuggable(f, arg) && !isHuggableStringArgument(f, arg)) return false;
  if (f.comments.hasLeading(arg) || f.comments.hasTrailing(arg)) return false;
  return !f.magicTrailingComma(arg.end, a.end);
}

/** Ruff's `is_huggable_string_argument`: a multiline triple-quoted string that starts on the `(`'s line. */
function isHuggableStringArgument(f: Fmt, arg: Expr): boolean {
  if (arg.kind !== "Str" || arg.parts.length > 1 || !isMultilineStr(f, arg))
    return false;
  if (!partOf(f.tree, arg.parts[0] as number).flags.triple) return false;
  // Past the `(`, only horizontal whitespace separates the argument from a line break: it starts its own line.
  return !startsLine(f.tree, leafFrom(f.tree, outer(arg).start));
}

/** Ruff's `is_expression_huggable`: a bracketed collection hugs its enclosing parentheses in preview. */
export function isHuggable(f: Fmt, e: Expr): boolean {
  switch (e.kind) {
    case "Tuple":
    case "List":
    case "Set":
    case "Dict":
    case "ListComp":
    case "SetComp":
    case "DictComp":
      return f.options.preview === true;
    case "Starred":
      return isHuggable(f, e.value);
    default:
      return false;
  }
}

function writeKeyword(f: Fmt, k: Keyword): void {
  const cs = f.comments;
  f.writeLeading(cs.leading(k));
  sink.sDsl(k.ts);
  f.writeTrailing(cs.trailing(k));
}

export function unaryNeedsLineBreak(f: Fmt, e: UnaryOp): boolean {
  const leading = f.comments.leading(e.operand);
  if (leading.length === 0) return false;
  if (e.operand.parens.length === 0) return true;
  const p = e.operand.parens[0];
  return p !== undefined && leading.some((c) => c.start < p.start);
}

/** The lambda's dangling comments after its parameters start: they print between `:` and its body. */
export function lambdaHeader(f: Fmt, e: Lambda): readonly Comment[] {
  const dangling = f.comments.dangling(e);
  const p = e.params;
  return p ? dangling.filter((c) => c.end >= p.start) : dangling;
}

/** What follows `lambda`: its dangling comments before the parameters, or a space or break, and the parameters. */
export function writeLambdaParams(f: Fmt, e: Lambda, p: Parameters): void {
  const cs = f.comments;
  const before = cs.dangling(e).filter((c) => c.end < p.start);
  const params = sink.capture(() => sink.sDsl(p.ts));
  if (before.length > 0) f.writeDangling(before);
  else if (cs.hasLeading(p)) sink.sLine(sink.HARD | sink.COLLAPSE);
  else sink.sText(" ");
  f.writeLeading(cs.leading(p));
  sink.place(cs.hasAnyIn(p.start, p.end) || cs.has(p) ? params : sink.removeSoftLines(params));
}

export function writeLambdaBody(f: Fmt, e: Lambda, header: readonly Comment[]): void {
  const cs = f.comments;
  const body = e.body;
  if (header.length > 0) {
    const split = header.findIndex((c) => c.line === "own");
    const trailingHeader = split < 0 ? header : header.slice(0, split);
    const leadingBody = split < 0 ? [] : header.slice(split);
    if (body.parens.length > 0 && cs.hasLeading(body)) {
      f.writeTrailing(header);
      if (leadingBody.length === 0) sText(" ");
      else sLine(sink.HARD | COLLAPSE);
      writeExpr(f, body, "always");
      return;
    }
    sText(" ");
    sink.sToken(body.ts, "(", true);
    f.writeTrailing(trailingHeader);
    sOpen(sink.INDENT);
    sLine(sink.HARD | COLLAPSE);
    f.writeLeading(leadingBody);
    writeExpr(f, body, "never");
    sClose();
    sLine(sink.HARD | COLLAPSE);
    sink.sToken(body.ts, ")", true);
    return;
  }
  if (cs.hasLeading(body) || cs.hasTrailingOwnLine(body)) {
    writeExpr(f, body, "always");
    return;
  }
  const needs = needsParentheses(f, body, e);
  if (needs === "always") {
    writeExpr(f, body, "always");
    return;
  }
  if (needs === "multiline") {
    f.writeParenthesizeIfExpands(body.ts, () => writeExpr(f, body, "never"));
    return;
  }
  if (body.kind === "Call" || body.kind === "Subscript") {
    const unparenthesized = sink.capture(() => writeExpr(f, body, "never"));
    if (sink.willBreak(unparenthesized)) sink.sBreakParent();
    const k = sink.openBestFitting(false);
    const variant = (write: () => void) => {
      const v = sink.openVariant(k);
      write();
      sink.closeVariant(v);
    };
    variant(() => sink.place(unparenthesized));
    variant(() => {
      sOpen(GROUP, -1, sink.BROKEN);
      sink.place(unparenthesized);
      sClose();
    });
    variant(() => {
      sink.sToken(body.ts, "(", true);
      sOpen(sink.INDENT);
      sLine(sink.HARD | COLLAPSE);
      sink.place(unparenthesized);
      sClose();
      sLine(sink.HARD | COLLAPSE);
      sink.sToken(body.ts, ")", true);
    });
    sClose();
    return;
  }
  if (hasOwnParentheses(f, body) !== undefined) {
    writeExpr(f, body);
    return;
  }
  f.writeParenthesizeIfExpands(body.ts, () => writeExpr(f, body, "never"));
}

/**
 * Ruff's `FormatParameters`, `Preserve` (a `def`'s parentheses, written by its spec's frame) or `Never` (a
 * lambda's).
 */
export function writeParameters(
  f: Fmt,
  p: Parameters,
  mode: Frame | "never",
): void {
  const cs = f.comments;
  const dangling = cs.dangling(p);
  let parenComments: Comment[] = [];
  let rest: readonly Comment[] = dangling;
  const first = dangling[0];
  if (first && first.line === "eol") {
    let only = true;
    for (const t of tokens(f.tree, p.start, first.start))
      if (t.kind !== "(" && t.kind !== "[" && t.kind !== "{") {
        only = false;
        break;
      }
    if (only) {
      parenComments = [first];
      rest = dangling.slice(1);
    }
  }
  const writeTok = (n: number) => sink.sToken(n, f.text(n));
  const inner = () => {
    const parenthesizedLevel = isParenthesizedLevel(f.level);
    let lastEnd: number | undefined;
    for (const [i, item] of p.items.entries()) {
      if (i > 0) {
        writeTok(commaBefore(f, p, item.start));
        if (parenthesizedLevel) sink.sLine(sink.COLLAPSE);
        else sink.sText(" ");
      }
      if (item.kind === "Separator") {
        const mine = rest.filter((c) => separatorOwns(p, i, c));
        f.writeLeading(mine.filter((c) => c.line === "own"));
        sink.sDsl(item.ts);
        f.writeTrailing(mine.filter((c) => c.line !== "own"));
      } else writeParameter(f, item);
      lastEnd = item.end;
    }
    const trailingComma =
      lastEnd !== undefined && firstTokenAfter(f, lastEnd) === ",";
    if (mode === "never") {
      if (trailingComma && lastEnd !== undefined)
        writeTok(commaBefore(f, p, lastEnd));
    } else {
      // A single parameter has no source comma to reuse.
      const comma =
        lastEnd !== undefined ? commaBefore(f, p, lastEnd) : undefined;
      sink.open(sink.IF_BROKEN);
      if (comma !== undefined) sink.sToken(comma, ",");
      else sink.sToken(p.ts, ",", true);
      sink.close();
      if (!f.options["skip-magic-trailing-comma"] && trailingComma)
        sink.sLine(sink.HARD | sink.COLLAPSE);
    }
  };
  if (mode === "never") {
    sink.open(sink.GROUP);
    inner();
    sink.close();
    f.writeDangling(rest.filter((c) => !c.formatted));
    return;
  }
  f.at(PAREN, () => {
    if (p.items.length === 0) {
      f.writeEmptyParenthesized(mode.open, dangling, mode.close);
      return;
    }
    // Ruff builds the parameters before the comments after the `(`; the two share no comment.
    mode.open();
    f.writeDanglingOpenParen(parenComments);
    sink.open(sink.INDENT);
    sink.sLine(sink.SOFT | sink.COLLAPSE);
    if (p.items.length === 1) inner();
    else {
      sink.open(sink.GROUP);
      inner();
      sink.close();
    }
    sink.close();
    sink.sLine(sink.SOFT | sink.COLLAPSE);
    mode.close();
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

function commaBefore(f: Fmt, p: Parameters, from: number): number {
  const tree = f.tree;
  const commas: number[] = [];
  for (let i = 0, n = tree.count(p.ts); i < n; i++) {
    const c = tree.child(p.ts, i);
    if (!tree.named(c) && tree.kindName(c) === ",") commas.push(c);
  }
  for (const c of commas) if (startOf(tree, c) >= from) return c;
  // A position past the last comma: the comma before `from`.
  const before = commas.filter((c) => endOf(tree, c) <= from).at(-1);
  return before !== undefined ? before : (commas[0] as number);
}

function firstTokenAfter(f: Fmt, at: number): string | undefined {
  for (const t of tokens(f.tree, at)) return t.kind;
  return undefined;
}

/** Ruff's `FormatParameter`: its comments, then the parameter as its rule in format.ts prints it. */
function writeParameter(f: Fmt, p: Parameter): void {
  const cs = f.comments;
  f.writeLeading(cs.leading(p));
  sink.sDsl(p.ts);
  f.writeTrailing(cs.trailing(p));
}

function writeSequence(f: Fmt, e: Sequence, comma: (after: number) => void): void {
  f.writeJoinCommaSeparated(
    e.elts.map((x) => ({ end: x.end, write: () => writeExpr(f, x) })),
    e.end,
    comma,
  );
}

/** Ruff's tuple layout; `expression_list` and `pattern_list` reach it through their rule's custom. */
export function writeTuple(f: Fmt, e: Sequence, mode: TupleMode): void {
  const cs = f.comments;
  const dangling = cs.dangling(e);
  const { open: lp, close: rp } = e;
  const parenthesized = lp !== undefined;
  const open = lp !== undefined ? () => f.writeTok(lp) : () => sink.sToken(e.ts, "(", true);
  const close = rp !== undefined ? () => f.writeTok(rp) : () => sink.sToken(e.ts, ")", true);
  const comma = writeCommaIn(f.tree, e.ts, e.ts);
  const spec =
    parenthesized &&
    f.tree.kindName(e.ts) === "tuple" &&
    (e.elts.length <= 1 || !(mode === "neverPreserve" && dangling.length === 0));
  if (spec) return sink.sDsl(e.ts);
  if (e.elts.length === 0)
    return f.at(PAREN, () => f.writeEmptyParenthesized(open, dangling, close));
  const sequence = () => writeSequence(f, e, comma);
  if (e.elts.length === 1) {
    const single = e.elts[0] as Expr;
    if (mode === "preserve" && !parenthesized) {
      const c = e.commas[0];
      writeExpr(f, single);
      if (c !== undefined && startOf(f.tree, c) >= single.end) f.writeTok(c);
      return;
    }
    const content = () => {
      writeExpr(f, single);
      comma(single.end);
    };
    return f.writeParenthesized(open, content, close, dangling);
  }
  if (parenthesized && !(mode === "neverPreserve" && dangling.length === 0))
    return f.writeParenthesized(open, sequence, close, dangling);
  switch (mode) {
    case "never":
      for (const [i, x] of e.elts.entries()) {
        if (i > 0) {
          sOpen(GROUP);
          comma((e.elts[i - 1] as Expr).end);
          sText(" ");
          sClose();
        }
        writeExpr(f, x);
      }
      return;
    case "preserve":
      sOpen(GROUP);
      sequence();
      sClose();
      return;
    case "neverPreserve":
      return f.writeOptionalParentheses(e.ts, sequence);
    case "optionalParentheses":
      if (e.elts.length === 2) return f.writeOptionalParentheses(e.ts, sequence);
      return f.writeParenthesizeIfExpands(e.ts, sequence);
    default:
      return f.writeParenthesizeIfExpands(e.ts, sequence);
  }
}

function writeList(f: Fmt, e: Sequence): void {
  if (f.tree.kindName(e.ts) !== "list_pattern") return sink.sDsl(e.ts);
  const dangling = f.comments.dangling(e);
  const open = () => f.writeTok(e.open as number);
  const close = () => f.writeTok(e.close as number);
  if (e.elts.length === 0)
    return f.at(PAREN, () => f.writeEmptyParenthesized(open, dangling, close));
  f.writeParenthesized(open, () => writeSequenceContent(f, e), close, dangling);
}

/** A list's or set's items between its brackets. */
export function writeSequenceContent(f: Fmt, e: Sequence): void {
  writeSequence(f, e, writeCommaIn(f.tree, e.ts, e.ts));
}

export function itemStart(i: Dict["items"][number]): number {
  const k = i.key ?? i.value;
  return outer(k).start;
}

function writeComp(f: Fmt, e: Comp, preserve: boolean): void {
  const dangling = f.comments.dangling(e);
  const elt = () => {
    sOpen(GROUP);
    writeExpr(f, e.elt);
    sClose();
  };
  if (
    e.kind === "Generator" &&
    preserve &&
    dangling.length === 0 &&
    e.open === undefined
  )
    return writeComprehensionBody(f, e, elt);
  if (e.open !== undefined) return sink.sDsl(e.ts);
  const body = () => {
    sOpen(GROUP);
    writeComprehensionBody(f, e, elt);
    sClose();
  };
  f.writeParenthesized(
    () => sink.sToken(e.ts, "(", true),
    body,
    () => sink.sToken(e.ts, ")", true),
    dangling,
  );
}

/** A comprehension's body as ruff prints it: `head` (its element, or its key and value), then each clause. */
export function writeComprehensionBody(f: Fmt, e: Comp | DictComp, head: () => void): void {
  head();
  for (const g of e.generators) {
    sLine(COLLAPSE);
    writeComprehension(f, g);
  }
}

/** Ruff's `FormatComprehension`: the `for` clause and each `if` clause from their DSL spec, between their comments. */
function writeComprehension(f: Fmt, c: Comprehension): void {
  const cs = f.comments;
  f.writeLeading(cs.leading(c));
  sink.sDsl(c.ts);
  if (c.ifs.length > 0) {
    const { ifs } = comprehensionComments(f, c);
    for (const [i, cond] of c.ifs.entries()) {
      sLine(COLLAPSE);
      f.writeLeading((ifs[i] as ComprehensionComments["ifs"][number]).own);
      sink.sDsl(f.tree.parent(cond.kw));
    }
  }
  f.writeTrailing(cs.trailing(c));
}

export interface ComprehensionComments {
  readonly beforeTarget: Comment[];
  readonly beforeIn: Comment[];
  readonly trailingIn: Comment[];
  /** Per `if` clause, the comments before its test: own-line ones lead its keyword, end-of-line ones trail it. */
  readonly ifs: { readonly own: Comment[]; readonly eol: Comment[] }[];
}

/** Where a comprehension's dangling comments go among its clauses. */
export function comprehensionComments(f: Fmt, c: Comprehension): ComprehensionComments {
  const inKw = c.kws.at(-1) as number;
  const inStart = startOf(f.tree, inKw);
  const dangling = f.comments.dangling(c);
  const targetStart = outer(c.target).start;
  const iterStart = outer(c.iter).start;
  const beforeTarget = dangling.filter((d) => d.end < targetStart);
  const afterTarget = dangling.filter((d) => d.end >= targetStart);
  const beforeIn = afterTarget.filter((d) => d.end < inStart);
  const afterIn = afterTarget.filter((d) => d.end >= inStart);
  const trailingIn = afterIn.filter((d) => d.start < iterStart);
  let ifComments = afterIn.filter((d) => d.start >= iterStart);
  const ifs = c.ifs.map((cond) => {
    const testStart = outer(cond.test).start;
    const mine = ifComments.filter((d) => d.start < testStart);
    ifComments = ifComments.filter((d) => d.start >= testStart);
    return {
      own: mine.filter((d) => d.line === "own"),
      eol: mine.filter((d) => d.line !== "own"),
    };
  });
  return { beforeTarget, beforeIn, trailingIn, ifs };
}

/** The space before a comprehension's part, a soft line when a comment leads it. */
export function writeComprehensionSpacer(f: Fmt, e: Expr, preserve: boolean): void {
  if (f.comments.hasLeading(e) && !(preserve && e.parens.length > 0)) sLine(COLLAPSE);
  else sText(" ");
}

// ---- binary-like expressions (expression/binary_like.rs) ----

type Operand = {
  k: "operand";
  e: Expr;
  /** Comments from the chain around: the left operand's leading, the right operand's trailing. */
  leadingBinary: readonly Comment[] | undefined;
  trailingBinary: readonly Comment[] | undefined;
};
type Operator = {
  k: "operator";
  tok: number;
  prec: Prec;
  pow: boolean;
  trailing: readonly Comment[];
};
type Part = Operand | Operator;

function flatten(f: Fmt, root: BinOp | Compare | BoolOp): Part[] {
  const cs = f.comments;
  const parts: Part[] = [];
  const isFlattened = (e: Expr): e is BinOp | Compare | BoolOp =>
    (e.kind === "BinOp" || e.kind === "Compare" || e.kind === "BoolOp") &&
    e.parens.length === 0;
  const rec = (
    e: Expr,
    position: "left" | "middle" | "right",
    leading: readonly Comment[],
    trailing: readonly Comment[],
  ) => {
    if (isFlattened(e))
      walk(
        e,
        position === "left" ? leading : cs.leading(e),
        position === "right" ? trailing : cs.trailing(e),
      );
    else
      parts.push({
        k: "operand",
        e,
        leadingBinary: position === "left" ? leading : undefined,
        trailingBinary: position === "right" ? trailing : undefined,
      });
  };
  const op = (tok: number, prec: Prec, trailing: readonly Comment[] = []) =>
    parts.push({
      k: "operator",
      tok,
      prec,
      pow: f.text(tok) === "**",
      trailing,
    });
  const walk = (
    e: BinOp | Compare | BoolOp,
    leading: readonly Comment[],
    trailing: readonly Comment[],
  ) => {
    if (e.kind === "BinOp") {
      rec(e.left, "left", leading, []);
      op(e.op, binPrec(f.text(e.op)), cs.dangling(e));
      rec(e.right, "right", [], trailing);
    } else if (e.kind === "Compare") {
      rec(e.left, "left", leading, []);
      for (const [i, c] of e.comparators.entries()) {
        op(e.ops[i] as number, Prec.Comparator);
        rec(
          c,
          i === e.comparators.length - 1 ? "right" : "middle",
          [],
          trailing,
        );
      }
    } else {
      for (const [i, v] of e.values.entries()) {
        if (i > 0) op(e.ops[i - 1] as number, Prec.BooleanOperation);
        rec(
          v,
          i === 0 ? "left" : i === e.values.length - 1 ? "right" : "middle",
          leading,
          trailing,
        );
      }
    }
  };
  walk(root, [], []);
  return parts;
}

function writeOperator(f: Fmt, o: Operator): void {
  const t = o.tok;
  const words: number[] = [];
  for (let i = 0, n = f.tree.count(t); i < n; i++) {
    const c = f.tree.child(t, i);
    if (f.tree.kindName(c) !== "comment") words.push(c);
  }
  if (words.length > 1)
    for (const [i, w] of words.entries()) {
      if (i > 0) sText(" ");
      f.writeTok(w);
    }
  else f.writeTok(t);
  f.writeTrailing(o.trailing);
}

function hasUnparenthesizedLeadingComments(f: Fmt, o: Operand): boolean {
  if (o.leadingBinary !== undefined) return o.leadingBinary.length > 0;
  const leading = f.comments.leading(o.e);
  if (o.e.parens.length > 0)
    return leading.some(
      (c) =>
        !c.formatted && firstTokenAfter(f, c.end) === "(" && c.end <= o.e.start,
    );
  return leading.length > 0;
}

function writeOperand(f: Fmt, o: Operand): void {
  const e = o.e;
  if (e.parens.length === 0) {
    writeExpr(f, e, "never");
    return;
  }
  const cs = f.comments;
  const leading = cs.leading(e);
  let beforeEnd = 0;
  for (const [i, c] of leading.entries())
    if (!c.formatted && tokenAfter(f, c.end, e.start) === "(")
      beforeEnd = i + 1;
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
  f.writeLeading(before);
  writeExpr(f, e, "always");
  for (const c of after) c.formatted = false;
  f.writeTrailing(after);
}

function tokenAfter(f: Fmt, from: number, to: number): string | undefined {
  for (const t of tokens(f.tree, from, to)) return t.kind;
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

function writeSlice(f: Fmt, parts: readonly Part[]): void {
  const [only] = parts;
  if (parts.length === 1 && only?.k === "operand") {
    writeOperand(f, only);
    return;
  }
  let lowest = Prec.None;
  for (const p of parts)
    if (p.k === "operator" && p.prec > lowest) lowest = p.prec;
  let last = -1;
  const sub = (from: number, to: number) => parts.slice(from, to);
  const piece = (s: readonly Part[]) => {
    const [one] = s;
    if (s.length === 1 && one?.k === "operand") writeOperand(f, one);
    else f.writeInParensGroup(() => writeSlice(f, s));
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
    if (leftFirst.leadingBinary) f.writeLeading(leftFirst.leadingBinary);
    piece(left);
    if (leftLast.trailingBinary) f.writeTrailing(leftLast.trailingBinary);
    if (isPow) f.writeSoftLine();
    else f.writeSoftLineOrSpace();
    writeOperator(f, p);
    if (
      p.trailing.length > 0 ||
      hasUnparenthesizedLeadingComments(f, rightFirst)
    )
      sLine(sink.HARD | COLLAPSE);
    else if (isPow) f.writeInParensIfBreaks(() => sText(" "));
    else sText(" ");
    last = i;
  }
  const right = sub(last + 1, parts.length);
  const rightFirst = right[0] as Operand;
  if (rightFirst.leadingBinary) f.writeLeading(rightFirst.leadingBinary);
  piece(right);
}

export function writeBinaryLike(f: Fmt, e: BinOp | Compare | BoolOp): void {
  const parts = flatten(f, e);
  if (e.kind === "BoolOp") {
    f.writeInParensGroup(() => writeSlice(f, parts));
    return;
  }
  const strings: number[] = [];
  for (const [i, p] of parts.entries())
    if (
      p.k === "operand" &&
      p.e.kind === "Str" &&
      p.e.parts.length > 1 &&
      p.e.parens.length === 0
    )
      strings.push(i);
  if (strings.length === 0) {
    f.writeInParensGroup(() => writeSlice(f, parts));
    return;
  }

  // The implicit concatenations each get a group of their own, the operands between them another: each opened
  // by `start` and closed by `end`, as `writeInParensGroup` would.
  const cs = f.comments;
  const l = f.level;
  const start = () => {
    if (l.k === "paren") sOpen(GROUP);
    else if (l.k === "expr" && l.g !== undefined) sOpen(sink.GROUP_IF_BROKEN, l.g);
  };
  const end = () => {
    if (isParenthesizedLevel(l)) sClose();
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
        if (leftFirst.leadingBinary) f.writeLeading(leftFirst.leadingBinary);
        writeSlice(f, left);
        if (leftLast.trailingBinary) f.writeTrailing(leftLast.trailingBinary);
        f.writeSoftLineOrSpace();
        writeOperator(f, leftOperator);
        end();
        if (
          hasUnparenthesizedLeadingComments(f, operand) ||
          leftOperator.trailing.length > 0
        )
          sLine(sink.HARD | COLLAPSE);
        else sText(" ");
      }
      if (operand.leadingBinary) f.writeLeading(operand.leadingBinary);
    }
    f.writeLeading(cs.leading(s));
    writeImplicitConcatenated(f, s);
    const trailing = cs.trailing(s);
    f.writeTrailing(trailing);
    if (i > 0 && operand.trailingBinary) f.writeTrailing(operand.trailingBinary);
    const rightOp = parts[i + 1] as Operator | undefined;
    if (!rightOp) {
      lastOp = undefined;
      break;
    }
    // ruff flushes the string's end-of-line comment before the operator, which then starts the next line after
    // the flat soft line's space. An own-line comment instead breaks that soft line.
    if (
      !trailing.some((c) => c.line === "own") &&
      !(i > 0 && operand.trailingBinary?.some((c) => c.line === "own"))
    )
      sLineSuffixBoundary();
    start();
    const rightOperand = parts[i + 2] as Operand;
    const hasLeading = hasUnparenthesizedLeadingComments(f, rightOperand);
    if (hasLeading) sText(" ");
    else f.writeSoftLineOrSpace();
    writeOperator(f, rightOp);
    if (
      (hasLeading && rightOperand.e.parens.length === 0) ||
      rightOp.trailing.length > 0
    )
      sLine(sink.HARD | COLLAPSE);
    else sText(" ");
    lastOp = i + 1;
  }
  if (
    lastOp !== undefined &&
    strings.at(-1) !== undefined &&
    (strings.at(-1) as number) + 1 === lastOp
  ) {
    writeSlice(f, parts.slice(lastOp + 1));
    end();
  }
  end();
}

export { isInterpolated };
