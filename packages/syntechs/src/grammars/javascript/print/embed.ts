// Prettier's embed (language-js/embed/): a template string in another language (util.ts's embedLanguage) printed
// by that language's printer, its substitutions in place of placeholders. Where prettier's embed would fail, or
// where this one covers less than prettier's (a CSS or HTML parse error, a GraphQL query, an escape in a quasi),
// `printEmbed` returns false and the template prints as its source.

import { NO_NODE, parseTree, type Tree } from "../../../core/index.js";
import { brokenNodes } from "../../../fmt/format.js";
import { printInto } from "../../../fmt/stream-format.js";
import { withEmbedding, withRewrite } from "../../../fmt/stream.js";
import { css } from "../../css/fmt.js";
import { language as cssLanguage } from "../../css/index.js";
import { html as htmlFormatter } from "../../html/fmt.js";
import { language as htmlLanguage } from "../../html/index.js";
import { parseHtml, Unsupported } from "../../html/print.js";
import {
  capture,
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  INDENT,
  type JsStreamCtx,
  open,
  type Part,
  place,
  SOFT,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../sink.js";
import { children, type EmbedLanguage, kind } from "./util.js";

/**
 * Prints the template `node` as `lang`, its quasis' source `raws`, each substitution as `substitution` captures it;
 * false when it does not, having written nothing.
 */
export function printEmbed(
  ctx: JsStreamCtx,
  node: number,
  lang: EmbedLanguage,
  raws: string[],
  substitution: (sub: number) => Part,
): boolean {
  // A quasi's cooked value, which prettier's embed reads, is its source when it holds no escape; the HTML embed
  // cooks its own.
  if (lang !== "html" && raws.some((q) => q.includes("\\"))) return false;
  const js = ctx.js;
  const ticks = children(js, node).filter((c) => kind(js, c) === "`");
  const tick = (i: number) => {
    const t = ticks[i];
    if (t === undefined) sText("`");
    else sToken(t, "`");
  };
  if (raws.length === 1 && (raws[0] as string).trim() === "") {
    tick(0);
    tick(1);
    return true;
  }
  const subs = () =>
    children(js, node)
      .filter((c) => kind(js, c) === "template_substitution")
      .map(substitution);
  const printed =
    lang === "html"
      ? html(ctx, node, raws, subs, tick)
      : lang === "css"
        ? cssEmbed(ctx, node, raws, subs, tick)
        : graphql(raws, subs, tick);
  if (printed === undefined) return false;
  place(printed);
  return true;
}

type Tick = (i: number) => void;

/** Writes `s`, each match of `placeholder` as the part its first group numbers; the numbers it wrote. */
function withParts(s: string, placeholder: RegExp, parts: Part[], seen?: Set<number>): void {
  s.split(placeholder).forEach((piece, i) => {
    if (i % 2 === 0) {
      if (piece !== "") sText(piece);
      return;
    }
    const n = Number(piece);
    const part = parts[n];
    if (part === undefined) throw new Unsupported(`placeholder ${n}`);
    seen?.add(n);
    place(part);
  });
}

/** A quasi's cooked value, for the escapes that cook to the character escaped; undefined for any other escape. */
function cook(raw: string): string | undefined {
  let other = false;
  const cooked = raw.replace(/\\([^])/g, (_, c: string) => {
    if ("\\`$/'\"".includes(c)) return c;
    other = true;
    return "";
  });
  return other ? undefined : cooked;
}

/** Each HTML embed's placeholders are its own, so an embed inside one leaves the outer one's placeholders alone. */
let htmlEmbeds = 0;

// embed/html.js's printEmbedHtmlLike: the HTML formatter prints the template's cooked text, and every string written
// under it is uncooked for the template (uncookTemplateElementValue), each placeholder its substitution.
function html(ctx: JsStreamCtx, node: number, raws: string[], subs: () => Part[], tick: Tick): Part | undefined {
  const cooked = raws.map(cook);
  if (cooked.some((q) => q === undefined)) return undefined;
  const id = htmlEmbeds++;
  const placeholder = (i: number) => `PRETTIER_HTML_PLACEHOLDER_${i}_${id}_IN_JS`;
  const text = cooked.map((q, i) => (i === cooked.length - 1 ? q : q + placeholder(i))).join("");
  const options = ctx.js.options;
  // Every option goes on to the HTML (a script in it reads `semi`, `singleQuote`), but what names this file's own
  // parse and place.
  const { parser: _parser, sourceType: _sourceType, embeddedInHtml: _embeddedInHtml, ...htmlOptions } = options;
  const { htmlWhitespaceSensitivity } = options;
  let root;
  try {
    root = parseHtml(text, true, true, htmlWhitespaceSensitivity, false, true);
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    throw e;
  }
  const parts = subs();
  const regex = new RegExp(`PRETTIER_HTML_PLACEHOLDER_(\\d+)_${id}_IN_JS`);
  const uncook = (s: string) => {
    const escaped = s.replace(/([\\`]|\$\{)/g, "\\$1");
    return options.embeddedInHtml ? escaped.replace(/<\/(?=script\b)/gi, "<\\/") : escaped;
  };
  const write = (s: string, out: (s: string) => void) =>
    s.split(regex).forEach((piece, i) => {
      if (i % 2 === 0) {
        if (piece !== "") out(uncook(piece));
        return;
      }
      const part = parts[Number(piece)];
      if (part === undefined) throw new Unsupported(`placeholder ${piece}`);
      place(part);
    });
  const content = () =>
    withRewrite(write, () =>
      withEmbedding({ anchor: node, token: undefined }, () =>
        printInto(parseTree(htmlLanguage, text), htmlFormatter, { ...htmlOptions, embeddedInJs: true }),
      ),
    );
  const leading = /^\s/.test(text);
  const trailing = /\s$/.test(text);
  const ignore = htmlWhitespaceSensitivity === "ignore";
  try {
    return capture(() => {
      open(GROUP);
      tick(0);
      if (ignore || (leading && trailing)) {
        const linebreak = ignore ? sHardline : () => sLine(0);
        open(INDENT);
        linebreak();
        open(GROUP);
        content();
        close();
        close();
        linebreak();
      } else {
        if (leading) sText(" ");
        const indented = root.children.length > 1;
        if (indented) open(INDENT);
        open(GROUP);
        content();
        close();
        if (indented) close();
        if (trailing) sText(" ");
      }
      tick(1);
      close();
    });
  } catch (e) {
    // The HTML formatter refuses what its parse let through (an attribute value it cannot print).
    if (e instanceof Unsupported) return undefined;
    throw e;
  }
}

// embed/css.js's printEmbedCss. Prettier's placeholder, `@prettier-placeholder-N-id`, is an at-word scss reads
// where tree-sitter-css reads none; an identifier stands wherever a value, a selector or a property does.
function cssEmbed(ctx: JsStreamCtx, node: number, raws: string[], subs: () => Part[], tick: Tick): Part | undefined {
  const statements = placeholderStatements(raws);
  const text = withLastSemicolon(statements);
  const tree = parseTree(cssLanguage, text);
  // A combinator alone (`> { … }`), a selector to SCSS, misses its right side to tree-sitter-css, whose printer keeps
  // that selector as written.
  const broken = brokenNodes(tree);
  const unreadable = broken !== undefined && [...broken].some((n) => !tree.kindName(n).endsWith("_selector"));
  if (tree.errorChars > 0 || unreadable || scssOnly(tree)) return undefined;
  const regex = /prettier-placeholder-(\d+)/;
  const { printWidth, tabWidth, useTabs, singleQuote } = ctx.js.options;
  let failed = false;
  const run = (token: (s: string, node: number) => boolean) =>
    capture(() => {
      tick(0);
      open(INDENT);
      sHardline();
      withEmbedding({ anchor: node, token }, () => {
        try {
          printInto(tree, css, { printWidth, tabWidth, useTabs, singleQuote });
        } catch {
          failed = true;
        }
      });
      close();
      sLine(SOFT);
      tick(1);
    });
  // oxfmt ends the template's last statement without a `;` where it opens with a substitution (`${a}: b`), which
  // tree-sitter-css needs to read it: the printer's last `;` is left out.
  let drop = -1;
  if (opensWithSubstitution(raws)) {
    let semis = 0;
    run((s) => {
      if (s === ";") semis++;
      return regex.test(s);
    });
    drop = semis - 1;
  }
  const parts = subs();
  const seen = new Set<number>();
  let semi = 0;
  const printed = run((s, at) => {
    if (s === ";" && semi++ === drop) return true;
    if (!regex.test(s)) return false;
    // An ignored statement prints as its source, the markers `placeholderStatements` wrote in it included.
    s = s.replace(/@prettier-placeholder-statement /g, "").replace(/@prettier-placeholder-bare ([^;]*);/g, "$1");
    const indented = /\wprettier-placeholder-\d/.test(s) && soleValueWord(tree, at);
    // A fill item fits by its own width, so the declaration's `;` after it is not measured.
    if (indented) for (const kind of [INDENT, FILL, FILL_ITEM]) open(kind);
    withParts(s, regex, parts, seen);
    if (indented) for (let k = 0; k < 3; k++) close();
    return true;
  });
  // Prettier fails the embed when a placeholder did not print as a token of its own.
  return failed || seen.size !== parts.length ? undefined : printed;
}

/**
 * `node` is a declaration value's word with no other word beside it between commas. A word glued to a placeholder
 * (`a${b}`) is two words to prettier's value parser, which indents a run of several (printCommaSeparatedValueGroup's
 * `indent(fill(…))`); the CSS printer indents a run of several words already.
 */
function soleValueWord(tree: Tree, node: number): boolean {
  if (node < 0 || node === NO_NODE) return false;
  let inDeclaration = false;
  for (let up = tree.parent(node); up !== NO_NODE; up = tree.parent(up))
    if (tree.kindName(up) === "declaration") inDeclaration = true;
  const parent = tree.parent(node);
  if (!inDeclaration || parent === NO_NODE || tree.kindName(node) === "property_name") return false;
  const siblings = Array.from({ length: tree.count(parent) }, (_, i) => tree.child(parent, i));
  const at = siblings.indexOf(node);
  // postcss takes `!important` off the value, so it is no word of it.
  const isWord = (n: number) =>
    tree.named(n) && !["property_name", "comment", "important"].includes(tree.kindName(n));
  for (const dir of [-1, 1])
    for (let i = at + dir; i >= 0 && i < siblings.length; i += dir) {
      const n = siblings[i] as number;
      if (tree.text(n) === "," || tree.text(n) === ":") break;
      if (isWord(n)) return false;
    }
  return true;
}

/**
 * The template's last statement, with no `;` ending it, opens with a substitution and holds more than substitutions
 * (a statement of substitutions alone is `placeholderStatements`' bare one).
 */
function opensWithSubstitution(raws: string[]): boolean {
  const plain = raws.map((r) => r.replace(/\/\*[^]*?\*\//g, ""));
  const last = plain[plain.length - 1] as string;
  if (plain.length < 2 || /[;{}]/.test(last)) return false;
  let i = plain.length - 2;
  while (i > 0 && !/[;{}]/.test(plain[i] as string)) i--;
  const r = plain[i] as string;
  const head = r.slice(Math.max(r.lastIndexOf(";"), r.lastIndexOf("{"), r.lastIndexOf("}")) + 1);
  return head.trim() === "" && plain.slice(i + 1).some((p) => p.trim() !== "");
}

/**
 * The CSS of `raws`, a placeholder for each substitution. One or more substitutions alone on a line, opening a
 * statement and ending it with a `;`, a line break, a `}` or the template's end (`${x}; b: a`), are a statement of
 * their own to oxfmt, which tree-sitter-css reads as a postcss statement opening with
 * `@prettier-placeholder-statement`, or `@prettier-placeholder-bare` where no `;` follows them, the CSS printer
 * printing that `;` only for the first (css/fmt.ts's `placeholdersMarker`).
 */
function placeholderStatements(raws: string[]): string {
  let out = raws[0] ?? "";
  for (let i = 0; i + 1 < raws.length; i++) {
    const opens = /(?:^|[;{}])(?:\s|\/\*[^]*?\*\/)*$/.test(out);
    let j = i;
    while (j + 2 < raws.length && /^[ \t]*$/.test(raws[j + 1] as string)) j++;
    const after = raws[j + 1] as string;
    const semi = /^\s*;/.test(after);
    if (!opens || !(semi || /^[ \t]*(?:\/\*[^]*?\*\/[ \t]*)*(?:\r?\n|\}|$)/.test(after))) {
      out += `prettier-placeholder-${i}${raws[i + 1]}`;
      continue;
    }
    const placeholders = Array.from({ length: j - i + 1 }, (_, k) => `prettier-placeholder-${i + k}`).join(" ");
    out += `@prettier-placeholder-${semi ? "statement" : "bare"} ${placeholders}${semi ? "" : ";"}${after}`;
    i = j;
  }
  return out;
}

// SCSS ends the template's last declaration as a block's (`b: a /* c */` is `b: a; /* c */`), where tree-sitter-css
// misses its `;`.
function withLastSemicolon(text: string): string {
  const tree = parseTree(cssLanguage, text);
  const last = tree.child(tree.root, tree.count(tree.root) - 1);
  if (tree.errorChars > 0) {
    // A lone last declaration (`b:a`) reads as a selector to tree-sitter-css until its `;` is there.
    const end = text.replace(/(?:\s|\/\*[^]*?\*\/)*$/, "").length;
    const ended = `${text.slice(0, end)};${text.slice(end)}`;
    return parseTree(cssLanguage, ended).errorChars === 0 ? ended : text;
  }
  if (last === NO_NODE || tree.kindName(last) !== "declaration") return text;
  const semi = tree.child(last, tree.count(last) - 1);
  if (!tree.missing(semi)) return text;
  let i = tree.count(last) - 2;
  while (tree.kindName(tree.child(last, i)) === "comment") i--;
  const at = tree.end(tree.child(last, i));
  return `${text.slice(0, at)};${text.slice(at)}`;
}

// Prettier parses the embed as SCSS, where `//` opens a line comment and a value's `:` (`a:b`, `fn(a:b)`) stays
// as written; the CSS printer reads two `/`s and spaces the `:` as oxc does, so the embed prints as its source.
function scssOnly(tree: Tree): boolean {
  const ends = new Set<number>();
  const starts: number[] = [];
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    // A `//` inside a word (`x(http://a)`) opens a line comment too, which leaves SCSS a broken value; an unquoted
    // `url()`'s argument is one token to it.
    if (tree.kindName(n) === "plain_value" && tree.text(n).includes("//") && !inUrl(tree, n)) return true;
    if (tree.named(n)) continue;
    const up = tree.parent(n);
    if (tree.text(n) === ":" && up !== NO_NODE) {
      const k = tree.kindName(up);
      if (k === "declaration" && tree.child(up, 1) !== n) return true;
      if (k === "keyword_argument" && tree.kindName(tree.parent(up)) === "arguments") return true;
    }
    if (tree.text(n) !== "/") continue;
    ends.add(tree.end(n));
    starts.push(tree.start(n));
  }
  return starts.some((s) => ends.has(s));
}

function inUrl(tree: Tree, n: number): boolean {
  for (let up = tree.parent(n); up !== NO_NODE; up = tree.parent(up))
    if (tree.kindName(up) === "call_expression") return /^url$/i.test(tree.text(tree.child(up, 0)));
  return false;
}

// embed/graphql.js's printEmbedGraphQL, for the quasis that hold only comments and whitespace: there is no
// GraphQL printer to lay a query out.
function graphql(raws: string[], subs: () => Part[], tick: Tick): Part | undefined {
  type Item = { lines: { text: string; blankBefore: boolean }[] } | number | "";
  const items: Item[] = [];
  for (const [i, raw] of raws.entries()) {
    const isFirst = i === 0;
    const isLast = i === raws.length - 1;
    const lines = raw.split("\n");
    const n = lines.length;
    if (!isLast && /#[^\n\r]*$/.test(lines[n - 1] as string)) return undefined;
    if (!lines.every((l) => /^\s*(?:#[^\n\r]*)?$/.test(l))) return undefined;
    const startsWithBlankLine = n > 2 && lines[0]?.trim() === "" && lines[1]?.trim() === "";
    const endsWithBlankLine = n > 2 && lines[n - 1]?.trim() === "" && lines[n - 2]?.trim() === "";
    // printGraphqlComments
    const trimmed = lines.map((l) => l.trim());
    const comments: { text: string; blankBefore: boolean }[] = [];
    trimmed.forEach((l, j) => {
      if (l === "") return;
      comments.push({ text: l, blankBefore: trimmed[j - 1] === "" && comments.length > 0 });
    });
    if (comments.length > 0) {
      if (!isFirst && startsWithBlankLine) items.push("");
      items.push({ lines: comments });
      if (!isLast && endsWithBlankLine) items.push("");
    } else if (!isFirst && !isLast && startsWithBlankLine) items.push("");
    if (!isLast) items.push(i);
  }
  const parts = subs();
  return capture(() => {
    tick(0);
    open(INDENT);
    sHardline();
    items.forEach((item, i) => {
      if (i > 0) sHardline();
      if (typeof item === "number") place(parts[item] as Part);
      else if (item !== "")
        item.lines.forEach((l, j) => {
          if (j > 0) sHardline();
          if (l.blankBefore) sHardline();
          sText(l.text);
        });
    });
    close();
    sHardline();
    tick(1);
  });
}
