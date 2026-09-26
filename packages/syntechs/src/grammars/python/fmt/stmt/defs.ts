import { type Doc, group } from "../../../../fmt/doc.js";
import type { FormatNode } from "../../../../fmt/tree.js";
import type { ClassDef, Decorator, FunctionDef, TypeParams } from "../ast.js";
import { Unformattable } from "../ast.js";
import { commaIn, emptyLine, type Fmt, hard, space } from "../builders.js";
import type { Comment } from "../comments.js";
import { args, formatExpr, maybeParenthesize, parameters } from "../expr.js";
import {
  linesAfter,
  linesAfterIgnoringEndOfLineTrivia,
  linesBefore,
} from "../trivia.js";
import { clauseBody, clauseHeader, type StmtRules } from "./suite.js";

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

export const defRules: StmtRules = {
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
