// Prettier's TypeScript type printers (print/typescript.js and the files it dispatches to: type-annotation.js,
// union-type.js, intersection-type.js, type-parameters.js, type-alias.js, function-type.js, index-signature.js,
// mapped-type.js, method-signature.js, enum.js, module-declaration.js, binary-cast-expression.js) and the
// TypeScript half of class-body.js.

import {
  align,
  conditionalGroup,
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
  token,
} from "../../../fmt/doc.js";
import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import { lfAfter, newlineBetween, nextLineEmpty } from "../../../fmt/text.js";
import { firstLeaf } from "../../../fmt/tree.js";
import {
  close,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  openIndentIfBreak,
  SOFT,
  sLine,
  sLineSuffixBoundary,
  sText,
  sToken,
} from "../sink.js";
import { printAssignment } from "./assignment.js";
import {
  printFunctionParameters,
  shouldGroupFunctionParameters,
  shouldHugTheOnlyFunctionParameter,
} from "./functions.js";
import { array, printKey } from "./objects.js";
import { role } from "./parens.js";
import {
  type Args,
  anon,
  CF,
  children,
  childWhere,
  field,
  fieldName,
  first,
  getComments,
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
  semi,
  separators,
  src,
  t,
  trailingCommaAllowed,
  unparen,
} from "./util.js";

const anonKid = (x: HasTree, n: number, text: string) => anon(x, n, text);
const anonKids = (x: HasTree, n: number) =>
  children(x, n).filter((c) => !named(x, c));
/** The last anonymous token `text` among `n`'s children: a closing bracket. */
const lastAnonKid = (x: HasTree, n: number, text: string) =>
  lastChildWhere(x, n, (c) => !named(x, c) && kind(x, c) === text);

// The customs below write through the sink (see sink.ts); these print a token or a child that may be absent.
const tok = (js: JsCtx, c: number | undefined, as?: string) => {
  if (c !== undefined) sToken(c, as ?? src(js, c));
};
const pr = (ctx: JsStreamCtx, c: number | undefined, args?: Args) => {
  if (c !== undefined) ctx.print(c, args);
};
const spaced = (ctx: JsStreamCtx, kids: readonly number[]) =>
  kids.forEach((c, i) => {
    if (i > 0) sText(" ");
    if (named(ctx.js, c)) ctx.print(c);
    else tok(ctx.js, c);
  });

// --- where a type stands --------------------------------------------------------------------------------------

const UNION_LIKE = new Set(["union_type", "intersection_type"]);

/**
 * Parentheses, and a union or intersection of one type (`| A`, `& A`): prettier's AST holds neither, so the type
 * inside stands where they stand.
 */
const isTransparentType = (x: HasTree, n: number) =>
  kind(x, n) === "parenthesized_type" ||
  (UNION_LIKE.has(kind(x, n)) && items(x, n).length === 1);

/** Through a type's parentheses and one-type unions, to the type. */
export function unparenType(
  x: HasTree,
  n: number | undefined,
): number | undefined {
  while (n !== undefined && isTransparentType(x, n)) n = items(x, n)[0];
  return n;
}

const bare = (x: HasTree, n: number) => unparenType(x, n) ?? n;

/** The type's real parent (past any parentheses and one-type unions) and the field it holds there. */
function typeRole(
  x: HasTree,
  n: number,
): {
  parent: number | undefined;
  field: string | undefined;
  top: number;
} {
  let top = n;
  for (
    let up = parent(x, top);
    up !== undefined && isTransparentType(x, up);
    up = parent(x, top)
  )
    top = up;
  return { parent: parent(x, top), field: fieldName(x, top), top };
}
const TYPE_OPERATORS = new Set(["index_type_query", "readonly_type"]);

/** Whether `n` is the object side of `T[K]`. */
const isLookupObject = (x: HasTree, n: number, up: number | undefined) =>
  up !== undefined && kind(x, up) === "lookup_type" && items(x, up)[0] === n;

/** The type an infer, function or constructor type ends in, for the constrained-infer rule. */
function returnType(x: HasTree, n: number): number | undefined {
  const r = field(x, n, "return_type") ?? field(x, n, "type");
  return r !== undefined && kind(x, r) === "type_annotation" ? first(x, r) : r;
}

