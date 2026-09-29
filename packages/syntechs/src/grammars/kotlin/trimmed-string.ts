// A multiline string that `.trimIndent()` or `.trimMargin()` trims, re-indented as ktfmt 0.64's
// MultilineStringFormatter does after it prints: the content lines at the indentation of the line the string
// starts on (after a `|` for trimMargin), the closing `"""` on a line of its own.
import { HARD, sBreakParent, sLine, sText, sToken } from "../../fmt/stream.js";
import type { StreamRule } from "../../fmt/stream-format.js";
import type { FormatTree } from "../../fmt/tree.js";

// ktfmt's simpleTemplateExpressionRegex, which it runs on each line: a `$` that starts a template.
const template = /\$((\{?[A-Za-z_\s])|\{$)/;

/**
 * The content lines ktfmt prints string literal `node` with, and whether it trims a margin; undefined when ktfmt
 * leaves the string as written: it is not a multiline raw string, no `.trimIndent()` or `.trimMargin()` follows
 * it, it holds a template or sits in another string. A string whose printed lines would end in whitespace is left
 * as written too, since the printer trims every line end.
 */
export function trimmedString(
  t: FormatTree,
  node: number,
): { readonly margin: boolean; readonly lines: readonly string[] } | undefined {
  const text = t.text(node);
  if (!text.startsWith('"""') || !text.endsWith('"""') || !text.includes("\n")) return;
  const nav = t.parent(node);
  if (t.kindName(nav) !== "navigation_expression" || t.child(nav, 0) !== node) return;
  const suffix = t.child(nav, t.count(nav) - 1);
  if (t.kindName(suffix) !== "navigation_suffix" || t.text(t.child(suffix, 0)) !== ".") return;
  const name = t.text(t.child(suffix, t.count(suffix) - 1));
  if (name !== "trimIndent" && name !== "trimMargin") return;
  const call = t.parent(nav);
  if (t.kindName(call) !== "call_expression" || t.child(call, 0) !== nav) return;
  const args = t.child(call, 1);
  if (t.count(args) !== 1 || t.text(args).replace(/\s/g, "") !== "()") return;
  for (let p = t.parent(node); p !== t.root; p = t.parent(p)) if (t.kindName(p) === "string_literal") return;

  const raw = text.slice(3, -3).split("\n");
  if (raw.some((l) => template.test(l))) return;
  const margin = name === "trimMargin";
  const first = raw[0] as string;
  const last = raw[raw.length - 1] as string;
  const middle = raw.slice(1, -1);
  const blank = (s: string) => s.trim() === "";
  const indentOf = (s: string) => s.length - s.trimStart().length;
  let min = Number.MAX_SAFE_INTEGER;
  for (const s of [...middle, first, last]) if (!blank(s)) min = Math.min(min, indentOf(s));
  const trim = (s: string) => {
    if (!margin) return s.slice(min);
    return s.trimStart().startsWith("|") ? s.slice(s.indexOf("|") + 1) : s;
  };
  const lines = [
    ...(blank(first) ? [] : [trim(first)]),
    ...middle.map(trim),
    ...(blank(last) ? [] : [trim(last)]),
  ];
  // A line prints after the indentation (and a margin's `|`) unless it is empty and trimIndent drops both.
  if (lines.some((l) => /[ \t]$/.test(l) && (margin || l.length > 0))) return;
  return { margin, lines };
}

/** The string literal rule, but a trimmed multiline string prints as `trimmedString` lays it out. */
export function trimmedStrings<O>(rule: StreamRule<O> | undefined): StreamRule<O> {
  return (node, ctx) => {
    const s = trimmedString(ctx.tree, node);
    if (s === undefined) {
      rule?.(node, ctx);
      return;
    }
    sBreakParent();
    sToken(node, '"""');
    for (const line of s.lines) {
      sLine(HARD);
      if (s.margin || line.length > 0) sText((s.margin ? "|" : "") + line);
    }
    // trimMargin closes on its last line when that line is empty: `|"""`.
    if (!(s.margin && s.lines.at(-1) === "")) sLine(HARD);
    sText('"""');
  };
}
