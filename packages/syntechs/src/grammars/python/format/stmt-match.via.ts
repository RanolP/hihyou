// The customs stmt-match.ts's `.via`s name: a match's subject and cases, a case's header parts and body.
import type { Frame } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { Match, MatchCase } from "../fmt/ast.js";
import { Unformattable } from "../fmt/ast.js";
import { COMPOUND, type Fmt } from "../fmt/builders.js";
import { writeMaybeParenthesize } from "../fmt/expr.js";
import { close, COLLAPSE, HARD, INDENT, open, ruffStmtOf, sDsl, sLine, sText, sToken } from "../fmt/sink.js";
import { writeBody } from "../fmt/stmt/defs.js";
import { type Pat, patternAt, readPattern } from "../fmt/pattern.js";
import {
  classArguments,
  mapping,
  maybeParenthesizePattern,
  orPattern,
  pattern,
  patternFields,
  sequence,
} from "../fmt/stmt/match.js";
import { writeLeadingAlternateBranchComments } from "../fmt/stmt/suite.js";
import { byteOffsetOf } from "../fmt/trivia.js";
import { closeSkippedClause } from "../fmt/stmt/verbatim.js";

/** The case `child` (a child of a `case_clause`) is part of: the clause's block is the match's body. */
function caseOf(child: number, ctx: StreamCtx<unknown>): { f: Fmt; c: MatchCase } {
  const clause = ctx.tree.parent(child);
  const { f, s } = ruffStmtOf(ctx.tree.parent(clause));
  const c = (s as Match).cases.find((k) => k.ts === clause);
  if (!c) throw new Error("python match: a case custom on a child of no case");
  return { f, c };
}

/** The `Fmt` printing `n`, a node inside a case's pattern. */
function fmtOf(n: number, ctx: StreamCtx<unknown>): Fmt {
  let child = n;
  while (ctx.tree.kindName(ctx.tree.parent(child)) !== "case_clause") child = ctx.tree.parent(child);
  return caseOf(child, ctx).f;
}

/** The pattern read from `n` when its case's AST was, or else read now (a `case_pattern`'s lone number). */
function patternOf(f: Fmt, n: number): Pat {
  const p = patternAt(f.tree, n);
  if (p?.kind === "Pattern") return p;
  if (p) throw new Error("python match: a pattern custom on a keyword");
  return readPattern(f.tree, n);
}

export const stmtMatchVia = {
  // A `case_pattern`'s child, the fields of the pattern whose `pattern` call printed its comments and parentheses.
  "match.pattern": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    patternFields(f, patternOf(f, n));
  },
  // Given the first node of a keyword's value, prints it: `-` and a number are two nodes.
  "match.keywordValue": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    const kw = patternAt(f.tree, ctx.tree.parent(n));
    if (kw?.kind !== "PatternKeyword") throw new Error("python match: match.keywordValue outside a keyword");
    pattern(f, kw.value);
  },
  // The alternatives, a line before each `|` once the group they share breaks.
  "match.or": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    const p = patternOf(f, n);
    if (p.k !== "or") throw new Error("python match: match.or on no union pattern");
    orPattern(f, p);
  },
  // Given the real part, prints it with its sign, then the operator, a line before it once the group breaks.
  "match.complexReal": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    const p = patternOf(f, ctx.tree.parent(n));
    if (p.k !== "complex") throw new Error("python match: match.complexReal outside a complex pattern");
    pattern(f, p.left);
    f.writeSoftLineOrSpace();
    sToken(p.op, f.text(p.op));
    sText(" ");
  },
  "match.sequence": (n: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const f = fmtOf(n, ctx);
    const p = patternOf(f, n);
    if (p.k !== "seq") throw new Error("python match: match.sequence on no sequence pattern");
    sequence(f, p, frame);
  },
  "match.mapping": (n: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const f = fmtOf(n, ctx);
    const p = patternOf(f, n);
    if (p.k !== "map") throw new Error("python match: match.mapping on no mapping pattern");
    mapping(f, p, frame);
  },
  "match.classArguments": (n: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const f = fmtOf(n, ctx);
    const p = patternOf(f, n);
    if (p.k !== "class") throw new Error("python match: match.classArguments on no class pattern");
    classArguments(f, p, frame);
  },
  "match.subject": (n: number) => {
    const { f, s: m } = ruffStmtOf(n);
    const s = m as Match;
    writeMaybeParenthesize(f, s.subject, s, "ifBreaks");
  },
  // Given the body, prints the colon's comments and every case, each through its rule in stmt-match.ts.
  "match.cases": (n: number) => {
    const { f, s: m } = ruffStmtOf(n);
    const s = m as Match;
    const cs = f.comments;
    closeSkippedClause(f);
    f.writeTrailing(cs.dangling(s));
    f.at(COMPOUND, () => {
      let previous: MatchCase | undefined;
      for (const c of s.cases) {
        open(INDENT);
        sLine(HARD | COLLAPSE);
        if (previous) writeLeadingAlternateBranchComments(f, cs.leading(c), previous.body.at(-1));
        f.writeLeading(cs.leading(c));
        sDsl(c.ts);
        f.writeTrailing(cs.trailing(c));
        close();
        previous = c;
      }
    });
  },
  // Given the first pattern, prints them all: several are one tuple without parentheses.
  "match.casePattern": (n: number, ctx: StreamCtx<unknown>) => {
    const { f, c } = caseOf(n, ctx);
    const cs = f.comments;
    maybeParenthesizePattern(f, c.pattern, c);
    const { start, end } = c.patternSpan;
    const lost = cs.all.find((x) => x.start >= start && x.end <= end && !x.formatted);
    if (lost) throw new Unformattable(`comment in a pattern at ${byteOffsetOf(f.tree, lost.ts)}`);
  },
  "match.guard": (n: number, ctx: StreamCtx<unknown>) => {
    const { f, c } = caseOf(n, ctx);
    if (c.guardKw === undefined || !c.guard) return;
    sToken(c.guardKw, f.text(c.guardKw));
    sText(" ");
    writeMaybeParenthesize(f, c.guard, c, "ifBreaksParenthesized");
  },
  // The colon's comments, then the body.
  "match.caseBody": (n: number, ctx: StreamCtx<unknown>) => {
    const { f, c } = caseOf(n, ctx);
    if (closeSkippedClause(f)) return;
    const dangling = f.comments.dangling(c);
    f.writeTrailing(dangling);
    writeBody(f, c, c.body, "other", dangling);
  },
};
