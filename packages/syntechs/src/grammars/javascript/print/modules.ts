// Prettier's import and export printers (print/module.js).

import {
  type Doc,
  group,
  hardline,
  indent,
  join,
  line,
  softline,
  synthetic,
  text,
} from "../../../fmt/doc.js";
import {
  childWhere,
  children as childrenOf,
  field,
  getComments,
  hasComment,
  isComment,
  items,
  type JsCtx,
  type JsRule,
  kind,
  lastChildWhere,
  named as isNamed,
  p,
  parent,
  removeLines,
  semi,
  separators,
  src,
  t,
  trailingComma,
} from "./util.js";

const NAMED = new Set(["named_imports", "export_clause"]);
const STANDALONE = new Set([
  "namespace_import",
  "namespace_export",
  "identifier",
]);
const DECLARATION_VALUES = new Set([
  "function_expression",
  "generator_function",
  "class",
]);

/** `n`'s children as words: each printed and separated by one space, the way every module clause reads. */
const words = (ctx: JsCtx, n: number, children = childrenOf(ctx, n)): Doc =>
  join(
    text(" "),
    children
      .filter((c) => !isComment(ctx, c))
      .map((c) => (isNamed(ctx, c) ? p(ctx, c) : t(ctx, c))),
  );

/** Prettier's printModuleSpecifiers over an import clause, or over an export statement's specifier nodes. */
function printSpecifiers(ctx: JsCtx, clauses: readonly number[]): Doc {
  const standaloneNodes = clauses.filter((c) => STANDALONE.has(kind(ctx, c)));
  const named = clauses.find((c) => NAMED.has(kind(ctx, c)));
  const owner = parent(ctx, clauses[0]);
  const commas =
    owner !== undefined
      ? separators(ctx, owner, clauses)
      : new Map<number, number>();
  const comma = (c: number): Doc => [
    t(ctx, commas.get(c)),
    commas.has(c) ? [] : synthetic(c, ","),
    text(" "),
  ];
  const grouped = named !== undefined ? items(ctx, named) : [];
  const parts: Doc[] = standaloneNodes.map((c, i) => [
    i > 0 ? comma(standaloneNodes[i - 1] as number) : [],
    p(ctx, c),
  ]);
  if (named === undefined) return parts;
  const open = t(
    ctx,
    childWhere(ctx, named, (c) => !isNamed(ctx, c) && kind(ctx, c) === "{"),
  );
  const close = t(
    ctx,
    lastChildWhere(ctx, named, (c) => !isNamed(ctx, c) && kind(ctx, c) === "}"),
  );
  if (grouped.length === 0) {
    if (standaloneNodes.length > 0) return parts;
    const dangling = ctx.dangling(named);
    return dangling.length > 0
      ? [open, text(" "), join(line, dangling), text(" "), close]
      : [open, close];
  }
  const lastStandalone = standaloneNodes.at(-1);
  if (lastStandalone !== undefined) parts.push(comma(lastStandalone));
  const itemCommas = separators(ctx, named, grouped);
  const printed = grouped.map((s, i) => {
    const sep = itemCommas.get(s);
    return i === grouped.length - 1
      ? p(ctx, s)
      : [p(ctx, s), sep !== undefined ? t(ctx, sep) : synthetic(s, ",")];
  });
  const canBreak =
    grouped.length > 1 ||
    standaloneNodes.length > 0 ||
    grouped.some((s) => hasComment(ctx, s));
  const spacing = ctx.options.bracketSpacing ? line : softline;
  if (canBreak)
    parts.push(
      group([
        open,
        indent([spacing, join(line, printed)]),
        trailingComma(ctx, grouped.at(-1) as number),
        spacing,
        close,
      ]),
    );
  else
    parts.push([
      open,
      ctx.options.bracketSpacing ? text(" ") : [],
      printed,
      ctx.options.bracketSpacing ? text(" ") : [],
      close,
    ]);
  return parts;
}

const importClause: JsRule = (n, ctx) => printSpecifiers(ctx, items(ctx, n));

/** Prettier's printImportDeclaration and printExportDeclaration. */
const moduleStatement: JsRule = (n, ctx) => {
  const all = childrenOf(ctx, n);
  const decorators = all.filter((c) => kind(ctx, c) === "decorator");
  const children = all.filter(
    (c) =>
      kind(ctx, c) !== "decorator" &&
      !(kind(ctx, c) === ";" && !isNamed(ctx, c)),
  );
  const specifiers = children.filter(
    (c) => NAMED.has(kind(ctx, c)) || kind(ctx, c) === "namespace_export",
  );
  const pieces: Doc[] = [];
  for (const c of children) {
    if (specifiers.includes(c)) {
      if (c === specifiers[0]) pieces.push(printSpecifiers(ctx, specifiers));
    } else pieces.push(isNamed(ctx, c) ? p(ctx, c) : t(ctx, c));
  }
  const parts = join(text(" "), pieces);
  const declaration = field(ctx, n, "declaration");
  const value = field(ctx, n, "value");
  const needsSemi =
    declaration === undefined &&
    !(value !== undefined && DECLARATION_VALUES.has(kind(ctx, value)));
  return [
    decorators.length > 0
      ? [
          join(
            hardline,
            decorators.map((d) => p(ctx, d)),
          ),
          hardline,
        ]
      : [],
    parts,
    needsSemi ? semi(ctx, n) : [],
  ];
};

/** `with { type: "json" }`: a lone `type` attribute never breaks. */
const importAttribute: JsRule = (n, ctx) => {
  const object = items(ctx, n)[0];
  const [keyword] = childrenOf(ctx, n).filter((c) => !isNamed(ctx, c));
  let doc = p(ctx, object);
  const props = object !== undefined ? items(ctx, object) : [];
  const only = props[0];
  const key = only !== undefined ? field(ctx, only, "key") : undefined;
  if (
    props.length === 1 &&
    only !== undefined &&
    kind(ctx, only) === "pair" &&
    key !== undefined &&
    /^(type|"type"|'type')$/.test(src(ctx, key)) &&
    kind(ctx, field(ctx, only, "value")) === "string" &&
    getComments(ctx, only).length === 0
  )
    doc = removeLines(doc);
  return [t(ctx, keyword), text(" "), doc];
};

const specifier: JsRule = (n, ctx) => words(ctx, n);

const requireClause: JsRule = (n, ctx) => {
  const [name] = items(ctx, n);
  const kids = childrenOf(ctx, n).filter((c) => !isNamed(ctx, c));
  const tok = (k: string) =>
    t(
      ctx,
      kids.find((c) => kind(ctx, c) === k),
    );
  return [
    p(ctx, name),
    text(" "),
    tok("="),
    text(" "),
    tok("require"),
    tok("("),
    p(ctx, field(ctx, n, "source")),
    tok(")"),
  ];
};

export const moduleRules: Record<string, JsRule> = {
  import_statement: moduleStatement,
  export_statement: moduleStatement,
  import_clause: importClause,
  import_specifier: specifier,
  export_specifier: specifier,
  namespace_import: specifier,
  namespace_export: specifier,
  import_attribute: importAttribute,
  import_require_clause: requireClause,
};
