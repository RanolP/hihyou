import type { FormatTree } from "../../../../fmt/tree.js";
import type {
  ClassDef,
  Decorator,
  FunctionDef,
  Match,
  TypeParams,
} from "../ast.js";
import { type Fmt, writeCommaIn } from "../builders.js";
import type { Comment } from "../comments.js";
import * as sink from "../sink.js";
import { writeTypeParam } from "./assign.js";
import { hasSkip, writeSkipped } from "./verbatim.js";
import type { Frame } from "../../../../fmt/dsl/runtime.js";
import {
  linesAfter,
  linesAfterIgnoringEndOfLineTrivia,
  linesBefore,
} from "../trivia.js";
import {
  type StmtRules,
  writeClauseBody,
} from "./suite.js";

/** Ruff's definitions and `match` (statement/stmt_{function_def,class_def,match}.rs, other/decorator.rs). */

export const kids = (tree: FormatTree, n: number): number[] =>
  Array.from({ length: tree.count(n) }, (_, i) => tree.child(n, i));

/**
 * The blank lines a definition needs between itself and its own-line comments: two at the top, else one; in a stub
 * file one at the top, else none, or one after a class (`afterClass`).
 */
const definitionGap = (f: Fmt, afterClass = false) =>
  f.options["source-type"] === "stub"
    ? f.level.k === "top" || afterClass
      ? 1
      : 0
    : f.level.k === "top"
      ? 2
      : 1;

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
function writeEmptyLinesBeforeTrailingComments(f: Fmt, s: FunctionDef | ClassDef, comments: readonly Comment[]): void {
  const first = comments.find((c) => c.line === "own");
  if (!first) return;
  const actual = Math.max(0, linesBefore(f.tree, first.start) - 1);
  writeEmptyLines(Math.max(0, definitionGap(f, s.kind === "ClassDef") - actual));
}

/**
 * A definition as its rule in format.ts prints it, from its decorators when it has any; the blank lines that
 * separate it from its own leading and trailing comments, which ruff prints around it, stay here.
 */
function defFromSpec(f: Fmt, s: FunctionDef | ClassDef): void {
  writeEmptyLinesAfterLeadingComments(f, f.comments.leading(s));
  sink.sDsl(s.decorators.length > 0 ? f.tree.parent(s.ts) : s.ts);
  writeEmptyLinesBeforeTrailingComments(f, s, f.comments.trailing(s));
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

/** Ruff's `FormatTypeParams`, in the brackets of `frame` (the kind's rule's). */
export function writeTypeParams(f: Fmt, tp: TypeParams, frame: Frame): void {
  const cs = f.comments;
  const entries = tp.params.map((p) => ({
    end: p.end,
    write: () => {
      f.writeLeading(cs.leading(p));
      writeTypeParam(f, p);
      f.writeTrailing(cs.trailing(p));
    },
  }));
  f.writeParenthesized(
    frame.open,
    () => f.writeJoinCommaSeparated(entries, tp.end, writeCommaIn(f.tree, tp.ts, tp.open)),
    frame.close,
    cs.dangling(tp),
  );
}

// ---- definitions ----

/** `writeClauseBody` for a header; a backslash continuation after its colon drops with the line break. */
export function writeBody(
  f: Fmt,
  _header: { readonly ts: number; readonly colon: number },
  stmts: Parameters<typeof writeClauseBody>[1],
  kind: "function" | "class" | "other",
  colonComments: readonly Comment[],
): void {
  writeClauseBody(f, stmts, kind, colonComments);
}

// A statement its rule in format.ts prints.
const fromSpec = (_: Fmt, s: Match) => sink.sDsl(s.ts);

export const defRules: StmtRules = {
  Match: fromSpec,
  FunctionDef: defFromSpec,
  ClassDef: defFromSpec,
};
