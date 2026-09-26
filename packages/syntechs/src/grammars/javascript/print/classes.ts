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
import { isNextLineEmpty } from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { printAssignment } from "./assignment.js";
import {
  method,
  printKey,
  printDecorators as printMemberDecorators,
} from "./objects.js";
import {
  CF,
  field,
  hasComment,
  isComment,
  isMember,
  items,
  type JsCtx,
  type JsRule,
  p,
  semi,
  separators,
  t,
} from "./util.js";

const FIELD_KINDS = new Set(["field_definition", "public_field_definition"]);
const METHOD_KINDS = new Set([
  "method_definition",
  "abstract_method_signature",
  "method_signature",
]);

const decoratorsOf = (n: FormatNode) =>
  n.children.filter((c) => c.kind === "decorator");
const kw = (n: FormatNode | undefined, kind: string) =>
  n?.children.some((c) => !c.named && c.kind === kind) ?? false;
const heritageOf = (n: FormatNode) =>
  n.children.find((c) => c.kind === "class_heritage");

/** The superclass expression and the `implements` list of a class, with the nodes that own their keywords. */
function heritage(n: FormatNode) {
  // An interface's `extends A, B` is a list, like a class's `implements`.
  const list = n.children.find((c) => c.kind === "extends_type_clause");
  if (list)
    return {
      h: list,
      ext: undefined,
      imp: list,
      superClass: undefined,
      implementsList: items(list),
    };
  const h = heritageOf(n);
  if (!h) return { superClass: undefined, implementsList: [] as FormatNode[] };
  const ext = h.children.find((c) => c.kind === "extends_clause");
  const imp = h.children.find((c) => c.kind === "implements_clause");
  const bare = items(h)[0];
  const superClass = ext
    ? field(ext, "value")
    : bare === imp
      ? undefined
      : bare;
  return { h, ext, imp, superClass, implementsList: imp ? items(imp) : [] };
}

const hasMultipleHeritage = (n: FormatNode) => {
  const { superClass, implementsList } = heritage(n);
  return (superClass ? 1 : 0) + implementsList.length > 1;
};

/** Prettier's shouldPrintClassInGroupMode. */
function groupMode(ctx: JsCtx, n: FormatNode): boolean {
  const name = field(n, "name");
  const typeParameters = field(n, "type_parameters");
  const { ext, superClass, implementsList } = heritage(n);
  if (
    hasComment(ctx, name, CF.Trailing) ||
    hasComment(ctx, typeParameters, CF.Trailing) ||
    hasComment(ctx, superClass) ||
    hasMultipleHeritage(n)
  )
    return true;
  if (superClass) {
    if (n.parent?.kind === "assignment_expression") return false;
    return !field(ext ?? n, "type_arguments") && isMember(superClass);
  }
  const first = implementsList[0];
  return first?.kind === "nested_type_identifier";
}

