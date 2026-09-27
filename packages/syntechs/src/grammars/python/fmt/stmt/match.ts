import { type Format, group, synthetic, type Token } from "../elements.js";
import type { Expr, MatchCase } from "../ast.js";
import { exprAst, Unformattable } from "../ast.js";
import { commaIn, type Fmt, space } from "../builders.js";
import { formatExpr, maybeParenthesize } from "../expr.js";
import { dslPart } from "../sink.js";
import { byteOffsetOf, endOf, startOf } from "../trivia.js";
import { kids } from "./defs.js";

/** Ruff's match patterns (pattern/*.rs), which a `match` statement's cases hold. */

/**
 * A match pattern read from the tree-sitter nodes, shaped as ruff's `Pattern`. Tree-sitter has no node for a
 * parenthesized pattern (it reads `(p)` as a one-element tuple without a comma) nor for `-1` (two sibling
 * tokens), so this model folds both in: `paren` holds a pattern's outermost redundant parentheses.
 */
export type Pat = {
  readonly node: number;
  readonly start: number;
  readonly end: number;
  paren?: { open: number; close: number };
  /** The `case_pattern` holding the pattern, whose rule prints it; none past the parentheses of `(p)`. */
  cp?: number;
} & (
  | { k: "expr"; e: Expr; capture: boolean }
  | { k: "neg"; minus: number; e: Expr }
  | { k: "complex"; left: Pat; op: number; right: Pat }
  | { k: "attr"; parts: readonly number[] }
  | { k: "wild" }
  | { k: "star"; star: number; name: number }
  | {
      k: "seq";
      type: "list" | "tuple" | "bare";
      open?: number;
      close?: number;
      items: Pat[];
      commas: number;
      end_: number;
    }
  | {
      k: "map";
      open: number;
      close: number;
      pairs: { key: Pat; colon: number; value: Pat }[];
      rest: { star: number; name: number } | undefined;
    }
  | {
      k: "class";
      cls: readonly number[];
      open: number;
      close: number;
      items: Pat[];
      keywords: { name: number; eq: number; value: Pat; end: number }[];
    }
  | { k: "as"; pattern: Pat; as: number; name: number }
  | { k: "or"; items: Pat[]; bars: number[] }
);

const outerEnd = (f: Fmt, p: Pat) =>
  p.paren !== undefined ? endOf(f.tree, p.paren.close) : p.end;

const unsupportedPattern = (f: Fmt, n: number): never => {
  throw new Unformattable(
    `unsupported pattern ${f.tree.kindName(n)} at ${byteOffsetOf(f.tree, n)}`,
  );
};

/** The pattern after `case`: several top-level patterns (or one and a comma) are a tuple without parentheses. */
export function readCasePattern(f: Fmt, c: MatchCase): Pat {
  const t = f.tree;
  const clause = c.pattern.ts;
  const stop = startOf(t, c.guardKw !== undefined ? c.guardKw : c.colon);
  const parts = kids(t, clause).filter(
    (x) =>
      startOf(t, x) >= c.pattern.start &&
      endOf(t, x) <= stop &&
      (t.kindName(x) === "case_pattern" || t.kindName(x) === ","),
  );
  const items = parts.filter((x) => t.kindName(x) === "case_pattern");
  const first = items[0];
  if (first === undefined) return unsupportedPattern(f, clause);
  if (items.length === 1 && parts.length === 1) return readPattern(f, first);
  const pats = items.map((x) => readPattern(f, x));
  return {
    k: "seq",
    type: "bare",
    node: clause,
    start: c.pattern.start,
    end: c.pattern.end,
    items: pats,
    commas: clause,
    end_: stop,
  };
}

