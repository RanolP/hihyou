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
import { isNextLineEmpty } from "../../fmt/text.js";
import type { FormatNode } from "../../fmt/tree.js";
import { grammar } from "./bundle.js";

/** The prettier options its postcss printer reads (3.9.9); `bracketSpacing` and `objectWrap` go unread. */
export interface CssOptions extends PrettierOptions {
  singleQuote: boolean;
}

const defaults: CssOptions = { ...prettierDefaults, singleQuote: false };

const slice = (n: FormatNode, ctx: Ctx) => ctx.source.slice(n.start, n.end);
const verbatim = (n: FormatNode, ctx: Ctx) => token(n, slice(n, ctx));
const isComment = (n: FormatNode) =>
  n.kind === "comment" || n.kind === "js_comment";
/** Every child but comments, which reach the output attached to their neighbours. */
const code = (n: FormatNode) => n.children.filter((c) => !isComment(c));
const anon = (n: FormatNode, kind: string) =>
  n.children.find((c) => !c.named && c.kind === kind);
const gap = (ctx: Ctx, a: FormatNode, b: FormatNode) =>
  ctx.source.slice(a.end, b.start);

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

const within = (n: FormatNode, kind: string) => n.parent?.kind === kind;
const inAttribute = (n: FormatNode) => within(n, "attribute_selector");
/** An `an+b` argument, which postcss-selector-parser reads as `an + b` (the `+` a combinator). */
function nthArgument(n: FormatNode, ctx: Ctx): boolean {
  const pseudo = n.parent?.kind === "arguments" ? n.parent.parent : undefined;
  const name = pseudo?.children.find((c) => c.kind === "class_name");
  return name !== undefined && /^nth-/i.test(slice(name, ctx));
}
/** The name of the nearest function around `n`, lowercased, as prettier's `insideValueFunctionNode` asks. */
function enclosingFunction(n: FormatNode, ctx: Ctx): string | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (p.kind === "call_expression") {
      const name = p.children.find((c) => c.kind === "function_name");
      return name && slice(name, ctx).toLowerCase();
    }
    if (p.kind === "declaration" || p.kind === "block") return undefined;
  }
  return undefined;
}

