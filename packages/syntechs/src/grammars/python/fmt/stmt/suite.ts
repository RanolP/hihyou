import { type Doc, indent } from "../../../../fmt/doc.js";
import type { ExprStmt, Module, Py, Stmt, Str } from "../ast.js";
import { Unformattable } from "../ast.js";
import {
  COMPOUND,
  emptyLine,
  type Fmt,
  hard,
  space,
  TOP,
} from "../builders.js";
import type { Comment } from "../comments.js";
import { lastChildInBody } from "../comments.js";
import { hooks } from "../expr.js";
import { formatStr } from "../strings.js";
import {
  linesAfter,
  linesAfterIgnoringEndOfLineTrivia,
  linesAfterIgnoringTrivia,
  linesBefore,
} from "../trivia.js";
import { assignRules } from "./assign.js";
import { clauseRules } from "./clauses.js";
import { defRules } from "./defs.js";
import { simpleRules } from "./simple.js";

/**
 * Ruff's module and suite formatting (module/mod_module.rs, statement/suite.rs, statement/clause.rs): the blank
 * lines between statements, docstrings, and the clause header and body every compound statement prints with.
 * Each statement kind's own layout lives in one of the rule tables below, so they can grow apart.
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
) => Doc;
export type StmtRules = { readonly [K in Stmt["kind"]]?: StmtRule<K> };

/**
 * Ruff's `SuiteKind`; `other` is any other clause's body. Ruff's `last_suite_in_statement` only matters in
 * preview and stub files, so it is left out.
 */
export type SuiteKind = "top" | "function" | "class" | "other";

let table: StmtRules | undefined;
// Built on first use: the rule files import this one, so their tables are not initialized when it loads.
const rules = (): StmtRules => {
  table ??= { ...simpleRules, ...assignRules, ...clauseRules, ...defRules };
  return table;
};

/** Ruff's `FormatModModule`. */
export function formatModule(f: Fmt, m: Module): Doc {
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
      return f.at(TOP, () => [
        f.leading(dangling.slice(0, -1)),
        f.comment(last),
      ]);
    return [];
  }
  return formatSuite(f, m.body, "top");
}

/** `fmt: off`, `fmt: skip` and `yapf: disable` ask for source text kept as written, which this port does not do. */
function rejectSuppressions(f: Fmt): void {
  for (const c of f.comments.all)
    if (/\bfmt:\s*(?:off|skip)\b|\byapf:\s*disable\b/.test(f.tree.text(c.ts)))
      throw new Unformattable(`suppression comment at ${c.start}`);
}

