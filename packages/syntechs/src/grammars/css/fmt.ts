import { NO_NODE, type Tree } from "../../core/arena.js";
import { decimalValue, type Normalize } from "../../fmt/check.js";
import {
  type Doc,
  fill,
  group,
  hardline,
  indent,
  join,
  line,
  softline,
  synthetic,
  text,
  token,
} from "../../fmt/doc.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import { type Ctx, defineLanguage, type Rule } from "../../fmt/rules.js";
import {
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  INDENT,
  open,
  SOFT,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../../fmt/stream.js";
import {
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
  type StreamRule,
} from "../../fmt/stream-format.js";
import { newlineBetween, nextLineEmpty } from "../../fmt/text.js";
import { type FormatTree, firstLeaf, nextLeaf } from "../../fmt/tree.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";

/** The prettier options its postcss printer reads (3.9.9); `bracketSpacing` and `objectWrap` go unread. */
export interface CssOptions extends PrettierOptions {
  singleQuote: boolean;
}

const defaults: CssOptions = { ...prettierDefaults, singleQuote: false };

/** What a helper reads of either context: the tree. */
type Tr = { readonly tree: FormatTree };

const src = (n: number, ctx: Tr) => ctx.tree.text(n);
const kind = (n: number, ctx: Tr) => ctx.tree.kindName(n);
const verbatim = (n: number, ctx: Ctx) => token(n, src(n, ctx));
const children = (n: number, tree: FormatTree) => {
  const out: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++)
    out.push(tree.child(n, i));
  return out;
};
const isComment = (n: number, ctx: Tr) =>
  kind(n, ctx) === "comment" || kind(n, ctx) === "js_comment";
/** Every child but comments, which reach the output attached to their neighbours. */
const code = (n: number, ctx: Tr) =>
  children(n, ctx.tree).filter((c) => !isComment(c, ctx));
const anon = (n: number, k: string, ctx: Tr) =>
  children(n, ctx.tree).find((c) => !ctx.tree.named(c) && kind(c, ctx) === k);
const childOfKind = (n: number, k: string, ctx: Tr) =>
  children(n, ctx.tree).find((c) => kind(c, ctx) === k);
/** Whether the source wrote anything, even whitespace, between `a` and the later `b`. */
const apart = (a: number, b: number, ctx: Tr) => !ctx.tree.adjoins(a, b);
/** Whether a line break lies between the end of `a` and the start of the later `b`. */
function breaksBetween(a: number, b: number, ctx: Tr): boolean {
  const after = nextLeaf(ctx.tree, a);
  return (
    ctx.tree.lf(after) > 0 ||
    newlineBetween(ctx.tree, after, firstLeaf(ctx.tree, b))
  );
}