/** Prettier's needsParens for a type (needs-parentheses.js), asked of a type the source wrapped in parentheses. */
export function typeNeedsParens(x: HasTree, n: number): boolean {
  const { parent: up, field: key, top } = typeRole(x, n);
  if (up === undefined) return false;
  const k = kind(x, n);
  const upKind = kind(x, up);
  const operatorParent = () =>
    upKind === "array_type" ||
    upKind === "optional_type" ||
    upKind === "rest_type" ||
    isLookupObject(x, top, up) ||
    TYPE_OPERATORS.has(upKind);
  switch (k) {
    case "function_type":
    case "conditional_type":
    case "constructor_type": {
      if (
        k === "function_type" &&
        upKind === "type_annotation" &&
        kind(x, parent(x, up)) === "arrow_function"
      )
        return true;
      if (upKind === "conditional_type") {
        if (key === "right" && k === "conditional_type") return true;
        if (key === "left") return true;
        if (key === "right") {
          const r = returnType(x, n);
          // `asserts x is T` wraps the predicate prettier reads as TSTypePredicate.
          const predicate =
            kind(x, r) === "asserts" ? first(x, r as number) : r;
          const inner =
            kind(x, predicate) === "type_predicate"
              ? field(x, predicate as number, "type")
              : predicate;
          if (
            kind(x, inner) === "infer_type" &&
            anonKid(x, inner as number, "extends") !== undefined
          )
            return true;
        }
      }
      if (k === "conditional_type" && upKind === "constraint") return true;
      if (UNION_LIKE.has(upKind)) return true;
      return operatorParent();
    }
    case "union_type":
    case "intersection_type":
      return UNION_LIKE.has(upKind) || operatorParent();
    case "infer_type":
      if (upKind === "rest_type") return false;
      if (UNION_LIKE.has(upKind) && anonKid(x, n, "extends") !== undefined)
        return true;
      return operatorParent();
    case "index_type_query":
    case "readonly_type":
      return operatorParent();
    case "type_query":
      return isLookupObject(x, top, up) || upKind === "array_type";
    default:
      return false;
  }
}

/** Source parentheses around a type stay only where prettier would print them. */
const parenthesizedType: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const inner = first(js, n);
  if (inner === undefined) return tok(js, n);
  if (unparenType(js, inner) !== inner || !typeNeedsParens(js, inner))
    return ctx.print(inner, ctx.args);
  tok(js, anonKid(js, n, "("));
  ctx.print(inner);
  tok(js, lastAnonKid(js, n, ")"));
};

/** `infer U` and `infer U extends C`, the constraint laid out as a type parameter's. */
const inferType: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const [name, constraint] = items(js, n);
  open(GROUP);
  tok(js, anonKid(js, n, "infer"));
  sText(" ");
  pr(ctx, name);
  if (constraint !== undefined)
    printConstraint(ctx, anonKid(js, n, "extends"), constraint);
  close();
};

// --- unions and intersections ---------------------------------------------------------------------------------

interface Flat {
  types: number[];
  /** The operator after each type but the last. */
  ops: Map<number, number>;
  /** A leading `|` (`type A = | a | b`), which prettier drops. */
  lead: number | undefined;
}

/** tree-sitter nests `a | b | c` to the left; prettier's AST holds the flat list. */
export function flattenTypes(x: HasTree, n: number): Flat {
  const out: Flat = { types: [], ops: new Map(), lead: undefined };
  const nKind = kind(x, n);
  const walk = (w: number) => {
    for (const c of children(x, w)) {
      if (isComment(x, c)) continue;
      const k = kind(x, c);
      if (named(x, c)) {
        if (k === nKind) walk(c);
        else out.types.push(c);
      } else if (k === "|" || k === "&") {
        const last = out.types.at(-1);
        if (last !== undefined && !out.ops.has(last)) out.ops.set(last, c);
        else if (last === undefined) out.lead ??= c;
      }
    }
  };
  walk(n);
  return out;
}

const OBJECT_LIKE = new Set([
  "object_type",
  "generic_type",
  "type_identifier",
  "nested_type_identifier",
]);

const isVoidType = (ctx: JsCtx, n: number) =>
  (kind(ctx, n) === "predefined_type" || kind(ctx, n) === "literal_type") &&
  /^(?:void|null)$/.test(src(ctx, n));