// What a token means, whatever prettier's spelling of it: a string by its cooked value, a number by its exact
// value and its unit, and hex colors, keywords and names by their case-folded form where CSS ignores case.
function meaning(node: FormatNode, t: string): string {
  switch (node.kind) {
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
      return within(node, "pseudo_class_selector") ? t.toLowerCase() : t;
    case "tag_name":
      return within(node, "pseudo_element_selector") ? t.toLowerCase() : t;
    case "plain_value":
      if (inAttribute(node)) return /^["']/.test(t) ? cook(t) : t;
      return cssWideKeywords.has(t.toLowerCase())
        ? t.toLowerCase()
        : t.replace(/\s+/g, "");
    default:
      return !node.named && t.startsWith("@") ? t.toLowerCase() : t;
  }
}

// A `;` that ends the last statement of a block or of the file means nothing, so prettier may add one there.
const normalize: Normalize = (lexemes) =>
  lexemes.map((l, i) => {
    const next = lexemes[i + 1]?.text;
    if (l.text === ";" && (next === undefined || next === "}"))
      return undefined;
    return meaning(l.node, l.text);
  });

/** Statements one per line, keeping one blank line where the source had any (prettier's `genericPrint` of nodes). */
function sequence(node: FormatNode, ctx: Ctx): Doc {
  const items = ctx.items(node);
  if (items.length === 0) return join(hardline, ctx.dangling(node));
  return items.map((n, i) => {
    const prev = items[i - 1];
    if (!prev) return ctx.print(n);
    return [
      hardline,
      isNextLineEmpty(ctx.source, prev.end) ? hardline : [],
      ctx.print(n),
    ];
  });
}

const braces: Rule = (node, ctx) => {
  const open = anon(node, "{");
  const close = anon(node, "}");
  const empty = ctx.items(node).length === 0 && ctx.dangling(node).length === 0;
  return [
    open ? verbatim(open, ctx) : [],
    empty ? [] : indent([hardline, sequence(node, ctx)]),
    hardline,
    close ? verbatim(close, ctx) : [],
  ];
};

/** The children split at their top-level commas, each run with the comma that ends it. */
function commaGroups(children: readonly FormatNode[]) {
  const groups: { items: FormatNode[]; comma?: FormatNode }[] = [{ items: [] }];
  for (const c of children) {
    const last = groups.at(-1);
    if (!last) continue;
    if (!c.named && c.kind === ",") {
      last.comma = c;
      groups.push({ items: [] });
    } else last.items.push(c);
  }
  if (groups.length > 1 && groups.at(-1)?.items.length === 0) groups.pop();
  return groups;
}

const printItem = (n: FormatNode, ctx: Ctx) =>
  n.named ? ctx.print(n) : verbatim(n, ctx);

/**
 * Space-separated words (prettier's comma_group), packed several to a line. Words the source wrote without a
 * gap stay joined: tree-sitter splits `16px/2` as `16` and `px/2`.
 */
function words(items: readonly FormatNode[], ctx: Ctx, grid: boolean): Doc {
  const first = items[0];
  if (!first) return [];
  if (items.length === 1) return printItem(first, ctx);
  const gridBreaks =
    grid &&
    items.some((n, i) => i > 0 && /\n/.test(gap(ctx, items[i - 1] ?? n, n)));
  const parts: Doc[] = gridBreaks ? [[], hardline] : [];
  let content: Doc[] = [printItem(first, ctx)];
  for (const [i, n] of items.entries()) {
    const prev = items[i - 1];
    if (!prev) continue;
    const between = gap(ctx, prev, n);
    if (between === "") content.push(printItem(n, ctx));
    else if (gridBreaks && !/\n/.test(between))
      content.push(text(" "), printItem(n, ctx));
    else {
      parts.push(content, gridBreaks ? hardline : line);
      content = [printItem(n, ctx)];
    }
  }
  parts.push(content);
  return group(indent(fill(parts)));
}

const multiWord = (items: readonly FormatNode[], ctx: Ctx) =>
  items.length > 1 ||
  (items[0] !== undefined && /^[+-]/.test(slice(items[0], ctx)));

/**
 * A declaration's (or `@import`'s) value. A comma list breaks one entry per line when an entry has several words
 * (prettier's `isSCSSMapItemNode`-free `shouldBreakList`), else it packs after an optional break past the colon.
 */
function valueList(
  values: readonly FormatNode[],
  ctx: Ctx,
  prop: string | undefined,
): Doc {
  const groups = commaGroups(values);
  const grid =
    prop !== undefined &&
    groups.length === 1 &&
    (prop === "grid" || prop.startsWith("grid-template"));
  const docs = groups.map((g) => [
    words(g.items, ctx, grid),
    g.comma ? verbatim(g.comma, ctx) : [],
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
  node: FormatNode,
  ctx: Ctx,
  item: (items: readonly FormatNode[]) => Doc,
): Doc {
  const kids = code(node);
  const open = kids[0];
  const close = kids.at(-1);
  if (!open || !close || open.kind !== "(" || close.kind !== ")")
    return kids.map((c) => printItem(c, ctx));
  const groups = commaGroups(kids.slice(1, -1));
  const docs = groups.map((g) => [
    item(g.items),
    g.comma ? verbatim(g.comma, ctx) : [],
  ]);
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
function parts(n: FormatNode): number {
  const kids = code(n);
  if (combinators.has(n.kind))
    return kids.reduce((sum, c) => sum + (c.named ? parts(c) : 0), 1);
  const left = kids[0];
  return left?.named &&
    kids[1] &&
    !kids[1].named &&
    n.kind.endsWith("_selector")
    ? parts(left) + 1
    : 1;
}
/** Prettier indents a selector of more than two nodes as it breaks. */
const selector = (n: FormatNode, ctx: Ctx): Doc =>
  parts(n) > 2 ? group(indent(ctx.print(n))) : ctx.print(n);
/** A selector list, one selector per line. */
const selectorList = (items: readonly FormatNode[], ctx: Ctx): Doc =>
  group(
    commaGroups(items).map((g, i) => [
      i > 0 ? hardline : [],
      g.items.map((n) => (n.named ? selector(n, ctx) : verbatim(n, ctx))),
      g.comma ? verbatim(g.comma, ctx) : [],
    ]),
  );

/** Children printed side by side, as the source wrote them. */
const concat: Rule = (node, ctx) => code(node).map((c) => printItem(c, ctx));

const combinator: Rule = (node, ctx) => {
  const kids = code(node);
  return kids.map((c, i): Doc => {
    if (c.named) {
      const prev = kids[i - 1];
      return [prev?.named ? line : prev ? text(" ") : [], ctx.print(c)];
    }
    return [i > 0 ? line : [], verbatim(c, ctx)];
  });
};

/** Media and supports queries: words spaced once, `(feature: value)` with a space after the colon. */
const spaced: Rule = (node, ctx) =>
  join(
    text(" "),
    code(node).map((c) => printItem(c, ctx)),
  );
const featureQuery: Rule = (node, ctx) => {
  const kids = code(node);
  return kids.map((c, i): Doc => {
    const prev = kids[i - 1];
    const sep =
      prev?.kind === ":" ||
      (prev && prev.kind !== "(" && c.kind !== ")" && gap(ctx, prev, c) !== "")
        ? text(" ")
        : [];
    return [sep, printItem(c, ctx)];
  });
};

/** The statement's own `;`, or one prettier adds. */
const semicolon = (node: FormatNode, ctx: Ctx) => {
  const semi = anon(node, ";");
  return semi ? verbatim(semi, ctx) : synthetic(node, ";");
};
/** Parameters kept as written, each separated by one space where the source had any gap (prettier's raw params). */
const raw = (nodes: readonly FormatNode[], ctx: Ctx): Doc =>
  nodes.map((n, i) => {
    const prev = nodes[i - 1];
    return [
      prev && gap(ctx, prev, n) !== "" ? text(gap(ctx, prev, n)) : [],
      verbatim(n, ctx),
    ];
  });

const requoted = (n: FormatNode, ctx: Ctx<CssOptions>) =>
  token(n, requote(slice(n, ctx), ctx.options.singleQuote));

/** CSS as prettier 3.9.9's postcss printer lays it out. */
export const css = defineLanguage(
  grammar,
  {
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
    selectors: (node, ctx) => selectorList(code(node), ctx),
    keyframe_block: (node, ctx) => {
      const kids = code(node);
      const block = kids.at(-1);
      return [
        selectorList(kids.slice(0, -1), ctx),
        block ? [text(" "), ctx.print(block)] : [],
      ];
    },
    from: (node, ctx) => token(node, slice(node, ctx).toLowerCase()),
    to: (node, ctx) => token(node, slice(node, ctx).toLowerCase()),

    declaration: (node, ctx) => {
      const kids = code(node);
      const colon = kids.findIndex((c) => !c.named && c.kind === ":");
      const prop = kids[0];
      if (!prop || colon !== 1) return concat(node, ctx);
      const important = kids.find((c) => c.kind === "important");
      const values = kids
        .slice(colon + 1)
        .filter((c) => c !== important && c.kind !== ";");
      const name = slice(prop, ctx).toLowerCase();
      const first = values[0];
      const value =
        first && slice(first, ctx).startsWith("progid:")
          ? raw(values, ctx)
          : valueList(values, ctx, name);
      return [
        ctx.print(prop),
        verbatim(kids[colon] ?? prop, ctx),
        values.length > 0 ? [text(" "), value] : [],
        important ? [text(" "), ctx.print(important)] : [],
        semicolon(node, ctx),
      ];
    },
    property_name: (node, ctx) => token(node, maybeLower(slice(node, ctx))),
    integer_value: (node, ctx) => token(node, printDimension(slice(node, ctx))),
    float_value: (node, ctx) => token(node, printDimension(slice(node, ctx))),
    color_value: (node, ctx) => token(node, slice(node, ctx).toLowerCase()),
    string_value: requoted,
    plain_value: (node, ctx: Ctx<CssOptions>) => {
      const t = slice(node, ctx);
      if (inAttribute(node)) {
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
      const call =
        node.parent?.kind === "call_expression" ? node.parent : undefined;
      const name = call?.children.find((c) => c.kind === "function_name");
      if (name && slice(name, ctx).toLowerCase() === "url")
        return code(node).map((c) => printItem(c, ctx));
      return parenList(node, ctx, (items) =>
        call
          ? words(items, ctx, false)
          : join(
              text(" "),
              items.map((n) => selector(n, ctx)),
            ),
      );
    },
    binary_expression: (node, ctx) => {
      const calc = enclosingFunction(node, ctx) === "calc";
      const kids = code(node);
      return kids.map((c, i) => {
        const prev = kids[i - 1];
        return [
          prev && (calc || gap(ctx, prev, c) !== "") ? text(" ") : [],
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
        within(node, "pseudo_class_selector")
          ? slice(node, ctx).toLowerCase()
          : slice(node, ctx),
      ),
    tag_name: (node, ctx) =>
      token(
        node,
        within(node, "pseudo_element_selector")
          ? slice(node, ctx).toLowerCase()
          : slice(node, ctx),
      ),

    at_keyword: (node, ctx) => token(node, atName(slice(node, ctx))),
    media_statement: (node, ctx) => {
      const kids = code(node);
      const [at, ...rest] = kids;
      const block = rest.at(-1);
      if (!at || block?.kind !== "block") return concat(node, ctx);
      const queries = commaGroups(rest.slice(0, -1)).map((g) => [
        g.items.map((n) => printItem(n, ctx)),
        g.comma ? verbatim(g.comma, ctx) : [],
      ]);
      return [
        token(at, atName(slice(at, ctx))),
        queries.length > 0
          ? [text(" "), group(indent(join(line, queries)))]
          : [],
        text(" "),
        ctx.print(block),
      ];
    },
    supports_statement: (node, ctx) => {
      const kids = code(node);
      return join(
        text(" "),
        kids.map((c, i) =>
          i === 0 ? token(c, atName(slice(c, ctx))) : printItem(c, ctx),
        ),
      );
    },
    import_statement: (node, ctx) => {
      const kids = code(node).filter((c) => c.kind !== ";");
      const [at, ...rest] = kids;
      if (!at) return concat(node, ctx);
      return [
        token(at, atName(slice(at, ctx))),
        rest.length > 0 ? [text(" "), valueList(rest, ctx, undefined)] : [],
        semicolon(node, ctx),
      ];
    },
    namespace_statement: (node, ctx) => {
      const kids = code(node).filter((c) => c.kind !== ";");
      return [
        join(
          text(" "),
          kids.map((c, i) =>
            i === 0 ? token(c, atName(slice(c, ctx))) : printItem(c, ctx),
          ),
        ),
        semicolon(node, ctx),
      ];
    },
    charset_statement: (node, ctx) => {
      const [at, ...rest] = code(node).filter((c) => c.kind !== ";");
      if (!at) return concat(node, ctx);
      return [
        token(at, atName(slice(at, ctx))),
        rest.length > 0 ? [text(" "), raw(rest, ctx)] : [],
        semicolon(node, ctx),
      ];
    },
    keyframes_statement: (node, ctx) =>
      join(
        text(" "),
        code(node).map((c, i) =>
          i === 0 ? token(c, atName(slice(c, ctx))) : printItem(c, ctx),
        ),
      ),
    at_rule: (node, ctx) => {
      const kids = code(node);
      const [at, ...rest] = kids;
      if (!at) return concat(node, ctx);
      const block = rest.find((c) => c.kind === "block");
      const params = rest.filter((c) => c !== block && c.kind !== ";");
      return [
        ctx.print(at),
        params.length > 0 ? [text(" "), raw(params, ctx)] : [],
        block ? [text(" "), ctx.print(block)] : semicolon(node, ctx),
      ];
    },
    binary_query: spaced,
    unary_query: spaced,
    parenthesized_query: concat,
    feature_query: featureQuery,
    feature_name: (node, ctx) => token(node, maybeLower(slice(node, ctx))),
  }),
);