export function readPattern(f: Fmt, n: number): Pat {
  const t = f.tree;
  const kind = (x: number) => t.kindName(x);
  const base = { node: n, start: startOf(t, n), end: endOf(t, n) };
  const cs = kids(t, n).filter((x) => kind(x) !== "line_continuation");
  for (const x of cs)
    if (kind(x) === "ERROR" || t.missing(x)) unsupportedPattern(f, x);
  switch (kind(n)) {
    case "case_pattern": {
      const p = readGroup(f, n, cs);
      if (p.paren === undefined) p.cp = n;
      return p;
    }
    case "union_pattern": {
      const bars = cs.filter((x) => kind(x) === "|");
      const items: Pat[] = [];
      let run: number[] = [];
      for (const x of [...cs, undefined]) {
        if (x === undefined || kind(x) === "|") {
          items.push(readGroup(f, n, run));
          run = [];
        } else run.push(x);
      }
      return { ...base, k: "or", items, bars };
    }
    case "dotted_name": {
      const [only] = cs;
      if (cs.length === 1 && only !== undefined && kind(only) === "identifier")
        return { ...base, k: "expr", e: exprAst(t, only), capture: true };
      return { ...base, k: "attr", parts: cs };
    }
    case "identifier":
      return { ...base, k: "expr", e: exprAst(t, n), capture: true };
    case "string":
    case "concatenated_string":
    case "integer":
    case "float":
    case "none":
    case "true":
    case "false":
      return { ...base, k: "expr", e: exprAst(t, n), capture: false };
    case "_":
      return { ...base, k: "wild" };
    case "complex_pattern": {
      const op = cs.findLast((x) => kind(x) === "+" || kind(x) === "-");
      if (op === undefined) return unsupportedPattern(f, n);
      const at = cs.indexOf(op);
      return {
        ...base,
        k: "complex",
        left: readGroup(f, n, cs.slice(0, at)),
        op,
        right: readGroup(f, n, cs.slice(at + 1)),
      };
    }
    case "splat_pattern": {
      const [star, name] = cs;
      if (
        star === undefined ||
        name === undefined ||
        kind(star) !== "*" ||
        cs.length !== 2
      )
        return unsupportedPattern(f, n);
      return { ...base, k: "star", star, name };
    }
    case "as_pattern": {
      const [inner, as, name] = cs;
      if (
        inner === undefined ||
        as === undefined ||
        name === undefined ||
        kind(as) !== "as" ||
        cs.length !== 3
      )
        return unsupportedPattern(f, n);
      return { ...base, k: "as", pattern: readPattern(f, inner), as, name };
    }
    case "list_pattern":
    case "tuple_pattern": {
      const open = cs[0];
      const close = cs.at(-1);
      if (open === undefined || close === undefined || cs.length < 2)
        return unsupportedPattern(f, n);
      const items = cs.filter((x) => kind(x) === "case_pattern");
      const commas = cs.filter((x) => kind(x) === ",").length;
      const [only] = items;
      if (
        kind(n) === "tuple_pattern" &&
        only !== undefined &&
        items.length === 1 &&
        !commas
      ) {
        // `(p)`: the parentheses are the pattern's own, the outermost pair kept.
        const inner = readPattern(f, only);
        inner.paren = { open, close };
        return inner;
      }
      return {
        ...base,
        k: "seq",
        type: kind(n) === "list_pattern" ? "list" : "tuple",
        open,
        close,
        items: items.map((x) => readPattern(f, x)),
        commas: n,
        end_: base.end,
      };
    }
    case "dict_pattern": {
      const open = cs[0];
      const close = cs.at(-1);
      if (
        open === undefined ||
        close === undefined ||
        kind(open) !== "{" ||
        kind(close) !== "}"
      )
        return unsupportedPattern(f, n);
      const pairs: { key: Pat; colon: number; value: Pat }[] = [];
      let rest: { star: number; name: number } | undefined;
      let run: number[] = [];
      let colon: number | undefined;
      for (const x of cs.slice(1, -1)) {
        if (kind(x) === ",") continue;
        if (kind(x) === "splat_pattern") {
          const [star, name] = kids(t, x);
          if (
            star === undefined ||
            name === undefined ||
            kind(star) !== "**" ||
            t.count(x) !== 2
          )
            return unsupportedPattern(f, x);
          rest = { star, name };
        } else if (kind(x) === ":" && colon === undefined) colon = x;
        else if (colon !== undefined && kind(x) === "case_pattern") {
          pairs.push({
            key: readGroup(f, n, run),
            colon,
            value: readPattern(f, x),
          });
          run = [];
          colon = undefined;
        } else if (colon === undefined) run.push(x);
        else return unsupportedPattern(f, x);
      }
      if (run.length > 0 || colon !== undefined)
        return unsupportedPattern(f, n);
      return { ...base, k: "map", open, close, pairs, rest };
    }
    case "class_pattern": {
      const at = cs.findIndex((x) => kind(x) === "(");
      const open = cs[at];
      const close = cs.at(-1);
      const cls = cs[0];
      if (
        open === undefined ||
        close === undefined ||
        kind(close) !== ")" ||
        at !== 1 ||
        cls === undefined
      )
        return unsupportedPattern(f, n);
      if (kind(cls) !== "dotted_name") return unsupportedPattern(f, cls);
      const items: Pat[] = [];
      const keywords: {
        name: number;
        eq: number;
        value: Pat;
        end: number;
      }[] = [];
      for (const x of cs.slice(at + 1, -1)) {
        if (kind(x) === ",") continue;
        const kw = t.count(x) === 1 ? t.child(x, 0) : undefined;
        if (kw !== undefined && kind(kw) === "keyword_pattern") {
          const [name, eq, ...value] = kids(t, kw);
          if (name === undefined || eq === undefined || kind(eq) !== "=")
            return unsupportedPattern(f, kw);
          keywords.push({
            name,
            eq,
            value: readGroup(f, kw, value),
            end: endOf(t, kw),
          });
        } else if (keywords.length > 0) return unsupportedPattern(f, x);
        else items.push(readPattern(f, x));
      }
      return {
        ...base,
        k: "class",
        cls: kids(t, cls),
        open,
        close,
        items,
        keywords,
      };
    }
    default:
      return unsupportedPattern(f, n);
  }
}

