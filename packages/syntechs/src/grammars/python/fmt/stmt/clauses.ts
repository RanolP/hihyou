import { type Format, synthetic } from "../elements.js";
import { firstLeaf } from "../../../../fmt/tree.js";
import type {
  ExceptHandler,
  For,
  Py,
  Stmt,
  Try,
  While,
  With,
  WithItem,
} from "../ast.js";
import { commaIn, type Fmt, space } from "../builders.js";
import type { Comment } from "../comments.js";
import {
  canOmitOptionalParentheses,
  formatExpr,
  maybeParenthesize,
} from "../expr.js";
import { dslPart } from "../sink.js";
import { startOf } from "../trivia.js";
import type { StmtRules } from "./suite.js";

/** Ruff's compound statements other than definitions (statement/stmt_{if,for,while,try,with}.rs). */

// A statement its rule in format/stmt-compound.ts prints.
const fromSpec = (_: Fmt, s: Stmt) => dslPart(s.ts);

/** The length of the prefix of `cs` that `p` holds for (Rust's `partition_point`). */
function prefix(cs: readonly Comment[], p: (c: Comment) => boolean): number {
  const i = cs.findIndex((c) => !p(c));
  return i < 0 ? cs.length : i;
}

/**
 * The comments around a `for`'s or `while`'s clauses: those on the header's colon, and of the rest (after its
 * body starts) the own-line ones before `else` and the end-of-line ones after its colon.
 */
export function loopComments(
  f: Fmt,
  s: For | While,
): { colon: readonly Comment[]; beforeElse: readonly Comment[]; elseColon: readonly Comment[] } {
  const [colon, rest] = splitAtBody(f, s, s.kind === "For" ? s.iter.end : s.test.end);
  const split = prefix(rest, (c) => c.line === "own");
  return { colon, beforeElse: rest.slice(0, split), elseColon: rest.slice(split) };
}

/** A `for`'s or `while`'s dangling comments: those on the header's colon, and the rest. */
function splitAtBody(
  f: Fmt,
  s: For | While,
  headerEnd: number,
): [readonly Comment[], readonly Comment[]] {
  const dangling = f.comments.dangling(s);
  const bodyStart = s.body[0]?.start ?? headerEnd;
  const split = prefix(dangling, (c) => c.end < bodyStart);
  return [dangling.slice(0, split), dangling.slice(split)];
}

/** Ruff's `FormatExceptHandlerExceptHandler` after `except` and `*`: the type, then `as` and the name. */
export function exceptType(f: Fmt, h: ExceptHandler): Format {
  const header: Format[] = [];
  if (h.type) {
    header.push(maybeParenthesize(f, h.type, h, "ifBreaks"));
    if (h.asTok !== undefined && h.name !== undefined)
      header.push(space, f.tok(h.asTok), space, f.tok(h.name));
  }
  return header;
}

/** One case of a `try` as ruff's `clause` prints it: the comments before its keyword and after its colon. */
export interface TryCase {
  readonly alternate: { readonly comments: readonly Comment[]; readonly last: Py | undefined };
  readonly colon: readonly Comment[];
}

/**
 * Ruff's `FormatStmtTry`: the `try`'s dangling comments go to the case whose body they end before. Gives each
 * case (the `try`, a handler, or its `orelse` or `finalbody`) its comments, and the comments left after the last.
 */
export function tryCases(
  f: Fmt,
  s: Try,
): { cases: Map<object, TryCase>; rest: readonly Comment[] } {
  const cs = f.comments;
  let dangling = cs.dangling(s);
  let previous: Stmt | undefined;
  const cases = new Map<object, TryCase>();
  const kase = (c: { kw: number; colon: number; body: Stmt[] }) => {
    const last = c.body.at(-1);
    if (!last) return;
    const n = prefix(dangling, (x) => x.end <= last.end);
    const comments = dangling.slice(0, n);
    dangling = dangling.slice(n);
    const own = prefix(comments, (x) => x.line === "own");
    cases.set(c, {
      alternate: { comments: comments.slice(0, own), last: previous },
      colon: comments.slice(own),
    });
    previous = last;
  };
  kase(s);
  for (const h of s.handlers) {
    cases.set(h, {
      alternate: { comments: cs.leading(h), last: previous },
      colon: cs.dangling(h),
    });
    previous = h.body.at(-1);
  }
  if (s.orelse) kase(s.orelse);
  if (s.finalbody) kase(s.finalbody);
  return { cases, rest: dangling };
}

/** Ruff's `WithItemLayout`, and whether the item is the statement's only one. */
export type ItemLayout = "contextManagers" | "single" | "py38";