/** Prettier's shouldHugUnionType: one object-like type among nothing but `void` and `null`. */
export function shouldHugUnionType(ctx: JsCtx, n: number): boolean {
  const { types } = flattenTypes(ctx, n);
  if (types.some((x) => hasComment(ctx, x))) return false;
  const object = types.find((x) => OBJECT_LIKE.has(kind(ctx, bare(ctx, x))));
  if (object === undefined) return false;
  return types.every((x) => x === object || isVoidType(ctx, bare(ctx, x)));
}

const isSimpleType = (ctx: JsCtx, n: number) => {
  const k = kind(ctx, n);
  return (
    (k === "predefined_type" && !src(ctx, n).startsWith("unique")) ||
    k === "type_identifier" ||
    k === "nested_type_identifier" ||
    k === "this_type"
  );
};

/** Prettier's shouldHugType. */
function shouldHugType(ctx: JsCtx, n: number): boolean {
  if (isSimpleType(ctx, n) || kind(ctx, n) === "object_type") return true;
  return kind(ctx, n) === "union_type" && shouldHugUnionType(ctx, n);
}

const opDoc = (
  ctx: JsCtx,
  op: number | undefined,
  anchor: number,
  kind: string,
): Doc => (op !== undefined ? t(ctx, op) : synthetic(anchor, kind));

const unionType: JsRule = (n, ctx, args?: Args) => {
  if (isTransparentType(ctx, n)) return p(ctx, items(ctx, n)[0], args);
  const { types, ops, lead } = flattenTypes(ctx, n);
  const bar = (x: number) => opDoc(ctx, ops.get(x), x, "|");
  if (shouldHugUnionType(ctx, n))
    return join(
      [],
      types.map((x, i) =>
        i === 0
          ? p(ctx, x)
          : [text(" "), bar(types[i - 1] as number), text(" "), p(ctx, x)],
      ),
    );
  const printed = group(
    types.map((x, i) => {
      const b: Doc =
        i === 0
          ? ifBreak([
              lead !== undefined ? t(ctx, lead) : synthetic(x, "|"),
              text(" "),
            ])
          : [line, bar(types[i - 1] as number), text(" ")];
      // A member aligns under its `|`, and its comments do only when one leads it.
      const bare = ctx.printBare(x);
      return ctx.comments(x).leading.length > 0
        ? [b, align(2, ctx.withComments(x, bare))]
        : [b, ctx.withComments(x, align(2, bare))];
    }),
  );
  const { parent: up, field: key } = typeRole(ctx, n);
  const upKind = kind(ctx, up);
  if (
    kind(ctx, parent(ctx, n)) === "parenthesized_type" &&
    typeNeedsParens(ctx, n)
  )
    return group([indent([softline, printed]), softline]);
  if (upKind === "tuple_type" && items(ctx, up as number).length > 1)
    return group([
      indent([ifBreak([synthetic(n, "("), softline]), printed]),
      softline,
      ifBreak(synthetic(n, ")")),
    ]);
  const noIndent =
    upKind === "type_assertion" ||
    upKind === "tuple_type" ||
    (upKind === "conditional_type" &&
      (key === "consequence" || key === "alternative")) ||
    upKind === "type_arguments";
  if (args?.assignmentLayout === "break-after-operator" || noIndent)
    return printed;
  return group(indent([softline, printed]));
};

const intersectionType: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  if (isTransparentType(js, n)) return pr(ctx, items(js, n)[0], ctx.args);
  const { types, ops } = flattenTypes(js, n);
  const indented = (x: number) => {
    open(INDENT);
    ctx.print(x);
    close();
  };
  let wasIndented = false;
  open(GROUP);
  types.forEach((x, i) => {
    if (i === 0) return ctx.print(x);
    const previous = types[i - 1] as number;
    const op = ops.get(previous);
    const amp = () =>
      op !== undefined ? tok(js, op) : sToken(previous, "&", true);
    const isObject = kind(js, bare(js, x)) === "object_type";
    const previousIsObject = kind(js, bare(js, previous)) === "object_type";
    if (previousIsObject && isObject) {
      sText(" ");
      amp();
      sText(" ");
      return wasIndented ? indented(x) : ctx.print(x);
    }
    if (
      (!previousIsObject && !isObject) ||
      hasComment(js, x, CF.Leading, (c) => lfAfter(js.tree, c) > 0)
    ) {
      open(INDENT);
      if (js.options.experimentalOperatorPosition === "start") {
        sLine(0);
        amp();
        sText(" ");
      } else {
        sText(" ");
        amp();
        sLine(0);
      }
      ctx.print(x);
      return close();
    }
    if (i > 1) wasIndented = true;
    sText(" ");
    amp();
    sText(" ");
    return i > 1 ? indented(x) : ctx.print(x);
  });
  close();
};

