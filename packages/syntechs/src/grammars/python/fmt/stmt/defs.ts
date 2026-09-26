import { type Doc, group, synthetic } from "../../../../fmt/doc.js";
import type { FormatNode } from "../../../../fmt/tree.js";
import type {
  ClassDef,
  Decorator,
  Expr,
  FunctionDef,
  MatchCase,
  TypeParams,
} from "../ast.js";
import { exprAst, Unformattable } from "../ast.js";
import {
  blockIndent,
  COMPOUND,
  commaIn,
  emptyLine,
  type Fmt,
  hard,
  space,
} from "../builders.js";
import type { Comment } from "../comments.js";
import { args, formatExpr, maybeParenthesize, parameters } from "../expr.js";
import {
  lineStart,
  linesAfter,
  linesAfterIgnoringEndOfLineTrivia,
  linesBefore,
} from "../trivia.js";
import {
  clauseBody,
  clauseHeader,
  leadingAlternateBranchComments,
  type StmtRules,
} from "./suite.js";

/** Ruff's definitions and `match` (statement/stmt_{function_def,class_def,match}.rs, other/decorator.rs). */

/** The blank lines a definition needs between itself and its leading comments: two at the top, else one. */
const definitionGap = (f: Fmt) => (f.level.k === "top" ? 2 : 1);

/** Ruff's `empty_lines_after_leading_comments`, printed after the leading comments already were. */
function emptyLinesAfterLeadingComments(
  f: Fmt,
  comments: readonly Comment[],
): Doc {
  const last = comments.findLast((c) => c.line === "own");
  if (!last) return [];
  const actual = Math.max(0, linesAfter(last.end, f.src) - 1);
  const want = definitionGap(f);
  if (actual === 0 || actual >= want) return [];
  return Array.from({ length: want - actual }, () => emptyLine);
}

/** Ruff's `empty_lines_before_trailing_comments`, printed before the trailing comments are. */
function emptyLinesBeforeTrailingComments(
  f: Fmt,
  comments: readonly Comment[],
): Doc {
  const first = comments.find((c) => c.line === "own");
  if (!first) return [];
  const actual = Math.max(0, linesBefore(first.start, f.src) - 1);
  const want = definitionGap(f);
  return Array.from({ length: Math.max(0, want - actual) }, () => emptyLine);
}

/** Ruff's `FormatDecorator`, with the decorator's own comments. */
function decorator(f: Fmt, d: Decorator): Doc {
  const cs = f.comments;
  return [
    f.leading(cs.leading(d)),
    f.tok(d.at),
    maybeParenthesize(f, d.expr, d, "optional"),
    f.trailing(cs.trailing(d)),
  ];
}

/** Ruff's `FormatDecorators`: one per line, then the own-line comments between the last and the header. */
function decorators(
  f: Fmt,
  list: readonly Decorator[],
  leadingDefinitionComments: readonly Comment[],
): Doc {
  const last = list.at(-1);
  if (!last) return [];
  const out: Doc[] = list.map((d, i) =>
    i === 0 ? decorator(f, d) : [hard, decorator(f, d)],
  );
  if (leadingDefinitionComments.length === 0) out.push(hard);
  else
    out.push(
      linesAfterIgnoringEndOfLineTrivia(last.end, f.src) <= 1
        ? hard
        : emptyLine,
      f.leading(leadingDefinitionComments),
    );
  return out;
}

/**
 * A definition's dangling comments: the own-line ones between its decorators and its header, then the ones
 * after its colon (ruff splits them at the first end-of-line one).
 */
function splitDangling(
  f: Fmt,
  s: FunctionDef | ClassDef,
): [readonly Comment[], readonly Comment[]] {
  const dangling = f.comments.dangling(s);
  const at = dangling.findIndex((c) => c.line !== "own");
  return at < 0 ? [dangling, []] : [dangling.slice(0, at), dangling.slice(at)];
}

