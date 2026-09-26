import { type Doc, synthetic } from "../../../../fmt/doc.js";
import type { FormatNode } from "../../../../fmt/tree.js";
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
import type { StmtRules } from "./suite.js";
import {
  clauseBody,
  clauseHeader,
  leadingAlternateBranchComments,
} from "./suite.js";

/** Ruff's compound statements other than definitions (statement/stmt_{if,for,while,try,with}.rs). */

/** Ruff's `clause`: a header, its colon and the comments after it, then the indented body. */
function clause(
  f: Fmt,
  header: Doc,
  colon: FormatNode,
  colonComments: readonly Comment[],
  body: readonly Stmt[],
  alternate?: { comments: readonly Comment[]; last: Py | undefined },
): Doc {
  return [
    clauseHeader(f, header, f.tok(colon), colonComments, alternate),
    clauseBody(f, body, "other", colonComments),
  ];
}

/** The length of the prefix of `cs` that `p` holds for (Rust's `partition_point`). */
function prefix(cs: readonly Comment[], p: (c: Comment) => boolean): number {
  const i = cs.findIndex((c) => !p(c));
  return i < 0 ? cs.length : i;
}

/**
 * The `else` of a `for` or `while`: `rest` are the statement's dangling comments after its body starts, the
 * own-line ones before `else` and the end-of-line ones after its colon.
 */
