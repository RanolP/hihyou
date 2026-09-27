import type { Alias, Simple } from "../ast.js";
import type { Fmt } from "../builders.js";
import { close, COLLAPSE, GROUP, IF_BROKEN, INDENT, open, SOFT, sDsl, sLine, sText, sToken } from "../sink.js";

/** Ruff's one-line statements (statement/stmt_{expr,pass,return,raise,assert,delete,global,import,...}.rs). */

const soft = () => sLine(SOFT | COLLAPSE);

function names(f: Fmt, s: Simple, sep: () => void): void {
  s.names.forEach((n, i) => {
    const comma = s.commas[i - 1];
    if (i > 0 && comma !== undefined) {
      sToken(comma, f.text(comma));
      sep();
    }
    sToken(n, f.text(n));
  });
}

/** Ruff's `FormatStmtGlobal` / `FormatStmtNonlocal` after the keyword: breaks with a backslash, since the names take no brackets. */
export function globalNames(f: Fmt, s: Simple): void {
  if (f.comments.hasTrailing(s)) {
    names(f, s, () => sText(" "));
    return;
  }
  const backslash = () => {
    open(IF_BROKEN);
    sToken(s.kw, "\\", true);
    close();
  };
  open(GROUP);
  backslash();
  soft();
  // Ruff's `soft_block_indent`.
  open(INDENT);
  soft();
  names(f, s, () => {
    sText(" ");
    backslash();
    soft();
  });
  close();
  soft();
  close();
}

/** An import's alias with its comments. */
export function alias(f: Fmt, a: Alias): void {
  const cs = f.comments;
  f.writeLeading(cs.leading(a));
  sDsl(a.ts);
  f.writeTrailing(cs.dangling(a));
  f.writeTrailing(cs.trailing(a));
}