// ---- type parameters (type_param/*.rs) ----

/**
 * Ruff's `FormatTypeParams`. Tree-sitter reads a bound as a type expression the AST does not convert, so a
 * bound is printed from its tokens and only in the shapes whose spacing is fixed: a name, a dotted name, or a
 * parenthesized tuple of those.
 */
function typeParams(f: Fmt, tp: TypeParams): Doc {
  if (f.comments.has(tp) || f.comments.hasAnyIn(tp.start, tp.end))
    throw new Unformattable(`comment in type parameters at ${tp.start}`);
  const open = tp.ts.children.find((c) => c.kind === "[");
  const close = tp.ts.children.findLast((c) => c.kind === "]");
  if (!open || !close)
    throw new Unformattable(`type parameters without brackets at ${tp.start}`);
  const items = tp.ts.children.filter((c) => c.named);
  const entries = items.map((n) => ({ end: n.end, doc: typeParam(f, n) }));
  const comma = commaIn(tp.ts, open);
  return f.parenthesized(
    f.tok(open),
    () => f.joinCommaSeparated(entries, tp.end, comma),
    f.tok(close),
  );
}

function typeParam(f: Fmt, n: FormatNode): Doc {
  const inner = unwrapType(n);
  switch (inner.kind) {
    case "identifier":
      return f.tok(inner);
    case "splat_type": {
      const [star, name] = inner.children;
      if (!star || !name || name.kind !== "identifier")
        return unsupported(inner);
      return [f.tok(star), f.tok(name)];
    }
    case "constrained_type": {
      const [name, colon, bound] = inner.children;
      if (!name || !colon || !bound || colon.kind !== ":")
        return unsupported(inner);
      const nameTok = unwrapType(name);
      if (nameTok.kind !== "identifier") return unsupported(inner);
      return [f.tok(nameTok), f.tok(colon), space, simpleType(f, bound)];
    }
    default:
      return unsupported(inner);
  }
}

const unwrapType = (n: FormatNode): FormatNode => {
  let x = n;
  while (x.kind === "type" && x.children.length === 1 && x.children[0])
    x = x.children[0];
  return x;
};

function simpleType(f: Fmt, n: FormatNode): Doc {
  const x = unwrapType(n);
  switch (x.kind) {
    case "identifier":
      return f.tok(x);
    case "attribute":
      return x.children.map((c) =>
        c.kind === "." || c.kind === "identifier"
          ? f.tok(c)
          : c.kind === "attribute"
            ? simpleType(f, c)
            : unsupported(c),
      );
    case "tuple":
      return x.children.map((c) =>
        c.kind === "(" || c.kind === ")"
          ? f.tok(c)
          : c.kind === ","
            ? [f.tok(c), c === x.children.at(-2) ? [] : space]
            : simpleType(f, c),
      );
    default:
      return unsupported(x);
  }
}

const unsupported = (n: FormatNode): never => {
  throw new Unformattable(`unsupported type parameter ${n.kind} at ${n.start}`);
};

// ---- definitions ----

/**
 * A clause body without the line break `blockIndent` ends it with. That break collapses into whatever follows
 * inside a file, but the last statement of a file meets the non-collapsing line break `format` ends every file
 * with, and the two would print a blank line.
 */
function body(
  f: Fmt,
  header: { readonly ts: FormatNode; readonly colon: FormatNode },
  stmts: Parameters<typeof clauseBody>[1],
  kind: "function" | "class" | "other",
  colonComments: readonly Comment[],
): Doc {
  // `check` reads a backslash alone on the line after a colon as a dedent, so it would flag the correct output.
  if (
    header.ts.children.some(
      (c) => c.kind === "line_continuation" && c.start >= header.colon.end,
    )
  )
    throw new Unformattable(
      `backslash continuation before a body at ${header.colon.end}`,
    );
  return withoutTrailingHard(clauseBody(f, stmts, kind, colonComments));
}

