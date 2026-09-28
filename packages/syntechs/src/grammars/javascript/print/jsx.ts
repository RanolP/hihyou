// Prettier's JSX printer (print/jsx.js, 3.9.9). Babel's JSXText is the source between two non-text children,
// character references included; tree-sitter splits it into `jsx_text` and `html_character_reference` nodes and
// drops a blank run that holds a line break, so `jsxChildren` rebuilds it from those nodes and the gaps between.

import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import { nextLineEmpty } from "../../../fmt/text.js";
import {
  BROKEN,
  capture,
  close,
  closeChoice,
  closeState,
  FILL,
  FILL_ITEM,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  openChoice,
  openState,
  type Part,
  place,
  SOFT,
  sHardline,
  sLine,
  sLineSuffixBoundary,
  sText,
  sToken,
  willBreak,
  withComments,
} from "../sink.js";
import { needsParens, role } from "./parens.js";
import {
  anon,
  CF,
  children as childrenOf,
  childWhere,
  field,
  fields,
  first,
  type HasTree,
  hasComment,
  hasNewlineIn,
  isComment,
  isJsx,
  isTaggedTemplate,
  type JsCtx,
  type JsOptions,
  kind,
  lastChildWhere,
  named,
  parent as parentOf,
  src,
  unparen,
} from "./util.js";

/** Options prettier's JSX printer reads that the rest of the JS printer does not. */
type JsxOptions = JsOptions & {
  singleAttributePerLine?: boolean;
  jsxBracketSameLine?: boolean;
};

/** One of Babel's JSX children: a JSXText (its raw text and the tree nodes it came from) or any other node. */
type Child =
  | { text: string; pieces: readonly Piece[]; node?: undefined }
  | { node: number; text?: undefined };
/** A source node inside a JSXText, at `at` in its text. */
interface Piece {
  at: number;
  node: number;
}

const isTextPiece = (ctx: JsCtx, n: number) => {
  const k = kind(ctx, n);
  return k === "jsx_text" || k === "html_character_reference";
};

/**
 * The source between sibling `from` and the next sibling `to`, which tree-sitter keeps no node for: blank,
 * reduced to what JSX reads. No leaf lies between the two, so its line breaks are `to`'s `lf`.
 */
function gap(ctx: JsCtx, from: number, to: number): string {
  if (ctx.tree.adjoins(from, to)) return "";
  const lf = ctx.tree.lf(to);
  if (lf === 0) return " ";
  return lf >= 2 ? "\n\n" : "\n";
}

/** The children of a jsx_element as Babel lists them. */
function jsxChildren(ctx: JsCtx, n: number): Child[] {
  const open = field(ctx, n, "open_tag");
  const close = field(ctx, n, "close_tag");
  const out: Child[] = [];
  // The sibling the next gap starts after: without an opening tag the first child starts the element.
  let at = open;
  let raw = "";
  let pieces: Piece[] = [];
  const flush = () => {
    if (raw !== "") out.push({ text: raw, pieces });
    raw = "";
    pieces = [];
  };
  for (const c of childrenOf(ctx, n)) {
    if (c === open || c === close) continue;
    if (at !== undefined) raw += gap(ctx, at, c);
    at = c;
    if (isTextPiece(ctx, c)) {
      pieces.push({ at: raw.length, node: c });
      raw += src(ctx, c);
    } else {
      flush();
      out.push({ node: c });
    }
  }
  // Without a closing tag the element ends at its last child, as a tree-sitter node ends at its last token.
  if (at !== undefined && close !== undefined) raw += gap(ctx, at, close);
  flush();
  return out;
}

const JSX_WHITESPACE = /([ \n\r\t]+)/;
const NON_WHITESPACE = /[^ \n\r\t]/;
const JSX_TRIM = /^[ \n\r\t]+|[ \n\r\t]+$/g;

/** Prettier's isMeaningfulJsxText. */
const isMeaningfulText = (c: Child | undefined) =>
  c?.text !== undefined &&
  (NON_WHITESPACE.test(c.text) || !c.text.includes("\n"));