/** The `extends` and `implements` clauses, the part of the class header that indents when it breaks. */
function printHeritage(ctx: JsCtx, n: FormatNode, grouped: boolean): Doc {
  const { h, ext, imp, superClass, implementsList } = heritage(n);
  if (!h) return [];
  const parts: Doc[] = [];
  if (superClass) {
    const keyword = t(
      ctx,
      (ext ?? h).children.find((c) => !c.named && c.kind === "extends"),
    );
    let printed: Doc = [
      p(ctx, superClass),
      p(ctx, ext && field(ext, "type_arguments")),
    ];
    if (n.parent?.kind === "assignment_expression")
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
  if (imp && implementsList.length > 0) {
    const keyword = t(
      ctx,
      imp.children.find(
        (c) => !c.named && (c.kind === "implements" || c.kind === "extends"),
      ),
    );
    const commas = separators(imp, implementsList);
    const list = join(
      line,
      implementsList.map((c, i) =>
        i < implementsList.length - 1
          ? [p(ctx, c), t(ctx, commas.get(c))]
          : p(ctx, c),
      ),
    );
    if (!hasMultipleHeritage(n)) {
      const doc: Doc = [keyword, text(" "), list];
      parts.push(grouped ? [line, group(doc)] : [text(" "), doc]);
    } else parts.push([line, keyword, group(indent([line, list]))]);
  }
  return parts;
}

/** Prettier's printDecorators for a declaration: each on its own line above the class. */
function printDeclarationDecorators(
  ctx: JsCtx,
  n: FormatNode,
  decorators: readonly FormatNode[],
): Doc {
  if (decorators.length === 0) return [];
  const parent = n.parent;
  const exported =
    parent?.kind === "export_statement" && field(parent, "declaration") === n;
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
  const name = field(n, "name");
  for (const c of n.children) {
    if (c.named) break;
    if (c.kind === "abstract" || c.kind === "declare")
      parts.push(t(ctx, c), text(" "));
  }
  const isInterface = n.kind === "interface_declaration";
  parts.push(
    t(
      ctx,
      n.children.find(
        (c) => !c.named && c.kind === (isInterface ? "interface" : "class"),
      ),
    ),
  );
  const head: Doc[] = [];
  if (name) head.push(text(" "), p(ctx, name));
  head.push(p(ctx, field(n, "type_parameters")));
  const heritageDoc = printHeritage(ctx, n, grouped);
  const body = field(n, "body");
  if (grouped) {
    const contents: Doc[] = [...head, indent(heritageDoc)];
    const g = group(contents);
    parts.push(
      g,
      !isInterface && body && items(body).length > 0
        ? ifBreak(hardline, text(" "), g)
        : text(" "),
    );
  } else parts.push(...head, heritageDoc, text(" "));
  parts.push(p(ctx, body));
  return [printDeclarationDecorators(ctx, n, decoratorsOf(n)), parts];
};

const nameText = (ctx: JsCtx, n: FormatNode) => {
  const key = field(n, "name") ?? field(n, "property");
  return key ? ctx.source.slice(key.start, key.end) : "";
};

/** Prettier's shouldPrintSemicolonAfterClassProperty: the `;` a no-semi class still needs against ASI. */
function needsSemicolonAfter(
  ctx: JsCtx,
  n: FormatNode,
  next: FormatNode | undefined,
): boolean {
  if (ctx.options.semi || !FIELD_KINDS.has(n.kind)) return false;
  const key = field(n, "name") ?? field(n, "property");
  if (
    !field(n, "value") &&
    key?.kind === "property_identifier" &&
    !field(n, "type")
  ) {
    const name = nameText(ctx, n);
    if (name === "static" || name === "get" || name === "set") return true;
  }
  if (!next) return false;
  if (
    kw(next, "static") ||
    kw(next, "readonly") ||
    next.children.some((c) => c.kind === "accessibility_modifier")
  )
    return false;
  const nextKey = field(next, "name") ?? field(next, "property");
  const computed = nextKey?.kind === "computed_property_name";
  if (!computed) {
    const name = nextKey ? ctx.source.slice(nextKey.start, nextKey.end) : "";
    if (name === "in" || name === "instanceof") return true;
  }
  if (FIELD_KINDS.has(next.kind)) return computed;
  if (METHOD_KINDS.has(next.kind)) {
    if (kw(next, "async") || kw(next, "get") || kw(next, "set")) return false;
    return computed || kw(next, "*");
  }
  return next.kind === "index_signature";
}

const ownSemicolon = (n: FormatNode) => {
  const siblings = n.parent?.children ?? [];
  const next = siblings[siblings.indexOf(n) + 1];
  return next && !next.named && next.kind === ";" ? next : undefined;
};

const classBody: JsRule = (n, ctx) => {
  // A method's decorators parse as its siblings in the class body; they print with the member they precede.
  const members: FormatNode[] = [];
  const decoratorsBefore = new Map<FormatNode, FormatNode[]>();
  let pending: FormatNode[] = [];
  for (const c of items(n)) {
    if (c.kind === "decorator") pending.push(c);
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
      decorators
        ? [printMemberDecorators(ctx, decorators), p(ctx, m)]
        : p(ctx, m),
    );
    const next = members[i + 1];
    if (needsSemicolonAfter(ctx, m, next)) parts.push(synthetic(m, ";"));
    if (next) {
      parts.push(hardline);
      if (isNextLineEmpty(ctx.source, m.end)) parts.push(hardline);
    }
  });
  const dangling = ctx.dangling(n);
  if (dangling.length > 0) parts.push(join(hardline, dangling));
  const open = t(
    ctx,
    n.children.find((c) => !c.named && c.kind === "{"),
  );
  const close = t(
    ctx,
    n.children.findLast((c) => !c.named && c.kind === "}"),
  );
  return [
    open,
    parts.length > 0 ? [indent([hardline, parts]), hardline] : [],
    close,
  ];
};

/** Prettier's printClassProperty. */
const classProperty: JsRule = (n, ctx) => {
  const key = field(n, "name") ?? field(n, "property");
  const parts: Doc[] = [printMemberDecorators(ctx, decoratorsOf(n))];
  for (const c of n.children) {
    if (c === key) break;
    if (isComment(c) || c.kind === "decorator") continue;
    parts.push(p(ctx, c), text(" "));
  }
  parts.push(printKey(ctx, n));
  const after = key ? n.children.slice(n.children.indexOf(key) + 1) : [];
  const mark = after.find(
    (c) => !c.named && (c.kind === "?" || c.kind === "!"),
  );
  parts.push(t(ctx, mark), p(ctx, field(n, "type")));
  const value = field(n, "value");
  const eq = after.find((c) => !c.named && c.kind === "=");
  return [
    printAssignment(ctx, n, parts, [text(" "), t(ctx, eq)], value),
    semi(ctx, n, ownSemicolon(n)),
  ];
};

const staticBlock: JsRule = (n, ctx) => [
  t(
    ctx,
    n.children.find((c) => !c.named && c.kind === "static"),
  ),
  text(" "),
  p(ctx, field(n, "body")),
];

const decorator: JsRule = (n, ctx) => [
  t(
    ctx,
    n.children.find((c) => c.kind === "@"),
  ),
  p(ctx, items(n)[0]),
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
