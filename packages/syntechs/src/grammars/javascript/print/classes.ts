// Prettier's class printers (print/class.js, class-body.js) and the declaration half of print/decorators.js.

import {
  type Doc,
  hardline,
  join,
  text,
} from "../../../fmt/doc.js";
import type { CustomRule, TokenRule } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import { nextLineEmpty } from "../../../fmt/text.js";
import {
  capture,
  close,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  jsCtx,
  open,
  place,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../sink.js";
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
  type JsOptions,
  type JsRule,
  kind,
  lastChildWhere,
  named,
  p,
  parent,
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

/** `c` as the source token it is; nothing when absent. */
const tok = (ctx: JsCtx, c: number | undefined) => {
  if (c !== undefined) sToken(c, src(ctx, c));
};

/** `node` with its comments; nothing when absent. */
const print = (sctx: StreamCtx<JsOptions>, node: number | undefined) => {
  if (node !== undefined) sctx.print(node);
};

/** `doc` a line apart, in a group of its own, when `grouped`; else a space apart. */
function clause(grouped: boolean, doc: () => void): void {
  if (!grouped) {
    sText(" ");
    doc();
    return;
  }
  sLine(0);
  open(GROUP);
  doc();
  close();
}

/** The `extends` and `implements` clauses, the part of the class header that indents when it breaks. */
function printHeritage(
  sctx: StreamCtx<JsOptions>,
  n: number,
  grouped: boolean,
): void {
  const { js: ctx } = jsCtx(sctx);
  const { h, ext, imp, superClass, implementsList } = heritage(ctx, n);
  if (h === undefined) return;
  if (superClass !== undefined) {
    const superClassAndArgs = () => {
      sctx.print(superClass);
      print(
        sctx,
        ext !== undefined ? field(ctx, ext, "type_arguments") : undefined,
      );
    };
    clause(grouped, () => {
      tok(ctx, anon(ctx, ext ?? h, "extends"));
      sText(" ");
      if (kind(ctx, parent(ctx, n)) !== "assignment_expression") {
        superClassAndArgs();
        return;
      }
      // Printed once, placed in both branches.
      const printed = capture(superClassAndArgs);
      open(GROUP);
      open(IF_BROKEN);
      sToken(superClass, "(", true);
      open(INDENT);
      sLine(SOFT);
      place(printed);
      close();
      sLine(SOFT);
      sToken(superClass, ")", true);
      close();
      open(IF_FLAT);
      place(printed);
      close();
      close();
    });
  }
  if (imp !== undefined && implementsList.length > 0) {
    const keyword = childWhere(
      ctx,
      imp,
      (c) =>
        !named(ctx, c) &&
        (kind(ctx, c) === "implements" || kind(ctx, c) === "extends"),
    );
    const commas = separators(ctx, imp, implementsList);
    const list = () =>
      implementsList.forEach((c, i) => {
        if (i > 0) sLine(0);
        sctx.print(c);
        if (i < implementsList.length - 1) tok(ctx, commas.get(c));
      });
    if (!hasMultipleHeritage(ctx, n))
      clause(grouped, () => {
        tok(ctx, keyword);
        sText(" ");
        list();
      });
    else {
      sLine(0);
      tok(ctx, keyword);
      open(GROUP);
      open(INDENT);
      sLine(0);
      list();
      close();
      close();
    }
  }
}

/** Prettier's printDecorators for a declaration: each on its own line above the class. */
function printDeclarationDecorators(
  sctx: StreamCtx<JsOptions>,
  n: number,
): void {
  const { js: ctx } = jsCtx(sctx);
  const decorators = decoratorsOf(ctx, n);
  if (decorators.length === 0) return;
  const up = parent(ctx, n);
  const exported =
    up !== undefined &&
    kind(ctx, up) === "export_statement" &&
    field(ctx, up, "declaration") === n;
  if (exported) sHardline();
  else sBreakParent();
  decorators.forEach((d, i) => {
    if (i > 0) sLine(0);
    sctx.print(d);
  });
  sLine(0);
}

/** Prettier's printClass, for classes and interfaces. */
const printClass: CustomRule<JsOptions> = (n, sctx) => {
  const { js: ctx } = jsCtx(sctx);
  printDeclarationDecorators(sctx, n);
  const grouped = groupMode(ctx, n);
  const name = field(ctx, n, "name");
  for (const c of children(ctx, n)) {
    if (named(ctx, c)) break;
    const k = kind(ctx, c);
    if (k === "abstract" || k === "declare") {
      tok(ctx, c);
      sText(" ");
    }
  }
  const isInterface = kind(ctx, n) === "interface_declaration";
  tok(ctx, anon(ctx, n, isInterface ? "interface" : "class"));
  const head = () => {
    if (name !== undefined) {
      sText(" ");
      sctx.print(name);
    }
    print(sctx, field(ctx, n, "type_parameters"));
  };
  const body = field(ctx, n, "body");
  if (grouped) {
    const g = open(GROUP);
    head();
    open(INDENT);
    printHeritage(sctx, n, true);
    close();
    close();
    if (!isInterface && body !== undefined && items(ctx, body).length > 0) {
      open(IF_BROKEN, g);
      sHardline();
      close();
      open(IF_FLAT, g);
      sText(" ");
      close();
    } else sText(" ");
  } else {
    head();
    printHeritage(sctx, n, false);
    sText(" ");
  }
  print(sctx, body);
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

/** Prettier's printClassBody. */
const classBody: CustomRule<JsOptions> = (n, sctx) => {
  const { js: ctx } = jsCtx(sctx);
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
  const dangling = ctx.dangling(n);
  tok(ctx, anon(ctx, n, "{"));
  if (members.length > 0 || dangling.length > 0) {
    open(INDENT);
    sHardline();
    members.forEach((m, i) => {
      const decorators = decoratorsBefore.get(m);
      if (decorators !== undefined)
        place({ doc: printMemberDecorators(ctx, decorators) });
      sctx.print(m);
      const next = members[i + 1];
      if (next !== undefined) {
        sHardline();
        if (nextLineEmpty(ctx.tree, m)) sHardline();
      }
    });
    if (dangling.length > 0) place({ doc: join(hardline, dangling) });
    close();
    sHardline();
  }
  tok(
    ctx,
    lastChildWhere(ctx, n, (c) => !named(ctx, c) && kind(ctx, c) === "}"),
  );
};

/** The member of `n`'s class body after `n`, a decorator of it aside. */
function nextMember(x: HasTree, n: number): number | undefined {
  const up = parent(x, n);
  if (up === undefined) return undefined;
  const members = items(x, up).filter((c) => kind(x, c) !== "decorator");
  return members[members.indexOf(n) + 1];
}

/**
 * A class property's `;`, which a spec writes as `tok(";").via("class.semi")`: the body's `;` after the property
 * (it parses as the body's, not the property's), or one added; under `semi: false`, only the one ASI needs.
 */
const classSemi: TokenRule<JsOptions> = (token, n, sctx) => {
  const { js: ctx } = jsCtx(sctx);
  const own = ownSemicolon(ctx, n) ?? token;
  const present = own !== undefined && src(ctx, own) !== "";
  if (ctx.options.semi) {
    if (present) sToken(own, ";");
    else sToken(n, ";", true);
    return;
  }
  if (present) sToken(own, "");
  if (needsSemicolonAfter(ctx, n, nextMember(ctx, n))) sToken(n, ";", true);
};

/**
 * Prettier's printClassProperty, which a spec writes as `tok("=").via("class.property")`: the property as an
 * assignment of its value (if any) to its decorators, modifiers, key and type.
 */
const classProperty: TokenRule<JsOptions> = (eq, n, sctx) => {
  const { js: ctx } = jsCtx(sctx);
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
  place({
    doc: printAssignment(ctx, n, parts, [text(" "), t(ctx, eq)], value),
  });
};

export const classCustoms = {
  class: printClass,
  "class.body": classBody,
  "class.property": classProperty,
  "class.semi": classSemi,
} satisfies Record<string, CustomRule<JsOptions> | TokenRule<JsOptions>>;

export const classRules: Record<string, JsRule> = {
  abstract_method_signature: method,
};