/** Prettier's isJsxWhitespaceExpression: `{" "}`. */
function isWhitespaceExpression(ctx: JsCtx, n: number): boolean {
  if (kind(ctx, n) !== "jsx_expression") return false;
  const e = first(ctx, n);
  return (
    e !== undefined &&
    kind(ctx, e) === "string" &&
    src(ctx, e).slice(1, -1) === " " &&
    !hasComment(ctx, e)
  );
}

const isSelfClosing = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "jsx_self_closing_element";

/**
 * A separator of prettier's JSX fill: `line`, `softline`, `hardline`, `ws` its jsxWhitespace
 * (`ifBreak([rawJsxWhitespace, softline], " ")`), `wsHard` `[rawJsxWhitespace, hardline]`.
 */
type Sep = "line" | "softline" | "hardline" | "ws" | "wsHard";
/** What a fill content writes: a token, or a printed child read by willBreak before it is placed. */
type Atom = (() => void) | Part;
/** A fill content, its atoms in order; `[]` is prettier's `""`, which the separator clean-up looks for. */
type Content = readonly Atom[];
type FillPart = Content | Sep;

const isEmptyContent = (x: FillPart | undefined) =>
  Array.isArray(x) && x.length === 0;

const isEmptyOrAnyLine = (x: FillPart) =>
  isEmptyContent(x) || x === "line" || x === "softline" || x === "hardline";

const breaks = (x: FillPart) =>
  typeof x === "string"
    ? x === "hardline" || x === "wsHard"
    : x.some((a) => typeof a !== "function" && willBreak(a));

function separatorNoWhitespace(
  x: HasTree,
  fbt: boolean,
  word: string,
  child: Child,
  next: Child | undefined,
): Sep | undefined {
  if (fbt) return undefined;
  if (isSelfClosing(x, child.node) || isSelfClosing(x, next?.node))
    return word.length === 1 ? "softline" : "hardline";
  return "softline";
}

function separatorWithWhitespace(
  x: HasTree,
  fbt: boolean,
  word: string,
  child: Child,
  next: Child | undefined,
): Sep {
  if (fbt) return "hardline";
  if (word.length === 1)
    return isSelfClosing(x, child.node) || isSelfClosing(x, next?.node)
      ? "hardline"
      : "softline";
  return "hardline";
}

/** The node a word of a JSXText starts in, for its token to point at; none for a text of gaps only. */
function pieceAt(
  child: Child & { text: string },
  at: number,
): number | undefined {
  let node = child.pieces[0]?.node;
  for (const piece of child.pieces) {
    if (piece.at > at) break;
    node = piece.node;
  }
  return node;
}

/** Prettier's printJsxChildren: fill parts, content at even indexes and separators at odd ones. */
function printChildren(
  s: JsStreamCtx,
  children: readonly Child[],
  fbt: boolean,
): FillPart[] {
  const ctx = s.js;
  const parts: FillPart[] = [[]];
  const push = (atom: Atom) => {
    parts.push([...(parts.pop() as Content), atom]);
  };
  const pushLine = (sep: Sep | undefined) => {
    if (sep === undefined) return;
    parts.push(sep, []);
  };
  for (const [i, child] of children.entries()) {
    const next = children[i + 1];
    if (child.text !== undefined) {
      const raw = child.text;
      if (isMeaningfulText(child)) {
        const words = raw.split(JSX_WHITESPACE);
        let offset = 0;
        let lastWord = "";
        if (words[0] === "") {
          words.shift();
          const space = words.shift() as string;
          offset += space.length;
          pushLine(
            space.includes("\n")
              ? separatorWithWhitespace(ctx, fbt, words[0] ?? "", child, next)
              : "ws",
          );
        }
        let endWhitespace: string | undefined;
        if (words.at(-1) === "") {
          words.pop();
          endWhitespace = words.pop();
        }
        if (words.length === 0) continue;
        for (const [j, word] of words.entries()) {
          if (j % 2 === 1) pushLine("line");
          else {
            const anchor = pieceAt(child, offset);
            push(
              anchor !== undefined
                ? () => sToken(anchor, word)
                : () => sText(word),
            );
            lastWord = word;
          }
          offset += word.length;
        }
        if (endWhitespace !== undefined)
          pushLine(
            endWhitespace.includes("\n")
              ? separatorWithWhitespace(ctx, fbt, lastWord, child, next)
              : "ws",
          );
        else pushLine(separatorNoWhitespace(ctx, fbt, lastWord, child, next));
      } else if (raw.includes("\n")) {
        if ((raw.match(/\n/g) as RegExpMatchArray).length > 1)
          pushLine("hardline");
      } else pushLine("ws");
    } else {
      const node = child.node;
      push(capture(() => s.print(node)));
      if (next !== undefined && isMeaningfulText(next)) {
        const firstWord =
          (next.text as string)
            .replace(JSX_TRIM, "")
            .split(JSX_WHITESPACE)[0] ?? "";
        pushLine(separatorNoWhitespace(ctx, fbt, firstWord, child, next));
      } else pushLine("hardline");
    }
  }
  return parts;
}