/** A statement with its leading and trailing comments (ruff's `FormatNodeRule::fmt`). */
export function formatStmt(f: Fmt, s: Stmt): Doc {
  const rule = rules()[s.kind] as StmtRule<typeof s.kind> | undefined;
  if (!rule) throw new Unformattable(`no rule for ${s.kind} at ${s.start}`);
  const cs = f.comments;
  const leading = f.leading(cs.leading(s));
  const body = rule(f, s as never);
  return [leading, body, f.trailing(cs.trailing(s))];
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
function docstring(f: Fmt, s: ExprStmt & { value: Str }, kind: SuiteKind): Doc {
  const cs = f.comments;
  const v = s.value;
  const out: Doc[] = [
    f.leading(cs.leading(s)),
    f.leading(cs.leading(v)),
    formatStr(f, v, hooks, indentOf(f)),
    f.trailing(cs.trailing(v)),
  ];
  const trailing = cs.trailing(s);
  if (kind === "class") {
    const own = trailing.find((c) => c.line === "own");
    if (own && linesBefore(f.tree, own.start) < 2) out.push(emptyLine);
  }
  out.push(f.trailing(trailing));
  return out;
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
export function formatSuite(
  f: Fmt,
  body: readonly Stmt[],
  kind: SuiteKind,
): Doc {
  const first = body[0];
  if (!first) return [];
  const cs = f.comments;
  const top = kind === "top";
  const savedDepth = f.depth;
  f.depth = top ? 0 : f.depth + 1;
  try {
    return f.at(top ? TOP : COMPOUND, () => {
      const out: Doc[] = [];
      const firstDoc = asDocstring(f, first, kind);
      if (kind === "other" && isDefinition(first) && !cs.hasLeading(first))
        out.push(emptyLine);
      if (kind === "function" && !firstDoc) {
        const start = cs.leading(first)[0]?.start ?? first.start;
        if (linesBefore(f.tree, start) > 1) out.push(emptyLine);
      }
      out.push(firstDoc ? docstring(f, firstDoc, kind) : formatStmt(f, first));
      let emptyLineAfterDocstring =
        (firstDoc !== undefined && kind === "class") ||
        (top && firstDoc !== undefined);

      let preceding = first;
      for (const following of body.slice(1)) {
        out.push(
          between(f, preceding, following, kind, emptyLineAfterDocstring),
        );
        out.push(formatStmt(f, following));
        preceding = following;
        emptyLineAfterDocstring = false;
      }
      return out;
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
): Doc {
  const cs = f.comments;
  const top = kind === "top";
  if (isDefinition(following) || trailingDefinition(f, preceding)) {
    const stubBefore =
      following.kind === "FunctionDef" &&
      preceding.kind === "FunctionDef" &&
      onlyEllipsis(f, preceding.body) !== undefined &&
      linesAfterIgnoringEndOfLineTrivia(f.tree, preceding.end) < 2 &&
      !cs.hasTrailingOwnLine(preceding);
    if (stubBefore) return hard;
    return top ? [emptyLine, emptyLine] : emptyLine;
  }
  if (
    isImport(preceding) &&
    (!isImport(following) || cs.hasLeading(following))
  ) {
    if (!top) return emptyLine;
    return linesAfter(
      f.tree,
      lastTrailingEnd(cs.trailing(preceding), preceding.end),
    ) <= 2
      ? emptyLine
      : [emptyLine, emptyLine];
  }
  if (isCompound(preceding)) {
    const n = linesBefore(
      f.tree,
      cs.leading(following)[0]?.start ?? following.start,
    );
    if (n <= 1) return hard;
    if (n === 2) return emptyLine;
    return top ? [emptyLine, emptyLine] : emptyLine;
  }
  if (afterDocstring) return emptyLine;
  const n = linesAfter(
    f.tree,
    lastTrailingEnd(cs.trailing(preceding), preceding.end),
  );
  if (n <= 1) return hard;
  if (!top || n === 2) return emptyLine;
  return [emptyLine, emptyLine];
}

// ---- clauses (statement/clause.rs), shared by every compound statement ----

/**
 * Ruff's `FormatClauseHeader`: `header` then its colon, then the comments after the colon. `alternate` gives
 * the leading comments of an alternative branch (`else`, `except`, ...) and the node before it.
 */
export function clauseHeader(
  f: Fmt,
  header: Doc,
  colon: Doc,
  colonComments: readonly Comment[],
  alternate?: { comments: readonly Comment[]; last: Py | undefined },
): Doc {
  return [
    alternate
      ? leadingAlternateBranchComments(f, alternate.comments, alternate.last)
      : [],
    header,
    colon,
    f.trailing(colonComments),
  ];
}

/**
 * Ruff's `FormatClauseBody`: a function or class body of only `...` stays on the header's line; any other body
 * goes indented on the lines below. `colonComments` are the header's trailing comments, printed here too
 * (they are marked printed, so the header printing them first wins). It ends without a line break: whatever
 * follows starts its own line, and at the end of the file one would stack on the break `format` ends it with.
 */
export function clauseBody(
  f: Fmt,
  body: readonly Stmt[],
  kind: SuiteKind,
  colonComments: readonly Comment[],
): Doc {
  if (kind === "function" || kind === "class") {
    const ellipsis = onlyEllipsis(f, body);
    if (ellipsis && colonComments.length === 0)
      return [space, formatStmt(f, ellipsis)];
  }
  return [
    f.trailing(colonComments),
    indent([hard, formatSuite(f, body, kind)]),
  ];
}

/** Ruff's `leading_alternate_branch_comments`: the lines before `else`/`elif`/`except`/`finally` and its comments. */
export function leadingAlternateBranchComments(
  f: Fmt,
  comments: readonly Comment[],
  last: Py | undefined,
): Doc {
  const first = comments[0];
  if (first)
    return [
      f.emptyLines(linesBefore(f.tree, first.start)),
      f.leading(comments),
    ];
  if (last) return f.emptyLines(linesAfterIgnoringTrivia(f.tree, last.end));
  return [];
}
