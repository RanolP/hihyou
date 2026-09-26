import { breakParent, type Doc, ifBreak, literalToken, token } from "../../../fmt/doc.js";
import type { FormatNode } from "../../../fmt/tree.js";
import type { Str } from "./ast.js";
import type { Comment } from "./comments.js";
import type { Fmt } from "./builders.js";
import { hasLineBreak } from "./trivia.js";

/**
 * Ruff's string formatting (string/{mod,normalize,implicit,docstring}.rs): the prefix and quotes each part
 * takes, escapes normalized, an implicit concatenation joined into one string when it fits and no part says
 * otherwise, and docstrings re-indented. A part prints leaf by leaf (its start, contents, interpolations and
 * end) so an f-string's expressions are formatted too; a string with no interpolation prints as one token.
 */

export type Quote = '"' | "'";
export type QuoteStyle = "double" | "single" | "preserve";

/** A part's prefix as printed (`r` keeps its case and comes first, `u` is dropped), quote, and triple-ness. */
export interface Flags {
  readonly prefix: string;
  readonly quote: Quote;
  readonly triple: boolean;
}

/** One tree-sitter `string` node. */
export interface Part {
  readonly node: FormatNode;
  readonly start: FormatNode;
  readonly end: FormatNode;
  readonly flags: Flags;
  /** `string_content` and `interpolation` children, in order. */
  readonly elements: readonly FormatNode[];
  readonly contentStart: number;
  readonly contentEnd: number;
}

/** Where the string being printed stands relative to an f-string (ruff's `InterpolatedStringState`). */
export type FState =
  | { readonly k: "outside" }
  | { readonly k: "inside" | "nested"; readonly flags: Flags; readonly multiline: boolean };

export const isRaw = (fl: Flags) => fl.prefix.startsWith("r") || fl.prefix.startsWith("R");
export const isBytes = (fl: Flags) => fl.prefix.includes("b");
export const isInterpolated = (fl: Flags) => fl.prefix.includes("f") || fl.prefix.includes("t");
const opposite = (q: Quote): Quote => (q === '"' ? "'" : '"');
const quotesOf = (fl: Flags) => fl.quote.repeat(fl.triple ? 3 : 1);

export function normalizePrefix(letters: string): string {
  const r = /[rR]/.exec(letters)?.[0] ?? "";
  return r + letters.replace(/[rRuU]/g, "").toLowerCase();
}