/** Writes fill part `x`; `raw` writes the element's rawJsxWhitespace, `{" "}`. */
function writePart(x: FillPart, raw: () => void): void {
  switch (x) {
    case "line":
      sLine(0);
      return;
    case "softline":
      sLine(SOFT);
      return;
    case "hardline":
      sHardline();
      return;
    case "ws":
      within(IF_BROKEN, () => {
        raw();
        sLine(SOFT);
      });
      within(IF_FLAT, () => sText(" "));
      return;
    case "wsHard":
      raw();
      sHardline();
      return;
    default:
      for (const a of x) {
        if (typeof a === "function") a();
        else place(a);
      }
  }
}

/** Prettier's printJsxElementInternal. */
function sElementInternal(s: JsStreamCtx, n: number): void {
  const ctx = s.js;
  const open0 = field(ctx, n, "open_tag") as number;
  const close0 = field(ctx, n, "close_tag") as number;
  let children = jsxChildren(ctx, n);
  const only = children[0];
  if (
    children.length === 0 ||
    (children.length === 1 &&
      only?.text !== undefined &&
      !isMeaningfulText(only))
  ) {
    s.print(open0);
    s.print(close0);
    return;
  }

  const openingLines = capture(() => s.print(open0));
  const closingLines = capture(() => s.print(close0));

  if (
    only?.node !== undefined &&
    kind(ctx, only.node) === "jsx_expression" &&
    children.length === 1
  ) {
    const e = unparen(ctx, first(ctx, only.node) ?? only.node);
    if (kind(ctx, e) === "template_string" || isTaggedTemplate(ctx, e)) {
      place(openingLines);
      s.print(only.node);
      place(closingLines);
      return;
    }
  }

  children = children.map((c) =>
    c.node !== undefined && isWhitespaceExpression(ctx, c.node)
      ? { text: " ", pieces: [{ at: 0, node: c.node }] }
      : c,
  );

  const containsTag = children.some((c) => isJsx(ctx, c.node));
  const containsMultipleExpressions =
    children.filter(
      (c) =>
        c.node !== undefined &&
        kind(ctx, c.node) === "jsx_expression" &&
        kind(ctx, first(ctx, c.node)) !== "spread_element",
    ).length > 1;
  const containsMultipleAttributes =
    fields(ctx, open0, "attribute").length > 1;

  let forcedBreak =
    willBreak(openingLines) ||
    containsTag ||
    containsMultipleAttributes ||
    containsMultipleExpressions;

  const rawText = ctx.options.singleQuote ? "{' '}" : '{" "}';
  const raw = () => sToken(n, rawText, true);
  const name = field(ctx, open0, "name");
  const fbt =
    name !== undefined &&
    kind(ctx, name) === "identifier" &&
    src(ctx, name) === "fbt";

  const parts = printChildren(s, children, fbt);
  const containsText = children.some(isMeaningfulText);

  // Multiple whitespace elements can end up with empty content between them: drop the empty ones and the soft
  // lines before JSX whitespace.
  for (let i = parts.length - 2; i >= 0; i--) {
    const a = parts[i];
    const b = parts[i + 1];
    const c = parts[i + 2];
    const pairOfEmpty = isEmptyContent(a) && isEmptyContent(b);
    const pairOfHardlines =
      a === "hardline" && isEmptyContent(b) && c === "hardline";
    const lineThenWhitespace =
      (a === "softline" || a === "hardline") && isEmptyContent(b) && c === "ws";
    const whitespaceThenLine =
      a === "ws" && isEmptyContent(b) && (c === "softline" || c === "hardline");
    const doubleWhitespace = a === "ws" && isEmptyContent(b) && c === "ws";
    const hardAndSoft =
      (a === "softline" && isEmptyContent(b) && c === "hardline") ||
      (a === "hardline" && isEmptyContent(b) && c === "softline");
    if (
      (pairOfHardlines && containsText) ||
      pairOfEmpty ||
      lineThenWhitespace ||
      doubleWhitespace ||
      hardAndSoft
    )
      parts.splice(i, 2);
    else if (whitespaceThenLine) parts.splice(i + 1, 2);
  }

  while (parts.length > 0 && isEmptyOrAnyLine(parts.at(-1) as FillPart))
    parts.pop();
  while (
    parts.length > 1 &&
    isEmptyOrAnyLine(parts[0] as FillPart) &&
    isEmptyOrAnyLine(parts[1] as FillPart)
  ) {
    parts.shift();
    parts.shift();
  }

  // The children as printed when the element breaks: JSX whitespace that would land at a line's edge prints
  // as `{" "}`, keeping every separator at an odd index as fill needs.
  const multiline: FillPart[] = [[]];
  const append = (x: Content) =>
    multiline.push([...(multiline.pop() as Content), ...x]);
  for (const [i, child] of parts.entries()) {
    if (child === "ws") {
      if (i === 1 && isEmptyContent(parts[0])) {
        if (parts.length === 2) {
          append([raw]);
          continue;
        }
        multiline.push("wsHard", []);
        continue;
      }
      if (i === parts.length - 1) {
        append([raw]);
        continue;
      }
      if (isEmptyContent(parts[i - 1]) && parts[i - 2] === "hardline") {
        append([raw]);
        continue;
      }
    }
    if (i % 2 === 0) append(child as Content);
    else multiline.push(child, []);
    if (breaks(child)) forcedBreak = true;
  }

  const multiLineElem = () =>
    within(GROUP, () => {
      place(openingLines);
      within(INDENT, () => {
        sHardline();
        if (containsText) {
          open(FILL);
          for (const [i, x] of multiline.entries()) {
            if (i % 2 === 0) within(FILL_ITEM, () => writePart(x, raw));
            else writePart(x, raw);
          }
          close();
        } else
          within(
            GROUP,
            () => {
              for (const x of multiline) writePart(x, raw);
            },
            -1,
            BROKEN,
          );
      });
      sHardline();
      place(closingLines);
    });
  if (forcedBreak) {
    multiLineElem();
    return;
  }
  openChoice(false);
  openState();
  within(GROUP, () => {
    place(openingLines);
    for (const x of parts) writePart(x, raw);
    place(closingLines);
  });
  closeState();
  openState();
  multiLineElem();
  closeState();
  closeChoice();
}

