// Prettier's class printers (print/class.js, class-body.js) and the declaration half of print/decorators.js.

import {
  breakParent,
  type Doc,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  line,
  softline,
  synthetic,
  text,
} from "../../../fmt/doc.js";
import { nextLineEmpty } from "../../../fmt/text.js";
import { printAssignment } from "./assignment.js";
import {
  method,
  printKey,
  printDecorators as printMemberDecorators,
} from "./objects.js";
import {
  anon,
  CF,
  childWhere,
  children,
  field,
  type HasTree,
  hasComment,
  isComment,
  isMember,
  items,
  type JsCtx,
  type JsRule,
  kind,
  lastChildWhere,
  named,
  p,
  parent,
  semi,
  separators,
  src,
  t,
} from "./util.js";

const FIELD_KINDS = new Set(["field_definition", "public_field_definition"]);
const METHOD_KINDS = new Set([
  "method_definition",
  "abstract_method_signature",
  "method_signature",
]);

const decoratorsOf = (x: HasTree, n: number) =>
  children(x, n).filter((c) => kind(x, c) === "decorator");
const kw = (x: HasTree, n: number | undefined, k: string) =>
  n !== undefined && anon(x, n, k) !== undefined;
const heritageOf = (x: HasTree, n: number) =>
  childWhere(x, n, (c) => kind(x, c) === "class_heritage");

/** The superclass expression and the `implements` list of a class, with the nodes that own their keywords. */
function heritage(x: HasTree, n: number) {
  // An interface's `extends A, B` is a list, like a class's `implements`.
  const list = childWhere(x, n, (c) => kind(x, c) === "extends_type_clause");
  if (list !== undefined)
    return {
      h: list,
      ext: undefined,
      imp: list,
      superClass: undefined,
      implementsList: items(x, list),
    };
  const h = heritageOf(x, n);
  if (h === undefined)
    return { superClass: undefined, implementsList: [] as number[] };
  const ext = childWhere(x, h, (c) => kind(x, c) === "extends_clause");
  const imp = childWhere(x, h, (c) => kind(x, c) === "implements_clause");
  const bare = items(x, h)[0];
  const superClass =
    ext !== undefined
      ? field(x, ext, "value")
      : bare === imp
        ? undefined
        : bare;
  return {
    h,
    ext,
    imp,
    superClass,
    implementsList: imp !== undefined ? items(x, imp) : [],
  };
}

const hasMultipleHeritage = (x: HasTree, n: number) => {
  const { superClass, implementsList } = heritage(x, n);
  return (superClass !== undefined ? 1 : 0) + implementsList.length > 1;
};

/** Prettier's shouldPrintClassInGroupMode. */
function groupMode(ctx: JsCtx, n: number): boolean {
  const name = field(ctx, n, "name");
  const typeParameters = field(ctx, n, "type_parameters");
  const { ext, superClass, implementsList } = heritage(ctx, n);
  if (
    hasComment(ctx, name, CF.Trailing) ||
    hasComment(ctx, typeParameters, CF.Trailing) ||
    hasComment(ctx, superClass) ||
    hasMultipleHeritage(ctx, n)
  )
    return true;
  if (superClass !== undefined) {
    if (kind(ctx, parent(ctx, n)) === "assignment_expression") return false;
    return (
      field(ctx, ext ?? n, "type_arguments") === undefined &&
      isMember(ctx, superClass)
    );
  }
  return kind(ctx, implementsList[0]) === "nested_type_identifier";
}