// --- type parameters ------------------------------------------------------------------------------------------

/** Prettier's printTypeParameters, for `<...>` lists of parameters and of arguments alike. */
const typeParameters: CustomRule<JsOptions> = (n, sctx) => {
  const sc = jsCtx(sctx);
  const ctx = sc.js;
  const params = items(ctx, n);
  const openTok = anonKid(ctx, n, "<");
  const closeTok = lastAnonKid(ctx, n, ">");
  const commas = separators(ctx, n, params);
  const lastComma =
    params.length > 0 ? commas.get(params.at(-1) as number) : undefined;
  if (params.length === 0) {
    tok(ctx, openTok);
    for (const c of sc.danglingComments(n)) sc.comment(c);
    return tok(ctx, closeTok);
  }
  const up = parent(ctx, n);
  const annotated = parent(ctx, up);
  const declarator = parent(ctx, annotated);
  const isArrowFunctionVariable =
    !(params.length === 1 && kind(ctx, params[0]) === "object_type") &&
    kind(ctx, up) === "generic_type" &&
    kind(ctx, annotated) === "type_annotation" &&
    kind(ctx, declarator) === "variable_declarator" &&
    kind(ctx, field(ctx, declarator as number, "value")) === "arrow_function";
  const shouldInline =
    !isArrowFunctionVariable &&
    params.length === 1 &&
    shouldHugType(ctx, params[0] as number) &&
    !params.some((x) => {
      const comments = getComments(ctx, x, CF.Leading | CF.Trailing);
      return (
        comments.length > 0 &&
        (comments.some((c) => ctx.isLineComment(c)) ||
          lfAfter(ctx.tree, comments.at(-1) as number) > 0)
      );
    });
  const printed = (sep: () => void) =>
    params.forEach((x, i) => {
      if (i > 0) sep();
      sc.print(x);
      if (i < params.length - 1) tok(ctx, commas.get(x));
    });
  if (shouldInline) {
    tok(ctx, openTok);
    printed(() => sText(" "));
    tok(ctx, lastComma, "");
    return tok(ctx, closeTok);
  }
  // `<T,>` in a TSX arrow keeps its comma: without it the list would read as a JSX tag.
  const forced =
    kind(ctx, n) === "type_parameters" &&
    params.length === 1 &&
    field(ctx, params[0] as number, "constraint") === undefined &&
    kind(ctx, up) === "arrow_function" &&
    lastComma !== undefined;
  open(GROUP);
  tok(ctx, openTok);
  open(INDENT);
  sLine(SOFT);
  printed(() => sLine(0));
  close();
  if (kind(ctx, n) === "type_arguments") tok(ctx, lastComma, "");
  else if (forced) tok(ctx, lastComma);
  else if (!trailingCommaAllowed(ctx, "all")) tok(ctx, lastComma, "");
  else if (lastComma !== undefined) {
    open(IF_BROKEN);
    tok(ctx, lastComma);
    close();
    open(IF_FLAT);
    tok(ctx, lastComma, "");
    close();
  } else {
    open(IF_BROKEN);
    sToken(params.at(-1) as number, ",", true);
    close();
  }
  sLine(SOFT);
  tok(ctx, closeTok);
  close();
};

/** ` extends C` with the constraint moved to the next line, indented, when it does not fit. */
function printConstraint(
  ctx: JsStreamCtx,
  keyword: number | undefined,
  type: number | undefined,
): void {
  sText(" ");
  tok(ctx.js, keyword);
  const g = open(GROUP);
  open(INDENT);
  sLine(0);
  close();
  close();
  sLineSuffixBoundary();
  openIndentIfBreak(g);
  pr(ctx, type);
  close();
}

