// The customs stmt-match.ts's `.via`s name: a match's subject and cases, a case's header parts and body.
import type { Frame } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { Match, MatchCase } from "../fmt/ast.js";
import { Unformattable } from "../fmt/ast.js";
import { COMPOUND, type Fmt } from "../fmt/builders.js";
import { maybeParenthesize } from "../fmt/expr.js";
import { close, COLLAPSE, dslPart, HARD, INDENT, open, part, ruffStmtOf, sLine, sText, sToken } from "../fmt/sink.js";
import { kids, writeBody } from "../fmt/stmt/defs.js";
import {
  classArguments,
  mapping,
  maybeParenthesizePattern,
  pattern,
  readCasePattern,
  readGroup,
  readPattern,
  sequence,
} from "../fmt/stmt/match.js";
import { leadingAlternateBranchComments } from "../fmt/stmt/suite.js";
import { byteOffsetOf } from "../fmt/trivia.js";

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

export const stmtMatchVia = {
  // A sub-pattern whose parentheses are its own.
  "match.pattern": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    pattern(f, readPattern(f, n));
  },
  // Given the first node of a keyword's value, prints it: `-` and a number are two nodes.
  "match.keywordValue": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    const kw = ctx.tree.parent(n);
    const [, , ...value] = kids(f.tree, kw);
    pattern(f, readGroup(f, kw, value));
  },
  // The alternatives, a line before each `|` once the group they share breaks.
  "match.or": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    const p = readPattern(f, n);
    if (p.k !== "or") throw new Error("python match: match.or on no union pattern");
    for (const [i, item] of p.items.entries()) {
      const bar = p.bars[i - 1];
      if (bar !== undefined) {
        part(f.softLineOrSpace());
        sToken(bar, f.text(bar));
        sText(" ");
      }
      pattern(f, item);
    }
  },
  // Given the real part, prints it with its sign, then the operator, a line before it once the group breaks.
  "match.complexReal": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    const p = readPattern(f, ctx.tree.parent(n));
    if (p.k !== "complex") throw new Error("python match: match.complexReal outside a complex pattern");
    pattern(f, p.left);
    part(f.softLineOrSpace());
    sToken(p.op, f.text(p.op));
    sText(" ");
  },
  "match.sequence": (n: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const f = fmtOf(n, ctx);
    const p = readPattern(f, n);
    if (p.k !== "seq") throw new Error("python match: match.sequence on no sequence pattern");
    sequence(f, p, frame);
  },
  "match.mapping": (n: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const f = fmtOf(n, ctx);
    const p = readPattern(f, n);
    if (p.k !== "map") throw new Error("python match: match.mapping on no mapping pattern");
    mapping(f, p, frame);
  },
  "match.className": (n: number, ctx: StreamCtx<unknown>) => {
    const f = fmtOf(n, ctx);
    for (const x of kids(f.tree, n)) sToken(x, f.text(x));
  },
  "match.classArguments": (n: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const f = fmtOf(n, ctx);
    const p = readPattern(f, n);
    if (p.k !== "class") throw new Error("python match: match.classArguments on no class pattern");
    classArguments(f, p, frame);
  },
  "match.subject": (n: number) => {
    const { f, s: m } = ruffStmtOf(n);
    const s = m as Match;
    // The AST reads one subject, so `match a, b:` would lose the rest.
    if (kids(f.tree, s.ts).filter((c) => f.tree.fieldName(c) === "subject").length > 1)
      throw new Unformattable(`tuple subject in a match at ${byteOffsetOf(f.tree, s.ts)}`);
    part(maybeParenthesize(f, s.subject, s, "ifBreaks"));
  },
  // Given the body, prints the colon's comments and every case, each through its rule in stmt-match.ts.
  "match.cases": (n: number) => {
    const { f, s: m } = ruffStmtOf(n);
    const s = m as Match;
    const cs = f.comments;
    part(f.trailing(cs.dangling(s)));
    f.at(COMPOUND, () => {
      let previous: MatchCase | undefined;
      for (const c of s.cases) {
        open(INDENT);
        sLine(HARD | COLLAPSE);
        if (previous) part(leadingAlternateBranchComments(f, cs.leading(c), previous.body.at(-1)));
        part(f.leading(cs.leading(c)));
        part(dslPart(c.ts));
        part(f.trailing(cs.trailing(c)));
        close();
        previous = c;
      }
    });
  },
  // Given the first pattern, prints them all: several are one tuple without parentheses.
  "match.casePattern": (n: number, ctx: StreamCtx<unknown>) => {
    const { f, c } = caseOf(n, ctx);
    const cs = f.comments;
    if (cs.has(c.pattern) || cs.hasAnyIn(c.pattern.start, c.pattern.end))
      throw new Unformattable(`comment in a pattern at ${byteOffsetOf(f.tree, c.pattern.ts)}`);
    const p = readCasePattern(f, c);
    // `check` keeps a pattern's parentheses as meaning, so it would flag the ones ruff adds to split a long
    // pattern; a header that already overflows is the case that can get them.
    const bracketed = p.paren !== undefined || p.k === "map" || p.k === "class" || (p.k === "seq" && p.type !== "bare");
    // The colon's end column; a header spanning lines is measured on the colon's own line only.
    if (!bracketed && f.tree.col(c.colon) + 1 > f.options["line-length"])
      throw new Unformattable(`long unparenthesized case pattern at ${byteOffsetOf(f.tree, c.ts)}`);
    maybeParenthesizePattern(f, p, c);
  },
  "match.guard": (n: number, ctx: StreamCtx<unknown>) => {
    const { f, c } = caseOf(n, ctx);
    if (c.guardKw === undefined || !c.guard) return;
    sToken(c.guardKw, f.text(c.guardKw));
    sText(" ");
    part(maybeParenthesize(f, c.guard, c, "ifBreaksParenthesized"));
  },
  // The colon's comments, then the body.
  "match.caseBody": (n: number, ctx: StreamCtx<unknown>) => {
    const { f, c } = caseOf(n, ctx);
    const dangling = f.comments.dangling(c);
    part(f.trailing(dangling));
    writeBody(f, c, c.body, "other", dangling);
  },
};