/** The `extends` and `implements` clauses, the part of the class header that indents when it breaks. */
function printHeritage(ctx: JsCtx, n: number, grouped: boolean): Doc {
  const { h, ext, imp, superClass, implementsList } = heritage(ctx, n);
  if (h === undefined) return [];
  const parts: Doc[] = [];
  if (superClass !== undefined) {
    const keyword = t(ctx, anon(ctx, ext ?? h, "extends"));
    let printed: Doc = [
      p(ctx, superClass),
      p(
        ctx,
        ext !== undefined ? field(ctx, ext, "type_arguments") : undefined,
      ),
    ];
    if (kind(ctx, parent(ctx, n)) === "assignment_expression")
      printed = group(
        ifBreak(
          [
            synthetic(superClass, "("),
            indent([softline, printed]),
            softline,
            synthetic(superClass, ")"),
          ],
          printed,
        ),
      );
    const doc: Doc = [keyword, text(" "), printed];
    parts.push(grouped ? [line, group(doc)] : [text(" "), doc]);
  }
  if (imp !== undefined && implementsList.length > 0) {
    const keyword = t(
      ctx,
      childWhere(
        ctx,
        imp,
        (c) =>
          !named(ctx, c) &&
          (kind(ctx, c) === "implements" || kind(ctx, c) === "extends"),
      ),
    );
    const commas = separators(ctx, imp, implementsList);
    const list = join(
      line,
      implementsList.map((c, i) =>
        i < implementsList.length - 1
          ? [p(ctx, c), t(ctx, commas.get(c))]
          : p(ctx, c),
      ),
    );
    if (!hasMultipleHeritage(ctx, n)) {
      const doc: Doc = [keyword, text(" "), list];
      parts.push(grouped ? [line, group(doc)] : [text(" "), doc]);
    } else parts.push([line, keyword, group(indent([line, list]))]);
  }
  return parts;
}

/** Prettier's printDecorators for a declaration: each on its own line above the class. */
function printDeclarationDecorators(
  ctx: JsCtx,
  n: number,
  decorators: readonly number[],
): Doc {
  if (decorators.length === 0) return [];
  const up = parent(ctx, n);
  const exported =
    up !== undefined &&
    kind(ctx, up) === "export_statement" &&
    field(ctx, up, "declaration") === n;
  return [
    exported ? hardline : breakParent,
    join(
      line,
      decorators.map((d) => p(ctx, d)),
    ),
    line,
  ];
}

const printClass: JsRule = (n, ctx) => {
  const grouped = groupMode(ctx, n);
  const parts: Doc[] = [];
  const name = field(ctx, n, "name");
  for (const c of children(ctx, n)) {
    if (named(ctx, c)) break;
    const k = kind(ctx, c);
    if (k === "abstract" || k === "declare") parts.push(t(ctx, c), text(" "));
  }
  const isInterface = kind(ctx, n) === "interface_declaration";
  parts.push(t(ctx, anon(ctx, n, isInterface ? "interface" : "class")));
  const head: Doc[] = [];
  if (name !== undefined) head.push(text(" "), p(ctx, name));
  head.push(p(ctx, field(ctx, n, "type_parameters")));
  const heritageDoc = printHeritage(ctx, n, grouped);
  const body = field(ctx, n, "body");
  if (grouped) {
    const contents: Doc[] = [...head, indent(heritageDoc)];
    const g = group(contents);
    parts.push(
      g,
      !isInterface && body !== undefined && items(ctx, body).length > 0
        ? ifBreak(hardline, text(" "), g)
        : text(" "),
    );
  } else parts.push(...head, heritageDoc, text(" "));
  parts.push(p(ctx, body));
  return [printDeclarationDecorators(ctx, n, decoratorsOf(ctx, n)), parts];
};

const nameText = (ctx: JsCtx, n: number) => {
  const key = field(ctx, n, "name") ?? field(ctx, n, "property");
  return key !== undefined ? src(ctx, key) : "";
};

/** Prettier's shouldPrintSemicolonAfterClassProperty: the `;` a no-semi class still needs against ASI. */
function needsSemicolonAfter(
  ctx: JsCtx,
  n: number,
  next: number | undefined,
): boolean {
  if (ctx.options.semi || !FIELD_KINDS.has(kind(ctx, n))) return false;
  const key = field(ctx, n, "name") ?? field(ctx, n, "property");
  if (
    field(ctx, n, "value") === undefined &&
    kind(ctx, key) === "property_identifier" &&
    field(ctx, n, "type") === undefined
  ) {
    const name = nameText(ctx, n);
    if (name === "static" || name === "get" || name === "set") return true;
  }
  if (next === undefined) return false;
  if (
    kw(ctx, next, "static") ||
    kw(ctx, next, "readonly") ||
    childWhere(ctx, next, (c) => kind(ctx, c) === "accessibility_modifier") !==
      undefined
  )
    return false;
  const nextKey = field(ctx, next, "name") ?? field(ctx, next, "property");
  const computed = kind(ctx, nextKey) === "computed_property_name";
  if (!computed) {
    const name = nextKey !== undefined ? src(ctx, nextKey) : "";
    if (name === "in" || name === "instanceof") return true;
  }
  if (FIELD_KINDS.has(kind(ctx, next))) return computed;
  if (METHOD_KINDS.has(kind(ctx, next))) {
    if (kw(ctx, next, "async") || kw(ctx, next, "get") || kw(ctx, next, "set"))
      return false;
    return computed || kw(ctx, next, "*");
  }
  return kind(ctx, next) === "index_signature";
}

