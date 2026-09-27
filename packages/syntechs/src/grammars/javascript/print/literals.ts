// Prettier's literal printers (print/literal.js, utilities/print-string.js, print-number.js), its template
// literal printer (print/template-literal.js) and its comment printer (print/comment.js).

import { isDirective } from "./parens.js";
import {
  anon,
  children,
  field,
  first,
  hasComment,
  type HasTree,
  type JsCtx,
  kind,
  parent,
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
  sLiteral,
  sText,
  sToken,
} from "../sink.js";
import type { JsOptions } from "./util.js";

const DOUBLE = '"';
const SINGLE = "'";

/** Prettier's getPreferredQuote: the preferred quote unless the text holds more of it than of the other. */
export function preferredQuote(content: string, preferSingle: boolean): string {
  const [preferred, alternate] = preferSingle
    ? [SINGLE, DOUBLE]
    : [DOUBLE, SINGLE];
  let p = 0;
  let a = 0;
  for (const ch of content) {
    if (ch === preferred) p++;
    else if (ch === alternate) a++;
  }
  return p > a ? alternate : preferred;
}

/** Prettier's makeString: `content` between `quote`, unescaping the other quote and escaping this one. */
export function makeString(content: string, quote: string): string {
  const other = quote === DOUBLE ? SINGLE : DOUBLE;
  const body = content.replaceAll(
    /\\(["'\\])|(["'])/g,
    (match, escaped: string | undefined, unescaped: string | undefined) => {
      if (escaped) return escaped === other ? other : match;
      return unescaped === quote ? `\\${unescaped}` : (unescaped ?? "");
    },
  );
  return quote + body + quote;
}

/** Prettier's printString over a string literal's raw text, quotes included. */
export function printString(raw: string, singleQuote: boolean): string {
  const content = raw.slice(1, -1);
  const quote = preferredQuote(content, singleQuote);
  return raw.charAt(0) === quote ? raw : makeString(content, quote);
}

/** Prettier's printNumber, and printBigInt for a literal ending in `n`. */
export function printNumber(raw: string): string {
  if (/n$/i.test(raw)) return raw.toLowerCase();
  if (raw.length === 1) return raw;
  return raw
    .toLowerCase()
    .replace(/^([+-]?[\d.]+e)(?:\+|(-))?0*(?=\d)/, "$1$2")
    .replace(/^([+-]?[\d.]+)e[+-]?0+$/, "$1")
    .replace(/^([+-])?\./, "$10.")
    .replace(/(\.\d+?)0+(?=e|$)/, "$1")
    .replace(/\.(?=e|$)/, "");
}

function printDirective(raw: string, singleQuote: boolean): string {
  const content = raw.slice(1, -1);
  if (
    content === "use strict" ||
    !(content.includes('"') || content.includes("'"))
  ) {
    const q = singleQuote ? SINGLE : DOUBLE;
    return q + content + q;
  }
  return raw;
}

const string: CustomRule<JsOptions> = (node, ctx) => {
  const js = jsCtx(ctx).js;
  const raw = src(js, node);
  const statement = parent(js, node);
  if (
    statement !== undefined &&
    kind(js, statement) === "expression_statement" &&
    isDirective(js, statement)
  ) {
    sToken(node, printDirective(raw, js.options.singleQuote));
    return;
  }
  // A line continuation keeps its break, which the printer must not indent.
  const printed = printString(raw, js.options.singleQuote);
  if (printed.includes("\n")) sLiteral(node, printed);
  else sToken(node, printed);
};

const number: CustomRule<JsOptions> = (node, ctx) =>
  sToken(node, printNumber(src(jsCtx(ctx).js, node)));

const regex: CustomRule<JsOptions> = (node, ctx) => {
  const js = jsCtx(ctx).js;
  const flags = field(js, node, "flags");
  for (const c of children(js, node))
    sToken(c, c === flags ? [...src(js, c)].sort().join("") : src(js, c));
};

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
      // A quasi prints as its source, a line break in it kept where it is.
      const t = src(js, c);
      if (t.includes("\n")) sLiteral(c, t);
      else sToken(c, t);
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
  if (raw.includes("\n")) sLiteral(c, raw);
  else sToken(c, raw);
}

/** The customs format/literals.ts names, by the names its spec gives them. */
export const literalCustoms = {
  number,
  regex,
  string,
  templateString,
} satisfies Record<string, CustomRule<JsOptions>>;
