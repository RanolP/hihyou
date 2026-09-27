import { type Format, group, ifBreak, synthetic } from "../elements.js";
import type { Alias, Simple } from "../ast.js";
import {
  type Fmt,
  soft,
  softBlockIndent,
  space,
} from "../builders.js";
import { dslPart } from "../sink.js";

/** Ruff's one-line statements (statement/stmt_{expr,pass,return,raise,assert,delete,global,import,...}.rs). */

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
  return [f.leading(cs.leading(a)), dslPart(a.ts), f.trailing(cs.dangling(a)), f.trailing(cs.trailing(a))];
}
