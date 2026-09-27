// The customs stmt-compound.ts's `.via`s name: ruff's clause headers and bodies (statement/clause.rs).
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { Py, Stmt } from "../fmt/ast.js";
import type { Fmt } from "../fmt/builders.js";
import type { Comment } from "../fmt/comments.js";
import { maybeParenthesize } from "../fmt/expr.js";
import { part, ruffOf, ruffStmtOf } from "../fmt/sink.js";
import { clauseBody, leadingAlternateBranchComments } from "../fmt/stmt/suite.js";

/** A clause as ruff's `clause` prints it: the comments around its header, and its body. */
interface Clause {
  readonly f: Fmt;
  /** The own-line comments before the keyword, and the node the blank lines before it count from. */
  readonly alternate: { readonly comments: readonly Comment[]; readonly last: Py | undefined };
  /** The comments after the colon. */
  readonly colon: readonly Comment[];
  readonly body: readonly Stmt[];
}

const none = { comments: [], last: undefined };

/** The clause tree-sitter node `n` is: a compound statement's first, or one after it. */
function clauseOf(n: number, ctx: StreamCtx<unknown>): Clause {
  const t = ctx.tree;
  const kind = t.kindName(n);
  // A statement's first clause is the statement; its keyword is a child to look it up by.
  const first = kind.endsWith("_statement");
  const { f, s } = ruffStmtOf(first ? t.child(n, 0) : n);
  const cs = f.comments;
  switch (s.kind) {
    case "If": {
      if (first) return { f, alternate: none, colon: cs.dangling(s), body: s.body };
      const at = s.clauses.findIndex((c) => c.ts === n);
      const c = s.clauses[at];
      if (!c) break;
      const last = (at === 0 ? s.body : (s.clauses[at - 1]?.body ?? [])).at(-1);
      return { f, alternate: { comments: cs.leading(c), last }, colon: cs.dangling(c), body: c.body };
    }
  }
  throw new Error(`python: ${kind} is no clause of a ${s.kind}`);
}

export const stmtCompoundVia = {
  "compound.ifBreaks": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Py, "ifBreaks"));
  },
  // A clause's keyword, after the comments and blank lines that separate it from the clause before.
  "compound.alternate": (token: number | undefined, n: number, ctx: StreamCtx<unknown>) => {
    const { f, alternate } = clauseOf(n, ctx);
    part([leadingAlternateBranchComments(f, alternate.comments, alternate.last), token === undefined ? [] : f.tok(token)]);
  },
  // A block: the comments after its clause's colon, then ruff's suite.
  "compound.body": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, colon, body } = clauseOf(ctx.tree.parent(c), ctx);
    part(clauseBody(f, body, "other", colon));
  },
};
