// Prettier's JSX printer (print/jsx.js, 3.9.9). Babel's JSXText is the source between two non-text children,
// character references included; tree-sitter splits it into `jsx_text` and `html_character_reference` nodes and
// drops a blank run that holds a line break, so `jsxChildren` rebuilds it from those nodes and the gaps between.

import {
  conditionalGroup,
  type Doc,
  fill,
  group,
  hardline,
  ifBreak,
  indent,
  isDocs,
  join,
  line,
  lineSuffixBoundary,
  literalToken,
  softline,
  synthetic,
  text,
  token,
  willBreak,
} from "../../../fmt/doc.js";
import { hasNewlineInRange, isNextLineEmpty } from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { preferredQuote } from "./literals.js";
import { needsParens, role } from "./parens.js";
import {
  anon,
  CF,
  danglingComments,
  field,
  fields,
  first,
  hasComment,
  hasNewlineIn,
  isComment,
  isJsx,
  isTaggedTemplate,
  type JsCtx,
  type JsOptions,
  type JsRule,
  p,
  src,
  t,
  unparen,
} from "./util.js";

/** Options prettier's JSX printer reads that the rest of the JS printer does not. */
type JsxOptions = JsOptions & {
  singleAttributePerLine?: boolean;
  jsxBracketSameLine?: boolean;
};

/** Prettier's `""` in a list of fill parts: the identity the separator clean-up compares against. */
const EMPTY: Doc = [];

/** One of Babel's JSX children: a JSXText (its raw text and the tree nodes it came from) or any other node. */
type Child =
  | { text: string; pieces: readonly Piece[]; node?: undefined }
  | { node: FormatNode; text?: undefined };
/** A source node inside a JSXText, at `at` in its text. */
interface Piece {
  at: number;
  node: FormatNode;
}

const isTextPiece = (n: FormatNode) =>
  n.kind === "jsx_text" || n.kind === "html_character_reference";

/** The source between `from` and `to`, which tree-sitter keeps no node for: blank, reduced to what JSX reads. */
function gap(ctx: JsCtx, from: number, to: number): string {
  if (from >= to) return "";
  if (!hasNewlineInRange(ctx.source, from, to)) return " ";
  return isNextLineEmpty(ctx.source, from) ? "\n\n" : "\n";
}