export function partOf(src: string, node: FormatNode): Part {
  const start = node.children[0];
  const end = node.children.at(-1);
  if (!start || !end || start.kind !== "string_start" || end.kind !== "string_end")
    throw new Error(`malformed string at ${node.start}`);
  const m = /^([a-zA-Z]*)("""|'''|"|')$/.exec(src.slice(start.start, start.end));
  if (!m) throw new Error(`malformed string start at ${start.start}`);
  const quotes = m[2] as string;
  return {
    node,
    start,
    end,
    flags: {
      prefix: normalizePrefix(m[1] as string),
      quote: quotes[0] as Quote,
      triple: quotes.length === 3,
    },
    elements: node.children.filter((c) => c.kind === "string_content" || c.kind === "interpolation"),
    contentStart: start.end,
    contentEnd: end.start,
  };
}

const isDebug = (interp: FormatNode) => interp.children.some((c) => !c.named && c.kind === "=");
const formatSpec = (interp: FormatNode) => interp.children.find((c) => c.kind === "format_specifier");

/** Ruff's `contains_opposite_quote`. */
function containsOppositeQuote(content: string, fl: Flags): boolean {
  if (fl.triple) return content.includes(opposite(fl.quote).repeat(3));
  const opp = opposite(fl.quote);
  for (let i = content.indexOf(opp); i >= 0; i = content.indexOf(opp, i + 1)) {
    if (isRaw(fl)) return true;
    let slashes = 0;
    while (content[i - 1 - slashes] === "\\") slashes++;
    if (slashes % 2 === 0) return true;
  }
  return false;
}

function descendants(n: FormatNode, kind: string, out: FormatNode[] = []): FormatNode[] {
  for (const c of n.children) {
    if (c.kind === kind) out.push(c);
    descendants(c, kind, out);
  }
  return out;
}

/** Ruff's `preferred_quote_style`, for a target before Python 3.12 (no PEP 701). */
export function preferredQuoteStyle(f: Fmt, part: Part, preferred: QuoteStyle): QuoteStyle {
  const state = f.fstr;
  if (state.k === "nested") return "preserve";
  if (state.k === "inside" && (!state.flags.triple || part.flags.triple))
    return opposite(state.flags.quote) === '"' ? "double" : "single";
  if (preferred === "preserve") return "preserve";
  if (isInterpolated(part.flags)) {
    const interps = part.elements.filter((e) => e.kind === "interpolation");
    for (const i of interps) {
      if (isDebug(i) && containsOppositeQuote(f.text(i), part.flags)) return "preserve";
      const spec = formatSpec(i);
      if (spec && isDebug(i) && containsOppositeQuote(f.text(spec), part.flags)) return "preserve";
    }
    for (const i of interps)
      for (const s of descendants(i, "string")) {
        const p = partOf(f.src, s);
        if (!p.flags.triple) continue;
        const literal = isInterpolated(p.flags)
          ? p.elements.filter((e) => e.kind === "string_content").map((e) => f.text(e)).join("")
          : f.src.slice(p.contentStart, p.contentEnd);
        if (literal.includes(p.flags.quote)) return "preserve";
      }
  }
  if (part.flags.triple) return "double";
  return preferred;
}

type Metadata =
  | { readonly k: "raw" | "triple"; readonly containsPreferred: boolean; readonly source: Quote }
  | { readonly k: "regular"; readonly single: number; readonly double: number; readonly source: Quote };

function metadataOf(text: string, fl: Flags, preferred: Quote): Metadata {
  if (isRaw(fl)) return { k: "raw", containsPreferred: rawContainsPreferred(text, preferred, fl.triple), source: fl.quote };
  if (fl.triple) return { k: "triple", containsPreferred: tripleContainsPreferred(text, preferred), source: fl.quote };
  let single = 0;
  let double = 0;
  for (const c of text) {
    if (c === "'") single++;
    else if (c === '"') double++;
  }
  return { k: "regular", single, double, source: fl.quote };
}

function tripleContainsPreferred(text: string, q: Quote): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      if (text[i + 1] === '"' || text[i + 1] === "\\") i++;
    } else if (c === q) {
      if (i + 1 >= text.length) return true;
      if (text[i + 1] === q) {
        i++;
        if (i + 1 >= text.length || text[i + 1] === q) return true;
      }
    }
  }
  return false;
}

function rawContainsPreferred(text: string, q: Quote, triple: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === q) {
      if (!triple) return true;
      if (i + 1 >= text.length) return true;
      if (text[i + 1] === q) {
        i++;
        if (i + 1 >= text.length || text[i + 1] === q) return true;
      }
    }
  }
  return false;
}

function mergeMetadata(a: Metadata, b: Metadata): Metadata | undefined {
  if (a.k === "regular" && b.k === "regular")
    return { k: "regular", single: a.single + b.single, double: a.double + b.double, source: a.source };
  if (a.k !== "regular" && a.k === b.k)
    return { k: a.k, containsPreferred: a.containsPreferred || b.containsPreferred, source: a.source };
  return undefined;
}

function choose(m: Metadata, preferred: Quote): Quote {
  if (m.k !== "regular") return m.containsPreferred ? m.source : preferred;
  return m.single < m.double ? "'" : m.single > m.double ? '"' : preferred;
}

/** Ruff's `QuoteMetadata::from_part`: an f-string counts its literal elements only. */
function partMetadata(f: Fmt, part: Part, preferred: Quote): Metadata {
  if (!isInterpolated(part.flags)) return metadataOf(f.src.slice(part.contentStart, part.contentEnd), part.flags, preferred);
  let m = metadataOf("", part.flags, preferred);
  for (const e of part.elements)
    if (e.kind === "string_content") m = mergeMetadata(m, metadataOf(f.text(e), part.flags, preferred)) ?? m;
  return m;
}

/** Ruff's `choose_quotes`. */
export function chooseQuotes(f: Fmt, part: Part, preferred: QuoteStyle = f.options["quote-style"]): Flags {
  const style = preferredQuoteStyle(f, part, preferred);
  if (style === "preserve") return part.flags;
  const q: Quote = style === "double" ? '"' : "'";
  const raw = f.src.slice(part.contentStart, part.contentEnd);
  const first = raw.search(/[\\"'\r]/);
  if (first < 0) return { ...part.flags, quote: q };
  const m = isInterpolated(part.flags) ? partMetadata(f, part, q) : metadataOf(raw.slice(first), part.flags, q);
  return { ...part.flags, quote: choose(m, q) };
}

/** Ruff's `UnicodeEscape::normalize`: the escape's body with its hex digits lowercased or its name uppercased. */
function normalizeEscape(kind: string, input: string, allowUnicode: boolean): string | undefined {
  const len = kind === "x" ? 2 : kind === "u" && allowUnicode ? 4 : kind === "U" && allowUnicode ? 8 : kind === "N" && allowUnicode ? -1 : 0;
  if (len === 0) return undefined;
  if (len > 0) {
    if (input.length < len) return undefined;
    const body = input.slice(0, len);
    if (!/^[0-9a-fA-F]*$/.test(body)) return undefined;
    return body.toLowerCase();
  }
  if (input[0] !== "{") return undefined;
  for (let i = 1; i < input.length; i++) {
    const c = input[i] as string;
    if (c === "}") return i < 3 ? undefined : input.slice(0, i + 1).toUpperCase();
    if (!/[0-9A-Za-z -]/.test(c)) return undefined;
  }
  return undefined;
}

/** Ruff's `normalize_string`: line endings to `\n`, escapes' case, and quotes escaped for `fl.quote`. */
export function normalizeString(input: string, from: number, fl: Flags, escapeBraces: boolean): string {
  let out = "";
  let last = 0;
  const preferred = fl.quote;
  const opp = opposite(preferred);
  const raw = isRaw(fl);
  let i = from;
  while (i < input.length) {
    const c = input[i];
    if ((c === "{" || c === "}") && escapeBraces) {
      out += input.slice(last, i + 1) + c;
      last = i + 1;
      i++;
      continue;
    }
    if (c === "\r") {
      out += input.slice(last, i);
      if (input[i + 1] !== "\n") out += "\n";
      last = i + 1;
      i += input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (raw) {
      i++;
      continue;
    }
    if (c === "\\") {
      const next = input[i + 1];
      let j = i + 1;
      if (next !== undefined) {
        if (next === "\\") j = i + 2;
        else {
          const body = normalizeEscape(next, input.slice(i + 2), !isBytes(fl));
          if (body !== undefined) {
            const at = i + 2;
            if (body !== input.slice(at, at + body.length)) {
              out += input.slice(last, at) + body;
              last = at + body.length;
            }
            j = at + body.length;
          }
        }
        if (!fl.triple) {
          if (next === opp) {
            out += input.slice(last, i);
            last = i + 1;
            j = i + 2;
          } else if (next === preferred) j = i + 2;
        }
      }
      i = j;
      continue;
    }
    if (!fl.triple && c === preferred) {
      out += `${input.slice(last, i)}\\${c}`;
      last = i + 1;
    }
    i++;
  }
  return last === 0 ? input : out + input.slice(last);
}

/** Ruff's `needs_chaperone_space`: a space before the closing quotes so they do not join the content. */
function needsChaperone(fl: Flags, trimEnd: string): boolean {
  const slashes = (s: string) => s.length - s.replace(/\\+$/, "").length;
  if (slashes(trimEnd) % 2 === 1) return true;
  return fl.triple && trimEnd.endsWith(fl.quote) && slashes(trimEnd.slice(0, -1)) % 2 === 0;
}

export interface Hooks {
  /** Prints an f-string interpolation, with the enclosing string's flags and layout in `f.fstr`. */
  interpolation(f: Fmt, interp: FormatNode, flags: Flags, multiline: boolean): Doc;
}

/** A string spanning lines (a triple-quoted one) breaks every group around it, as ruff's multiline text does. */
export const multilineToken = (n: FormatNode, text: string): Doc =>
  text.includes("\n") ? [literalToken(n, text), breakParent] : token(n, text);

/** Ruff's `InterpolatedStringLayout`: multiline when an interpolation spans lines. */
function layoutMultiline(f: Fmt, part: Part): boolean {
  return part.elements.some((e) => e.kind === "interpolation" && hasLineBreak(f.src, e.start, e.end));
}

/** Prints an f-string's elements with `fl`, as ruff's `FormatFString`; literals escape braces when `escape`. */
function interpolatedElements(f: Fmt, part: Part, fl: Flags, hooks: Hooks): Doc[] {
  const multiline = layoutMultiline(f, part);
  const saved = f.fstr;
  f.fstr = { k: saved.k === "outside" ? "inside" : "nested", flags: fl, multiline };
  try {
    return part.elements.map((e) =>
      e.kind === "string_content"
        ? multilineToken(e, normalizeString(f.text(e), 0, fl, false))
        : hooks.interpolation(f, e, fl, multiline),
    );
  } finally {
    f.fstr = saved;
  }
}

/** One part, with its own quotes: ruff's `FormatStringLiteral` / `FormatBytesLiteral` / `FormatFString`. */
export function formatPart(f: Fmt, part: Part, hooks: Hooks, docstringIndent?: string): Doc {
  if (isInterpolated(part.flags)) {
    const fl = chooseQuotes(f, part);
    const q = quotesOf(fl);
    return [token(part.start, fl.prefix + q), interpolatedElements(f, part, fl, hooks), token(part.end, q)];
  }
  const style = f.options["quote-style"];
  const fl = chooseQuotes(f, part, docstringIndent !== undefined && style !== "preserve" ? "double" : style);
  const raw = f.src.slice(part.contentStart, part.contentEnd);
  const first = raw.search(/[\\"'\r]/);
  const content = first < 0 ? raw : normalizeString(raw, first, fl, false);
  if (docstringIndent !== undefined) {
    const doc = docstring(content, fl, docstringIndent, f.options["indent-width"]);
    if (doc !== undefined) return multilineToken(part.node, doc);
  }
  const q = quotesOf(fl);
  return multilineToken(part.node, fl.prefix + q + content + q);
}

/** A docstring's leading whitespace as ruff measures it: columns with tabs to the next multiple of 8, and its length. */
function indentation(line: string): { columns: number; length: number } {
  let columns = 0;
  let length = 0;
  for (const c of line) {
    if (c === " ") columns++;
    else if (c === "\t") columns += 8 - (columns % 8);
    else break;
    length++;
  }
  return { columns, length };
}

/** Ruff's `docstring::format`, as the text of one token whose later lines carry `indent`; undefined to print as a plain string. */
function docstring(content: string, fl: Flags, indent: string, _indentWidth: number): string | undefined {
  if (/\\[ \t\f]*\n/.test(content)) return undefined;
  const q = quotesOf(fl);
  const lines = content.split("\n");
  const first = lines[0] ?? "";
  let out = fl.prefix + q;
  let lineEmpty = false;
  const write = (s: string) => {
    if (lineEmpty) out += indent;
    out += s;
    lineEmpty = false;
  };
  const hardBreak = () => {
    if (!lineEmpty) out += "\n";
    lineEmpty = true;
  };
  const trimEnd = first.trimEnd();
  const trimBoth = trimEnd.trimStart();
  if (trimBoth.startsWith(fl.quote)) out += " ";
  if (trimEnd !== "") out += trimBoth;
  if (content.slice(first.length).trim() === "") {
    if (needsChaperone(fl, trimEnd) || (trimEnd === "" && content !== "")) out += " ";
    return out + q;
  }
  hardBreak();
  const rest = lines.slice(1);
  let stripped: { columns: number; length: number } | undefined;
  for (const l of rest) {
    if (l.trim() === "") continue;
    const ind = indentation(l);
    if (!stripped || ind.columns < stripped.columns) stripped = ind;
  }
  const strip = stripped ?? { columns: 0, length: 0 };
  for (const [i, line] of rest.entries()) {
    const last = i === rest.length - 1;
    const te = line.trimEnd();
    if (te === "") {
      if (!last) {
        if (!lineEmpty) out += "\n";
        out += "\n";
        lineEmpty = true;
      }
      continue;
    }
    const lead = /^\s*/.exec(te)?.[0] ?? "";
    if (/[^ ]/.test(lead)) write(" ".repeat(Math.max(0, indentation(te).columns - strip.columns)) + te.trimStart());
    else write(te.slice(strip.length));
    if (!last) hardBreak();
  }
  const tail = content.replace(/[^\S\n]+$/, "");
  if (needsChaperone(fl, tail)) write(" ");
  write(q);
  return out;
}

/** Ruff's `StringLike::is_multiline`. */
export function isMultilineStr(f: Fmt, s: Str): boolean {
  return s.parts.some((n) => {
    const p = partOf(f.src, n);
    if (!isInterpolated(p.flags)) return p.flags.triple && hasLineBreak(f.src, n.start, n.end);
    return p.elements.some((e) =>
      e.kind === "string_content"
        ? p.flags.triple && hasLineBreak(f.src, e.start, e.end)
        : isDebug(e) && /[\r\n]/.test(f.text(e)),
    );
  });
}

/** The flags an implicit concatenation merges into, or undefined when it must keep its parts (ruff's `merge_flags`). */
function mergedFlags(f: Fmt, s: Str, parts: readonly Part[]): Flags | undefined {
  if (isMultilineStr(f, s)) return undefined;
  if (f.comments.hasDangling(s)) return undefined;
  let preserve: Quote | undefined;
  for (const p of parts) {
    if (p.flags.triple || isRaw(p.flags)) return undefined;
    if (f.comments.has(p.node)) return undefined;
    if (isInterpolated(p.flags)) {
      if (s.flavor === "t" && !p.flags.prefix.includes("t")) return undefined;
      const style = preferredQuoteStyle(f, { ...p, flags: { ...p.flags, triple: false } }, "double");
      if (style === "preserve" && f.fstr.k === "outside" && f.options["quote-style"] !== "preserve") {
        if (preserve !== undefined && preserve !== p.flags.quote) return undefined;
        preserve = p.flags.quote;
      }
    }
  }
  const prefix = s.flavor === "bytes" ? "b" : s.flavor === "f" ? "f" : s.flavor === "t" ? "t" : "";
  const first = parts[0] as Part;
  let quote: Quote;
  if (preserve !== undefined) quote = preserve;
  else {
    const style = preferredQuoteStyle(f, first, f.options["quote-style"]);
    if (style === "preserve") quote = first.flags.quote;
    else {
      const q: Quote = style === "double" ? '"' : "'";
      let merged: Metadata | undefined;
      for (const p of parts) {
        const m = partMetadata(f, p, q);
        if (merged) {
          const next = mergeMetadata(m, merged);
          if (!next) return undefined;
          merged = next;
        } else merged = m;
      }
      quote = choose(merged as Metadata, q);
    }
  }
  return { prefix, quote, triple: false };
}

/** Ruff's `FormatImplicitConcatenatedStringFlat`: every part's content between one pair of quotes. */
function flat(f: Fmt, parts: readonly Part[], fl: Flags, hooks: Hooks): Doc {
  const out: Doc[] = [];
  const q = quotesOf(fl);
  for (const [i, p] of parts.entries()) {
    out.push(token(p.start, i === 0 ? fl.prefix + q : ""));
    if (isInterpolated(p.flags)) out.push(interpolatedElements(f, p, fl, hooks));
    else
      for (const e of p.elements)
        out.push(token(e, normalizeString(f.text(e), 0, fl, isInterpolated(fl))));
    out.push(token(p.end, i === parts.length - 1 ? q : ""));
  }
  return out;
}

/** Ruff's `FormatImplicitConcatenatedStringExpanded`: each part on its own, joined by in-parentheses-only lines. */
function expanded(f: Fmt, s: Str, parts: readonly Part[], hooks: Hooks, multipart: boolean): Doc {
  const out: Doc[] = [];
  if (multipart && parts.some((p, i) => i > 0 && hasLineBreak(f.src, (parts[i - 1] as Part).node.end, p.node.start)))
    out.push({ k: "breakParent" });
  // Comments between parts attach to the string; each goes to the part it follows on its line, else the next.
  const between = f.comments.dangling(s);
  for (const [i, p] of parts.entries()) {
    const prevEnd = i === 0 ? -1 : (parts[i - 1] as Part).node.end;
    const nextStart = parts[i + 1]?.node.start ?? Number.POSITIVE_INFINITY;
    const leading = between.filter((c: Comment) => c.line === "own" && c.start > prevEnd && c.end < p.node.start);
    const trailing = between.filter((c: Comment) => c.line === "eol" && c.start > p.node.end && c.end < nextStart);
    if (i > 0) out.push(f.softLineOrSpace());
    out.push(
      f.leading([...leading, ...f.comments.leading(p.node)]),
      formatPart(f, p, hooks),
      f.trailing([...trailing, ...f.comments.trailing(p.node)]),
    );
  }
  return out;
}

/** Ruff's `FormatExprStringLiteral` / `FormatExprFString` / bytes, for the whole expression `s`. */
export function formatStr(f: Fmt, s: Str, hooks: Hooks, docstringIndent?: string): Doc {
  const parts = s.parts.map((n) => partOf(f.src, n));
  if (parts.length === 1) return formatPart(f, parts[0] as Part, hooks, docstringIndent);
  const parenthesized = f.level.k === "paren" || (f.level.k === "expr" && f.level.g !== undefined);
  const merged = mergedFlags(f, s, parts);
  if (!parenthesized) {
    if (merged) return flat(f, parts, merged, hooks);
    if (docstringIndent !== undefined)
      return f.parenthesizeIfExpands(s.ts, () => expanded(f, s, parts, hooks, true));
  }
  if (merged) {
    const flatDoc = flat(f, parts, merged, hooks);
    const exp = expanded(f, s, parts, hooks, false);
    return f.inParensGroup(ifBreak(exp, flatDoc));
  }
  return f.inParensGroup(expanded(f, s, parts, hooks, true));
}

/** An implicit concatenation as an operand of a binary expression, which groups it itself. */
export function implicitConcatenated(f: Fmt, s: Str, hooks: Hooks): Doc {
  const parts = s.parts.map((n) => partOf(f.src, n));
  const merged = mergedFlags(f, s, parts);
  return merged ? ifBreak(expanded(f, s, parts, hooks, false), flat(f, parts, merged, hooks)) : expanded(f, s, parts, hooks, true);
}