const typeParameter: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  open(GROUP);
  const name = field(js, n, "name");
  for (const c of children(js, n)) {
    if (c === name) break;
    if (!isComment(js, c)) {
      tok(js, c);
      sText(" ");
    }
  }
  pr(ctx, name);
  const constraint = field(js, n, "constraint");
  if (constraint !== undefined)
    printConstraint(
      ctx,
      anonKid(js, constraint, "extends"),
      items(js, constraint)[0],
    );
  const value = field(js, n, "value");
  if (value !== undefined)
    printConstraint(ctx, anonKid(js, value, "="), items(js, value)[0]);
  close();
};

// --- declarations ---------------------------------------------------------------------------------------------

const typeAlias: JsRule = (n, ctx) => {
  const left: Doc = [
    t(ctx, anonKid(ctx, n, "type")),
    text(" "),
    p(ctx, field(ctx, n, "name")),
    p(ctx, field(ctx, n, "type_parameters")),
  ];
  return [
    printAssignment(
      ctx,
      n,
      left,
      [text(" "), t(ctx, anonKid(ctx, n, "="))],
      field(ctx, n, "value"),
    ),
    semi(ctx, n),
  ];
};

const enumAssignment: JsRule = (n, ctx) => [
  printKey(ctx, n),
  text(" "),
  t(ctx, anonKid(ctx, n, "=")),
  text(" "),
  p(ctx, field(ctx, n, "value")),
];

/** `module "m" { ... }`, `namespace N.M { ... }`. */
const moduleDeclaration: JsRule = (n, ctx) => {
  const body = field(ctx, n, "body");
  const parts: Doc[] = [];
  for (const c of children(ctx, n)) {
    if (c === body || isComment(ctx, c)) continue;
    if (parts.length > 0) parts.push(text(" "));
    parts.push(named(ctx, c) ? p(ctx, c) : t(ctx, c));
  }
  return [
    parts,
    body !== undefined ? [text(" "), group(p(ctx, body))] : semi(ctx, n),
  ];
};

const ambientDeclaration: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const block = childWhere(js, n, (c) => kind(js, c) === "statement_block");
  spaced(
    ctx,
    children(js, n).filter((c) => c !== block && !isComment(js, c)),
  );
  if (block === undefined) return;
  sText(" ");
  open(GROUP);
  ctx.print(block);
  close();
};

// --- casts ----------------------------------------------------------------------------------------------------

/** Prettier's printBinaryCastExpression: `x as T`, `x satisfies T`. */
const castExpression: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const [expression, type] = items(js, n);
  const keyword = anonKids(js, n).find(
    (c) => kind(js, c) === "as" || kind(js, c) === "satisfies",
  );
  const { parent: up, key } = role(js, n);
  const grouped =
    (key === "callee" &&
      (kind(js, up) === "call_expression" ||
        kind(js, up) === "new_expression")) ||
    (key === "object" && isMember(js, up));
  if (grouped) {
    open(GROUP);
    open(INDENT);
    sLine(SOFT);
  }
  pr(ctx, expression);
  sText(" ");
  tok(js, keyword);
  sText(" ");
  if (type !== undefined) ctx.print(type);
  else tok(js, anonKid(js, n, "const"));
  if (grouped) {
    close();
    sLine(SOFT);
    close();
  }
};

const typeAssertion: JsRule = (n, ctx) => {
  const args = childWhere(ctx, n, (c) => kind(ctx, c) === "type_arguments");
  const expression = items(ctx, n).find((c) => c !== args);
  const inner = args !== undefined ? items(ctx, args)[0] : undefined;
  const cast =
    args !== undefined
      ? group([
          t(ctx, anonKid(ctx, args, "<")),
          indent([softline, p(ctx, inner)]),
          softline,
          t(ctx, lastAnonKid(ctx, args, ">")),
        ])
      : [];
  const printed = p(ctx, expression);
  const bare =
    expression !== undefined ? kind(ctx, unparen(ctx, expression)) : undefined;
  if (bare === "array" || bare === "object") return group([cast, printed]);
  const broken = group(
    [
      ifBreak(synthetic(n, "(")),
      indent([softline, printed]),
      softline,
      ifBreak(synthetic(n, ")")),
    ],
    true,
  );
  return conditionalGroup([
    [cast, printed],
    [cast, broken],
    [cast, printed],
  ]);
};

// --- object types and interfaces ------------------------------------------------------------------------------

