// Prettier's import and export printers (print/module.js). Their layouts are format.ts's; what it names `custom`
// is `moduleCustoms`, written against sink.ts.

import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import {
  capture,
  close,
  GROUP,
  IF_BROKEN,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  place,
  removeLines,
  SOFT,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../sink.js";
import { semiCustoms } from "./semi.js";
import { sTok } from "./statements.js";
import {
  CF,
  childWhere,
  children as childrenOf,
  field,
  getComments,
  hasComment,
  isComment,
  items,
  type JsOptions,
  kind,
  lastChildWhere,
  named as isNamed,
  parent,
  separators,
  src,
  trailingCommaAllowed,
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

/** Prettier's printModuleSpecifiers over an import clause, or over an export statement's specifier nodes. */
function printSpecifiers(s: JsStreamCtx, clauses: readonly number[]): void {
  const js = s.js;
  const standaloneNodes = clauses.filter((c) => STANDALONE.has(kind(js, c)));
  const named = clauses.find((c) => NAMED.has(kind(js, c)));
  const owner = parent(js, clauses[0]);
  const commas =
    owner !== undefined
      ? separators(js, owner, clauses)
      : new Map<number, number>();
  const comma = (c: number) => {
    const own = commas.get(c);
    if (own !== undefined) sTok(js, own);
    else sToken(c, ",", true);
    sText(" ");
  };
  standaloneNodes.forEach((c, i) => {
    if (i > 0) comma(standaloneNodes[i - 1] as number);
    s.print(c);
  });
  if (named === undefined) return;
  const grouped = items(js, named);
  const open_ = childWhere(js, named, (c) => !isNamed(js, c) && kind(js, c) === "{");
  const close_ = lastChildWhere(
    js,
    named,
    (c) => !isNamed(js, c) && kind(js, c) === "}",
  );
  if (grouped.length === 0) {
    if (standaloneNodes.length > 0) return;
    const dangling = s.danglingComments(named);
    sTok(js, open_);
    if (dangling.length > 0) {
      sText(" ");
      dangling.forEach((c, i) => {
        if (i > 0) sLine(0);
        s.comment(c);
      });
      sText(" ");
    }
    sTok(js, close_);
    return;
  }
  const lastStandalone = standaloneNodes.at(-1);
  if (lastStandalone !== undefined) comma(lastStandalone);
  const itemCommas = separators(js, named, grouped);
  const printed = (between: () => void) =>
    grouped.forEach((x, i) => {
      if (i > 0) between();
      s.print(x);
      if (i === grouped.length - 1) return;
      const sep = itemCommas.get(x);
      if (sep !== undefined) sTok(js, sep);
      else sToken(x, ",", true);
    });
  const canBreak =
    grouped.length > 1 ||
    standaloneNodes.length > 0 ||
    grouped.some((x) => hasComment(js, x));
  const spacing = js.options.bracketSpacing ? 0 : SOFT;
  if (canBreak) {
    open(GROUP);
    sTok(js, open_);
    open(INDENT);
    sLine(spacing);
    printed(() => sLine(0));
    close();
    if (trailingCommaAllowed(js)) {
      open(IF_BROKEN);
      sToken(grouped.at(-1) as number, ",", true);
      close();
    }
    sLine(spacing);
    sTok(js, close_);
    close();
  } else {
    sTok(js, open_);
    if (js.options.bracketSpacing) sText(" ");
    printed(() => {});
    if (js.options.bracketSpacing) sText(" ");
    sTok(js, close_);
  }
}

/**
 * Prettier's printImportDeclaration and printExportDeclaration. Its `;` is the `semi` rule on the last `;` rather
 * than `tok(";")`'s first, and an export of a declaration, or of a default function or class, has none.
 */
function printModuleStatement(s: JsStreamCtx, n: number, ctx: StreamCtx<JsOptions>): void {
  const js = s.js;
  const all = childrenOf(js, n);
  const decorators = all.filter((c) => kind(js, c) === "decorator");
  const isSemi = (c: number) => kind(js, c) === ";" && !isNamed(js, c);
  const children = all.filter((c) => kind(js, c) !== "decorator" && !isSemi(c));
  const specifiers = children.filter((c) => NAMED.has(kind(js, c)) || kind(js, c) === "namespace_export");
  // A comment attached to a child that `s.print` prints comes out with that child; any other prints where it sits.
  const printedWithChild = new Set(
    children
      .filter((c) => isNamed(js, c) && !isComment(js, c) && !specifiers.includes(c))
      .flatMap((c) => getComments(js, c, CF.Leading | CF.Trailing)),
  );
  for (const d of decorators) {
    s.print(d);
    sHardline();
  }
  let first = true;
  for (const c of children) {
    if (specifiers.includes(c) && c !== specifiers[0]) continue;
    if (printedWithChild.has(c)) continue;
    if (!first) sText(" ");
    first = false;
    if (c === specifiers[0]) printSpecifiers(s, specifiers);
    else if (isNamed(js, c)) s.print(c);
    else sTok(js, c);
  }
  const value = field(js, n, "value");
  if (field(js, n, "declaration") !== undefined) return;
  if (value !== undefined && DECLARATION_VALUES.has(kind(js, value))) return;
  semiCustoms.semi(all.findLast(isSemi), n, ctx);
}

/** The rules format.ts names `custom` for imports and exports. */
export const moduleCustoms = {
  "module.statement": (n, ctx) => printModuleStatement(jsCtx(ctx), n, ctx),

  "module.clause": (n, ctx) => {
    const s = jsCtx(ctx);
    printSpecifiers(s, items(s.js, n));
  },

  /** `with { type: "json" }`: a lone `type` attribute never breaks. */
  "module.attribute": (n, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const object = items(js, n)[0];
    const [keyword] = childrenOf(js, n).filter((c) => !isNamed(js, c));
    sTok(js, keyword);
    sText(" ");
    if (object === undefined) return;
    const props = items(js, object);
    const only = props[0];
    const key = only !== undefined ? field(js, only, "key") : undefined;
    if (
      props.length === 1 &&
      only !== undefined &&
      kind(js, only) === "pair" &&
      key !== undefined &&
      /^(type|"type"|'type')$/.test(src(js, key)) &&
      kind(js, field(js, only, "value")) === "string" &&
      getComments(js, only).length === 0
    )
      place(removeLines(capture(() => s.print(object))));
    else s.print(object);
  },
} satisfies Record<string, CustomRule<JsOptions>>;