// Prettier lowercases a name unless it could be a preprocessor's or a custom one (utils `maybeToLowerCase`).
const maybeLower = (t: string) =>
  /[$@#]/.test(t) ||
  t.startsWith("%") ||
  t.startsWith("--") ||
  t.startsWith(":--") ||
  (t.includes("(") && t.includes(")"))
    ? t
    : t.toLowerCase();
const atName = (t: string) => `@${maybeLower(t.slice(1))}`;
const cssWideKeywords = new Set(["initial", "inherit", "unset", "revert"]);

// Prettier's `printCssNumber` and unit table (utils/print-number.js, print-unit.js).
const printNumber = (raw: string) =>
  (raw.length === 1
    ? raw
    : raw
        .toLowerCase()
        .replace(/^([+-]?[\d.]+e)(?:\+|(-))?0*(?=\d)/, "$1$2")
        .replace(/^([+-]?[\d.]+)e[+-]?0+$/, "$1")
        .replace(/^([+-])?\./, "$10.")
        .replace(/(\.\d+?)0+(?=e|$)/, "$1")
        .replace(/\.(?=e|$)/, "")
  ).replace(/\.0(?=$|e)/, "");
const units = new Map(
  (
    "em rem ex rex cap rcap ch rch ic ric lh rlh vw svw lvw dvw vh svh lvh dvh vi svi lvi dvi vb svb lvb dvb " +
    "vmin svmin lvmin dvmin vmax svmax lvmax dvmax cm mm Q in pt pc px deg grad rad turn s ms Hz kHz dpi dpcm " +
    "dppx x cqw cqh cqi cqb cqmin cqmax fr"
  )
    .split(" ")
    .map((u) => [u.toLowerCase(), u]),
);
const numberParts = /^([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)([a-z]*)(.*)$/is;
function printDimension(t: string): string {
  const m = numberParts.exec(t);
  if (!m) return t;
  const [, num = "", unit = "", rest = ""] = m;
  const lower = unit.toLowerCase();
  if (unit !== "" && lower !== "n" && !units.has(lower)) return t;
  return printNumber(num) + (units.get(lower) ?? unit) + rest;
}

// A CSS string's value: its escapes resolved (css-syntax-3 §4.3.7), so a requoted string compares equal.
const cook = (quoted: string) =>
  quoted
    .slice(1, -1)
    .replace(
      /\\(?:\r\n|[\n\r\f])|\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([\s\S])/g,
      (_, hex: string | undefined, ch: string | undefined) => {
        if (hex === undefined) return ch ?? "";
        const cp = Number.parseInt(hex, 16);
        return String.fromCodePoint(cp > 0x10ffff || cp === 0 ? 0xfffd : cp);
      },
    );

// Prettier's `printString`: the preferred quote unless the content holds more of it than of the other.
function requote(quoted: string, singleQuote: boolean): string {
  const content = quoted.slice(1, -1);
  const [preferred, alternate] = singleQuote ? ["'", '"'] : ['"', "'"];
  let p = 0;
  let a = 0;
  for (const c of content) {
    if (c === preferred) p++;
    else if (c === alternate) a++;
  }
  const q = p > a ? alternate : preferred;
  if (quoted.startsWith(q)) return quoted;
  const other = q === '"' ? "'" : '"';
  return (
    q +
    content.replace(/\\(["'\\])|(["'])/g, (m, escaped, bare) =>
      escaped
        ? escaped === other
          ? other
          : m
        : bare === q
          ? `\\${bare}`
          : bare,
    ) +
    q
  );
}

const within = (n: number, k: string, ctx: Tr) => {
  const p = ctx.tree.parent(n);
  return p !== NO_NODE && kind(p, ctx) === k;
};
/** An `an+b` argument, which postcss-selector-parser reads as `an + b` (the `+` a combinator). */
function nthArgument(n: number, ctx: Tr): boolean {
  if (!within(n, "arguments", ctx)) return false;
  const pseudo = ctx.tree.parent(ctx.tree.parent(n));
  if (pseudo === NO_NODE) return false;
  const name = childOfKind(pseudo, "class_name", ctx);
  return name !== undefined && /^nth-/i.test(src(name, ctx));
}
/** The name of the nearest function around `n`, lowercased, as prettier's `insideValueFunctionNode` asks. */
function enclosingFunction(n: number, ctx: Tr): string | undefined {
  for (let p = ctx.tree.parent(n); p !== NO_NODE; p = ctx.tree.parent(p)) {
    const k = kind(p, ctx);
    if (k === "call_expression") {
      const name = childOfKind(p, "function_name", ctx);
      return name === undefined ? undefined : src(name, ctx).toLowerCase();
    }
    if (k === "declaration" || k === "block") return undefined;
  }
  return undefined;
}

// What a token means, whatever prettier's spelling of it: a string by its cooked value, a number by its exact
// value and its unit, and hex colors, keywords and names by their case-folded form where CSS ignores case.
function meaning(tree: Tree, node: number, t: string): string {
  const parent = tree.parent(node);
  const parentKind = parent === NO_NODE ? undefined : tree.kindName(parent);
  switch (tree.kindName(node)) {
    case "string_value":
      return cook(t);
    case "integer_value":
    case "float_value": {
      const m = numberParts.exec(t);
      if (!m) return t;
      const [, num = "", unit = "", rest = ""] = m;
      return `${decimalValue(num) ?? num}${unit.toLowerCase()}${rest}`;
    }
    case "color_value":
    case "feature_name":
    case "at_keyword":
    case "from":
    case "to":
      return t.toLowerCase();
    case "property_name":
      return maybeLower(t);
    case "class_name":
      return parentKind === "pseudo_class_selector" ? t.toLowerCase() : t;
    case "tag_name":
      return parentKind === "pseudo_element_selector" ? t.toLowerCase() : t;
    case "plain_value":
      if (parentKind === "attribute_selector")
        return /^["']/.test(t) ? cook(t) : t;
      return cssWideKeywords.has(t.toLowerCase())
        ? t.toLowerCase()
        : t.replace(/\s+/g, "");
    default:
      return !tree.named(node) && t.startsWith("@") ? t.toLowerCase() : t;
  }
}

// A `;` that ends the last statement of a block or of the file means nothing, so prettier may add one there.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    const next = lexemes[i + 1]?.text;
    if (l.text === ";" && (next === undefined || next === "}"))
      return undefined;
    return meaning(tree, l.node, l.text);
  });

/** Statements one per line, keeping one blank line where the source had any (prettier's `genericPrint` of nodes). */
function sequence(node: number, ctx: Ctx): Doc {
  const items = ctx.items(node);
  if (items.length === 0) return join(hardline, ctx.dangling(node));
  return items.map((n, i) => {
    const prev = items[i - 1];
    if (prev === undefined) return ctx.print(n);
    return [
      hardline,
      nextLineEmpty(ctx.tree, prev) ? hardline : [],
      ctx.print(n),
    ];
  });
}

const braces: Rule = (node, ctx) => {
  const open = anon(node, "{", ctx);
  const close = anon(node, "}", ctx);
  const empty = ctx.items(node).length === 0 && ctx.dangling(node).length === 0;
  return [
    open !== undefined ? verbatim(open, ctx) : [],
    empty ? [] : indent([hardline, sequence(node, ctx)]),
    hardline,
    close !== undefined ? verbatim(close, ctx) : [],
  ];
};

/** The children split at their top-level commas, each run with the comma that ends it. */
function commaGroups(nodes: readonly number[], ctx: Tr) {
  const groups: { items: number[]; comma?: number }[] = [{ items: [] }];
  for (const c of nodes) {
    const last = groups.at(-1);
    if (!last) continue;
    if (!ctx.tree.named(c) && kind(c, ctx) === ",") {
      last.comma = c;
      groups.push({ items: [] });
    } else last.items.push(c);
  }
  if (groups.length > 1 && groups.at(-1)?.items.length === 0) groups.pop();
  return groups;
}
const printComma = (comma: number | undefined, ctx: Ctx) =>
  comma !== undefined ? verbatim(comma, ctx) : [];

const printItem = (n: number, ctx: Ctx) =>
  ctx.tree.named(n) ? ctx.print(n) : verbatim(n, ctx);

/**
 * Space-separated words (prettier's comma_group), packed several to a line. Words the source wrote without a
 * gap stay joined: tree-sitter splits `16px/2` as `16` and `px/2`.
 */
function words(items: readonly number[], ctx: Ctx, grid: boolean): Doc {
  const first = items[0];
  if (first === undefined) return [];
  if (items.length === 1) return printItem(first, ctx);
  const gridBreaks =
    grid &&
    items.some((n, i) => i > 0 && breaksBetween(items[i - 1] ?? n, n, ctx));
  const parts: Doc[] = gridBreaks ? [[], hardline] : [];
  let content: Doc[] = [printItem(first, ctx)];
  for (const [i, n] of items.entries()) {
    const prev = items[i - 1];
    if (prev === undefined) continue;
    if (!apart(prev, n, ctx)) content.push(printItem(n, ctx));
    else if (gridBreaks && !breaksBetween(prev, n, ctx))
      content.push(text(" "), printItem(n, ctx));
    else {
      parts.push(content, gridBreaks ? hardline : line);
      content = [printItem(n, ctx)];
    }
  }
  parts.push(content);
  return group(indent(fill(parts)));
}

const multiWord = (items: readonly number[], ctx: Tr) =>
  items.length > 1 ||
  (items[0] !== undefined && /^[+-]/.test(src(items[0], ctx)));

/**
 * A declaration's (or `@import`'s) value. A comma list breaks one entry per line when an entry has several words
 * (prettier's `isSCSSMapItemNode`-free `shouldBreakList`), else it packs after an optional break past the colon.
 */
function valueList(
  values: readonly number[],
  ctx: Ctx,
  prop: string | undefined,
): Doc {
  const groups = commaGroups(values, ctx);
  const grid =
    prop !== undefined &&
    groups.length === 1 &&
    (prop === "grid" || prop.startsWith("grid-template"));
  const docs = groups.map((g) => [
    words(g.items, ctx, grid),
    printComma(g.comma, ctx),
  ]);
  if (docs.length === 1) return docs;
  if (
    prop !== undefined &&
    !prop.startsWith("--") &&
    groups.some((g) => multiWord(g.items, ctx))
  )
    return indent([hardline, join(hardline, docs)]);
  return group(
    indent([prop !== undefined ? softline : [], fill(join(line, docs))]),
  );
}

/** `(a, b)` breaking inside the parentheses, for function arguments and pseudo-class selectors alike. */
function parenList(
  node: number,
  ctx: Ctx,
  item: (items: readonly number[]) => Doc,
): Doc {
  const kids = code(node, ctx);
  const open = kids[0];
  const close = kids.at(-1);
  if (
    open === undefined ||
    close === undefined ||
    kind(open, ctx) !== "(" ||
    kind(close, ctx) !== ")"
  )
    return kids.map((c) => printItem(c, ctx));
  const groups = commaGroups(kids.slice(1, -1), ctx);
  const docs = groups.map((g) => [item(g.items), printComma(g.comma, ctx)]);
  return group([
    verbatim(open, ctx),
    indent([softline, join(line, docs)]),
    softline,
    verbatim(close, ctx),
  ]);
}

const combinators = new Set([
  "child_selector",
  "descendant_selector",
  "sibling_selector",
  "adjacent_sibling_selector",
]);
/**
 * How many nodes postcss-selector-parser gives the selector: each simple selector and each combinator. Tree-sitter
 * nests a compound `a.b:c` leftwards, so the part left of the first punctuation is the rest of the compound.
 */
function parts(n: number, ctx: Tr): number {
  const kids = code(n, ctx);
  const named = (c: number | undefined) => c !== undefined && ctx.tree.named(c);
  if (combinators.has(kind(n, ctx)))
    return kids.reduce((sum, c) => sum + (named(c) ? parts(c, ctx) : 0), 1);
  const left = kids[0];
  const second = kids[1];
  return left !== undefined &&
    named(left) &&
    second !== undefined &&
    !named(second) &&
    kind(n, ctx).endsWith("_selector")
    ? parts(left, ctx) + 1
    : 1;
}
/** Prettier indents a selector of more than two nodes as it breaks. */
const selector = (n: number, ctx: Ctx): Doc =>
  parts(n, ctx) > 2 ? group(indent(ctx.print(n))) : ctx.print(n);
/** A selector list, one selector per line. */
const selectorList = (items: readonly number[], ctx: Ctx): Doc =>
  group(
    commaGroups(items, ctx).map((g, i) => [
      i > 0 ? hardline : [],
      g.items.map((n) =>
        ctx.tree.named(n) ? selector(n, ctx) : verbatim(n, ctx),
      ),
      printComma(g.comma, ctx),
    ]),
  );

/** Children printed side by side, as the source wrote them. */
const concat: Rule = (node, ctx) =>
  code(node, ctx).map((c) => printItem(c, ctx));

const combinator: Rule = (node, ctx) => {
  const kids = code(node, ctx);
  return kids.map((c, i): Doc => {
    if (ctx.tree.named(c)) {
      const prev = kids[i - 1];
      return [
        prev === undefined ? [] : ctx.tree.named(prev) ? line : text(" "),
        ctx.print(c),
      ];
    }
    return [i > 0 ? line : [], verbatim(c, ctx)];
  });
};

/** Media and supports queries: words spaced once, `(feature: value)` with a space after the colon. */
const spaced: Rule = (node, ctx) =>
  join(
    text(" "),
    code(node, ctx).map((c) => printItem(c, ctx)),
  );
const featureQuery: Rule = (node, ctx) => {
  const kids = code(node, ctx);
  return kids.map((c, i): Doc => {
    const prev = kids[i - 1];
    const sep =
      prev !== undefined &&
      (kind(prev, ctx) === ":" ||
        (kind(prev, ctx) !== "(" &&
          kind(c, ctx) !== ")" &&
          apart(prev, c, ctx)))
        ? text(" ")
        : [];
    return [sep, printItem(c, ctx)];
  });
};

/** The statement's own `;`, or one prettier adds. */
const semicolon = (node: number, ctx: Ctx) => {
  const semi = anon(node, ";", ctx);
  return semi !== undefined ? verbatim(semi, ctx) : synthetic(node, ";");
};
/**
 * Parameters kept as written, each separated by one space where the source had any gap (prettier's raw params).
 * A comment among them is attached to a parameter, so it prints with that parameter rather than in a gap.
 */
const raw = (nodes: readonly number[], ctx: Ctx): Doc =>
  nodes.map((n, i) => {
    const prev = nodes[i - 1];
    return [
      prev !== undefined && apart(prev, n, ctx) ? text(" ") : [],
      ctx.withComments(n, verbatim(n, ctx)),
    ];
  });

const requoted = (n: number, ctx: Ctx<CssOptions>) =>
  token(n, requote(src(n, ctx), ctx.options.singleQuote));
const atToken = (at: number, ctx: Ctx) => token(at, atName(src(at, ctx)));
const withoutSemicolon = (node: number, ctx: Tr) =>
  code(node, ctx).filter((c) => kind(c, ctx) !== ";");

/** CSS as prettier 3.9.9's postcss printer lays it out. */
export const css = defineLanguage(
  grammar,
  {
    parser: language,
    // What `meaning` reads whole: a string's quotes and escapes, and a name's identifier, are separate leaves.
    atoms: ["string_value", "class_name", "plain_value", "color_value"],
    lineComments: { js_comment: "//" },
    defaults,
    settings: prettierSettings,
    normalize,
    layoutBlind: true,
  },
  () => ({
    stylesheet: sequence,
    block: braces,
    keyframe_block_list: braces,
    rule_set: (node, ctx) =>
      join(
        text(" "),
        ctx.items(node).map((n) => ctx.print(n)),
      ),
    selectors: (node, ctx) => selectorList(code(node, ctx), ctx),
    keyframe_block: (node, ctx) => {
      const kids = code(node, ctx);
      const block = kids.at(-1);
      return [
        selectorList(kids.slice(0, -1), ctx),
        block !== undefined ? [text(" "), ctx.print(block)] : [],
      ];
    },
    from: (node, ctx) => token(node, src(node, ctx).toLowerCase()),
    to: (node, ctx) => token(node, src(node, ctx).toLowerCase()),

    declaration: (node, ctx) => {
      const kids = code(node, ctx);
      const colon = kids.findIndex(
        (c) => !ctx.tree.named(c) && kind(c, ctx) === ":",
      );
      const prop = kids[0];
      if (prop === undefined || colon !== 1) return concat(node, ctx);
      const important = kids.find((c) => kind(c, ctx) === "important");
      const values = kids
        .slice(colon + 1)
        .filter((c) => c !== important && kind(c, ctx) !== ";");
      const name = src(prop, ctx).toLowerCase();
      const first = values[0];
      const value =
        first !== undefined && src(first, ctx).startsWith("progid:")
          ? raw(values, ctx)
          : valueList(values, ctx, name);
      return [
        ctx.print(prop),
        verbatim(kids[colon] ?? prop, ctx),
        values.length > 0 ? [text(" "), value] : [],
        important !== undefined ? [text(" "), ctx.print(important)] : [],
        semicolon(node, ctx),
      ];
    },
    property_name: (node, ctx) => token(node, maybeLower(src(node, ctx))),
    integer_value: (node, ctx) => token(node, printDimension(src(node, ctx))),
    float_value: (node, ctx) => token(node, printDimension(src(node, ctx))),
    color_value: (node, ctx) => token(node, src(node, ctx).toLowerCase()),
    string_value: requoted,
    plain_value: (node, ctx: Ctx<CssOptions>) => {
      const t = src(node, ctx);
      if (within(node, "attribute_selector", ctx)) {
        const q = ctx.options.singleQuote ? "'" : '"';
        return token(node, /["']/.test(t) ? t : q + t + q);
      }
      if (nthArgument(node, ctx))
        return token(node, t.replace(/(?<=[^\s+-])\+(?=\S)/g, " + "));
      return token(
        node,
        cssWideKeywords.has(t.toLowerCase()) ? t.toLowerCase() : t,
      );
    },
    call_expression: concat,
    arguments: (node, ctx) => {
      const call = within(node, "call_expression", ctx)
        ? ctx.tree.parent(node)
        : undefined;
      const name =
        call === undefined
          ? undefined
          : childOfKind(call, "function_name", ctx);
      if (name !== undefined && src(name, ctx).toLowerCase() === "url")
        return code(node, ctx).map((c) => printItem(c, ctx));
      return parenList(node, ctx, (items) =>
        call !== undefined
          ? words(items, ctx, false)
          : join(
              text(" "),
              items.map((n) => selector(n, ctx)),
            ),
      );
    },
    binary_expression: (node, ctx) => {
      const calc = enclosingFunction(node, ctx) === "calc";
      const kids = code(node, ctx);
      return kids.map((c, i) => {
        const prev = kids[i - 1];
        return [
          prev !== undefined && (calc || apart(prev, c, ctx)) ? text(" ") : [],
          printItem(c, ctx),
        ];
      });
    },
    parenthesized_value: concat,

    class_selector: concat,
    id_selector: concat,
    pseudo_element_selector: concat,
    pseudo_class_selector: concat,
    namespace_selector: concat,
    attribute_selector: concat,
    child_selector: combinator,
    descendant_selector: combinator,
    sibling_selector: combinator,
    adjacent_sibling_selector: combinator,
    class_name: (node, ctx) =>
      token(
        node,
        within(node, "pseudo_class_selector", ctx)
          ? src(node, ctx).toLowerCase()
          : src(node, ctx),
      ),
    tag_name: (node, ctx) =>
      token(
        node,
        within(node, "pseudo_element_selector", ctx)
          ? src(node, ctx).toLowerCase()
          : src(node, ctx),
      ),

    at_keyword: (node, ctx) => atToken(node, ctx),
    media_statement: (node, ctx) => {
      const kids = code(node, ctx);
      const [at, ...rest] = kids;
      const block = rest.at(-1);
      if (
        at === undefined ||
        block === undefined ||
        kind(block, ctx) !== "block"
      )
        return concat(node, ctx);
      const queries = commaGroups(rest.slice(0, -1), ctx).map((g) => [
        g.items.map((n) => printItem(n, ctx)),
        printComma(g.comma, ctx),
      ]);
      return [
        atToken(at, ctx),
        queries.length > 0
          ? [text(" "), group(indent(join(line, queries)))]
          : [],
        text(" "),
        ctx.print(block),
      ];
    },
    supports_statement: (node, ctx) =>
      join(
        text(" "),
        code(node, ctx).map((c, i) =>
          i === 0 ? atToken(c, ctx) : printItem(c, ctx),
        ),
      ),
    import_statement: (node, ctx) => {
      const [at, ...rest] = withoutSemicolon(node, ctx);
      if (at === undefined) return concat(node, ctx);
      return [
        atToken(at, ctx),
        rest.length > 0 ? [text(" "), valueList(rest, ctx, undefined)] : [],
        semicolon(node, ctx),
      ];
    },
    namespace_statement: (node, ctx) => [
      join(
        text(" "),
        withoutSemicolon(node, ctx).map((c, i) =>
          i === 0 ? atToken(c, ctx) : printItem(c, ctx),
        ),
      ),
      semicolon(node, ctx),
    ],
    charset_statement: (node, ctx) => {
      const [at, ...rest] = withoutSemicolon(node, ctx);
      if (at === undefined) return concat(node, ctx);
      return [
        atToken(at, ctx),
        rest.length > 0 ? [text(" "), raw(rest, ctx)] : [],
        semicolon(node, ctx),
      ];
    },
    keyframes_statement: (node, ctx) =>
      join(
        text(" "),
        code(node, ctx).map((c, i) =>
          i === 0 ? atToken(c, ctx) : printItem(c, ctx),
        ),
      ),
    at_rule: (node, ctx) => {
      const [at, ...rest] = code(node, ctx);
      if (at === undefined) return concat(node, ctx);
      const block = rest.find((c) => kind(c, ctx) === "block");
      const params = rest.filter((c) => c !== block && kind(c, ctx) !== ";");
      return [
        ctx.print(at),
        params.length > 0 ? [text(" "), raw(params, ctx)] : [],
        block !== undefined
          ? [text(" "), ctx.print(block)]
          : semicolon(node, ctx),
      ];
    },
    binary_query: spaced,
    unary_query: spaced,
    parenthesized_query: concat,
    feature_query: featureQuery,
    feature_name: (node, ctx) => token(node, maybeLower(src(node, ctx))),
  }),
);

// ---- the stream rules the formatter spec (format.ts) names as `custom`: prettier's heuristics, and leaves it respells ----

type SCtx = StreamCtx<CssOptions>;
type SRule = StreamRule<CssOptions>;

const sItem = (n: number, ctx: SCtx) => {
  if (ctx.tree.named(n)) ctx.print(n);
  else sToken(n, src(n, ctx));
};
const sComma = (comma: number | undefined, ctx: SCtx) => {
  if (comma !== undefined) sToken(comma, src(comma, ctx));
};
const sConcat: SRule = (node, ctx) => {
  for (const c of code(node, ctx)) sItem(c, ctx);
};
/** `words` of the Doc rules. */
function sWords(items: readonly number[], ctx: SCtx, grid: boolean): void {
  const first = items[0];
  if (first === undefined) return;
  if (items.length === 1) return sItem(first, ctx);
  const gridBreaks =
    grid &&
    items.some((n, i) => i > 0 && breaksBetween(items[i - 1] ?? n, n, ctx));
  open(GROUP);
  open(INDENT);
  open(FILL);
  if (gridBreaks) {
    open(FILL_ITEM);
    close();
    sHardline();
  }
  open(FILL_ITEM);
  sItem(first, ctx);
  for (const [i, n] of items.entries()) {
    const prev = items[i - 1];
    if (prev === undefined) continue;
    if (!apart(prev, n, ctx)) sItem(n, ctx);
    else if (gridBreaks && !breaksBetween(prev, n, ctx)) {
      sText(" ");
      sItem(n, ctx);
    } else {
      close();
      if (gridBreaks) sHardline();
      else sLine(0);
      open(FILL_ITEM);
      sItem(n, ctx);
    }
  }
  close();
  close();
  close();
  close();
}
/** `valueList` of the Doc rules. */
function sValueList(
  values: readonly number[],
  ctx: SCtx,
  prop: string | undefined,
): void {
  const groups = commaGroups(values, ctx);
  const grid =
    prop !== undefined &&
    groups.length === 1 &&
    (prop === "grid" || prop.startsWith("grid-template"));
  const entry = (g: (typeof groups)[number]) => {
    sWords(g.items, ctx, grid);
    sComma(g.comma, ctx);
  };
  const only = groups[0];
  if (groups.length === 1 && only) return entry(only);
  if (
    prop !== undefined &&
    !prop.startsWith("--") &&
    groups.some((g) => multiWord(g.items, ctx))
  ) {
    open(INDENT);
    sHardline();
    groups.forEach((g, i) => {
      if (i > 0) sHardline();
      entry(g);
    });
    close();
    return;
  }
  open(GROUP);
  open(INDENT);
  if (prop !== undefined) sLine(SOFT);
  open(FILL);
  groups.forEach((g, i) => {
    if (i > 0) sLine(0);
    open(FILL_ITEM);
    entry(g);
    close();
  });
  close();
  close();
  close();
}
/** `parenList` of the Doc rules. */
function sParenList(
  node: number,
  ctx: SCtx,
  item: (items: readonly number[]) => void,
): void {
  const kids = code(node, ctx);
  const first = kids[0];
  const last = kids.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    kind(first, ctx) !== "(" ||
    kind(last, ctx) !== ")"
  ) {
    for (const c of kids) sItem(c, ctx);
    return;
  }
  open(GROUP);
  sToken(first, src(first, ctx));
  open(INDENT);
  sLine(SOFT);
  commaGroups(kids.slice(1, -1), ctx).forEach((g, i) => {
    if (i > 0) sLine(0);
    item(g.items);
    sComma(g.comma, ctx);
  });
  close();
  sLine(SOFT);
  sToken(last, src(last, ctx));
  close();
}
const sSelector = (n: number, ctx: SCtx) => {
  if (parts(n, ctx) <= 2) return ctx.print(n);
  open(GROUP);
  open(INDENT);
  ctx.print(n);
  close();
  close();
};
function sSelectorList(items: readonly number[], ctx: SCtx): void {
  open(GROUP);
  commaGroups(items, ctx).forEach((g, i) => {
    if (i > 0) sHardline();
    for (const n of g.items)
      if (ctx.tree.named(n)) sSelector(n, ctx);
      else sToken(n, src(n, ctx));
    sComma(g.comma, ctx);
  });
  close();
}
const sSemicolon = (node: number, ctx: SCtx) => {
  const semi = anon(node, ";", ctx);
  if (semi !== undefined) sToken(semi, src(semi, ctx));
  else sToken(node, ";", true);
};
function sRaw(nodes: readonly number[], ctx: SCtx): void {
  nodes.forEach((n, i) => {
    const prev = nodes[i - 1];
    if (prev !== undefined && apart(prev, n, ctx)) sText(" ");
    printLeadingComments(ctx, n);
    sToken(n, src(n, ctx));
    printTrailingComments(ctx, n);
  });
}
const sAtToken = (at: number, ctx: SCtx) => sToken(at, atName(src(at, ctx)));
const respell =
  (f: (t: string, node: number, ctx: SCtx) => string): SRule =>
  (node, ctx) =>
    sToken(node, f(src(node, ctx), node, ctx));

/** The rules `custom` names in format.ts. */
export const customs = {
  lower: respell((t) => t.toLowerCase()),
  maybeLower: respell((t) => maybeLower(t)),
  dimension: respell((t) => printDimension(t)),
  string: respell((t, _, ctx) => requote(t, ctx.options.singleQuote)),
  atKeyword: respell((t) => atName(t)),
  className: respell((t, node, ctx) =>
    within(node, "pseudo_class_selector", ctx) ? t.toLowerCase() : t,
  ),
  tagName: respell((t, node, ctx) =>
    within(node, "pseudo_element_selector", ctx) ? t.toLowerCase() : t,
  ),
  plainValue: respell((t, node, ctx) => {
    if (within(node, "attribute_selector", ctx)) {
      const q = ctx.options.singleQuote ? "'" : '"';
      return /["']/.test(t) ? t : q + t + q;
    }
    if (nthArgument(node, ctx))
      return t.replace(/(?<=[^\s+-])\+(?=\S)/g, " + ");
    return cssWideKeywords.has(t.toLowerCase()) ? t.toLowerCase() : t;
  }),
  selectors: (node, ctx) => sSelectorList(code(node, ctx), ctx),
  keyframeBlock: (node, ctx) => {
    const kids = code(node, ctx);
    const block = kids.at(-1);
    sSelectorList(kids.slice(0, -1), ctx);
    if (block !== undefined) {
      sText(" ");
      ctx.print(block);
    }
  },
  combinator: (node, ctx) => {
    const kids = code(node, ctx);
    kids.forEach((c, i) => {
      if (ctx.tree.named(c)) {
        const prev = kids[i - 1];
        if (prev !== undefined) {
          if (ctx.tree.named(prev)) sLine(0);
          else sText(" ");
        }
        ctx.print(c);
        return;
      }
      if (i > 0) sLine(0);
      sToken(c, src(c, ctx));
    });
  },
  featureQuery: (node, ctx) => {
    const kids = code(node, ctx);
    kids.forEach((c, i) => {
      const prev = kids[i - 1];
      if (
        prev !== undefined &&
        (kind(prev, ctx) === ":" ||
          (kind(prev, ctx) !== "(" &&
            kind(c, ctx) !== ")" &&
            apart(prev, c, ctx)))
      )
        sText(" ");
      sItem(c, ctx);
    });
  },
  declaration: (node, ctx) => {
    const kids = code(node, ctx);
    const colon = kids.findIndex(
      (c) => !ctx.tree.named(c) && kind(c, ctx) === ":",
    );
    const prop = kids[0];
    if (prop === undefined || colon !== 1) return sConcat(node, ctx);
    const important = kids.find((c) => kind(c, ctx) === "important");
    const values = kids
      .slice(colon + 1)
      .filter((c) => c !== important && kind(c, ctx) !== ";");
    ctx.print(prop);
    const colonTok = kids[colon] ?? prop;
    sToken(colonTok, src(colonTok, ctx));
    const first = values[0];
    if (first !== undefined) {
      sText(" ");
      if (src(first, ctx).startsWith("progid:")) sRaw(values, ctx);
      else sValueList(values, ctx, src(prop, ctx).toLowerCase());
    }
    if (important !== undefined) {
      sText(" ");
      ctx.print(important);
    }
    sSemicolon(node, ctx);
  },
  arguments: (node, ctx) => {
    const call = within(node, "call_expression", ctx)
      ? ctx.tree.parent(node)
      : undefined;
    const name =
      call === undefined ? undefined : childOfKind(call, "function_name", ctx);
    if (name !== undefined && src(name, ctx).toLowerCase() === "url")
      return sConcat(node, ctx);
    sParenList(node, ctx, (items) => {
      if (call !== undefined) return sWords(items, ctx, false);
      items.forEach((n, i) => {
        if (i > 0) sText(" ");
        sSelector(n, ctx);
      });
    });
  },
  binaryExpression: (node, ctx) => {
    const calc = enclosingFunction(node, ctx) === "calc";
    const kids = code(node, ctx);
    kids.forEach((c, i) => {
      const prev = kids[i - 1];
      if (prev !== undefined && (calc || apart(prev, c, ctx))) sText(" ");
      sItem(c, ctx);
    });
  },
  media: (node, ctx) => {
    const [at, ...rest] = code(node, ctx);
    const block = rest.at(-1);
    if (at === undefined || block === undefined || kind(block, ctx) !== "block")
      return sConcat(node, ctx);
    sAtToken(at, ctx);
    const queries = commaGroups(rest.slice(0, -1), ctx);
    if (queries.length > 0) {
      sText(" ");
      open(GROUP);
      open(INDENT);
      queries.forEach((g, i) => {
        if (i > 0) sLine(0);
        for (const n of g.items) sItem(n, ctx);
        sComma(g.comma, ctx);
      });
      close();
      close();
    }
    sText(" ");
    ctx.print(block);
  },
  import: (node, ctx) => {
    const [at, ...rest] = withoutSemicolon(node, ctx);
    if (at === undefined) return sConcat(node, ctx);
    sAtToken(at, ctx);
    if (rest.length > 0) {
      sText(" ");
      sValueList(rest, ctx, undefined);
    }
    sSemicolon(node, ctx);
  },
  namespace: (node, ctx) => {
    withoutSemicolon(node, ctx).forEach((c, i) => {
      if (i > 0) sText(" ");
      if (i === 0) sAtToken(c, ctx);
      else sItem(c, ctx);
    });
    sSemicolon(node, ctx);
  },
  charset: (node, ctx) => {
    const [at, ...rest] = withoutSemicolon(node, ctx);
    if (at === undefined) return sConcat(node, ctx);
    sAtToken(at, ctx);
    if (rest.length > 0) {
      sText(" ");
      sRaw(rest, ctx);
    }
    sSemicolon(node, ctx);
  },
  atRule: (node, ctx) => {
    const [at, ...rest] = code(node, ctx);
    if (at === undefined) return sConcat(node, ctx);
    const block = rest.find((c) => kind(c, ctx) === "block");
    const params = rest.filter((c) => c !== block && kind(c, ctx) !== ";");
    ctx.print(at);
    if (params.length > 0) {
      sText(" ");
      sRaw(params, ctx);
    }
    if (block !== undefined) {
      sText(" ");
      ctx.print(block);
    } else sSemicolon(node, ctx);
  },
} satisfies Record<string, SRule>;