const NO_WRAP_PARENTS = new Set([
  "array",
  "jsx_attribute",
  "jsx_element",
  "jsx_expression",
  "expression_statement",
  "new_expression",
  "call_expression",
  "ternary_expression",
]);

/** Prettier's shouldBreakJsxElement: the element an arrow returns inside a call inside a JSX container. */
function shouldBreakElement(ctx: JsCtx, n: number): boolean {
  const body = role(ctx, n);
  if (body.key !== "body" || kind(ctx, body.parent) !== "arrow_function")
    return false;
  const arg = role(ctx, body.parent as number);
  if (arg.key !== "arguments" || kind(ctx, arg.parent) !== "call_expression")
    return false;
  return kind(ctx, role(ctx, arg.parent as number).parent) === "jsx_expression";
}

/** Prettier's printJsxOpeningElement; a self-closing element is its own opening element. */
function sOpening(s: JsStreamCtx, n: number, selfClosing: boolean): void {
  const ctx = s.js;
  const name = field(ctx, n, "name");
  if (name === undefined) {
    sFragmentTag(s, n, true);
    return;
  }
  const typeArgs = field(ctx, n, "type_arguments");
  const attributes = fields(ctx, n, "attribute");
  const nameHasComments = hasComment(ctx, name) || hasComment(ctx, typeArgs);
  const head = () => {
    tokOf(ctx, anon(ctx, n, "<"));
    sName(s, name);
    if (typeArgs !== undefined) s.print(typeArgs);
  };
  const end = lastChildWhere(ctx, n, (c) => {
    const k = kind(ctx, c);
    return !named(ctx, c) && (k === ">" || k === "/>");
  });
  const closeTag = () => tokOf(ctx, end);

  if (selfClosing && attributes.length === 0 && !nameHasComments) {
    head();
    sText(" ");
    closeTag();
    return;
  }

  const only = attributes[0];
  const onlyValue =
    only !== undefined && kind(ctx, only) === "jsx_attribute"
      ? attrValue(ctx, only)
      : undefined;
  if (
    only !== undefined &&
    attributes.length === 1 &&
    kind(ctx, only) === "jsx_attribute" &&
    isAttrString(ctx, onlyValue) &&
    !hasNewlineIn(ctx, onlyValue as number) &&
    !nameHasComments &&
    !hasComment(ctx, only)
  ) {
    within(GROUP, () => {
      head();
      sText(" ");
      s.print(only);
      if (selfClosing) sText(" ");
      closeTag();
    });
    return;
  }

  const shouldBreak = attributes.some((a) => {
    const v = kind(ctx, a) === "jsx_attribute" ? attrValue(ctx, a) : undefined;
    return isAttrString(ctx, v) && hasNewlineIn(ctx, v as number);
  });
  const options = ctx.options as JsxOptions;
  const hardAttributeLine =
    options.singleAttributePerLine === true && attributes.length > 1;

  open(GROUP, -1, shouldBreak ? BROKEN : 0);
  head();
  within(INDENT, () => {
    attributes.forEach((a, i) => {
      const previous = attributes[i - 1];
      if (previous !== undefined && nextLineEmpty(ctx.tree, previous)) {
        sHardline();
        sHardline();
      } else if (hardAttributeLine) sHardline();
      else sLine(0);
      s.print(a);
    });
  });
  if (selfClosing) sLine(0);
  else if (!bracketSameLine(ctx, attributes, nameHasComments)) sLine(SOFT);
  closeTag();
  close();
}

