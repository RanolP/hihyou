// Prettier's literal printers (print/literal.js, utilities/print-string.js, print-number.js), its template
// literal printer (print/template-literal.js) and its comment printer (print/comment.js).

import {
  align,
  contentsOf,
  type Doc,
  flatOf,
  group,
  hardline,
  indent,
  isBroken,
  isDocs,
  isHardLine,
  isSoftLine,
  kindOf,
  lineSuffixBoundary,
  literalToken,
  partsOf,
  softline,
  text,
  textOf,
  token,
  withContents,
} from "../../../fmt/doc.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { isDirective } from "./parens.js";
import {
  anon,
  field,
  first,
  hasComment,
  type JsCtx,
  type JsRule,
  src,
  unparen,
} from "./util.js";

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

const string: JsRule = (node, ctx) => {
  const raw = src(ctx, node);
  const statement = node.parent;
  if (statement?.kind === "expression_statement" && isDirective(statement))
    return token(node, printDirective(raw, ctx.options.singleQuote));
  // A line continuation keeps its break, which the printer must not indent.
  const printed = printString(raw, ctx.options.singleQuote);
  return printed.includes("\n")
    ? literalToken(node, printed)
    : token(node, printed);
};

const number: JsRule = (node, ctx) => token(node, printNumber(src(ctx, node)));

const regex: JsRule = (node, ctx) => {
  const flags = field(node, "flags");
  const parts: Doc[] = node.children.map((c) =>
    c === flags
      ? token(c, [...src(ctx, c)].sort().join(""))
      : token(c, src(ctx, c)),
  );
  return parts;
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

/** Prettier's addAlignmentToDoc. */
export function addAlignmentToDoc(
  doc: Doc,
  size: number,
  tabWidth: number,
): Doc {
  if (size <= 0) return doc;
  let aligned = doc;
  for (let i = 0; i < Math.floor(size / tabWidth); i++)
    aligned = indent(aligned);
  aligned = align(size % tabWidth, aligned);
  return align(Number.NEGATIVE_INFINITY, aligned);
}

/**
 * `doc` as prettier's printDocToString lays it out at an infinite width, when that is one line: every group
 * flat. `undefined` when it would hold a line break (a hard line, or a token spanning lines).
 */
export function flatten(doc: Doc): Doc | undefined {
  let broken = false;
  const walk = (d: Doc): Doc => {
    if (broken) return [];
    if (isDocs(d)) return d.map(walk);
    switch (kindOf(d)) {
      case "token":
        if (textOf(d).includes("\n")) broken = true;
        return d;
      case "text":
        if (textOf(d).includes("\n")) broken = true;
        return d;
      case "line":
        if (isHardLine(d)) broken = true;
        return isSoftLine(d) ? [] : text(" ");
      case "breakParent":
        broken = true;
        return [];
      case "group":
        if (isBroken(d)) broken = true;
        return walk(contentsOf(d));
      case "indent":
      case "align":
        return walk(contentsOf(d));
      case "fill":
        return partsOf(d).map(walk);
      case "ifBreak":
        return walk(flatOf(d));
      case "lineSuffix":
        return withContents(d, walk(contentsOf(d)));
      // Ruff's layouts, which a JavaScript doc never holds.
      default:
        return d;
    }
  };
  const out = walk(doc);
  return broken ? undefined : out;
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

/** The raw text of each quasi of a template string, between its backticks and substitutions. */
function quasis(ctx: JsCtx, node: FormatNode): string[] {
  const out: string[] = [];
  let from = node.start + 1;
  for (const c of node.children)
    if (c.kind === "template_substitution") {
      out.push(ctx.source.slice(from, c.start));
      from = c.end;
    }
  out.push(ctx.source.slice(from, node.end - 1));
  return out;
}

function printSubstitution(
  ctx: JsCtx,
  sub: FormatNode,
  indentSizeOf: number,
  previousQuasi: string,
  preserveIndentation = true,
): Doc {
  const open = anon(sub, "${");
  const close = anon(sub, "}");
  const expr = first(sub);
  let doc: Doc = expr ? ctx.print(expr) : [];
  let hasNewline = src(ctx, sub).includes("\n");
  if (!hasNewline) {
    const flat = flatten(doc);
    if (flat === undefined) hasNewline = true;
    else doc = flat;
  }
  const e = expr && unparen(expr);
  if (
    hasNewline &&
    expr &&
    e &&
    (hasComment(ctx, expr) || INDENTED_WHEN_BROKEN.has(e.kind))
  )
    doc = [indent([softline, doc]), softline];
  const wrap = (d: Doc) =>
    group([
      open ? token(open, "${") : [],
      d,
      lineSuffixBoundary,
      close ? token(close, "}") : [],
    ]);
  if (!preserveIndentation) return wrap(doc);
  doc =
    indentSizeOf === 0 && previousQuasi.endsWith("\n")
      ? align(Number.NEGATIVE_INFINITY, doc)
      : addAlignmentToDoc(doc, indentSizeOf, ctx.options.tabWidth);
  return wrap(doc);
}

/** The quasi leaves of a template printed as their source, a line break in them kept where it is. */
const quasiLeaf = (ctx: JsCtx, c: FormatNode): Doc => {
  const t = src(ctx, c);
  return t.includes("\n") ? literalToken(c, t) : token(c, t);
};

const templateString: JsRule = (node, ctx) => {
  const raws = quasis(ctx, node);
  let previous = 0;
  const sizes = raws.map((q) => {
    const size = q.includes("\n")
      ? indentSize(q, ctx.options.tabWidth)
      : previous;
    previous = size;
    return size;
  });
  let i = 0;
  const parts = node.children.map((c): Doc => {
    if (c.kind === "template_substitution") {
      const doc = printSubstitution(ctx, c, sizes[i] ?? 0, raws[i] ?? "");
      i++;
      return doc;
    }
    if (c.kind === "comment") return [];
    return quasiLeaf(ctx, c);
  });
  return [lineSuffixBoundary, parts];
};

/** Prettier's printComment: a block comment whose lines all start with `*` is re-indented. */
export function printComment(c: FormatNode, ctx: JsCtx): Doc {
  const raw = src(ctx, c);
  if (ctx.isLineComment(c)) return token(c, raw.trimEnd());
  if (raw.startsWith("/*") && raw.includes("\n")) {
    const value = raw.slice(2, -2);
    const lines = `*${value}*`.split("\n").map((l) => l.trimStart());
    if (lines.every((l) => l.startsWith("*"))) {
      const out: Doc[] = [];
      lines.forEach((l, index) => {
        if (index === 0) out.push(token(c, `/${l.trimEnd()}`), hardline);
        else if (index === lines.length - 1) out.push(text(` ${l}/`));
        else {
          const trimmed = l.trimEnd();
          out.push(text(` ${trimmed}`));
          out.push(hardline);
        }
      });
      return out;
    }
  }
  return raw.includes("\n") ? literalToken(c, raw) : token(c, raw);
}

export const literalRules: Record<string, JsRule> = {
  string,
  number,
  regex,
  template_string: templateString,
};