/** One pattern from sibling nodes: a lone node, or `-` and a number, which tree-sitter leaves unwrapped. */
export function readGroup(f: Fmt, parent: number, nodes: number[]): Pat {
  const t = f.tree;
  const [a, b] = nodes;
  if (a !== undefined && nodes.length === 1) return readPattern(f, a);
  if (
    a !== undefined &&
    b !== undefined &&
    nodes.length === 2 &&
    t.kindName(a) === "-" &&
    (t.kindName(b) === "integer" || t.kindName(b) === "float")
  )
    return {
      node: a,
      start: startOf(t, a),
      end: endOf(t, b),
      k: "neg",
      minus: a,
      e: exprAst(t, b),
    };
  return unsupportedPattern(f, a !== undefined ? a : parent);
}

/** Ruff's `FormatPattern` with its `Parentheses` option. */
export function pattern(
  f: Fmt,
  p: Pat,
  parens: "preserve" | "always" | "never" = "preserve",
): Format {
  const parenthesize =
    parens === "preserve" ? p.paren !== undefined : parens === "always";
  const fields = () =>
    p.cp !== undefined ? dslPart(p.cp) : patternFields(f, p);
  if (!parenthesize) return fields();
  const open = p.paren ? f.tok(p.paren.open) : synthetic(p.node, "(");
  const close = p.paren ? f.tok(p.paren.close) : synthetic(p.node, ")");
  return f.parenthesized(open, fields, close);
}

function patternFields(f: Fmt, p: Pat): Format {
  switch (p.k) {
    case "expr":
      return formatExpr(f, p.e, "never");
    case "neg":
      return [f.tok(p.minus), formatExpr(f, p.e, "never")];
    case "complex":
    case "or":
      return f.inParensGroup(dslPart(p.node));
    case "attr":
      return p.parts.map((x) => f.tok(x));
    case "wild":
      return f.tok(p.node);
    case "star":
      return dslPart(p.node);
    case "as":
      return dslPart(p.node);
    case "seq":
      return p.type === "bare"
        ? sequence(f, p, synthetic(p.node, "("), synthetic(p.node, ")"))
        : dslPart(p.node);
    case "map":
    case "class":
      return dslPart(p.node);
  }
}

/** Ruff's `FormatPatternMatchSequence`, between `open` and `close`, synthetic for a tuple without parentheses. */
export function sequence(
  f: Fmt,
  p: Pat & { k: "seq" },
  open: Token,
  close: Token,
): Format {
  const [only] = p.items;
  const comma = commaIn(
    f.tree,
    p.commas,
    p.open !== undefined ? p.open : p.node,
  );
  if (!only) return f.emptyParenthesized(open, [], close);
  if (p.items.length === 1 && p.type !== "list") {
    // A one-element tuple keeps its parentheses, and its comma never makes it expand.
    const open1 = p.type === "tuple" ? open : synthetic(p.node, "(");
    const close1 = p.type === "tuple" ? close : synthetic(p.node, ")");
    return f.parenthesized(
      open1,
      () => [pattern(f, only), comma(outerEnd(f, only))],
      close1,
    );
  }
  const items = () =>
    f.joinCommaSeparated(
      p.items.map((x) => ({ end: outerEnd(f, x), doc: pattern(f, x) })),
      p.end_,
      comma,
    );
  if (p.type === "bare") return f.optionalParentheses(p.node, items);
  return f.parenthesized(open, items, close);
}