/**
 * Prettier's printJsxElement with maybeWrapJsxElementInParens: `inner` between the element's own comments (see
 * `printsOwnComments` in fmt.ts), so they sit inside the parentheses.
 */
function sElement(s: JsStreamCtx, n: number, inner: () => void): void {
  const ctx = s.js;
  const elem = () => withComments(s, n, inner);
  const parent = role(ctx, n).parent;
  if (parent === undefined || NO_WRAP_PARENTS.has(kind(ctx, parent))) {
    elem();
    return;
  }
  const parens = needsParens(n, ctx);
  open(GROUP, -1, shouldBreakElement(ctx, n) ? BROKEN : 0);
  if (!parens) within(IF_BROKEN, () => sToken(n, "(", true));
  within(INDENT, () => {
    sLine(SOFT);
    elem();
  });
  sLine(SOFT);
  if (!parens) within(IF_BROKEN, () => sToken(n, ")", true));
  close();
}

function bracketSameLine(
  ctx: JsCtx,
  attributes: readonly number[],
  nameHasComments: boolean,
): boolean {
  if (attributes.length === 0 && !nameHasComments) return true;
  const options = ctx.options as JsxOptions;
  const lastHasTrailing = hasComment(ctx, attributes.at(-1), CF.Trailing);
  return (
    (options.bracketSameLine || options.jsxBracketSameLine === true) &&
    (!nameHasComments || attributes.length > 0) &&
    !lastHasTrailing
  );
}