/** The children of a jsx_element as Babel lists them. */
function jsxChildren(ctx: JsCtx, n: FormatNode): Child[] {
  const open = field(n, "open_tag");
  const close = field(n, "close_tag");
  const out: Child[] = [];
  let at = open ? open.end : n.start;
  let raw = "";
  let pieces: Piece[] = [];
  const flush = () => {
    if (raw !== "") out.push({ text: raw, pieces });
    raw = "";
    pieces = [];
  };
  for (const c of n.children) {
    if (c === open || c === close) continue;
    raw += gap(ctx, at, c.start);
    at = c.end;
    if (isTextPiece(c)) {
      pieces.push({ at: raw.length, node: c });
      raw += src(ctx, c);
    } else {
      flush();
      out.push({ node: c });
    }
  }
  raw += gap(ctx, at, close ? close.start : n.end);
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
function isWhitespaceExpression(ctx: JsCtx, n: FormatNode): boolean {
  if (n.kind !== "jsx_expression") return false;
  const e = first(n);
  return (
    e?.kind === "string" &&
    src(ctx, e).slice(1, -1) === " " &&
    !hasComment(ctx, e)
  );
}

const isSelfClosing = (n: FormatNode | undefined) =>
  n?.kind === "jsx_self_closing_element";

const isEmptyish = (doc: Doc) =>
  doc === EMPTY || (isDocs(doc) && doc.length === 0);

const isEmptyOrAnyLine = (doc: Doc) =>
  doc === EMPTY || doc === line || doc === hardline || doc === softline;

function separatorNoWhitespace(
  fbt: boolean,
  word: string,
  child: Child,
  next: Child | undefined,
): Doc {
  if (fbt) return EMPTY;
  if (isSelfClosing(child.node) || isSelfClosing(next?.node))
    return word.length === 1 ? softline : hardline;
  return softline;
}

function separatorWithWhitespace(
  fbt: boolean,
  word: string,
  child: Child,
  next: Child | undefined,
): Doc {
  if (fbt) return hardline;
  if (word.length === 1)
    return isSelfClosing(child.node) || isSelfClosing(next?.node)
      ? hardline
      : softline;
  return hardline;
}

/** The node a word of a JSXText starts in, for its token to point at. */
function pieceAt(child: Child & { text: string }, at: number): FormatNode {
  let node = child.pieces[0]?.node as FormatNode;
  for (const piece of child.pieces) {
    if (piece.at > at) break;
    node = piece.node;
  }
  return node;
}

/** Prettier's printJsxChildren: fill parts, content at even indexes and separators at odd ones. */
function printChildren(
  ctx: JsCtx,
  children: readonly Child[],
  whitespace: Doc,
  fbt: boolean,
): Doc[] {
  const parts: Doc[] = [EMPTY];
  const push = (doc: Doc) => {
    parts.push([parts.pop() as Doc, doc]);
  };
  const pushLine = (doc: Doc) => {
    if (doc === EMPTY) return;
    parts.push(doc, EMPTY);
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
              ? separatorWithWhitespace(fbt, words[0] ?? "", child, next)
              : whitespace,
          );
        }
        let endWhitespace: string | undefined;
        if (words.at(-1) === "") {
          words.pop();
          endWhitespace = words.pop();
        }
        if (words.length === 0) continue;
        for (const [j, word] of words.entries()) {
          if (j % 2 === 1) pushLine(line);
          else {
            const anchor = pieceAt(child, offset);
            push(anchor ? token(anchor, word) : text(word));
            lastWord = word;
          }
          offset += word.length;
        }
        if (endWhitespace !== undefined)
          pushLine(
            endWhitespace.includes("\n")
              ? separatorWithWhitespace(fbt, lastWord, child, next)
              : whitespace,
          );
        else pushLine(separatorNoWhitespace(fbt, lastWord, child, next));
      } else if (raw.includes("\n")) {
        if ((raw.match(/\n/g) as RegExpMatchArray).length > 1)
          pushLine(hardline);
      } else pushLine(whitespace);
    } else {
      push(p(ctx, child.node));
      if (next !== undefined && isMeaningfulText(next)) {
        const firstWord =
          (next.text as string)
            .replace(JSX_TRIM, "")
            .split(JSX_WHITESPACE)[0] ?? "";
        pushLine(separatorNoWhitespace(fbt, firstWord, child, next));
      } else pushLine(hardline);
    }
  }
  return parts;
}

