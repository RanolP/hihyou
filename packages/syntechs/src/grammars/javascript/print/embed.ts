// Prettier's embed (language-js/embed/): a template string in another language (util.ts's embedLanguage) printed
// by that language's printer, its substitutions in place of placeholders. Where prettier's embed would fail, or
// where this one covers less than prettier's (a CSS or HTML parse error, a GraphQL query, an escape in a quasi),
// `printEmbed` returns false and the template prints as its source.

import { NO_NODE, parseTree, type Tree } from "../../../core/index.js";
import { brokenNodes } from "../../../fmt/format.js";
import { printInto } from "../../../fmt/stream-format.js";
import { withEmbedding } from "../../../fmt/stream.js";
import { css } from "../../css/fmt.js";
import { language as cssLanguage } from "../../css/index.js";
import { parseHtml, printHtml, Unsupported } from "../../html/print.js";
import {
  capture,
  close,
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
  // A quasi's cooked value, which prettier's embed reads, is its source when it holds no escape.
  if (raws.some((q) => q.includes("\\"))) return false;
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
      ? html(node, raws, subs, tick, js.options.tabWidth)
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

// embed/html.js's printEmbedHtmlLike
function html(node: number, raws: string[], subs: () => Part[], tick: Tick, tabWidth: number): Part | undefined {
  const placeholder = (i: number) => `PRETTIER_HTML_PLACEHOLDER_${i}_IN_JS`;
  const text = raws.map((q, i) => (i === raws.length - 1 ? q : q + placeholder(i))).join("");
  let root;
  try {
    root = parseHtml(text);
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    throw e;
  }
  const parts = subs();
  const regex = /PRETTIER_HTML_PLACEHOLDER_(\d+)_IN_JS/;
  const content = () =>
    withEmbedding({ anchor: node, token: undefined }, () =>
      printHtml(root, text, { text: (s) => withParts(s, regex, parts), tabWidth }),
    );
  const leading = /^\s/.test(text);
  const trailing = /\s$/.test(text);
  return capture(() => {
    open(GROUP);
    tick(0);
    if (leading && trailing) {
      open(INDENT);
      sLine(0);
      open(GROUP);
      content();
      close();
      close();
      sLine(0);
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
}

// embed/css.js's printEmbedCss. Prettier's placeholder, `@prettier-placeholder-N-id`, is an at-word scss reads
// where tree-sitter-css reads none; an identifier stands wherever a value, a selector or a property does.
function cssEmbed(ctx: JsStreamCtx, node: number, raws: string[], subs: () => Part[], tick: Tick): Part | undefined {
  const statements = placeholderStatements(raws);
  const text = withLastSemicolon(statements);
  const tree = parseTree(cssLanguage, text);
  if (tree.errorChars > 0 || brokenNodes(tree) !== undefined || scssOnly(tree)) return undefined;
  const regex = /prettier-placeholder-(\d+)/;
  const { printWidth, tabWidth, useTabs, singleQuote } = ctx.js.options;
  let failed = false;
  const run = (token: (s: string) => boolean) =>
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
  const printed = run((s) => {
    if (s === ";" && semi++ === drop) return true;
    if (!regex.test(s)) return false;
    // An ignored statement prints as its source, the markers `placeholderStatements` wrote in it included.
    s = s.replace(/@prettier-placeholder-statement /g, "").replace(/@prettier-placeholder-bare ([^;]*);/g, "$1");
    withParts(s, regex, parts, seen);
    return true;
  });
  // Prettier fails the embed when a placeholder did not print as a token of its own.
  return failed || seen.size !== parts.length ? undefined : printed;
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