/** An attribute's value: its named child after the `=`; none without one. */
function attrValue(ctx: JsCtx, a: number): number | undefined {
  const eq = anon(ctx, a, "=");
  if (eq === undefined) return undefined;
  const after = ctx.tree.ord(eq);
  return childWhere(
    ctx,
    a,
    (c) => named(ctx, c) && !isComment(ctx, c) && ctx.tree.ord(c) > after,
  );
}

const isAttrString = (x: HasTree, v: number | undefined) =>
  kind(x, v) === "string";

/** `c` as the source token it is; nothing when absent. */
const tokOf = (ctx: JsCtx, c: number | undefined) => {
  if (c !== undefined) sToken(c, src(ctx, c));
};

/** What `fn` writes inside an interval of `kind`. */
function within(kind: number, fn: () => void, ref = -1, flags = 0): void {
  open(kind, ref, flags);
  fn();
  close();
}

/** A tag's name as prettier's JSXIdentifier, JSXMemberExpression or JSXNamespacedName: never broken. */
const sName = (s: JsStreamCtx, name: number | undefined) => {
  if (name !== undefined) withComments(s, name, () => tokOf(s.js, name));
};

/** Prettier's printJsxClosingElement. */
const closing: CustomRule<JsOptions> = (n, sctx) => {
  const s = jsCtx(sctx);
  const ctx = s.js;
  const name = field(ctx, n, "name");
  if (name === undefined) {
    sFragmentTag(s, n, false);
    return;
  }
  tokOf(ctx, anon(ctx, n, "</"));
  if (hasComment(ctx, name, CF.Leading | CF.Line)) {
    within(INDENT, () => {
      sHardline();
      sName(s, name);
    });
    sHardline();
  } else {
    if (hasComment(ctx, name, CF.Leading | CF.Block)) sText(" ");
    sName(s, name);
  }
  tokOf(ctx, anon(ctx, n, ">"));
};

/** `n`'s dangling comments, one per line. */
function sDangling(s: JsStreamCtx, n: number): void {
  s.danglingComments(n).forEach((c, i) => {
    if (i > 0) sHardline();
    s.comment(c);
  });
}

/** Prettier's printJsxOpeningClosingFragment over the sink: `<>` or `</>` with the comments inside it. */
function sFragmentTag(s: JsStreamCtx, n: number, opening: boolean): void {
  const ctx = s.js;
  const dangling = s.danglingComments(n);
  const hasOwnLine = dangling.some((c) => s.isLineComment(c));
  tokOf(ctx, anon(ctx, n, opening ? "<" : "</"));
  within(INDENT, () => {
    if (hasOwnLine) sHardline();
    else if (dangling.length > 0 && !opening) sText(" ");
    sDangling(s, n);
  });
  if (hasOwnLine) sHardline();
  tokOf(
    ctx,
    lastChildWhere(ctx, n, (c) => !named(ctx, c) && kind(ctx, c) === ">"),
  );
}

