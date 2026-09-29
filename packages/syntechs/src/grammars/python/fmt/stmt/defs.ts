import type { FormatTree } from "../../../../fmt/tree.js";
import type {
  ClassDef,
  Decorator,
  FunctionDef,
  Match,
  TypeParams,
} from "../ast.js";
import { Unformattable } from "../ast.js";
import { type Fmt, writeCommaIn } from "../builders.js";
import type { Comment } from "../comments.js";
import * as sink from "../sink.js";
import { hasSkip, writeSkipped } from "./verbatim.js";
import type { Frame } from "../../../../fmt/dsl/runtime.js";
import {
  byteEndOf,
  byteOffsetOf,
  endOf,
  linesAfter,
  linesAfterIgnoringEndOfLineTrivia,
  linesBefore,
  startOf,
} from "../trivia.js";
import {
  type StmtRules,
  writeClauseBody,
} from "./suite.js";

/** Ruff's definitions and `match` (statement/stmt_{function_def,class_def,match}.rs, other/decorator.rs). */

export const kids = (tree: FormatTree, n: number): number[] =>
  Array.from({ length: tree.count(n) }, (_, i) => tree.child(n, i));

/** The blank lines a definition needs between itself and its leading comments: two at the top, else one. */
const definitionGap = (f: Fmt) => (f.level.k === "top" ? 2 : 1);

const writeHard = () => sink.sLine(sink.HARD | sink.COLLAPSE);
const writeEmptyLines = (n: number) => {
  for (let i = 0; i < n; i++) sink.sLine(sink.HARD | sink.COLLAPSE | sink.BLANK);
};

/** Ruff's `empty_lines_after_leading_comments`, written after the leading comments already were. */
function writeEmptyLinesAfterLeadingComments(f: Fmt, comments: readonly Comment[]): void {
  const last = comments.findLast((c) => c.line === "own");
  if (!last) return;
  const actual = Math.max(0, linesAfter(f.tree, last.end) - 1);
  const want = definitionGap(f);
  if (actual === 0 || actual >= want) return;
  writeEmptyLines(want - actual);
}

/** Ruff's `empty_lines_before_trailing_comments`, written before the trailing comments are. */
function writeEmptyLinesBeforeTrailingComments(f: Fmt, comments: readonly Comment[]): void {
  const first = comments.find((c) => c.line === "own");
  if (!first) return;
  const actual = Math.max(0, linesBefore(f.tree, first.start) - 1);
  writeEmptyLines(Math.max(0, definitionGap(f) - actual));
}

/**
 * A definition as its rule in format.ts prints it, from its decorators when it has any; the blank lines that
 * separate it from its own leading and trailing comments, which ruff prints around it, stay here.
 */
function defFromSpec(f: Fmt, s: FunctionDef | ClassDef): void {
  writeEmptyLinesAfterLeadingComments(f, f.comments.leading(s));
  sink.sDsl(s.decorators.length > 0 ? f.tree.parent(s.ts) : s.ts);
  writeEmptyLinesBeforeTrailingComments(f, f.comments.trailing(s));
}

/** Ruff's `FormatDecorator`, with the decorator's own comments. */
function writeDecorator(f: Fmt, d: Decorator): void {
  const cs = f.comments;
  // The placement gives the comments after the decorator's line to its expression, where ruff's has them.
  const after = [...cs.trailing(d.expr).filter((c) => c.start > d.expr.end), ...cs.trailing(d)];
  if (hasSkip(f, after)) {
    writeSkipped(f, d, d.expr, after);
    return;
  }
  f.writeLeading(cs.leading(d));
  sink.sDsl(d.ts);
  f.writeTrailing(cs.trailing(d));
}

/** Ruff's `FormatDecorators`: one per line, then the own-line comments between the last and the header. */
export function writeDecorators(
  f: Fmt,
  list: readonly Decorator[],
  leadingDefinitionComments: readonly Comment[],
): void {
  const last = list.at(-1);
  if (!last) return;
  for (const [i, d] of list.entries()) {
    if (i > 0) writeHard();
    writeDecorator(f, d);
  }
  if (leadingDefinitionComments.length === 0) writeHard();
  else {
    if (linesAfterIgnoringEndOfLineTrivia(f.tree, last.end) <= 1) writeHard();
    else writeEmptyLines(1);
    f.writeLeading(leadingDefinitionComments);
  }
}

/**
 * A definition's dangling comments: the own-line ones between its decorators and its header, then the ones
 * after its colon (ruff splits them at the first end-of-line one).
 */
