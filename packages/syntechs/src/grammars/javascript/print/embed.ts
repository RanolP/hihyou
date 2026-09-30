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
  const text = raws.map((q, i) => (i === 0 ? q : `prettier-placeholder-${i - 1}${q}`)).join("");
  const tree = parseTree(cssLanguage, text);
  if (tree.errorChars > 0 || brokenNodes(tree) !== undefined || scssOnly(tree)) return undefined;
  const parts = subs();
  const seen = new Set<number>();
  const regex = /prettier-placeholder-(\d+)/;
  const { printWidth, tabWidth, useTabs, singleQuote } = ctx.js.options;
  let failed = false;
  const printed = capture(() => {
    tick(0);
    open(INDENT);
    sHardline();
    withEmbedding(
      {
        anchor: node,
        token: (s) => {
          if (!regex.test(s)) return false;
          withParts(s, regex, parts, seen);
          return true;
        },
      },
      () => {
        try {
          printInto(tree, css, { printWidth, tabWidth, useTabs, singleQuote });
        } catch {
          failed = true;
        }
      },
    );
    close();
    sLine(SOFT);
    tick(1);
  });
  // Prettier fails the embed when a placeholder did not print as a token of its own.
  return failed || seen.size !== parts.length ? undefined : printed;
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
