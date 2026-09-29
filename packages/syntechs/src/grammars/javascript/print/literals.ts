// Prettier's literal printers (print/literal.js, utilities/print-string.js, print-number.js), its template
// literal printer (print/template-literal.js) and its comment printer (print/comment.js).

import {
  anon,
  children,
  first,
  hasComment,
  type HasTree,
  type JsCtx,
  kind,
  src,
  unparen,
} from "./util.js";
import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import {
  capture,
  close,
  flatten,
  GROUP,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  openAlign,
  type Part,
  place,
  SOFT,
  sLine,
  sLineSuffixBoundary,
  sHardline,
  sBreakParent,
  sLiteral,
  sText,
  sToken,
} from "../sink.js";
import type { JsOptions } from "./util.js";

// Prettier's getAlignmentSize and getIndentSize (utilities/get-alignment-size.js, get-indent-size.js).
function alignmentSize(s: string, tabWidth: number): number {
  let size = 0;
  for (const ch of s)
    size = ch === "\t" ? size + tabWidth - (size % tabWidth) : size + 1;
  return size;
}
function indentSize(value: string, tabWidth: number): number {
  const nl = value.lastIndexOf("\n");
  if (nl === -1) return 0;
  return alignmentSize(
    /^[\t ]*/.exec(value.slice(nl + 1))?.[0] ?? "",
    tabWidth,
  );
}

/** Prettier's addAlignmentToDoc: what `body` writes, at `size` columns past the root indentation. */
function addAlignment(size: number, tabWidth: number, body: () => void): void {
  if (size <= 0) {
    body();
    return;
  }
  const indents = Math.floor(size / tabWidth);
  openAlign(Number.NEGATIVE_INFINITY);
  openAlign(size % tabWidth);
  for (let i = 0; i < indents; i++) open(INDENT);
  body();
  for (let i = 0; i < indents; i++) close();
  close();
  close();
}

const INDENTED_WHEN_BROKEN = new Set([
  "identifier",
  "member_expression",
  "subscript_expression",
  "ternary_expression",
  "sequence_expression",
  "binary_expression",
  "as_expression",
  "satisfies_expression",
]);

/**
 * The raw text of each quasi of a template string, between its backticks and substitutions. The children
 * (backticks, string_fragment, escape_sequence, template_substitution) tile the template's span with no gap,
 * so a child's offset in the template's text is the length of the children before it.
 */
function quasis(ctx: JsCtx, node: number): string[] {
  const whole = src(ctx, node);
  const out: string[] = [];
  let from = 1;
  let at = 0;
  for (const c of children(ctx, node)) {
    const length = src(ctx, c).length;
    if (kind(ctx, c) === "template_substitution") {
      out.push(whole.slice(from, at));
      from = at + length;
    }
    at += length;
  }
  out.push(whole.slice(from, whole.length - 1));
  return out;
}

function printSubstitution(
  ctx: JsStreamCtx,
  sub: number,
  indentSizeOf: number,
  previousQuasi: string,
): void {
  const js = ctx.js;
  const openToken = anon(js, sub, "${");
  const closeToken = anon(js, sub, "}");
  const expr = first(js, sub);
  let printed: Part = capture(() => {
    if (expr !== undefined) ctx.print(expr);
  });
  let hasNewline = src(js, sub).includes("\n");
  if (!hasNewline) {
    const flat = flatten(printed);
    if (flat === undefined) hasNewline = true;
    else printed = flat;
  }
  const indented =
    hasNewline &&
    expr !== undefined &&
    (hasComment(js, expr) ||
      INDENTED_WHEN_BROKEN.has(kind(js, unparen(js, expr))));
  const body = () => {
    if (!indented) {
      place(printed);
      return;
    }
    open(INDENT);
    sLine(SOFT);
    place(printed);
    close();
    sLine(SOFT);
  };
  open(GROUP);
  if (openToken !== undefined) sToken(openToken, "${");
  if (indentSizeOf === 0 && previousQuasi.endsWith("\n")) {
    openAlign(Number.NEGATIVE_INFINITY);
    body();
    close();
  } else addAlignment(indentSizeOf, js.options.tabWidth, body);
  sLineSuffixBoundary();
  if (closeToken !== undefined) sToken(closeToken, "}");
  close();
}

const templateString: CustomRule<JsOptions> = (node, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const raws = quasis(js, node);
  let previous = 0;
  const sizes = raws.map((q) => {
    const size = q.includes("\n") ? indentSize(q, js.options.tabWidth) : previous;
    previous = size;
    return size;
  });
  sLineSuffixBoundary();
  let i = 0;
  for (const c of children(js, node)) {
    const k = kind(js, c);
    if (k === "template_substitution") {
      printSubstitution(ctx, c, sizes[i] ?? 0, raws[i] ?? "");
      i++;
    } else if (k !== "comment") {
      // A quasi prints as its source, a line break in it kept where it is. Prettier's literalline carries a
      // break parent, so a multi-line template breaks the groups around it.
      const t = src(js, c);
      if (t.includes("\n")) {
        sLiteral(c, t);
        sBreakParent();
      } else sToken(c, t);
    }
  }
};

/** Prettier's printComment: a block comment whose lines all start with `*` is re-indented. */
export function printComment(
  c: number,
  ctx: HasTree & { isLineComment(c: number): boolean },
): void {
  const raw = src(ctx, c);
  if (ctx.isLineComment(c)) {
    sToken(c, raw.trimEnd());
    return;
  }
  if (raw.startsWith("/*") && raw.includes("\n")) {
    const value = raw.slice(2, -2);
    const lines = `*${value}*`.split("\n").map((l) => l.trimStart());
    if (lines.every((l) => l.startsWith("*"))) {
      lines.forEach((l, index) => {
        if (index === 0) {
          sToken(c, `/${l.trimEnd()}`);
          sHardline();
        } else if (index === lines.length - 1) sText(` ${l}/`);
        else {
          sText(` ${l.trimEnd()}`);
          sHardline();
        }
      });
      return;
    }
  }
  if (!raw.includes("\n")) {
    sToken(c, raw);
    return;
  }
  // replaceEndOfLine's literalline carries a break parent: the groups around a multi-line comment break.
  sLiteral(c, raw);
  sBreakParent();
}

/** The customs format/literals.ts names, by the names its spec gives them. */
export const literalCustoms = {
  templateString,
} satisfies Record<string, CustomRule<JsOptions>>;
