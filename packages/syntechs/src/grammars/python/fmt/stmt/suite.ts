import type { Format } from "../elements.js";
import type { ExprStmt, Module, Py, Stmt, Str } from "../ast.js";
import { Unformattable } from "../ast.js";
import { COMPOUND, type Fmt, TOP } from "../builders.js";
import type { Comment } from "../comments.js";
import { lastChildInBody } from "../comments.js";
import { BLANK, COLLAPSE, close, HARD, INDENT, open, part, record, sDsl, sLine, sText } from "../sink.js";
import { formatStr } from "../strings.js";
import {
  byteOffsetOf,
  linesAfter,
  linesAfterIgnoringEndOfLineTrivia,
  linesAfterIgnoringTrivia,
  linesBefore,
} from "../trivia.js";
import { defRules } from "./defs.js";

/**
 * Ruff's module and suite formatting (module/mod_module.rs, statement/suite.rs, statement/clause.rs): the blank
 * lines between statements, docstrings, and the body every compound statement prints with. Each statement prints
 * by its rule in format/*.ts; a definition by defs.ts's, which lays out the blank lines around its comments.
 */

// Distributes over `Stmt`: `Simple` spans several kinds, which `Extract<Stmt, { kind: K }>` would miss.
export type StmtRule<K extends Stmt["kind"]> = (
  f: Fmt,
  s: Stmt extends infer S
    ? S extends { kind: infer SK }
      ? K extends SK
        ? S
        : never
      : never
    : never,
) => Format;
export type StmtRules = { readonly [K in Stmt["kind"]]?: StmtRule<K> };

/**
 * Ruff's `SuiteKind`; `other` is any other clause's body. Ruff's `last_suite_in_statement` only matters in
 * preview and stub files, so it is left out.
 */
export type SuiteKind = "top" | "function" | "class" | "other";

// Ruff's lines: breaking on a line that is still empty prints nothing, so they never stack into blank lines.
const hard = () => sLine(HARD | COLLAPSE);
const emptyLine = () => sLine(HARD | COLLAPSE | BLANK);

/** Ruff's `FormatModModule`. */
export function writeModule(f: Fmt, m: Module): void {
  rejectSuppressions(f);
  const cs = f.comments;
  if (m.body.length === 0) {
    // A file of only comments: ruff holds them as the module's dangling comments, the placement here as leading.
    const dangling = [
      ...cs.leading(m),
      ...cs.dangling(m),
      ...cs.trailing(m),
    ].filter((c) => !c.formatted);
    // The last one's line break is the one `format` ends every file with.
    const last = dangling.at(-1);
    if (last)
      f.at(TOP, () => {
        part(f.leading(dangling.slice(0, -1)));
        part(f.comment(last));
      });
    return;
  }
  writeSuite(f, m.body, "top");
}

/** `fmt: off`, `fmt: skip` and `yapf: disable` ask for source text kept as written, which this port does not do. */
function rejectSuppressions(f: Fmt): void {
  for (const c of f.comments.all)
    if (/\bfmt:\s*(?:off|skip)\b|\byapf:\s*disable\b/.test(f.tree.text(c.ts)))
      throw new Unformattable(
        `suppression comment at ${byteOffsetOf(f.tree, c.ts)}`,
      );
}

/** A statement with its leading and trailing comments (ruff's `FormatNodeRule::fmt`). */
function writeStmt(f: Fmt, s: Stmt): void {
  const cs = f.comments;
  part(f.leading(cs.leading(s)));
  const def = defRules[s.kind] as StmtRule<typeof s.kind> | undefined;
  if (def) part(def(f, s as never));
  else sDsl(s.ts);
  part(f.trailing(cs.trailing(s)));
}

const isDefinition = (s: Stmt) =>
  s.kind === "FunctionDef" || s.kind === "ClassDef";
