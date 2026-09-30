import type { Alias, Simple } from "../ast.js";
import type { Fmt } from "../builders.js";
import type { Comment } from "../comments.js";
import { startOf } from "../trivia.js";
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

/**
 * An import's alias with its comments, as ruff prints them: comments inside the alias, or between it and its comma,
 * are dangling; where an own-line one sits among them they end their line, so `as`, the asname or the comma after
 * them starts the next line, as written.
 */
export function alias(f: Fmt, a: Alias): void {
  const cs = f.comments;
  f.writeLeading(cs.leading(a));
  const dangling = cs.dangling(a);
  if (dangling.length === 0) sDsl(a.ts);
  else {
    const at = (n: number) => startOf(f.tree, n);
    const within = (lo: number, hi: number) => dangling.filter((c) => lo <= c.start && c.start < hi);
    // Only an own-line comment keeps the layout as written; end-of-line ones merge onto the line, as black does.
    const ownLine = (cs: readonly Comment[]) => cs.some((c) => c.line === "own");
    const sep = (cs: readonly Comment[]) => {
      if (ownLine(cs)) f.writeDangling(cs);
      else {
        sText(" ");
        f.writeTrailing(cs);
      }
    };
    for (const n of a.name) f.writeTok(n);
    if (a.asTok !== undefined && a.asname !== undefined) {
      sep(within(0, at(a.asTok)));
      f.writeTok(a.asTok);
      sep(within(at(a.asTok), at(a.asname)));
      f.writeTok(a.asname);
    }
    const last = a.asname ?? a.name.at(-1);
    const after = dangling.filter((c) => last === undefined || c.start >= at(last));
    if (ownLine(after)) f.writeDangling(after);
    else f.writeTrailing(after);
  }
  f.writeTrailing(cs.trailing(a));
}