function orElse(f: Fmt, s: For | While, rest: readonly Comment[]): Doc {
  const o = s.orelse;
  if (!o) return [];
  const split = prefix(rest, (c) => c.line === "own");
  return clause(f, f.tok(o.kw), o.colon, rest.slice(split), o.body, {
    comments: rest.slice(0, split),
    last: s.body.at(-1),
  });
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

/** Ruff's `FormatExceptHandlerExceptHandler`; its leading comments are the `try`'s to print. */
function exceptHandler(f: Fmt, h: ExceptHandler): Doc {
  const [except, star] = h.kws.map((k) => f.tok(k));
  const header: Doc[] = [except ?? [], star ?? []];
  if (h.type) {
    header.push(space, maybeParenthesize(f, h.type, h, "ifBreaks"));
    if (h.asTok && h.name)
      header.push(space, f.tok(h.asTok), space, f.tok(h.name));
  }
  return clause(f, header, h.colon, f.comments.dangling(h), h.body);
}

/** Ruff's `FormatStmtTry`: the `try`'s dangling comments go to the case whose body they end before. */
function tryStmt(f: Fmt, s: Try): Doc {
  const cs = f.comments;
  let dangling = cs.dangling(s);
  let previous: Stmt | undefined;
  const out: Doc[] = [];
  const kase = (c: { kw: FormatNode; colon: FormatNode; body: Stmt[] }) => {
    const last = c.body.at(-1);
    if (!last) return;
    const n = prefix(dangling, (x) => x.end <= last.end);
    const comments = dangling.slice(0, n);
    dangling = dangling.slice(n);
    const own = prefix(comments, (x) => x.line === "own");
    out.push(
      clause(f, f.tok(c.kw), c.colon, comments.slice(own), c.body, {
        comments: comments.slice(0, own),
        last: previous,
      }),
    );
    previous = last;
  };
  kase(s);
  for (const h of s.handlers) {
    out.push(
      leadingAlternateBranchComments(f, cs.leading(h), previous),
      exceptHandler(f, h),
    );
    previous = h.body.at(-1);
  }
  if (s.orelse) kase(s.orelse);
  if (s.finalbody) kase(s.finalbody);
  out.push(f.dangling(dangling));
  return out;
}

/** Ruff's `WithItemLayout`, and whether the item is the statement's only one. */
type ItemLayout = "contextManagers" | "single" | "py38";

/** Ruff's `FormatWithItem`: the context manager, then `as` and the target. */
function withItem(
  f: Fmt,
  item: WithItem,
  layout: ItemLayout,
  single: boolean,
): Doc {
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
  const out: Doc[] = [f.leading(cs.leading(item)), head];
  const vars = item.vars;
  if (vars && item.asTok) {
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

/** The first token of `n`'s source. */
function firstLeaf(n: FormatNode): FormatNode {
  let x = n;
  while (x.children[0]) x = x.children[0];
  return x;
}

/** Ruff's `FormatStmtWith` with its `WithItemsLayout`. */
function withStmt(f: Fmt, w: With): Doc {
  const cs = f.comments;
  const dangling = cs.dangling(w);
  const first = w.items[0];
  const split = prefix(dangling, (c) => !!first && c.start < first.start);
  const parenComments = dangling.slice(0, split);
  const withKw = w.kws.at(-1) ?? w.colon;
  const clauseNode =
    w.ts.children.find((c) => c.kind === "with_clause") ?? w.ts;
  const single = w.items.length === 1 ? first : undefined;
  const joined = () =>
    f.joinCommaSeparated(
      w.items.map((i) => ({
        end: i.end,
        doc: withItem(f, i, "contextManagers", !!single),
      })),
      w.colon.start,
      commaIn(clauseNode, withKw),
    );
  const last = w.items.at(-1);
  const tv = (f.options as { "target-version"?: string })["target-version"];
  const canParenthesize =
    !(tv && /^py3[0-8]$/.test(tv)) ||
    (w.items.length > 1 && firstLeaf(clauseNode).kind === "(");
  let items: Doc;
  if (
    parenComments.length > 0 ||
    (single && (cs.hasLeading(single) || cs.hasTrailing(single)))
  )
    items = f.parenthesized(
      w.open ? f.tok(w.open) : synthetic(withKw, "("),
      joined,
      w.close ? f.tok(w.close) : synthetic(withKw, ")"),
      parenComments,
    );
  else if (last && f.magicTrailingComma(last.end, w.colon.start))
    items = f.parenthesizeIfExpands(withKw, joined);
  else if (single && single.context.parens.length > 0)
    items = withItem(f, single, "single", true);
  else if (!canParenthesize) {
    const comma = commaIn(clauseNode, withKw);
    items = w.items.map((i, n) => [
      n > 0 ? [comma(w.items[n - 1]?.end ?? i.start), space] : [],
      withItem(f, i, "py38", !!single),
    ]);
  } else if (single && !single.vars)
    items = withItem(f, single, "single", true);
  else if (single && canOmitOptionalParentheses(f, single.context))
    items = f.optionalParentheses(single.ts, () =>
      withItem(f, single, "contextManagers", true),
    );
  else items = f.parenthesizeIfExpands(withKw, joined);
  return clause(
    f,
    [w.kws.map((k) => [f.tok(k), space]), items],
    w.colon,
    dangling.slice(split),
    w.body,
  );
}

export const clauseRules: StmtRules = {
  With: withStmt,
  Try: tryStmt,
  If(f, s) {
    const cs = f.comments;
    const out: Doc[] = [
      clause(
        f,
        [f.tok(s.kw), space, maybeParenthesize(f, s.test, s, "ifBreaks")],
        s.colon,
        cs.dangling(s),
        s.body,
      ),
    ];
    let last: Py | undefined = s.body.at(-1);
    for (const c of s.clauses) {
      const header = c.test
        ? [f.tok(c.kw), space, maybeParenthesize(f, c.test, c, "ifBreaks")]
        : f.tok(c.kw);
      out.push(
        clause(f, header, c.colon, cs.dangling(c), c.body, {
          comments: cs.leading(c),
          last,
        }),
      );
      last = c.body.at(-1);
    }
    return out;
  },
  While(f, s) {
    const [colon, rest] = splitAtBody(f, s, s.test.end);
    return [
      clause(
        f,
        [f.tok(s.kw), space, maybeParenthesize(f, s.test, s, "ifBreaks")],
        s.colon,
        colon,
        s.body,
      ),
      orElse(f, s, rest),
    ];
  },
  For(f, s) {
    const [colon, rest] = splitAtBody(f, s, s.iter.end);
    const kws = s.kws.map((k) => f.tok(k));
    const inKw = kws.pop();
    const target =
      s.target.kind === "Tuple"
        ? formatExpr(f, s.target, "preserve", { tuple: "neverPreserve" })
        : maybeParenthesize(f, s.target, s, "ifBreaks");
    return [
      clause(
        f,
        [
          kws.map((k) => [k, space]),
          target,
          space,
          inKw ?? [],
          space,
          maybeParenthesize(f, s.iter, s, "ifBreaks"),
        ],
        s.colon,
        colon,
        s.body,
      ),
      orElse(f, s, rest),
    ];
  },
};