const isImport = (s: Stmt) => s.kind === "Import" || s.kind === "ImportFrom";
const isCompound = (s: Stmt) =>
  s.kind === "If" ||
  s.kind === "For" ||
  s.kind === "While" ||
  s.kind === "With" ||
  s.kind === "Try" ||
  s.kind === "FunctionDef" ||
  s.kind === "ClassDef" ||
  s.kind === "Match";

/** Ruff's `DocstringStmt::try_from_statement`: a plain string statement, not an implicit concatenation with comments. */
function asDocstring(
  f: Fmt,
  s: Stmt,
  kind: SuiteKind,
): (ExprStmt & { value: Str }) | undefined {
  if (
    kind === "other" ||
    s.kind !== "Expr" ||
    s.value.kind !== "Str" ||
    s.value.flavor !== "str"
  )
    return undefined;
  const v = s.value;
  if (v.parts.length > 1 && v.parts.some((p) => f.comments.has(p)))
    return undefined;
  return s as ExprStmt & { value: Str };
}

/** The indentation a docstring's later lines take: its suite's. */
function indentOf(f: Fmt): string {
  return f.options["indent-style"] === "tab"
    ? "\t".repeat(f.depth)
    : " ".repeat(f.options["indent-width"] * f.depth);
}

/** Ruff's `FormatDocstringStmt`. */
function docstring(f: Fmt, s: ExprStmt & { value: Str }, kind: SuiteKind): void {
  const cs = f.comments;
  const v = s.value;
  part(f.leading(cs.leading(s)));
  part(f.leading(cs.leading(v)));
  part(formatStr(f, v, indentOf(f)));
  part(f.trailing(cs.trailing(v)));
  const trailing = cs.trailing(s);
  if (kind === "class") {
    const own = trailing.find((c) => c.line === "own");
    if (own && linesBefore(f.tree, own.start) < 2) emptyLine();
  }
  part(f.trailing(trailing));
}

/** Ruff's `trailing_function_or_class_def`: the def or class that `s` ends with, through nested last bodies. */
function trailingDefinition(f: Fmt, s: Py | undefined): Py | undefined {
  for (
    let p = s;
    p && !f.comments.hasTrailingOwnLine(p);
    p = lastChildInBody(p)
  )
    if (p.kind === "FunctionDef" || p.kind === "ClassDef") return p;
  return undefined;
}

/** Ruff's `as_only_an_ellipsis`: a body of just `...`, without comments that would stop it collapsing. */
export function onlyEllipsis(
  f: Fmt,
  body: readonly Stmt[],
): ExprStmt | undefined {
  const [s] = body;
  if (
    body.length !== 1 ||
    !s ||
    s.kind !== "Expr" ||
    s.value.kind !== "Ellipsis"
  )
    return undefined;
  if (f.comments.hasLeading(s) || f.comments.hasTrailingOwnLine(s))
    return undefined;
  return s;
}

const lastTrailingEnd = (cs: readonly Comment[], fallback: number) =>
  cs.at(-1)?.end ?? fallback;

/** Ruff's `FormatSuite`. */
export function writeSuite(
  f: Fmt,
  body: readonly Stmt[],
  kind: SuiteKind,
): void {
  const first = body[0];
  if (!first) return;
  const cs = f.comments;
  const top = kind === "top";
  const savedDepth = f.depth;
  f.depth = top ? 0 : f.depth + 1;
  try {
    f.at(top ? TOP : COMPOUND, () => {
      const firstDoc = asDocstring(f, first, kind);
      if (kind === "other" && isDefinition(first) && !cs.hasLeading(first))
        emptyLine();
      if (kind === "function" && !firstDoc) {
        const start = cs.leading(first)[0]?.start ?? first.start;
        if (linesBefore(f.tree, start) > 1) emptyLine();
      }
      if (firstDoc) docstring(f, firstDoc, kind);
      else writeStmt(f, first);
      let emptyLineAfterDocstring =
        (firstDoc !== undefined && kind === "class") ||
        (top && firstDoc !== undefined);

      let preceding = first;
      for (const following of body.slice(1)) {
        between(f, preceding, following, kind, emptyLineAfterDocstring);
        writeStmt(f, following);
        preceding = following;
        emptyLineAfterDocstring = false;
      }
    });
  } finally {
    f.depth = savedDepth;
  }
}