/** Prettier's printJsxElementInternal. */
function printElementInternal(n: FormatNode, ctx: JsCtx): Doc {
  if (isSelfClosing(n)) return printOpening(n, ctx, true);
  const open = field(n, "open_tag") as FormatNode;
  const close = field(n, "close_tag") as FormatNode;
  let children = jsxChildren(ctx, n);
  const only = children[0];
  if (
    children.length === 0 ||
    (children.length === 1 &&
      only?.text !== undefined &&
      !isMeaningfulText(only))
  )
    return [p(ctx, open), p(ctx, close)];

  const openingLines = p(ctx, open);
  const closingLines = p(ctx, close);

  if (only?.node?.kind === "jsx_expression" && children.length === 1) {
    const e = unparen(first(only.node) ?? only.node);
    if (e.kind === "template_string" || isTaggedTemplate(e))
      return [openingLines, p(ctx, only.node), closingLines];
  }

  children = children.map((c) =>
    c.node && isWhitespaceExpression(ctx, c.node)
      ? { text: " ", pieces: [{ at: 0, node: c.node }] }
      : c,
  );

  const containsTag = children.some((c) => isJsx(c.node));
  const containsMultipleExpressions =
    children.filter(
      (c) =>
        c.node?.kind === "jsx_expression" &&
        first(c.node)?.kind !== "spread_element",
    ).length > 1;
  const containsMultipleAttributes = fields(open, "attribute").length > 1;

  let forcedBreak =
    willBreak(openingLines) ||
    containsTag ||
    containsMultipleAttributes ||
    containsMultipleExpressions;

  const rawWhitespace = synthetic(
    n,
    ctx.options.singleQuote ? "{' '}" : '{" "}',
  );
  const whitespace = ifBreak([rawWhitespace, softline], text(" "));
  const name = field(open, "name");
  const fbt = name?.kind === "identifier" && src(ctx, name) === "fbt";

  const parts = printChildren(ctx, children, whitespace, fbt);
  const containsText = children.some(isMeaningfulText);

  // Multiple whitespace elements can end up with empty content between them: drop the empty ones and the soft
  // lines before JSX whitespace.
  for (let i = parts.length - 2; i >= 0; i--) {
    const a = parts[i];
    const b = parts[i + 1];
    const c = parts[i + 2];
    const pairOfEmpty = a === EMPTY && b === EMPTY;
    const pairOfHardlines = a === hardline && b === EMPTY && c === hardline;
    const lineThenWhitespace =
      (a === softline || a === hardline) && b === EMPTY && c === whitespace;
    const whitespaceThenLine =
      a === whitespace && b === EMPTY && (c === softline || c === hardline);
    const doubleWhitespace =
      a === whitespace && b === EMPTY && c === whitespace;
    const hardAndSoft =
      (a === softline && b === EMPTY && c === hardline) ||
      (a === hardline && b === EMPTY && c === softline);
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

  while (parts.length > 0 && isEmptyOrAnyLine(parts.at(-1) as Doc)) parts.pop();
  while (
    parts.length > 1 &&
    isEmptyOrAnyLine(parts[0] as Doc) &&
    isEmptyOrAnyLine(parts[1] as Doc)
  ) {
    parts.shift();
    parts.shift();
  }

  // The children as printed when the element breaks: JSX whitespace that would land at a line's edge prints
  // as `{" "}`, keeping every separator at an odd index as fill needs.
  const multiline: Doc[] = [EMPTY];
  const append = (doc: Doc) => multiline.push([multiline.pop() as Doc, doc]);
  for (const [i, child] of parts.entries()) {
    if (child === whitespace) {
      if (i === 1 && isEmptyish(parts[0] as Doc)) {
        if (parts.length === 2) {
          append(rawWhitespace);
          continue;
        }
        multiline.push([rawWhitespace, hardline], EMPTY);
        continue;
      }
      if (i === parts.length - 1) {
        append(rawWhitespace);
        continue;
      }
      if (parts[i - 1] === EMPTY && parts[i - 2] === hardline) {
        append(rawWhitespace);
        continue;
      }
    }
    if (i % 2 === 0) append(child);
    else multiline.push(child, EMPTY);
    if (willBreak(child)) forcedBreak = true;
  }

  const content = containsText ? fill(multiline) : group(multiline, true);
  const multiLineElem = group([
    openingLines,
    indent([hardline, content]),
    hardline,
    closingLines,
  ]);
  if (forcedBreak) return multiLineElem;
  return conditionalGroup([
    group([openingLines, ...parts, closingLines]),
    multiLineElem,
  ]);
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
function shouldBreakElement(n: FormatNode): boolean {
  const body = role(n);
  if (body.key !== "body" || body.parent?.kind !== "arrow_function")
    return false;
  const arg = role(body.parent);
  if (arg.key !== "arguments" || arg.parent?.kind !== "call_expression")
    return false;
  return role(arg.parent).parent?.kind === "jsx_expression";
}

/** Prettier's printJsxElement with maybeWrapJsxElementInParens. */
/** Prints its own comments (see `printsOwnComments` in fmt.ts), so they sit inside the parentheses. */
const element: JsRule = (n, ctx) => {
  const elem = ctx.withComments(n, printElementInternal(n, ctx));
  const parent = role(n).parent;
  if (!parent || NO_WRAP_PARENTS.has(parent.kind)) return elem;
  const parens = needsParens(n, ctx);
  return group(
    [
      parens ? [] : ifBreak(synthetic(n, "(")),
      indent([softline, elem]),
      softline,
      parens ? [] : ifBreak(synthetic(n, ")")),
    ],
    shouldBreakElement(n),
  );
};

/** A tag's name as prettier's JSXIdentifier, JSXMemberExpression or JSXNamespacedName: never broken. */
const printName = (ctx: JsCtx, name: FormatNode | undefined): Doc =>
  name ? ctx.withComments(name, token(name, src(ctx, name))) : [];

/** Prettier's printJsxOpeningElement; a self-closing element is its own opening element. */
function printOpening(n: FormatNode, ctx: JsCtx, selfClosing: boolean): Doc {
  const name = field(n, "name");
  if (!name) return printFragmentTag(n, ctx, true);
  const typeArgs = field(n, "type_arguments");
  const attributes = fields(n, "attribute");
  const nameHasComments = hasComment(ctx, name) || hasComment(ctx, typeArgs);
  const lt = t(ctx, anon(n, "<"));
  const head: Doc = [lt, printName(ctx, name), p(ctx, typeArgs)];
  const end = n.children.findLast(
    (c) => !c.named && (c.kind === ">" || c.kind === "/>"),
  );
  const closeTag: Doc = t(ctx, end);

  if (selfClosing && attributes.length === 0 && !nameHasComments)
    return [head, text(" "), closeTag];

  const only = attributes[0];
  const onlyValue =
    only?.kind === "jsx_attribute" ? attrValue(only) : undefined;
  if (
    attributes.length === 1 &&
    only?.kind === "jsx_attribute" &&
    isAttrString(onlyValue) &&
    !hasNewlineIn(ctx, onlyValue as FormatNode) &&
    !nameHasComments &&
    !hasComment(ctx, only)
  )
    return group([
      head,
      text(" "),
      p(ctx, only),
      selfClosing ? [text(" "), closeTag] : closeTag,
    ]);

  const shouldBreak = attributes.some((a) => {
    const v = a.kind === "jsx_attribute" ? attrValue(a) : undefined;
    return isAttrString(v) && hasNewlineIn(ctx, v as FormatNode);
  });
  const options = ctx.options as JsxOptions;
  const attributeLine =
    options.singleAttributePerLine && attributes.length > 1 ? hardline : line;

  let tail: Doc;
  if (selfClosing) tail = [line, closeTag];
  else if (bracketSameLine(ctx, attributes, nameHasComments)) tail = closeTag;
  else tail = [softline, closeTag];

  return group(
    [
      head,
      indent(
        attributes.map((a, i) => {
          const previous = attributes[i - 1];
          const sep =
            previous && isNextLineEmpty(ctx.source, previous.end)
              ? [hardline, hardline]
              : attributeLine;
          return [sep, p(ctx, a)];
        }),
      ),
      tail,
    ],
    shouldBreak,
  );
}

function bracketSameLine(
  ctx: JsCtx,
  attributes: readonly FormatNode[],
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

const attrValue = (a: FormatNode) =>
  a.children.find(
    (c) => c.named && !isComment(c) && c.start > (anon(a, "=")?.start ?? a.end),
  );

const isAttrString = (v: FormatNode | undefined) => v?.kind === "string";

/** Prettier's printJsxAttribute: a string value requoted by `jsxSingleQuote`, its quotes as entities. */
const attribute: JsRule = (n, ctx) => {
  const eq = anon(n, "=");
  const name = n.children.find(
    (c) => c.named && !isComment(c) && (!eq || c.end <= eq.start),
  );
  const value = eq ? attrValue(n) : undefined;
  const parts: Doc[] = [p(ctx, name)];
  if (eq && value) {
    let res: Doc;
    if (isAttrString(value)) {
      const raw = src(ctx, value)
        .slice(1, -1)
        .replaceAll("&apos;", "'")
        .replaceAll("&quot;", '"');
      const quote = preferredQuote(raw, ctx.options.jsxSingleQuote);
      const escaped =
        quote === '"'
          ? raw.replaceAll('"', "&quot;")
          : raw.replaceAll("'", "&apos;");
      res = ctx.withComments(
        value,
        literalToken(value, quote + escaped + quote),
      );
    } else res = p(ctx, value);
    parts.push(t(ctx, eq), res);
  }
  return parts;
};

/** Prettier's printJsxClosingElement. */
const closing: JsRule = (n, ctx) => {
  const name = field(n, "name");
  if (!name) return printFragmentTag(n, ctx, false);
  const printed = printName(ctx, name);
  let middle: Doc = printed;
  if (hasComment(ctx, name, CF.Leading | CF.Line))
    middle = [indent([hardline, printed]), hardline];
  else if (hasComment(ctx, name, CF.Leading | CF.Block))
    middle = [text(" "), printed];
  return [t(ctx, anon(n, "</")), middle, t(ctx, anon(n, ">"))];
};

/** Prettier's printJsxOpeningClosingFragment: `<>` or `</>` with the comments inside it. */
function printFragmentTag(n: FormatNode, ctx: JsCtx, opening: boolean): Doc {
  const dangling = ctx.comments(n).dangling;
  const hasOwnLine = dangling.some((c) => ctx.isLineComment(c));
  const lead = hasOwnLine
    ? hardline
    : dangling.length > 0 && !opening
      ? text(" ")
      : [];
  return [
    t(ctx, anon(n, opening ? "<" : "</")),
    indent([lead, join(hardline, ctx.dangling(n))]),
    hasOwnLine ? hardline : [],
    t(
      ctx,
      n.children.findLast((c) => !c.named && c.kind === ">"),
    ),
  ];
}

/** Prettier's printJsxExpressionContainer, printJsxEmptyExpression and printJsxSpreadAttributeOrChild. */
const expression: JsRule = (n, ctx) => {
  const open = t(ctx, anon(n, "{"));
  const close = t(
    ctx,
    n.children.findLast((c) => !c.named && c.kind === "}"),
  );
  const e = first(n);
  if (!e) {
    const lineComment = ctx
      .comments(n)
      .dangling.some((c) => ctx.isLineComment(c));
    return group([
      open,
      danglingComments(ctx, n, lineComment),
      lineComment ? hardline : [],
      lineSuffixBoundary,
      close,
    ]);
  }
  if (e.kind === "spread_element") {
    // Prettier's printJsxSpreadAttributeOrChild: the argument's comments go around `...`, and a commented
    // spread goes on its own lines inside the braces once anything breaks.
    const arg = first(e);
    const spread = arg
      ? ctx.withComments(
          e,
          ctx.withComments(arg, [t(ctx, anon(e, "...")), p(ctx, arg)]),
        )
      : p(ctx, e);
    if (!hasComment(ctx, e) && !hasComment(ctx, arg))
      return [open, spread, close];
    return [open, indent([softline, spread]), softline, close];
  }
  if (shouldInline(ctx, unparen(e), n.parent))
    return group([open, p(ctx, e), lineSuffixBoundary, close]);
  return group([
    open,
    indent([softline, p(ctx, e)]),
    softline,
    lineSuffixBoundary,
    close,
  ]);
};

function shouldInline(
  ctx: JsCtx,
  e: FormatNode,
  parent: FormatNode | undefined,
): boolean {
  if (hasComment(ctx, e)) return false;
  switch (e.kind) {
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
      const arg = first(e);
      return (
        arg !== undefined &&
        (isJsx(unparen(arg)) || shouldInline(ctx, unparen(arg), e))
      );
    }
    case "ternary_expression":
    case "binary_expression":
      return parent?.kind === "jsx_element";
    default:
      return false;
  }
}

/** A JSX spread's argument, whose comments `expression` prints around the `...` (even when ignored). */
export const isJsxSpreadArgument = (n: FormatNode) =>
  n.parent?.kind === "spread_element" &&
  n.parent.parent?.kind === "jsx_expression" &&
  first(n.parent) === n;

/** Prettier's hasJsxIgnoreComment: a child element right after `{/* prettier-ignore *\/}` keeps its source text. */
export function jsxIgnored(
  ctx: JsCtx,
  n: FormatNode,
  isIgnore: (c: FormatNode) => boolean,
): boolean {
  if (!isJsx(n) || n.parent?.kind !== "jsx_element") return false;
  const siblings = n.parent.children;
  let previous: FormatNode | undefined;
  for (let i = siblings.indexOf(n) - 1; i >= 0; i--) {
    const c = siblings[i] as FormatNode;
    if (!c.named) continue;
    if (c.kind === "jsx_text" && /^[ \n\r\t]*\n[ \n\r\t]*$/.test(src(ctx, c)))
      continue;
    previous = c;
    break;
  }
  return (
    previous?.kind === "jsx_expression" &&
    !first(previous) &&
    ctx.comments(previous).dangling.some(isIgnore)
  );
}

export const jsxRules: Record<string, JsRule> = {
  jsx_element: element,
  jsx_self_closing_element: element,
  jsx_opening_element: (n, ctx) => printOpening(n, ctx, false),
  jsx_closing_element: closing,
  jsx_attribute: attribute,
  jsx_expression: expression,
};
