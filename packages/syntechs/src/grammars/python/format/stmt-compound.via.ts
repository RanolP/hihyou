// The customs stmt-compound.ts's `.via`s name: ruff's clause headers and bodies (statement/clause.rs).
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { Py, Stmt } from "../fmt/ast.js";
import { type Fmt, space } from "../fmt/builders.js";
import type { Comment } from "../fmt/comments.js";
import { formatExpr, maybeParenthesize } from "../fmt/expr.js";
import { part, ruffOf, ruffStmtOf } from "../fmt/sink.js";
import {
  exceptType,
  type ItemLayout,
  loopComments,
  tryCases,
  withComments,
  withItem,
  withItems,
} from "../fmt/stmt/clauses.js";
import {
  clauseBody,
  formatSuite,
  leadingAlternateBranchComments,
  type SuiteKind,
} from "../fmt/stmt/suite.js";

/** A clause as ruff's `clause` prints it: the comments around its header, and its body. */
interface Clause {
  readonly f: Fmt;
  /** The own-line comments before the keyword, and the node the blank lines before it count from. */
  readonly alternate: { readonly comments: readonly Comment[]; readonly last: Py | undefined };
  /** The comments after the colon. */
  readonly colon: readonly Comment[];
  readonly body: readonly Stmt[];
  /** The statement's comments to print after the body: a `try`'s that no case took. */
  readonly after?: readonly Comment[];
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
    case "For":
    case "While": {
      const { colon, beforeElse, elseColon } = loopComments(f, s);
      if (first) return { f, alternate: none, colon, body: s.body };
      if (!s.orelse) break;
      return { f, alternate: { comments: beforeElse, last: s.body.at(-1) }, colon: elseColon, body: s.orelse.body };
    }
    case "With":
      if (first) return { f, alternate: none, colon: withComments(f, s)[1], body: s.body };
      break;
    case "Try": {
      const c =
        first ? s
        : kind === "except_clause" ? s.handlers.find((h) => h.ts === n)
        : kind === "else_clause" ? s.orelse
        : s.finalbody;
      const at = c && tryCases(f, s);
      const kase = c && at?.cases.get(c);
      if (!c || !at || !kase) break;
      // The comments no case took print after the last.
      const lastCase = s.finalbody ?? s.orelse ?? s.handlers.at(-1) ?? s;
      return { f, ...kase, body: c.body, after: c === lastCase ? at.rest : [] };
    }
  }
  throw new Error(`python: ${kind} is no clause of a ${s.kind}`);
}

export const stmtCompoundVia = {
  "compound.ifBreaks": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Py, "ifBreaks"));
  },
  "compound.forTarget": (c: number) => {
    const { f, e } = ruffOf(c);
    part(
      e.kind === "Tuple"
        ? formatExpr(f, e, "preserve", { tuple: "neverPreserve" })
        : maybeParenthesize(f, e, e.parent as Py, "ifBreaks"),
    );
  },
  // Given the type (or its `as` pattern), prints the handler's type, `as` and name.
  "compound.exceptType": (c: number, ctx: StreamCtx<unknown>) => {
    const n = ctx.tree.parent(c);
    const { f, s } = ruffStmtOf(n);
    const h = s.kind === "Try" ? s.handlers.find((x) => x.ts === n) : undefined;
    if (!h) throw new Error("python: an except type outside a try's handler");
    part(exceptType(f, h));
  },
  "compound.withItems": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, s } = ruffStmtOf(ctx.tree.parent(c));
    if (s.kind !== "With") throw new Error("python: a with clause outside a with");
    part(withItems(f, s));
  },
  // Given the item's value, prints the item in the layout its caller passes (`ctx.args`).
  "compound.withItem": (c: number, ctx: StreamCtx<unknown>) => {
    const n = ctx.tree.parent(c);
    const { f, s } = ruffStmtOf(ctx.tree.parent(n));
    const item = s.kind === "With" ? s.items.find((i) => i.ts === n) : undefined;
    const args = ctx.args as { layout: ItemLayout; single: boolean } | undefined;
    if (!item || !args) throw new Error("python: a with item outside a with's items");
    part(withItem(f, item, args.layout, args.single));
  },
  // `async` and the space after it, where the statement has one.
  "compound.async": (token: number | undefined) => {
    if (token === undefined) return;
    const { f } = ruffStmtOf(token);
    part([f.tok(token), space]);
  },
  // A clause's keyword, after the comments and blank lines that separate it from the clause before.
  "compound.alternate": (token: number | undefined, n: number, ctx: StreamCtx<unknown>) => {
    const { f, alternate } = clauseOf(n, ctx);
    part([leadingAlternateBranchComments(f, alternate.comments, alternate.last), token === undefined ? [] : f.tok(token)]);
  },
  // The block's statements as ruff's suite of the kind its clause passes (`ctx.args`).
  "compound.suite": (n: number, ctx: StreamCtx<unknown>) => {
    const items = ctx.items(n);
    const [first] = items;
    const kind = (ctx.args as { suite?: SuiteKind } | undefined)?.suite;
    if (first === undefined || !kind) throw new Error("python: a block outside a clause's body");
    // A statement's keyword or first child looks up the statement.
    const { f } = ruffStmtOf(ctx.tree.child(first, 0));
    part(formatSuite(f, items.map((c) => ruffStmtOf(ctx.tree.child(c, 0)).s), kind));
  },
  // A block: the comments after its clause's colon, then ruff's suite.
  "compound.body": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, colon, body, after = [] } = clauseOf(ctx.tree.parent(c), ctx);
    part([clauseBody(f, body, "other", colon), f.dangling(after)]);
  },
};