/** The line breaks between two statements of a suite. */
function between(
  f: Fmt,
  preceding: Stmt,
  following: Stmt,
  kind: SuiteKind,
  afterDocstring: boolean,
): void {
  const cs = f.comments;
  const top = kind === "top";
  // One blank line, or two at the top level.
  const blank = (two: boolean) => {
    emptyLine();
    if (two) emptyLine();
  };
  if (isDefinition(following) || trailingDefinition(f, preceding)) {
    const stubBefore =
      following.kind === "FunctionDef" &&
      preceding.kind === "FunctionDef" &&
      onlyEllipsis(f, preceding.body) !== undefined &&
      linesAfterIgnoringEndOfLineTrivia(f.tree, preceding.end) < 2 &&
      !cs.hasTrailingOwnLine(preceding);
    if (stubBefore) hard();
    else blank(top);
    return;
  }
  if (
    isImport(preceding) &&
    (!isImport(following) || cs.hasLeading(following))
  ) {
    blank(
      top &&
        linesAfter(
          f.tree,
          lastTrailingEnd(cs.trailing(preceding), preceding.end),
        ) > 2,
    );
    return;
  }
  if (isCompound(preceding)) {
    const n = linesBefore(
      f.tree,
      cs.leading(following)[0]?.start ?? following.start,
    );
    if (n <= 1) hard();
    else blank(n > 2 && top);
    return;
  }
  if (afterDocstring) {
    emptyLine();
    return;
  }
  const n = linesAfter(
    f.tree,
    lastTrailingEnd(cs.trailing(preceding), preceding.end),
  );
  if (n <= 1) hard();
  else blank(top && n > 2);
}

// ---- clauses (statement/clause.rs), shared by every compound statement ----

/** The block `s` stands in: a decorated definition's statement node is the definition, inside its decorators'. */
function blockOf(f: Fmt, s: Stmt): number {
  const p = f.tree.parent(s.ts);
  return (s.kind === "FunctionDef" || s.kind === "ClassDef") && s.decorators.length > 0 ? f.tree.parent(p) : p;
}

/**
 * Ruff's `FormatClauseBody`: a function or class body of only `...` stays on the header's line; any other body
 * goes indented on the lines below. `colonComments` are the header's trailing comments, printed here too
 * (they are marked printed, so the header printing them first wins). It ends without a line break: whatever
 * follows starts its own line, and at the end of the file one would stack on the break `format` ends it with.
 */
export function writeClauseBody(
  f: Fmt,
  body: readonly Stmt[],
  kind: SuiteKind,
  colonComments: readonly Comment[],
): void {
  if (kind === "function" || kind === "class") {
    const ellipsis = onlyEllipsis(f, body);
    if (ellipsis && colonComments.length === 0) {
      sText(" ");
      writeStmt(f, ellipsis);
      return;
    }
  }
  part(f.trailing(colonComments));
  open(INDENT);
  hard();
  // The block, as its rule in format/stmt-compound.ts prints it: ruff's suite of this kind.
  if (body[0]) sDsl(blockOf(f, body[0]), { suite: kind });
  close();
}

/** `writeClauseBody`, as a `Format` for defs.ts's rules. */
export const clauseBody = (...args: Parameters<typeof writeClauseBody>): Format =>
  record(() => writeClauseBody(...args));

/** Ruff's `leading_alternate_branch_comments`: the lines before `else`/`elif`/`except`/`finally` and its comments. */
export function leadingAlternateBranchComments(
  f: Fmt,
  comments: readonly Comment[],
  last: Py | undefined,
): Format {
  const first = comments[0];
  if (first)
    return [
      f.emptyLines(linesBefore(f.tree, first.start)),
      f.leading(comments),
    ];
  if (last) return f.emptyLines(linesAfterIgnoringTrivia(f.tree, last.end));
  return [];
}