/** Ruff's `FormatWithItem`: the context manager, then `as` and the target. */
export function withItem(
  f: Fmt,
  item: WithItem,
  layout: ItemLayout,
  single: boolean,
): Format {
  const cs = f.comments;
  const ctx = item.context;
  const parenthesized = ctx.parens.length > 0;
  const head =
    layout === "single"
      ? maybeParenthesize(f, ctx, item, "ifBreaks")
      : layout === "py38"
        ? maybeParenthesize(
            f,
            ctx,
            item,
            single || parenthesized ? "ifBreaks" : "ifRequired",
          )
        : (item.vars || !single) && parenthesized
          ? maybeParenthesize(f, ctx, item, "ifBreaksParenthesizedNested")
          : formatExpr(f, ctx, "never");
  const out: Format[] = [f.leading(cs.leading(item)), head];
  const vars = item.vars;
  if (vars && item.asTok !== undefined) {
    const as = cs.dangling(item);
    out.push(
      space,
      f.tok(item.asTok),
      space,
      as.length === 0
        ? formatExpr(f, vars)
        : f.parenthesized(
            synthetic(vars.ts, "("),
            () => formatExpr(f, vars, "never"),
            synthetic(vars.ts, ")"),
            as,
          ),
    );
  }
  out.push(f.trailing(cs.trailing(item)));
  return out;
}

/** The `with_clause` child of a `with` statement, or the statement itself. */
function withClause(f: Fmt, w: With): number {
  for (let i = 0, n = f.tree.count(w.ts); i < n; i++) {
    const c = f.tree.child(w.ts, i);
    if (f.tree.kindName(c) === "with_clause") return c;
  }
  return w.ts;
}

/** Ruff's `FormatStmtWith`'s items, laid out by its `WithItemsLayout`. */
export function withItems(f: Fmt, w: With): Format {
  const cs = f.comments;
  const first = w.items[0];
  const [parenComments] = withComments(f, w);
  const lastKw = w.kws.at(-1);
  const withKw = lastKw !== undefined ? lastKw : w.colon;
  const colonStart = startOf(f.tree, w.colon);
  const clauseNode = withClause(f, w);
  const single = w.items.length === 1 ? first : undefined;
  // An item as its rule in format/stmt-compound.ts prints it, in the layout ruff chose for the statement.
  const item = (i: WithItem, layout: ItemLayout, only: boolean) => dslPart(i.ts, { layout, single: only });
  const joined = () =>
    f.joinCommaSeparated(
      w.items.map((i) => ({
        end: i.end,
        doc: item(i, "contextManagers", !!single),
      })),
      colonStart,
      commaIn(f.tree, clauseNode, withKw),
    );
  const last = w.items.at(-1);
  const tv = (f.options as { "target-version"?: string })["target-version"];
  const canParenthesize =
    !(tv && /^py3[0-8]$/.test(tv)) ||
    (w.items.length > 1 &&
      f.tree.kindName(firstLeaf(f.tree, clauseNode)) === "(");
  let items: Format;
  if (
    parenComments.length > 0 ||
    (single && (cs.hasLeading(single) || cs.hasTrailing(single)))
  )
    items = f.parenthesized(
      w.open !== undefined ? f.tok(w.open) : synthetic(withKw, "("),
      joined,
      w.close !== undefined ? f.tok(w.close) : synthetic(withKw, ")"),
      parenComments,
    );
  else if (last && f.magicTrailingComma(last.end, colonStart))
    items = f.parenthesizeIfExpands(withKw, joined);
  else if (single && single.context.parens.length > 0)
    items = item(single, "single", true);
  else if (!canParenthesize) {
    const comma = commaIn(f.tree, clauseNode, withKw);
    items = w.items.map((i, n) => [
      n > 0 ? [comma(w.items[n - 1]?.end ?? i.start), space] : [],
      item(i, "py38", !!single),
    ]);
  } else if (single && !single.vars)
    items = item(single, "single", true);
  else if (single && canOmitOptionalParentheses(f, single.context))
    items = f.optionalParentheses(single.ts, () =>
      item(single, "contextManagers", true),
    );
  else items = f.parenthesizeIfExpands(withKw, joined);
  return items;
}

/** A `with`'s dangling comments: those inside its parentheses, before the first item, and those on its colon. */
export function withComments(f: Fmt, w: With): [readonly Comment[], readonly Comment[]] {
  const dangling = f.comments.dangling(w);
  const first = w.items[0];
  const split = prefix(dangling, (c) => !!first && c.start < first.start);
  return [dangling.slice(0, split), dangling.slice(split)];
}

export const clauseRules: StmtRules = {
  With: fromSpec,
  Try: fromSpec,
  If: fromSpec,
  While: fromSpec,
  For: fromSpec,
};
