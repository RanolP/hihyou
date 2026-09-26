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
import type { FormatNode } from "../../../fmt/tree.js";
import {
  field,
  getComments,
  hasComment,
  isComment,
  items,
  type JsCtx,
  type JsRule,
  p,
  removeLines,
  semi,
  separators,
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
const words = (ctx: JsCtx, n: FormatNode, children = n.children): Doc =>
  join(
    text(" "),
    children
      .filter((c) => !isComment(c))
      .map((c) => (c.named ? p(ctx, c) : t(ctx, c))),
  );

/** Prettier's printModuleSpecifiers over an import clause, or over an export statement's specifier nodes. */
function printSpecifiers(ctx: JsCtx, clauses: readonly FormatNode[]): Doc {
  const standaloneNodes = clauses.filter((c) => STANDALONE.has(c.kind));
  const named = clauses.find((c) => NAMED.has(c.kind));
  const owner = clauses[0]?.parent;
  const commas = owner
    ? separators(owner, clauses)
    : new Map<FormatNode, FormatNode>();
  const comma = (c: FormatNode): Doc => [
    t(ctx, commas.get(c)),
    commas.has(c) ? [] : synthetic(c, ","),
    text(" "),
  ];
  const grouped = named ? items(named) : [];
  const parts: Doc[] = standaloneNodes.map((c, i) => [
    i > 0 ? comma(standaloneNodes[i - 1] as FormatNode) : [],
    p(ctx, c),
  ]);
  if (!named) return parts;
  const open = t(
    ctx,
    named.children.find((c) => !c.named && c.kind === "{"),
  );
  const close = t(
    ctx,
    named.children.findLast((c) => !c.named && c.kind === "}"),
  );
  if (grouped.length === 0) {
    if (standaloneNodes.length > 0) return parts;
    const dangling = ctx.dangling(named);
    return dangling.length > 0
      ? [open, text(" "), join(line, dangling), text(" "), close]
      : [open, close];
  }
  const lastStandalone = standaloneNodes.at(-1);
  if (lastStandalone) parts.push(comma(lastStandalone));
  const itemCommas = separators(named, grouped);
  const printed = grouped.map((s, i) => {
    const sep = itemCommas.get(s);
    return i === grouped.length - 1
      ? p(ctx, s)
      : [p(ctx, s), sep ? t(ctx, sep) : synthetic(s, ",")];
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
        trailingComma(ctx, grouped.at(-1) as FormatNode),
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

const importClause: JsRule = (n, ctx) => printSpecifiers(ctx, items(n));

/** Prettier's printImportDeclaration and printExportDeclaration. */
const moduleStatement: JsRule = (n, ctx) => {
  const decorators = n.children.filter((c) => c.kind === "decorator");
  const children = n.children.filter(
    (c) => c.kind !== "decorator" && !(c.kind === ";" && !c.named),
  );
  const specifiers = children.filter(
    (c) => NAMED.has(c.kind) || c.kind === "namespace_export",
  );
  const pieces: Doc[] = [];
  for (const c of children) {
    if (specifiers.includes(c)) {
      if (c === specifiers[0]) pieces.push(printSpecifiers(ctx, specifiers));
    } else pieces.push(c.named ? p(ctx, c) : t(ctx, c));
  }
  const parts = join(text(" "), pieces);
  const declaration = field(n, "declaration");
  const value = field(n, "value");
  const needsSemi =
    !declaration && !(value && DECLARATION_VALUES.has(value.kind));
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
  const object = items(n)[0];
  const [keyword] = n.children.filter((c) => !c.named);
  let doc = p(ctx, object);
  const props = object ? items(object) : [];
  const only = props[0];
  if (
    props.length === 1 &&
    only?.kind === "pair" &&
    /^(type|"type"|'type')$/.test(
      ctx.source.slice(field(only, "key")?.start, field(only, "key")?.end),
    ) &&
    field(only, "value")?.kind === "string" &&
    getComments(ctx, only).length === 0
  )
    doc = removeLines(doc);
  return [t(ctx, keyword), text(" "), doc];
};

const specifier: JsRule = (n, ctx) => words(ctx, n);

const requireClause: JsRule = (n, ctx) => {
  const [name] = items(n);
  const kids = n.children.filter((c) => !c.named);
  const tok = (k: string) =>
    t(
      ctx,
      kids.find((c) => c.kind === k),
    );
  return [
    p(ctx, name),
    text(" "),
    tok("="),
    text(" "),
    tok("require"),
    tok("("),
    p(ctx, field(n, "source")),
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