export function splitDangling(
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
 * parenthesized tuple of those, in the brackets of `frame` (the kind's rule's).
 */
export function writeTypeParams(f: Fmt, tp: TypeParams, frame: Frame): void {
  if (f.comments.has(tp) || f.comments.hasAnyIn(tp.start, tp.end))
    throw new Unformattable(
      `comment in type parameters at ${byteOffsetOf(f.tree, tp.ts)}`,
    );
  const t = f.tree;
  const children = kids(t, tp.ts);
  const open = children.find((c) => t.kindName(c) === "[");
  const close = children.findLast((c) => t.kindName(c) === "]");
  if (open === undefined || close === undefined)
    throw new Unformattable(
      `type parameters without brackets at ${byteOffsetOf(t, tp.ts)}`,
    );
  const entries = children
    .filter((c) => t.named(c))
    .map((n) => ({ end: endOf(t, n), write: () => writeTypeParam(f, n) }));
  f.writeParenthesized(
    frame.open,
    () => f.writeJoinCommaSeparated(entries, tp.end, writeCommaIn(t, tp.ts, open)),
    frame.close,
  );
}

const writeTok = (f: Fmt, n: number) => sink.sToken(n, f.text(n));

function writeTypeParam(f: Fmt, n: number): void {
  const t = f.tree;
  const inner = unwrapType(t, n);
  switch (t.kindName(inner)) {
    case "identifier":
      writeTok(f, inner);
      return;
    case "splat_type": {
      const [star, name] = kids(t, inner);
      if (
        star === undefined ||
        name === undefined ||
        t.kindName(name) !== "identifier"
      )
        return unsupported(t, inner);
      writeTok(f, star);
      writeTok(f, name);
      return;
    }
    case "constrained_type": {
      const [name, colon, bound] = kids(t, inner);
      if (
        name === undefined ||
        colon === undefined ||
        bound === undefined ||
        t.kindName(colon) !== ":"
      )
        return unsupported(t, inner);
      const nameTok = unwrapType(t, name);
      if (t.kindName(nameTok) !== "identifier") return unsupported(t, inner);
      sink.sDsl(inner, { boundTokens: true });
      return;
    }
    default:
      return unsupported(t, inner);
  }
}

const unwrapType = (tree: FormatTree, n: number): number => {
  let x = n;
  while (tree.kindName(x) === "type" && tree.count(x) === 1)
    x = tree.child(x, 0);
  return x;
};

export function writeSimpleType(f: Fmt, n: number): void {
  const t = f.tree;
  const x = unwrapType(t, n);
  switch (t.kindName(x)) {
    case "identifier":
      writeTok(f, x);
      return;
    case "attribute":
      for (const c of kids(t, x)) {
        const k = t.kindName(c);
        if (k === "." || k === "identifier") writeTok(f, c);
        else if (k === "attribute") writeSimpleType(f, c);
        else unsupported(t, c);
      }
      return;
    case "tuple": {
      const cs = kids(t, x);
      for (const c of cs) {
        const k = t.kindName(c);
        if (k === "(" || k === ")") writeTok(f, c);
        else if (k === ",") {
          writeTok(f, c);
          if (c !== cs.at(-2)) sink.sText(" ");
        } else writeSimpleType(f, c);
      }
      return;
    }
    default:
      unsupported(t, x);
  }
}

const unsupported = (tree: FormatTree, n: number): never => {
  throw new Unformattable(
    `unsupported type parameter ${tree.kindName(n)} at ${byteOffsetOf(tree, n)}`,
  );
};

// ---- definitions ----

/** `writeClauseBody`, refusing a backslash continuation after the colon. */
export function writeBody(
  f: Fmt,
  header: { readonly ts: number; readonly colon: number },
  stmts: Parameters<typeof writeClauseBody>[1],
  kind: "function" | "class" | "other",
  colonComments: readonly Comment[],
): void {
  const t = f.tree;
  const colonEnd = endOf(t, header.colon);
  // `check` reads a backslash alone on the line after a colon as a dedent, so it would flag the correct output.
  if (
    kids(t, header.ts).some(
      (c) => t.kindName(c) === "line_continuation" && startOf(t, c) >= colonEnd,
    )
  )
    throw new Unformattable(
      `backslash continuation before a body at ${byteEndOf(t, header.colon)}`,
    );
  writeClauseBody(f, stmts, kind, colonComments);
}

// A statement its rule in format.ts prints.
const fromSpec = (_: Fmt, s: Match) => sink.sDsl(s.ts);

export const defRules: StmtRules = {
  Match: fromSpec,
  FunctionDef: defFromSpec,
  ClassDef: defFromSpec,
};