function withoutTrailingHard(d: Doc): Doc {
  if (!Array.isArray(d) || d.length === 0) return d;
  const last = d.at(-1) as Doc;
  if (last === hard) return d.slice(0, -1);
  return [...d.slice(0, -1), withoutTrailingHard(last)];
}

/** Ruff's `format_function_header`, less its colon. */
function functionHeader(f: Fmt, s: FunctionDef): Doc {
  const cs = f.comments;
  const out: Doc[] = s.kws.map((k) => [f.tok(k), space]);
  out.push(f.tok(s.name));
  if (s.typeParams) out.push(typeParams(f, s.typeParams));
  const p = s.params;
  const emptyParams = p.items.length === 0 && !cs.has(p);
  // Ruff's empty `soft_block_indent` prints nothing, where the shared `emptyParenthesized` still breaks.
  const inner: Doc[] = [
    emptyParams && p.open && p.close
      ? [f.tok(p.open), f.tok(p.close)]
      : parameters(f, p, "preserve"),
  ];
  const ret = s.returns;
  if (ret && s.arrow) {
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
  out.push(group(inner));
  return out;
}

/** Ruff's `class` header: an empty argument list is dropped, keeping its end-of-line comments. */
function classHeader(f: Fmt, s: ClassDef): Doc {
  const out: Doc[] = [f.tok(s.kw), space, f.tok(s.name)];
  if (s.typeParams) out.push(typeParams(f, s.typeParams));
  const a = s.args;
  if (a) {
    const dangling = f.comments.dangling(a);
    if (a.items.length === 0 && dangling.every((c) => c.line === "eol"))
      out.push(f.trailing(dangling));
    else out.push(args(f, a));
  }
  return out;
}

// ---- patterns (pattern/*.rs) ----

/**
 * A match pattern read from the tree-sitter nodes, shaped as ruff's `Pattern`. Tree-sitter has no node for a
 * parenthesized pattern (it reads `(p)` as a one-element tuple without a comma) nor for `-1` (two sibling
 * tokens), so this model folds both in: `paren` holds a pattern's outermost redundant parentheses.
 */
type Pat = {
  readonly node: FormatNode;
  readonly start: number;
  readonly end: number;
  paren?: { open: FormatNode; close: FormatNode };
} & (
  | { k: "expr"; e: Expr; capture: boolean }
  | { k: "neg"; minus: FormatNode; e: Expr }
  | { k: "complex"; left: Pat; op: FormatNode; right: Pat }
  | { k: "attr"; parts: readonly FormatNode[] }
  | { k: "wild" }
  | { k: "star"; star: FormatNode; name: FormatNode }
  | {
      k: "seq";
      type: "list" | "tuple" | "bare";
      open?: FormatNode;
      close?: FormatNode;
      items: Pat[];
      commas: FormatNode;
      end_: number;
    }
  | {
      k: "map";
      open: FormatNode;
      close: FormatNode;
      pairs: { key: Pat; colon: FormatNode; value: Pat }[];
      rest: { star: FormatNode; name: FormatNode } | undefined;
    }
  | {
      k: "class";
      cls: readonly FormatNode[];
      open: FormatNode;
      close: FormatNode;
      items: Pat[];
      keywords: { name: FormatNode; eq: FormatNode; value: Pat; end: number }[];
    }
  | { k: "as"; pattern: Pat; as: FormatNode; name: FormatNode }
  | { k: "or"; items: Pat[]; bars: FormatNode[] }
);

const outerEnd = (p: Pat) => p.paren?.close.end ?? p.end;

const unsupportedPattern = (n: FormatNode): never => {
  throw new Unformattable(`unsupported pattern ${n.kind} at ${n.start}`);
};

/** The pattern after `case`: several top-level patterns (or one and a comma) are a tuple without parentheses. */
function readCasePattern(f: Fmt, c: MatchCase): Pat {
  const clause = c.pattern.ts;
  const stop = c.guardKw?.start ?? c.colon.start;
  const kids = clause.children.filter(
    (x) =>
      x.start >= c.pattern.start &&
      x.end <= stop &&
      (x.kind === "case_pattern" || x.kind === ","),
  );
  const items = kids.filter((x) => x.kind === "case_pattern");
  const first = items[0];
  if (!first) return unsupportedPattern(clause);
  if (items.length === 1 && kids.length === 1) return readPattern(f, first);
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

function readPattern(f: Fmt, n: FormatNode): Pat {
  const base = { node: n, start: n.start, end: n.end };
  const kids = n.children.filter((x) => x.kind !== "line_continuation");
  for (const x of kids)
    if (x.kind === "ERROR" || x.missing) unsupportedPattern(x);
  switch (n.kind) {
    case "case_pattern":
      return readGroup(f, n, kids);
    case "union_pattern": {
      const bars = kids.filter((x) => x.kind === "|");
      const items: Pat[] = [];
      let run: FormatNode[] = [];
      for (const x of [...kids, undefined]) {
        if (x === undefined || x.kind === "|") {
          items.push(readGroup(f, n, run));
          run = [];
        } else run.push(x);
      }
      return { ...base, k: "or", items, bars };
    }
    case "dotted_name": {
      const [only] = kids;
      if (kids.length === 1 && only?.kind === "identifier")
        return { ...base, k: "expr", e: exprAst(only, f.src), capture: true };
      return { ...base, k: "attr", parts: kids };
    }
    case "identifier":
      return { ...base, k: "expr", e: exprAst(n, f.src), capture: true };
    case "string":
    case "concatenated_string":
    case "integer":
    case "float":
    case "none":
    case "true":
    case "false":
      return { ...base, k: "expr", e: exprAst(n, f.src), capture: false };
    case "_":
      return { ...base, k: "wild" };
    case "complex_pattern": {
      const op = kids.findLast((x) => x.kind === "+" || x.kind === "-");
      if (!op) return unsupportedPattern(n);
      const at = kids.indexOf(op);
      return {
        ...base,
        k: "complex",
        left: readGroup(f, n, kids.slice(0, at)),
        op,
        right: readGroup(f, n, kids.slice(at + 1)),
      };
    }
    case "splat_pattern": {
      const [star, name] = kids;
      if (!star || !name || star.kind !== "*" || kids.length !== 2)
        return unsupportedPattern(n);
      return { ...base, k: "star", star, name };
    }
    case "as_pattern": {
      const [inner, as, name] = kids;
      if (!inner || !as || !name || as.kind !== "as" || kids.length !== 3)
        return unsupportedPattern(n);
      return { ...base, k: "as", pattern: readPattern(f, inner), as, name };
    }
    case "list_pattern":
    case "tuple_pattern": {
      const open = kids[0];
      const close = kids.at(-1);
      if (!open || !close || kids.length < 2) return unsupportedPattern(n);
      const items = kids.filter((x) => x.kind === "case_pattern");
      const commas = kids.filter((x) => x.kind === ",").length;
      const [only] = items;
      if (n.kind === "tuple_pattern" && only && items.length === 1 && !commas) {
        // `(p)`: the parentheses are the pattern's own, the outermost pair kept.
        const inner = readPattern(f, only);
        inner.paren = { open, close };
        return inner;
      }
      return {
        ...base,
        k: "seq",
        type: n.kind === "list_pattern" ? "list" : "tuple",
        open,
        close,
        items: items.map((x) => readPattern(f, x)),
        commas: n,
        end_: n.end,
      };
    }
    case "dict_pattern": {
      const open = kids[0];
      const close = kids.at(-1);
      if (!open || !close || open.kind !== "{" || close.kind !== "}")
        return unsupportedPattern(n);
      const pairs: { key: Pat; colon: FormatNode; value: Pat }[] = [];
      let rest: { star: FormatNode; name: FormatNode } | undefined;
      let run: FormatNode[] = [];
      let colon: FormatNode | undefined;
      for (const x of kids.slice(1, -1)) {
        if (x.kind === ",") continue;
        if (x.kind === "splat_pattern") {
          const [star, name] = x.children;
          if (!star || !name || star.kind !== "**" || x.children.length !== 2)
            return unsupportedPattern(x);
          rest = { star, name };
        } else if (x.kind === ":" && !colon) colon = x;
        else if (colon && x.kind === "case_pattern") {
          pairs.push({
            key: readGroup(f, n, run),
            colon,
            value: readPattern(f, x),
          });
          run = [];
          colon = undefined;
        } else if (!colon) run.push(x);
        else return unsupportedPattern(x);
      }
      if (run.length > 0 || colon) return unsupportedPattern(n);
      return { ...base, k: "map", open, close, pairs, rest };
    }
    case "class_pattern": {
      const at = kids.findIndex((x) => x.kind === "(");
      const open = kids[at];
      const close = kids.at(-1);
      const cls = kids[0];
      if (!open || !close || close.kind !== ")" || at !== 1 || !cls)
        return unsupportedPattern(n);
      if (cls.kind !== "dotted_name") return unsupportedPattern(cls);
      const items: Pat[] = [];
      const keywords: {
        name: FormatNode;
        eq: FormatNode;
        value: Pat;
        end: number;
      }[] = [];
      for (const x of kids.slice(at + 1, -1)) {
        if (x.kind === ",") continue;
        const kw = x.children.length === 1 ? x.children[0] : undefined;
        if (kw?.kind === "keyword_pattern") {
          const [name, eq, ...value] = kw.children;
          if (!name || !eq || eq.kind !== "=") return unsupportedPattern(kw);
          keywords.push({
            name,
            eq,
            value: readGroup(f, kw, value),
            end: kw.end,
          });
        } else if (keywords.length > 0) return unsupportedPattern(x);
        else items.push(readPattern(f, x));
      }
      return {
        ...base,
        k: "class",
        cls: cls.children,
        open,
        close,
        items,
        keywords,
      };
    }
    default:
      return unsupportedPattern(n);
  }
}

/** One pattern from sibling nodes: a lone node, or `-` and a number, which tree-sitter leaves unwrapped. */
function readGroup(f: Fmt, parent: FormatNode, nodes: FormatNode[]): Pat {
  const [a, b] = nodes;
  if (a && nodes.length === 1) return readPattern(f, a);
  if (
    a &&
    b &&
    nodes.length === 2 &&
    a.kind === "-" &&
    (b.kind === "integer" || b.kind === "float")
  )
    return {
      node: a,
      start: a.start,
      end: b.end,
      k: "neg",
      minus: a,
      e: exprAst(b, f.src),
    };
  return unsupportedPattern(a ?? parent);
}

/** Ruff's `FormatPattern` with its `Parentheses` option. */
function pattern(
  f: Fmt,
  p: Pat,
  parens: "preserve" | "always" | "never" = "preserve",
): Doc {
  const parenthesize =
    parens === "preserve" ? p.paren !== undefined : parens === "always";
  if (!parenthesize) return patternFields(f, p);
  const open = p.paren ? f.tok(p.paren.open) : synthetic(p.node, "(");
  const close = p.paren ? f.tok(p.paren.close) : synthetic(p.node, ")");
  return f.parenthesized(open, () => patternFields(f, p), close);
}

function patternFields(f: Fmt, p: Pat): Doc {
  switch (p.k) {
    case "expr":
      return formatExpr(f, p.e, "never");
    case "neg":
      return [f.tok(p.minus), formatExpr(f, p.e, "never")];
    case "complex":
      return f.inParensGroup([
        pattern(f, p.left),
        f.softLineOrSpace(),
        f.tok(p.op),
        space,
        pattern(f, p.right),
      ]);
    case "attr":
      return p.parts.map((x) => f.tok(x));
    case "wild":
      return f.tok(p.node);
    case "star":
      return [f.tok(p.star), f.tok(p.name)];
    case "as":
      return [pattern(f, p.pattern), space, f.tok(p.as), space, f.tok(p.name)];
    case "or":
      return f.inParensGroup(
        p.items.map((item, i) => {
          const bar = p.bars[i - 1];
          return bar
            ? [f.softLineOrSpace(), f.tok(bar), space, pattern(f, item)]
            : pattern(f, item);
        }),
      );
    case "seq":
      return sequence(f, p);
    case "map":
      return mapping(f, p);
    case "class":
      return classPattern(f, p);
  }
}

/** Ruff's `FormatPatternMatchSequence`. */
function sequence(f: Fmt, p: Pat & { k: "seq" }): Doc {
  const open = p.open ? f.tok(p.open) : synthetic(p.node, "(");
  const close = p.close ? f.tok(p.close) : synthetic(p.node, ")");
  const [only] = p.items;
  const comma = commaIn(p.commas, p.open ?? p.node);
  if (!only) return f.emptyParenthesized(open, [], close);
  if (p.items.length === 1 && p.type !== "list") {
    // A one-element tuple keeps its parentheses, and its comma never makes it expand.
    const open1 = p.type === "tuple" ? open : synthetic(p.node, "(");
    const close1 = p.type === "tuple" ? close : synthetic(p.node, ")");
    return f.parenthesized(
      open1,
      () => [pattern(f, only), comma(outerEnd(only))],
      close1,
    );
  }
  const items = () =>
    f.joinCommaSeparated(
      p.items.map((x) => ({ end: outerEnd(x), doc: pattern(f, x) })),
      p.end_,
      comma,
    );
  if (p.type === "bare") return f.optionalParentheses(p.node, items);
  return f.parenthesized(open, items, close);
}

/** Ruff's `FormatPatternMatchMapping`, whose comments `defs` rejects before this runs. */
function mapping(f: Fmt, p: Pat & { k: "map" }): Doc {
  const open = f.tok(p.open);
  const close = f.tok(p.close);
  if (p.pairs.length === 0 && !p.rest)
    return f.emptyParenthesized(open, [], close);
  const entries: { end: number; doc: Doc }[] = p.pairs.map(
    ({ key, colon, value }) => ({
      end: outerEnd(value),
      doc: group([pattern(f, key), f.tok(colon), space, pattern(f, value)]),
    }),
  );
  if (p.rest)
    entries.push({
      end: p.rest.name.end,
      doc: [f.tok(p.rest.star), f.tok(p.rest.name)],
    });
  return f.parenthesized(
    open,
    () => f.joinCommaSeparated(entries, p.end, commaIn(p.node, p.open)),
    close,
  );
}

/** Ruff's `FormatPatternMatchClass` and `FormatPatternArguments`. */
function classPattern(f: Fmt, p: Pat & { k: "class" }): Doc {
  const cls = p.cls.map((x) => f.tok(x));
  const open = f.tok(p.open);
  const close = f.tok(p.close);
  const [only] = p.items;
  if (!only && p.keywords.length === 0)
    return [cls, f.emptyParenthesized(open, [], close)];
  const comma = commaIn(p.node, p.open);
  const entries = () =>
    only && p.items.length === 1 && p.keywords.length === 0
      ? [
          {
            end: outerEnd(only),
            // A lone argument keeps its parentheses only when it has its own.
            doc: pattern(f, only, only.paren ? "always" : "never"),
          },
        ]
      : [
          ...p.items.map((x) => ({ end: outerEnd(x), doc: pattern(f, x) })),
          ...p.keywords.map((k) => ({
            end: k.end,
            doc: [f.tok(k.name), f.tok(k.eq), pattern(f, k.value)],
          })),
        ];
  return [
    cls,
    f.parenthesized(
      open,
      () => group(f.joinCommaSeparated(entries(), p.end, comma)),
      close,
    ),
  ];
}

/** Ruff's `maybe_parenthesize_pattern`, for a pattern without comments. */
function maybeParenthesizePattern(f: Fmt, p: Pat, c: MatchCase): Doc {
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

// ---- match ----

/** Ruff's `FormatMatchCase`, less its own leading and trailing comments. */
function matchCase(f: Fmt, c: MatchCase): Doc {
  const cs = f.comments;
  if (cs.has(c.pattern) || cs.hasAnyIn(c.pattern.start, c.pattern.end))
    throw new Unformattable(`comment in a pattern at ${c.pattern.start}`);
  const dangling = cs.dangling(c);
  const p = readCasePattern(f, c);
  // `check` keeps a pattern's parentheses as meaning, so it would flag the ones ruff adds to split a long
  // pattern; a header that already overflows is the case that can get them.
  const bracketed =
    p.paren !== undefined ||
    p.k === "map" ||
    p.k === "class" ||
    (p.k === "seq" && p.type !== "bare");
  if (
    !bracketed &&
    c.colon.end - lineStart(f.src, c.start) > f.options["line-length"]
  )
    throw new Unformattable(`long unparenthesized case pattern at ${c.start}`);
  const header: Doc[] = [f.tok(c.kw), space, maybeParenthesizePattern(f, p, c)];
  if (c.guardKw && c.guard)
    header.push(
      space,
      f.tok(c.guardKw),
      space,
      maybeParenthesize(f, c.guard, c, "ifBreaksParenthesized"),
    );
  return [
    clauseHeader(f, header, f.tok(c.colon), dangling),
    body(f, c, c.body, "other", dangling),
  ];
}

export const defRules: StmtRules = {
  Match(f, s) {
    const cs = f.comments;
    // The AST reads one subject, so `match a, b:` would lose the rest.
    if (s.ts.children.filter((c) => c.field === "subject").length > 1)
      throw new Unformattable(`tuple subject in a match at ${s.start}`);
    const header = [
      f.tok(s.kw),
      space,
      maybeParenthesize(f, s.subject, s, "ifBreaks"),
    ];
    const cases = f.at(COMPOUND, () => {
      const out: Doc[] = [];
      let previous: MatchCase | undefined;
      for (const c of s.cases) {
        const alternate = previous
          ? leadingAlternateBranchComments(
              f,
              cs.leading(c),
              previous.body.at(-1),
            )
          : [];
        out.push(
          blockIndent([
            alternate,
            f.leading(cs.leading(c)),
            matchCase(f, c),
            f.trailing(cs.trailing(c)),
          ]),
        );
        previous = c;
      }
      return out;
    });
    return [
      clauseHeader(f, header, f.tok(s.colon), cs.dangling(s)),
      withoutTrailingHard(cases),
    ];
  },
  FunctionDef(f, s) {
    const [leadingDef, trailingDef] = splitDangling(f, s);
    return [
      emptyLinesAfterLeadingComments(f, f.comments.leading(s)),
      decorators(f, s.decorators, leadingDef),
      clauseHeader(f, functionHeader(f, s), f.tok(s.colon), trailingDef),
      body(f, s, s.body, "function", trailingDef),
      emptyLinesBeforeTrailingComments(f, f.comments.trailing(s)),
    ];
  },
  ClassDef(f, s) {
    const [leadingDef, trailingDef] = splitDangling(f, s);
    return [
      emptyLinesAfterLeadingComments(f, f.comments.leading(s)),
      decorators(f, s.decorators, leadingDef),
      clauseHeader(f, classHeader(f, s), f.tok(s.colon), trailingDef),
      body(f, s, s.body, "class", trailingDef),
      emptyLinesBeforeTrailingComments(f, f.comments.trailing(s)),
    ];
  },
};