/** Ruff's `FormatPatternMatchMapping` between its braces, whose comments `match.casePattern` rejects before this runs. */
export function mapping(
  f: Fmt,
  p: Pat & { k: "map" },
  open: Token,
  close: Token,
): Format {
  if (p.pairs.length === 0 && !p.rest)
    return f.emptyParenthesized(open, [], close);
  const entries: { end: number; doc: Format }[] = p.pairs.map(
    ({ key, colon, value }) => ({
      end: outerEnd(f, value),
      doc: group([pattern(f, key), f.tok(colon), space, pattern(f, value)]),
    }),
  );
  if (p.rest)
    entries.push({
      end: endOf(f.tree, p.rest.name),
      doc: dslPart(f.tree.parent(p.rest.star)),
    });
  return f.parenthesized(
    open,
    () => f.joinCommaSeparated(entries, p.end, commaIn(f.tree, p.node, p.open)),
    close,
  );
}

/** Ruff's `FormatPatternArguments`, a class pattern's parentheses and what they hold. */
export function classArguments(
  f: Fmt,
  p: Pat & { k: "class" },
  open: Token,
  close: Token,
): Format {
  const [only] = p.items;
  if (!only && p.keywords.length === 0)
    return f.emptyParenthesized(open, [], close);
  const comma = commaIn(f.tree, p.node, p.open);
  const entries = () =>
    only && p.items.length === 1 && p.keywords.length === 0
      ? [
          {
            end: outerEnd(f, only),
            // A lone argument keeps its parentheses only when it has its own.
            doc: pattern(f, only, only.paren ? "always" : "never"),
          },
        ]
      : [
          ...p.items.map((x) => ({
            end: outerEnd(f, x),
            doc: pattern(f, x),
          })),
          ...p.keywords.map((k) => ({
            end: k.end,
            doc: dslPart(f.tree.parent(k.name)),
          })),
        ];
  return f.parenthesized(
    open,
    () => group(f.joinCommaSeparated(entries(), p.end, comma)),
    close,
  );
}

/** Ruff's `maybe_parenthesize_pattern`, for a pattern without comments. */
export function maybeParenthesizePattern(f: Fmt, p: Pat, c: MatchCase): Format {
  switch (p.k) {
    case "expr":
      // Ruff's `BestFit` for a value or a capture, the expression's own layout.
      return maybeParenthesize(f, p.e, c, "ifBreaks");
    case "or":
    case "as":
    case "complex":
      return canPatternOmitOptionalParentheses(p)
        ? f.optionalParentheses(p.node, () => pattern(f, p, "never"))
        : f.parenthesizeIfExpands(p.node, () => pattern(f, p, "never"));
    default:
      return pattern(f, p, "never");
  }
}

/** Ruff's `can_pattern_omit_optional_parentheses`: split a first or last bracketed pattern before the `|`s. */
function canPatternOmitOptionalParentheses(root: Pat): boolean {
  let anyParenthesized = false;
  let maxPrecedence = 0; // 0 none, 1 additive, 2 or
  let maxCount = 0;
  let last: Pat | undefined;
  let first: Pat | "token" | undefined;
  const update = (precedence: number, count: number) => {
    if (maxPrecedence < precedence) {
      maxPrecedence = precedence;
      maxCount = count;
    } else if (maxPrecedence === precedence) maxCount += count;
  };
  const visit = (p: Pat) => {
    switch (p.k) {
      case "seq":
      case "map":
        anyParenthesized = true;
        break;
      case "complex":
        update(1, 1);
        break;
      case "class":
        anyParenthesized = true;
        first ??= "token";
        break;
      case "as":
        visitSub(p.pattern);
        break;
      case "or":
        update(2, p.items.length - 1);
        for (const item of p.items) visitSub(item);
        break;
      default:
    }
  };
  const visitSub = (p: Pat) => {
    last = p;
    if (p.paren) anyParenthesized = true;
    else visit(p);
    first ??= p;
  };
  visit(root);
  if (!anyParenthesized || maxCount > 1) return false;
  const bracketed = (p: Pat): boolean => {
    const own =
      p.k === "as"
        ? bracketed(p.pattern)
        : p.k === "seq"
          ? p.items.length > 0
          : p.k === "map"
            ? p.pairs.length > 0 || p.rest !== undefined
            : p.k === "class"
              ? p.items.length > 0 || p.keywords.length > 0
              : false;
    return own || p.paren !== undefined;
  };
  return (
    (last !== undefined && bracketed(last)) ||
    (first !== undefined && first !== "token" && bracketed(first))
  );
}