/** Prettier's printJsxExpressionContainer, printJsxEmptyExpression and printJsxSpreadAttributeOrChild. */
const expression: CustomRule<JsOptions> = (n, sctx) => {
  const s = jsCtx(sctx);
  const ctx = s.js;
  const openBrace = () => tokOf(ctx, anon(ctx, n, "{"));
  const closeBrace = () =>
    tokOf(
      ctx,
      lastChildWhere(ctx, n, (c) => !named(ctx, c) && kind(ctx, c) === "}"),
    );
  const e = first(ctx, n);
  if (e === undefined) {
    const lineComment = s.danglingComments(n).some((c) => s.isLineComment(c));
    within(GROUP, () => {
      openBrace();
      if (lineComment) {
        within(INDENT, () => {
          sHardline();
          sDangling(s, n);
        });
        sHardline();
      } else sDangling(s, n);
      sLineSuffixBoundary();
      closeBrace();
    });
    return;
  }
  if (kind(ctx, e) === "spread_element") {
    // Prettier's printJsxSpreadAttributeOrChild: the argument's comments go around `...`, and a commented
    // spread goes on its own lines inside the braces once anything breaks.
    const arg = first(ctx, e);
    const spread = () => {
      if (arg === undefined) s.print(e);
      else
        withComments(s, e, () =>
          withComments(s, arg, () => {
            tokOf(ctx, anon(ctx, e, "..."));
            s.print(arg);
          }),
        );
    };
    openBrace();
    if (!hasComment(ctx, e) && !hasComment(ctx, arg)) spread();
    else {
      within(INDENT, () => {
        sLine(SOFT);
        spread();
      });
      sLine(SOFT);
    }
    closeBrace();
    return;
  }
  const inline = shouldInline(ctx, unparen(ctx, e), parentOf(ctx, n));
  within(GROUP, () => {
    openBrace();
    if (inline) s.print(e);
    else {
      within(INDENT, () => {
        sLine(SOFT);
        s.print(e);
      });
      sLine(SOFT);
    }
    sLineSuffixBoundary();
    closeBrace();
  });
};

function shouldInline(
  ctx: JsCtx,
  e: number,
  parent: number | undefined,
): boolean {
  if (hasComment(ctx, e)) return false;
  switch (kind(ctx, e)) {
    case "array":
    case "object":
    case "arrow_function":
    case "function_expression":
    case "generator_function":
    case "template_string":
      return true;
    case "call_expression":
      return true;
    case "await_expression": {
      const arg = first(ctx, e);
      return (
        arg !== undefined &&
        (isJsx(ctx, unparen(ctx, arg)) ||
          shouldInline(ctx, unparen(ctx, arg), e))
      );
    }
    case "ternary_expression":
    case "binary_expression":
      return kind(ctx, parent) === "jsx_element";
    default:
      return false;
  }
}

/** A JSX spread's argument, whose comments `expression` prints around the `...` (even when ignored). */
export function isJsxSpreadArgument(x: HasTree, n: number): boolean {
  const spread = parentOf(x, n);
  return (
    spread !== undefined &&
    kind(x, spread) === "spread_element" &&
    kind(x, parentOf(x, spread)) === "jsx_expression" &&
    first(x, spread) === n
  );
}

/** Prettier's hasJsxIgnoreComment: a child element right after `{/* prettier-ignore *\/}` keeps its source text. */
export function jsxIgnored(
  ctx: JsCtx,
  n: number,
  isIgnore: (c: number) => boolean,
): boolean {
  const element = parentOf(ctx, n);
  if (
    !isJsx(ctx, n) ||
    element === undefined ||
    kind(ctx, element) !== "jsx_element"
  )
    return false;
  const siblings = childrenOf(ctx, element);
  let previous: number | undefined;
  for (let i = siblings.indexOf(n) - 1; i >= 0; i--) {
    const c = siblings[i] as number;
    if (!named(ctx, c)) continue;
    if (
      kind(ctx, c) === "jsx_text" &&
      /^[ \n\r\t]*\n[ \n\r\t]*$/.test(src(ctx, c))
    )
      continue;
    previous = c;
    break;
  }
  return (
    previous !== undefined &&
    kind(ctx, previous) === "jsx_expression" &&
    first(ctx, previous) === undefined &&
    ctx.comments(previous).dangling.some(isIgnore)
  );
}

/** The customs format/jsx.ts names, by the names its spec gives them. */
export const jsxCustoms = {
  jsxClosing: closing,
  jsxExpression: expression,
  jsxElement: (n, sctx) => {
    const s = jsCtx(sctx);
    sElement(s, n, () => sElementInternal(s, n));
  },
  jsxOpening: (n, sctx) => sOpening(jsCtx(sctx), n, false),
  jsxSelfClosing: (n, sctx) => {
    const s = jsCtx(sctx);
    sElement(s, n, () => sOpening(s, n, true));
  },
} satisfies Record<string, CustomRule<JsOptions>>;