const ownSemicolon = (x: HasTree, n: number) => {
  const up = parent(x, n);
  const siblings = up !== undefined ? children(x, up) : [];
  const next = siblings[siblings.indexOf(n) + 1];
  return next !== undefined && !named(x, next) && kind(x, next) === ";"
    ? next
    : undefined;
};

const classBody: JsRule = (n, ctx) => {
  // A method's decorators parse as its siblings in the class body; they print with the member they precede.
  const members: number[] = [];
  const decoratorsBefore = new Map<number, number[]>();
  let pending: number[] = [];
  for (const c of items(ctx, n)) {
    if (kind(ctx, c) === "decorator") pending.push(c);
    else {
      if (pending.length > 0) decoratorsBefore.set(c, pending);
      pending = [];
      members.push(c);
    }
  }
  const parts: Doc[] = [];
  members.forEach((m, i) => {
    const decorators = decoratorsBefore.get(m);
    parts.push(
      decorators !== undefined
        ? [printMemberDecorators(ctx, decorators), p(ctx, m)]
        : p(ctx, m),
    );
    const next = members[i + 1];
    if (needsSemicolonAfter(ctx, m, next)) parts.push(synthetic(m, ";"));
    if (next !== undefined) {
      parts.push(hardline);
      if (nextLineEmpty(ctx.tree, m)) parts.push(hardline);
    }
  });
  const dangling = ctx.dangling(n);
  if (dangling.length > 0) parts.push(join(hardline, dangling));
  const open = t(ctx, anon(ctx, n, "{"));
  const close = t(
    ctx,
    lastChildWhere(ctx, n, (c) => !named(ctx, c) && kind(ctx, c) === "}"),
  );
  return [
    open,
    parts.length > 0 ? [indent([hardline, parts]), hardline] : [],
    close,
  ];
};

/** Prettier's printClassProperty. */
const classProperty: JsRule = (n, ctx) => {
  const key = field(ctx, n, "name") ?? field(ctx, n, "property");
  const parts: Doc[] = [printMemberDecorators(ctx, decoratorsOf(ctx, n))];
  const all = children(ctx, n);
  for (const c of all) {
    if (c === key) break;
    if (isComment(ctx, c) || kind(ctx, c) === "decorator") continue;
    parts.push(p(ctx, c), text(" "));
  }
  parts.push(printKey(ctx, n));
  const after = key !== undefined ? all.slice(all.indexOf(key) + 1) : [];
  const mark = after.find(
    (c) => !named(ctx, c) && (kind(ctx, c) === "?" || kind(ctx, c) === "!"),
  );
  parts.push(t(ctx, mark), p(ctx, field(ctx, n, "type")));
  const value = field(ctx, n, "value");
  const eq = after.find((c) => !named(ctx, c) && kind(ctx, c) === "=");
  return [
    printAssignment(ctx, n, parts, [text(" "), t(ctx, eq)], value),
    semi(ctx, n, ownSemicolon(ctx, n)),
  ];
};

const staticBlock: JsRule = (n, ctx) => [
  t(ctx, anon(ctx, n, "static")),
  text(" "),
  p(ctx, field(ctx, n, "body")),
];

const decorator: JsRule = (n, ctx) => [
  t(
    ctx,
    childWhere(ctx, n, (c) => kind(ctx, c) === "@"),
  ),
  p(ctx, items(ctx, n)[0]),
];

export const classRules: Record<string, JsRule> = {
  class: printClass,
  class_declaration: printClass,
  abstract_class_declaration: printClass,
  interface_declaration: printClass,
  class_body: classBody,
  field_definition: classProperty,
  public_field_definition: classProperty,
  abstract_method_signature: method,
  class_static_block: staticBlock,
  decorator,
};