/** The `;` or `,` after a member in its body, which prettier reprints as `;` or drops. */
function memberSeparator(x: HasTree, n: number): number | undefined {
  const up = parent(x, n);
  const siblings = up !== undefined ? children(x, up) : [];
  for (let i = siblings.indexOf(n) + 1; i < siblings.length; i++) {
    const c = siblings[i] as number;
    const k = kind(x, c);
    if (!named(x, c) && (k === ";" || k === ",")) return c;
    if (!isComment(x, c)) return undefined;
  }
  return undefined;
}

const isKeywordProperty = (ctx: JsCtx, n: number) => {
  if (
    kind(ctx, n) !== "property_signature" ||
    field(ctx, n, "type") !== undefined
  )
    return false;
  const key = field(ctx, n, "name");
  return (
    kind(ctx, key) === "property_identifier" &&
    /^(?:static|get|set)$/.test(src(ctx, key as number))
  );
};

/** Prettier's shouldPrintSemicolonAfterInterfaceProperty. */
function needsInterfaceSemicolon(
  ctx: JsCtx,
  n: number,
  next: number | undefined,
): boolean {
  if (ctx.options.semi || kind(ctx, n) !== "property_signature") return false;
  if (isKeywordProperty(ctx, n)) return true;
  if (next === undefined) return false;
  return (
    kind(ctx, next) === "call_signature" && field(ctx, n, "type") === undefined
  );
}

/** Prettier's printClassMemberSemicolon, from the member's own separator when the source has one. */
function memberSemicolon(ctx: JsCtx, n: number): Doc {
  const up = parent(ctx, n);
  const sep = memberSeparator(ctx, n);
  const put = (text: string): Doc =>
    sep !== undefined ? token(sep, text) : text ? synthetic(n, text) : [];
  if (up === undefined) return [];
  const upKind = kind(ctx, up);
  if (upKind === "interface_body" || upKind === "class_body")
    return put(ctx.options.semi ? ";" : "");
  if (upKind !== "object_type") return sep !== undefined ? token(sep, "") : [];
  const members = items(ctx, up);
  const i = members.indexOf(n);
  const next = members[i + 1];
  if (next === undefined)
    return ctx.options.semi
      ? ifBreak(put(";"), sep !== undefined ? token(sep, "") : [])
      : put("");
  if (ctx.options.semi || needsInterfaceSemicolon(ctx, n, next))
    return put(";");
  return ifBreak(sep !== undefined ? token(sep, "") : [], put(";"));
}

export const mappedClauseOf = (x: HasTree, n: number) => {
  const members = items(x, n);
  const only = members[0];
  if (members.length !== 1 || kind(x, only) !== "index_signature")
    return undefined;
  const signature = only as number;
  const clause = childWhere(
    x,
    signature,
    (c) => kind(x, c) === "mapped_type_clause",
  );
  return clause !== undefined ? { signature, clause } : undefined;
};

/** Prettier's printTypeScriptMappedType, over tree-sitter's `{ [K in T]: V }` object type. */
function mappedType(
  ctx: JsCtx,
  n: number,
  signature: number,
  clause: number,
): Doc {
  const open = anonKid(ctx, n, "{");
  const close = lastAnonKid(ctx, n, "}");
  let shouldBreak = false;
  // A line break between `{` and the first thing after it, a comment included.
  if (ctx.options.objectWrap === "preserve" && open !== undefined)
    shouldBreak = lfAfter(ctx.tree, open) > 0;
  const spacing = ctx.options.bracketSpacing ? line : softline;
  const readonlyKw = anonKid(ctx, signature, "readonly");
  const sign = field(ctx, signature, "sign");
  const name = field(ctx, clause, "name");
  const type = field(ctx, clause, "type");
  const alias = field(ctx, clause, "alias");
  const valueAnnotation = field(ctx, signature, "type");
  const sep = memberSeparator(ctx, signature);
  const dangling = ctx.dangling(n);
  return group(
    [
      t(ctx, open),
      indent([
        spacing,
        dangling.length > 0 ? [join(hardline, dangling), hardline] : [],
        readonlyKw !== undefined
          ? [t(ctx, sign), t(ctx, readonlyKw), text(" ")]
          : [],
        group([
          t(ctx, anonKid(ctx, signature, "[")),
          indent([
            softline,
            p(ctx, name),
            text(" "),
            t(ctx, anonKid(ctx, clause, "in")),
            text(" "),
            p(ctx, type),
            alias !== undefined
              ? [
                  text(" "),
                  t(ctx, anonKid(ctx, clause, "as")),
                  text(" "),
                  p(ctx, alias),
                ]
              : [],
          ]),
          softline,
          t(ctx, anonKid(ctx, signature, "]")),
        ]),
        p(ctx, valueAnnotation),
        ctx.options.semi
          ? ifBreak(
              sep !== undefined ? token(sep, ";") : synthetic(signature, ";"),
              sep !== undefined ? token(sep, "") : [],
            )
          : sep !== undefined
            ? token(sep, "")
            : [],
      ]),
      spacing,
      t(ctx, close),
    ],
    shouldBreak,
  );
}

