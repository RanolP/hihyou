import { type Format, group, ifBreak, synthetic } from "../elements.js";
import type { Alias, Simple } from "../ast.js";
import {
  type Fmt,
  soft,
  softBlockIndent,
  space,
} from "../builders.js";
import { dslPart } from "../sink.js";
import type { StmtRules } from "./suite.js";

/** Ruff's one-line statements (statement/stmt_{expr,pass,return,raise,assert,delete,global,import,...}.rs). */

// A statement its rule in format.ts prints.
const fromSpec = (_: Fmt, s: { readonly ts: number }) => dslPart(s.ts);

function names(f: Fmt, s: Simple, sep: Format): Format {
  return s.names.map((n, i) => {
    const comma = s.commas[i - 1];
    return i === 0 || comma === undefined
      ? f.tok(n)
      : [f.tok(comma), sep, f.tok(n)];
  });
}

/** Ruff's `FormatStmtGlobal` / `FormatStmtNonlocal` after the keyword: breaks with a backslash, since the names take no brackets. */
export function globalNames(f: Fmt, s: Simple): Format {
  if (f.comments.hasTrailing(s)) return names(f, s, space);
  const backslash = ifBreak(synthetic(s.kw, "\\"));
  return group([backslash, soft, softBlockIndent(names(f, s, [space, backslash, soft]))]);
}

export function alias(f: Fmt, a: Alias): Format {
  const cs = f.comments;
  const out: Format[] = [f.leading(cs.leading(a)), a.name.map((t) => f.tok(t))];
  if (a.asTok !== undefined && a.asname !== undefined)
    out.push(space, f.tok(a.asTok), space, f.tok(a.asname));
  out.push(f.trailing(cs.dangling(a)), f.trailing(cs.trailing(a)));
  return out;
}

export const simpleRules: StmtRules = {
  Expr: fromSpec,
  Pass: fromSpec,
  Break: fromSpec,
  Continue: fromSpec,
  Return: fromSpec,
  Raise: fromSpec,
  Assert: fromSpec,
  Delete: fromSpec,
  Global: fromSpec,
  Nonlocal: fromSpec,
  Import: fromSpec,
  ImportFrom: fromSpec,
};