/** Whether an object type is the annotation of a function's hugged only parameter. */
function isHuggedParameterType(ctx: JsCtx, n: number): boolean {
  const annotation = parent(ctx, n);
  if (kind(ctx, annotation) !== "type_annotation") return false;
  const param = parent(ctx, annotation);
  const paramKind = kind(ctx, param);
  if (paramKind !== "required_parameter" && paramKind !== "optional_parameter")
    return false;
  const list = parent(ctx, param);
  return (
    kind(ctx, list) === "formal_parameters" &&
    shouldHugTheOnlyFunctionParameter(ctx, parent(ctx, list))
  );
}

/** Prettier's printClassBody for `TSTypeLiteral` and `TSInterfaceBody`. */
const typeBody: JsRule = (n, ctx) => {
  const isObjectType = kind(ctx, n) === "object_type";
  const mapped = isObjectType ? mappedClauseOf(ctx, n) : undefined;
  if (mapped !== undefined)
    return mappedType(ctx, n, mapped.signature, mapped.clause);
  const members = items(ctx, n);
  const parts: Doc[] = [];
  members.forEach((m, i) => {
    parts.push(p(ctx, m));
    const next = members[i + 1];
    if (!isObjectType && needsInterfaceSemicolon(ctx, m, next))
      parts.push(synthetic(m, ";"));
    if (next !== undefined) {
      parts.push(isObjectType ? line : hardline);
      if (nextLineEmpty(ctx.tree, m)) parts.push(hardline);
    }
  });
  const dangling = ctx.dangling(n);
  if (dangling.length > 0) parts.push(join(hardline, dangling));
  const open = t(ctx, anonKid(ctx, n, "{"));
  const close = t(ctx, lastAnonKid(ctx, n, "}"));
  if (!isObjectType)
    return [
      open,
      parts.length > 0 ? [indent([hardline, parts]), hardline] : [],
      close,
    ];
  const shouldBreak =
    hasComment(ctx, n, CF.Dangling | CF.Line) ||
    (ctx.options.objectWrap === "preserve" &&
      members[0] !== undefined &&
      newlineBetween(
        ctx.tree,
        firstLeaf(ctx.tree, n),
        firstLeaf(ctx.tree, members[0]),
      ));
  if (parts.length === 0) return group([open, close]);
  const spacing =
    !ctx.options.bracketSpacing || (members.length === 0 && !shouldBreak)
      ? softline
      : line;
  const content: Doc = [open, indent([spacing, ...parts]), spacing, close];
  if (isHuggedParameterType(ctx, n)) return content;
  return group(content, shouldBreak);
};

/** The children of `n` after its key, where a `?` stands. */
const afterKey = (ctx: JsCtx, n: number, key: number | undefined) => {
  if (key === undefined) return [];
  const kids = children(ctx, n);
  return kids.slice(kids.indexOf(key) + 1);
};

const propertySignature: JsRule = (n, ctx) => {
  const key = field(ctx, n, "name");
  const parts: Doc[] = [];
  for (const c of children(ctx, n)) {
    if (c === key) break;
    if (!isComment(ctx, c))
      parts.push(named(ctx, c) ? p(ctx, c) : t(ctx, c), text(" "));
  }
  const after = afterKey(ctx, n, key);
  return [
    parts,
    printKey(ctx, n),
    t(
      ctx,
      after.find((c) => !named(ctx, c) && kind(ctx, c) === "?"),
    ),
    p(ctx, field(ctx, n, "type")),
    memberSemicolon(ctx, n),
  ];
};

const methodSignature: JsRule = (n, ctx) => {
  const key = field(ctx, n, "name");
  const parts: Doc[] = [];
  for (const c of children(ctx, n)) {
    if (c === key) break;
    if (!isComment(ctx, c))
      parts.push(named(ctx, c) ? p(ctx, c) : t(ctx, c), text(" "));
  }
  const after = afterKey(ctx, n, key);
  parts.push(
    printKey(ctx, n),
    t(
      ctx,
      after.find((c) => !named(ctx, c) && kind(ctx, c) === "?"),
    ),
  );
  const parametersDoc = printFunctionParameters(ctx, n, false, true);
  const returnNode = field(ctx, n, "return_type");
  const returnTypeDoc = returnNode !== undefined ? p(ctx, returnNode) : [];
  parts.push(
    shouldGroupFunctionParameters(ctx, n, returnTypeDoc)
      ? group(parametersDoc)
      : parametersDoc,
  );
  if (returnNode !== undefined) parts.push(group(returnTypeDoc));
  return [group(parts), memberSemicolon(ctx, n)];
};

const indexSignature: JsRule = (n, ctx) => {
  const name = field(ctx, n, "name");
  const indexType = field(ctx, n, "index_type");
  const colon = anonKid(ctx, n, ":");
  const parts: Doc[] = [];
  for (const c of children(ctx, n)) {
    if (!named(ctx, c) && kind(ctx, c) === "[") break;
    if (!isComment(ctx, c))
      parts.push(named(ctx, c) ? p(ctx, c) : t(ctx, c), text(" "));
  }
  const parameter: Doc =
    name !== undefined
      ? [p(ctx, name), t(ctx, colon), text(" "), p(ctx, indexType)]
      : [];
  return [
    parts,
    t(ctx, anonKid(ctx, n, "[")),
    name !== undefined ? group([indent([softline, parameter]), softline]) : [],
    t(ctx, anonKid(ctx, n, "]")),
    p(ctx, field(ctx, n, "type")),
    memberSemicolon(ctx, n),
  ];
};

/** Prettier's printFunctionType, for function and constructor types and call and construct signatures. */
const functionType: JsRule = (n, ctx) => {
  const parts: Doc[] = [];
  const abstractKw = anonKid(ctx, n, "abstract");
  if (abstractKw !== undefined) parts.push(t(ctx, abstractKw), text(" "));
  const newKw = anonKid(ctx, n, "new");
  if (newKw !== undefined) parts.push(t(ctx, newKw), text(" "));
  let parametersDoc = printFunctionParameters(ctx, n, false, true);
  const isSignature =
    kind(ctx, n) === "call_signature" || kind(ctx, n) === "construct_signature";
  const returnNode = field(ctx, n, "return_type") ?? field(ctx, n, "type");
  const returnTypeDoc: Doc =
    returnNode === undefined
      ? []
      : isSignature
        ? p(ctx, returnNode)
        : [
            text(" "),
            t(ctx, anonKid(ctx, n, "=>")),
            text(" "),
            p(ctx, returnNode),
          ];
  if (shouldGroupFunctionParameters(ctx, n, returnTypeDoc))
    parametersDoc = group(parametersDoc);
  parts.push(parametersDoc, returnTypeDoc);
  // `(): (r: U) => S => x` parses without parentheses around the arrow's return type; prettier adds them.
  if (
    kind(ctx, n) === "function_type" &&
    kind(ctx, parent(ctx, n)) !== "parenthesized_type" &&
    typeNeedsParens(ctx, n)
  )
    return [synthetic(n, "("), group(parts), synthetic(n, ")")];
  return [group(parts), isSignature ? memberSemicolon(ctx, n) : []];
};

/** The TypeScript kinds format.ts lays out by hand, by the names its spec gives them. */
export const typeCustoms = {
  parenthesizedType,
  inferType,
  intersectionType,
  typeParameters,
  typeParameter,
  ambientDeclaration,
  castExpression,
} satisfies Record<string, CustomRule<JsOptions>>;

export const typeRules: Record<string, JsRule> = {
  union_type: unionType,
  type_alias_declaration: typeAlias,
  enum_assignment: enumAssignment,
  module: moduleDeclaration,
  internal_module: moduleDeclaration,
  type_assertion: typeAssertion,
  object_type: typeBody,
  interface_body: typeBody,
  property_signature: propertySignature,
  method_signature: methodSignature,
  index_signature: indexSignature,
  call_signature: functionType,
  construct_signature: functionType,
  function_type: functionType,
  constructor_type: functionType,
  tuple_type: array,
};
