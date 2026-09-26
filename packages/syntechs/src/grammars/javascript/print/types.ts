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
  indentIfBreak,
  join,
  line,
  lineSuffixBoundary,
  softline,
  synthetic,
  text,
  token,
} from "../../../fmt/doc.js";
import {
  hasNewline,
  hasNewlineInRange,
  isNextLineEmpty,
} from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { printAssignment } from "./assignment.js";
import {
  printFunctionParameters,
  shouldGroupFunctionParameters,
  shouldHugTheOnlyFunctionParameter,
} from "./functions.js";
import { array, objectRules, printKey } from "./objects.js";
import { role } from "./parens.js";
import {
  type Args,
  CF,
  field,
  first,
  getComments,
  hasComment,
  isComment,
  isMember,
  items,
  type JsCtx,
  type JsRule,
  p,
  semi,
  separators,
  src,
  t,
  trailingCommaAllowed,
  unparen,
} from "./util.js";

const anonKid = (n: FormatNode, kind: string) =>
  n.children.find((c) => !c.named && c.kind === kind);
const anonKids = (n: FormatNode) => n.children.filter((c) => !c.named);

/** `n`'s children printed one after another, each separated by a space: the shape of every keyword-led type. */
const words = (ctx: JsCtx, n: FormatNode): Doc =>
  join(
    text(" "),
    n.children
      .filter((c) => !isComment(c))
      .map((c) => (c.named ? p(ctx, c) : t(ctx, c))),
  );

// --- where a type stands --------------------------------------------------------------------------------------

const UNION_LIKE = new Set(["union_type", "intersection_type"]);

/**
 * Parentheses, and a union or intersection of one type (`| A`, `& A`): prettier's AST holds neither, so the type
 * inside stands where they stand.
 */
const isTransparentType = (n: FormatNode) =>
  n.kind === "parenthesized_type" ||
  (UNION_LIKE.has(n.kind) && items(n).length === 1);

/** Through a type's parentheses and one-type unions, to the type. */
export function unparenType(n: FormatNode | undefined): FormatNode | undefined {
  while (n && isTransparentType(n)) n = items(n)[0];
  return n;
}

const bare = (n: FormatNode) => unparenType(n) ?? n;

/** The type's real parent (past any parentheses and one-type unions) and the field it holds there. */
function typeRole(n: FormatNode): {
  parent: FormatNode | undefined;
  field: string | undefined;
  top: FormatNode;
} {
  let top = n;
  while (top.parent && isTransparentType(top.parent)) top = top.parent;
  return { parent: top.parent, field: top.field, top };
}
const TYPE_OPERATORS = new Set(["index_type_query", "readonly_type"]);

/** Whether `n` is the object side of `T[K]`. */
const isLookupObject = (n: FormatNode, parent: FormatNode | undefined) =>
  parent?.kind === "lookup_type" && items(parent)[0] === n;

/** The type an infer, function or constructor type ends in, for the constrained-infer rule. */
function returnType(n: FormatNode): FormatNode | undefined {
  const r = field(n, "return_type") ?? field(n, "type");
  return r?.kind === "type_annotation" ? first(r) : r;
}

/** Prettier's needsParens for a type (needs-parentheses.js), asked of a type the source wrapped in parentheses. */
export function typeNeedsParens(n: FormatNode): boolean {
  const { parent, field: key, top } = typeRole(n);
  if (!parent) return false;
  const kind = n.kind;
  const operatorParent = () =>
    parent.kind === "array_type" ||
    parent.kind === "optional_type" ||
    parent.kind === "rest_type" ||
    isLookupObject(top, parent) ||
    TYPE_OPERATORS.has(parent.kind);
  switch (kind) {
    case "function_type":
    case "conditional_type":
    case "constructor_type": {
      if (
        kind === "function_type" &&
        parent.kind === "type_annotation" &&
        parent.parent?.kind === "arrow_function"
      )
        return true;
      if (parent.kind === "conditional_type") {
        if (key === "right" && kind === "conditional_type") return true;
        if (key === "left") return true;
        if (key === "right") {
          const r = returnType(n);
          // `asserts x is T` wraps the predicate prettier reads as TSTypePredicate.
          const predicate = r?.kind === "asserts" ? first(r) : r;
          const inner =
            predicate?.kind === "type_predicate"
              ? field(predicate, "type")
              : predicate;
          if (inner?.kind === "infer_type" && anonKid(inner, "extends"))
            return true;
        }
      }
      if (kind === "conditional_type" && parent.kind === "constraint")
        return true;
      if (UNION_LIKE.has(parent.kind)) return true;
      return operatorParent();
    }
    case "union_type":
    case "intersection_type":
      return UNION_LIKE.has(parent.kind) || operatorParent();
    case "infer_type":
      if (parent.kind === "rest_type") return false;
      if (UNION_LIKE.has(parent.kind) && anonKid(n, "extends")) return true;
      return operatorParent();
    case "index_type_query":
    case "readonly_type":
      return operatorParent();
    case "type_query":
      return isLookupObject(top, parent) || parent.kind === "array_type";
    default:
      return false;
  }
}

/** Source parentheses around a type stay only where prettier would print them. */
const parenthesizedType: JsRule = (n, ctx, args) => {
  const inner = first(n);
  if (!inner) return t(ctx, n);
  if (unparenType(inner) !== inner || !typeNeedsParens(inner))
    return p(ctx, inner, args);
  return [
    t(ctx, anonKid(n, "(")),
    p(ctx, inner),
    t(
      ctx,
      n.children.findLast((c) => !c.named && c.kind === ")"),
    ),
  ];
};

// --- annotations ----------------------------------------------------------------------------------------------

/** `: T`, `?: T`, `-?: T`: the annotation's own token, then the type. */
const annotation: JsRule = (n, ctx) => {
  const [tok] = anonKids(n);
  return [t(ctx, tok), text(" "), p(ctx, items(n)[0])];
};

const typePredicate: JsRule = (n, ctx) => {
  const type = field(n, "type");
  return [
    p(ctx, field(n, "name")),
    type ? [text(" "), t(ctx, anonKid(n, "is")), text(" "), p(ctx, type)] : [],
  ];
};

// --- simple compound types ------------------------------------------------------------------------------------

const arrayType: JsRule = (n, ctx) => [
  p(ctx, items(n)[0]),
  t(ctx, anonKid(n, "[")),
  t(ctx, anonKid(n, "]")),
];

const lookupType: JsRule = (n, ctx) => {
  const [object, index] = items(n);
  return [
    p(ctx, object),
    t(ctx, anonKid(n, "[")),
    p(ctx, index),
    t(ctx, anonKid(n, "]")),
  ];
};

const optionalType: JsRule = (n, ctx) => [
  p(ctx, items(n)[0]),
  t(ctx, anonKid(n, "?")),
];
const restType: JsRule = (n, ctx) => [
  t(ctx, anonKid(n, "...")),
  p(ctx, items(n)[0]),
];
const genericType: JsRule = (n, ctx) => [
  p(ctx, field(n, "name")),
  p(ctx, field(n, "type_arguments")),
];

const typeQuery: JsRule = (n, ctx) => {
  const [expr, ...rest] = items(n);
  return [
    t(ctx, anonKid(n, "typeof")),
    text(" "),
    p(ctx, expr),
    rest.map((r) => p(ctx, r)),
  ];
};

const templateLiteralType: JsRule = (n, ctx) =>
  n.children.map((c) =>
    c.named && c.kind === "template_type" ? p(ctx, c) : t(ctx, c),
  );

const templateType: JsRule = (n, ctx) => [
  t(ctx, anonKid(n, "${")),
  p(ctx, items(n)[0]),
  t(ctx, anonKid(n, "}")),
];

/** `infer U` and `infer U extends C`, the constraint laid out as a type parameter's. */
const inferType: JsRule = (n, ctx) => {
  const [name, constraint] = items(n);
  const parts: Doc[] = [t(ctx, anonKid(n, "infer")), text(" "), p(ctx, name)];
  if (constraint)
    parts.push(printConstraint(ctx, anonKid(n, "extends"), constraint));
  return group(parts);
};

// --- unions and intersections ---------------------------------------------------------------------------------

interface Flat {
  types: FormatNode[];
  /** The operator after each type but the last. */
  ops: Map<FormatNode, FormatNode>;
  /** A leading `|` (`type A = | a | b`), which prettier drops. */
  lead: FormatNode | undefined;
}

/** tree-sitter nests `a | b | c` to the left; prettier's AST holds the flat list. */
export function flattenTypes(n: FormatNode): Flat {
  const out: Flat = { types: [], ops: new Map(), lead: undefined };
  const walk = (x: FormatNode) => {
    for (const c of x.children) {
      if (isComment(c)) continue;
      if (c.named) {
        if (c.kind === n.kind) walk(c);
        else out.types.push(c);
      } else if (c.kind === "|" || c.kind === "&") {
        const last = out.types.at(-1);
        if (last && !out.ops.has(last)) out.ops.set(last, c);
        else if (!last) out.lead ??= c;
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

const isVoidType = (ctx: JsCtx, n: FormatNode) =>
  (n.kind === "predefined_type" || n.kind === "literal_type") &&
  /^(?:void|null)$/.test(src(ctx, n));

/** Prettier's shouldHugUnionType: one object-like type among nothing but `void` and `null`. */
export function shouldHugUnionType(ctx: JsCtx, n: FormatNode): boolean {
  const { types } = flattenTypes(n);
  if (types.some((x) => hasComment(ctx, x))) return false;
  const object = types.find((x) => OBJECT_LIKE.has(bare(x).kind));
  if (!object) return false;
  return types.every((x) => x === object || isVoidType(ctx, bare(x)));
}

const isSimpleType = (ctx: JsCtx, n: FormatNode) =>
  (n.kind === "predefined_type" && !src(ctx, n).startsWith("unique")) ||
  n.kind === "type_identifier" ||
  n.kind === "nested_type_identifier" ||
  n.kind === "this_type";

/** Prettier's shouldHugType. */
function shouldHugType(ctx: JsCtx, n: FormatNode): boolean {
  if (isSimpleType(ctx, n) || n.kind === "object_type") return true;
  return n.kind === "union_type" && shouldHugUnionType(ctx, n);
}

const opDoc = (
  ctx: JsCtx,
  op: FormatNode | undefined,
  anchor: FormatNode,
  kind: string,
): Doc => (op ? t(ctx, op) : synthetic(anchor, kind));

const unionType: JsRule = (n, ctx, args?: Args) => {
  if (isTransparentType(n)) return p(ctx, items(n)[0], args);
  const { types, ops, lead } = flattenTypes(n);
  const bar = (x: FormatNode) => opDoc(ctx, ops.get(x), x, "|");
  if (shouldHugUnionType(ctx, n))
    return join(
      [],
      types.map((x, i) =>
        i === 0
          ? p(ctx, x)
          : [text(" "), bar(types[i - 1] as FormatNode), text(" "), p(ctx, x)],
      ),
    );
  const printed = group(
    types.map((x, i) => {
      const b: Doc =
        i === 0
          ? ifBreak([lead ? t(ctx, lead) : synthetic(x, "|"), text(" ")])
          : [line, bar(types[i - 1] as FormatNode), text(" ")];
      return [b, align(2, p(ctx, x))];
    }),
  );
  const { parent, field: key } = typeRole(n);
  if (n.parent?.kind === "parenthesized_type" && typeNeedsParens(n))
    return group([indent([softline, printed]), softline]);
  if (parent?.kind === "tuple_type" && items(parent).length > 1)
    return group([
      indent([ifBreak([synthetic(n, "("), softline]), printed]),
      softline,
      ifBreak(synthetic(n, ")")),
    ]);
  const noIndent =
    parent?.kind === "type_assertion" ||
    parent?.kind === "tuple_type" ||
    (parent?.kind === "conditional_type" &&
      (key === "consequence" || key === "alternative")) ||
    parent?.kind === "type_arguments";
  if (args?.assignmentLayout === "break-after-operator" || noIndent)
    return printed;
  return group(indent([softline, printed]));
};

const intersectionType: JsRule = (n, ctx, args) => {
  if (isTransparentType(n)) return p(ctx, items(n)[0], args);
  const { types, ops } = flattenTypes(n);
  let wasIndented = false;
  return group(
    types.map((x, i) => {
      const doc = p(ctx, x);
      if (i === 0) return doc;
      const previous = types[i - 1] as FormatNode;
      const amp = opDoc(ctx, ops.get(previous), previous, "&");
      const isObject = bare(x).kind === "object_type";
      const previousIsObject = bare(previous).kind === "object_type";
      if (previousIsObject && isObject)
        return [text(" "), amp, text(" "), wasIndented ? indent(doc) : doc];
      if (
        (!previousIsObject && !isObject) ||
        hasComment(ctx, x, CF.Leading, (c) => hasNewline(ctx.source, c.end))
      )
        return ctx.options.experimentalOperatorPosition === "start"
          ? indent([line, amp, text(" "), doc])
          : indent([text(" "), amp, line, doc]);
      if (i > 1) wasIndented = true;
      return [text(" "), amp, text(" "), i > 1 ? indent(doc) : doc];
    }),
  );
};

// --- type parameters ------------------------------------------------------------------------------------------

/** Prettier's printTypeParameters, for `<...>` lists of parameters and of arguments alike. */
const typeParameters: JsRule = (n, ctx) => {
  const params = items(n);
  const open = t(ctx, anonKid(n, "<"));
  const close = t(
    ctx,
    n.children.findLast((c) => !c.named && c.kind === ">"),
  );
  const commas = separators(n, params);
  const lastComma =
    params.length > 0 ? commas.get(params.at(-1) as FormatNode) : undefined;
  if (params.length === 0) return [open, ctx.dangling(n), close];
  const annotated = n.parent?.parent;
  const isArrowFunctionVariable =
    !(params.length === 1 && params[0]?.kind === "object_type") &&
    n.parent?.kind === "generic_type" &&
    annotated?.kind === "type_annotation" &&
    annotated.parent?.kind === "variable_declarator" &&
    field(annotated.parent, "value")?.kind === "arrow_function";
  const shouldInline =
    !isArrowFunctionVariable &&
    params.length === 1 &&
    shouldHugType(ctx, params[0] as FormatNode) &&
    !params.some((x) => {
      const comments = getComments(ctx, x, CF.Leading | CF.Trailing);
      return (
        comments.length > 0 &&
        (comments.some((c) => ctx.isLineComment(c)) ||
          hasNewline(ctx.source, (comments.at(-1) as FormatNode).end))
      );
    });
  const printed = params.map((x, i) =>
    i < params.length - 1 ? [p(ctx, x), t(ctx, commas.get(x))] : p(ctx, x),
  );
  if (shouldInline)
    return [open, join(text(" "), printed), t(ctx, lastComma, ""), close];
  // `<T,>` in a TSX arrow keeps its comma: without it the list would read as a JSX tag.
  const forced =
    n.kind === "type_parameters" &&
    params.length === 1 &&
    !field(params[0] as FormatNode, "constraint") &&
    n.parent?.kind === "arrow_function" &&
    lastComma !== undefined;
  const trailing: Doc =
    n.kind === "type_arguments"
      ? t(ctx, lastComma, "")
      : forced
        ? t(ctx, lastComma)
        : trailingCommaAllowed(ctx, "all")
          ? lastComma
            ? ifBreak(t(ctx, lastComma), t(ctx, lastComma, ""))
            : ifBreak(synthetic(params.at(-1) as FormatNode, ","))
          : t(ctx, lastComma, "");
  return group([
    open,
    indent([softline, join(line, printed)]),
    trailing,
    softline,
    close,
  ]);
};

/** ` extends C` with the constraint moved to the next line, indented, when it does not fit. */
function printConstraint(
  ctx: JsCtx,
  keyword: FormatNode | undefined,
  type: FormatNode | undefined,
): Doc {
  const g = group(indent(line));
  return [
    text(" "),
    t(ctx, keyword),
    g,
    lineSuffixBoundary,
    indentIfBreak(p(ctx, type), g),
  ];
}

const typeParameter: JsRule = (n, ctx) => {
  const parts: Doc[] = [];
  const name = field(n, "name");
  for (const c of n.children) {
    if (c === name) break;
    if (!isComment(c)) parts.push(t(ctx, c), text(" "));
  }
  parts.push(p(ctx, name));
  const constraint = field(n, "constraint");
  if (constraint)
    parts.push(
      printConstraint(
        ctx,
        anonKid(constraint, "extends"),
        items(constraint)[0],
      ),
    );
  const value = field(n, "value");
  if (value)
    parts.push(printConstraint(ctx, anonKid(value, "="), items(value)[0]));
  return group(parts);
};

// --- declarations ---------------------------------------------------------------------------------------------

const typeAlias: JsRule = (n, ctx) => {
  const left: Doc = [
    t(ctx, anonKid(n, "type")),
    text(" "),
    p(ctx, field(n, "name")),
    p(ctx, field(n, "type_parameters")),
  ];
  return [
    printAssignment(
      ctx,
      n,
      left,
      [text(" "), t(ctx, anonKid(n, "="))],
      field(n, "value"),
    ),
    semi(ctx, n),
  ];
};

const enumDeclaration: JsRule = (n, ctx) => words(ctx, n);

const enumAssignment: JsRule = (n, ctx) => [
  printKey(ctx, n),
  text(" "),
  t(ctx, anonKid(n, "=")),
  text(" "),
  p(ctx, field(n, "value")),
];

/** `module "m" { ... }`, `namespace N.M { ... }`. */
const moduleDeclaration: JsRule = (n, ctx) => {
  const body = field(n, "body");
  const parts: Doc[] = [];
  for (const c of n.children) {
    if (c === body || isComment(c)) continue;
    if (parts.length > 0) parts.push(text(" "));
    parts.push(c.named ? p(ctx, c) : t(ctx, c));
  }
  return [parts, body ? [text(" "), group(p(ctx, body))] : semi(ctx, n)];
};

const ambientDeclaration: JsRule = (n, ctx) => {
  const block = n.children.find((c) => c.kind === "statement_block");
  if (block) {
    const rest = n.children.filter((c) => c !== block && !isComment(c));
    return [
      join(
        text(" "),
        rest.map((c) => (c.named ? p(ctx, c) : t(ctx, c))),
      ),
      text(" "),
      group(p(ctx, block)),
    ];
  }
  return words(ctx, n);
};

// --- casts ----------------------------------------------------------------------------------------------------

/** Prettier's printBinaryCastExpression: `x as T`, `x satisfies T`. */
const castExpression: JsRule = (n, ctx) => {
  const [expression, type] = items(n);
  const keyword = anonKids(n).find(
    (c) => c.kind === "as" || c.kind === "satisfies",
  );
  const constKw = type ? undefined : anonKid(n, "const");
  const parts: Doc[] = [
    p(ctx, expression),
    text(" "),
    t(ctx, keyword),
    text(" "),
    type ? p(ctx, type) : t(ctx, constKw),
  ];
  const { parent, key } = role(n);
  if (
    (key === "callee" &&
      (parent?.kind === "call_expression" ||
        parent?.kind === "new_expression")) ||
    (key === "object" && isMember(parent))
  )
    return group([indent([softline, ...parts]), softline]);
  return parts;
};

const typeAssertion: JsRule = (n, ctx) => {
  const args = n.children.find((c) => c.kind === "type_arguments");
  const expression = items(n).find((c) => c !== args);
  const inner = args ? items(args)[0] : undefined;
  const cast = args
    ? group([
        t(ctx, anonKid(args, "<")),
        indent([softline, p(ctx, inner)]),
        softline,
        t(
          ctx,
          args.children.findLast((c) => !c.named && c.kind === ">"),
        ),
      ])
    : [];
  const printed = p(ctx, expression);
  const bare = expression && unparen(expression).kind;
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
function memberSeparator(n: FormatNode): FormatNode | undefined {
  const siblings = n.parent?.children ?? [];
  for (let i = siblings.indexOf(n) + 1; i < siblings.length; i++) {
    const c = siblings[i] as FormatNode;
    if (!c.named && (c.kind === ";" || c.kind === ",")) return c;
    if (!isComment(c)) return undefined;
  }
  return undefined;
}

const isKeywordProperty = (ctx: JsCtx, n: FormatNode) => {
  if (n.kind !== "property_signature" || field(n, "type")) return false;
  const key = field(n, "name");
  return (
    key?.kind === "property_identifier" &&
    /^(?:static|get|set)$/.test(src(ctx, key))
  );
};

/** Prettier's shouldPrintSemicolonAfterInterfaceProperty. */
function needsInterfaceSemicolon(
  ctx: JsCtx,
  n: FormatNode,
  next: FormatNode | undefined,
): boolean {
  if (ctx.options.semi || n.kind !== "property_signature") return false;
  if (isKeywordProperty(ctx, n)) return true;
  if (!next) return false;
  return next.kind === "call_signature" && !field(n, "type");
}

/** Prettier's printClassMemberSemicolon, from the member's own separator when the source has one. */
function memberSemicolon(ctx: JsCtx, n: FormatNode): Doc {
  const parent = n.parent;
  const sep = memberSeparator(n);
  const put = (text: string): Doc =>
    sep ? token(sep, text) : text ? synthetic(n, text) : [];
  if (!parent) return [];
  if (parent.kind === "interface_body" || parent.kind === "class_body")
    return put(ctx.options.semi ? ";" : "");
  if (parent.kind !== "object_type") return sep ? token(sep, "") : [];
  const members = items(parent);
  const i = members.indexOf(n);
  const next = members[i + 1];
  if (!next)
    return ctx.options.semi
      ? ifBreak(put(";"), sep ? token(sep, "") : [])
      : put("");
  if (ctx.options.semi || needsInterfaceSemicolon(ctx, n, next))
    return put(";");
  return ifBreak(sep ? token(sep, "") : [], put(";"));
}

export const mappedClauseOf = (n: FormatNode) => {
  const members = items(n);
  const only = members[0];
  if (members.length !== 1 || only?.kind !== "index_signature")
    return undefined;
  const clause = only.children.find((c) => c.kind === "mapped_type_clause");
  return clause ? { signature: only, clause } : undefined;
};

/** Prettier's printTypeScriptMappedType, over tree-sitter's `{ [K in T]: V }` object type. */
function mappedType(
  ctx: JsCtx,
  n: FormatNode,
  signature: FormatNode,
  clause: FormatNode,
): Doc {
  const open = anonKid(n, "{");
  const close = n.children.findLast((c) => !c.named && c.kind === "}");
  let shouldBreak = false;
  if (ctx.options.objectWrap === "preserve" && open) {
    const start = open.end;
    const after = ctx.source.slice(start).search(/\S/);
    shouldBreak =
      after >= 0 && hasNewlineInRange(ctx.source, start, start + after);
  }
  const spacing = ctx.options.bracketSpacing ? line : softline;
  const readonlyKw = anonKid(signature, "readonly");
  const sign = field(signature, "sign");
  const name = field(clause, "name");
  const type = field(clause, "type");
  const alias = field(clause, "alias");
  const valueAnnotation = field(signature, "type");
  const sep = memberSeparator(signature);
  const dangling = ctx.dangling(n);
  return group(
    [
      t(ctx, open),
      indent([
        spacing,
        dangling.length > 0 ? [join(hardline, dangling), hardline] : [],
        readonlyKw ? [t(ctx, sign), t(ctx, readonlyKw), text(" ")] : [],
        group([
          t(ctx, anonKid(signature, "[")),
          indent([
            softline,
            p(ctx, name),
            text(" "),
            t(ctx, anonKid(clause, "in")),
            text(" "),
            p(ctx, type),
            alias
              ? [
                  text(" "),
                  t(ctx, anonKid(clause, "as")),
                  text(" "),
                  p(ctx, alias),
                ]
              : [],
          ]),
          softline,
          t(ctx, anonKid(signature, "]")),
        ]),
        p(ctx, valueAnnotation),
        ctx.options.semi
          ? ifBreak(
              sep ? token(sep, ";") : synthetic(signature, ";"),
              sep ? token(sep, "") : [],
            )
          : sep
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
function isHuggedParameterType(ctx: JsCtx, n: FormatNode): boolean {
  const annotation = n.parent;
  if (annotation?.kind !== "type_annotation") return false;
  const param = annotation.parent;
  if (
    param?.kind !== "required_parameter" &&
    param?.kind !== "optional_parameter"
  )
    return false;
  const list = param.parent;
  return (
    list?.kind === "formal_parameters" &&
    shouldHugTheOnlyFunctionParameter(ctx, list.parent)
  );
}

/** Prettier's printClassBody for `TSTypeLiteral` and `TSInterfaceBody`. */
const typeBody: JsRule = (n, ctx) => {
  const isObjectType = n.kind === "object_type";
  const mapped = isObjectType ? mappedClauseOf(n) : undefined;
  if (mapped) return mappedType(ctx, n, mapped.signature, mapped.clause);
  const members = items(n);
  const parts: Doc[] = [];
  members.forEach((m, i) => {
    parts.push(p(ctx, m));
    const next = members[i + 1];
    if (!isObjectType && needsInterfaceSemicolon(ctx, m, next))
      parts.push(synthetic(m, ";"));
    if (next) {
      parts.push(isObjectType ? line : hardline);
      if (isNextLineEmpty(ctx.source, m.end)) parts.push(hardline);
    }
  });
  const dangling = ctx.dangling(n);
  if (dangling.length > 0) parts.push(join(hardline, dangling));
  const open = t(ctx, anonKid(n, "{"));
  const close = t(
    ctx,
    n.children.findLast((c) => !c.named && c.kind === "}"),
  );
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
      hasNewlineInRange(ctx.source, n.start, members[0].start));
  if (parts.length === 0) return group([open, close]);
  const spacing =
    !ctx.options.bracketSpacing || (members.length === 0 && !shouldBreak)
      ? softline
      : line;
  const content: Doc = [open, indent([spacing, ...parts]), spacing, close];
  if (isHuggedParameterType(ctx, n)) return content;
  return group(content, shouldBreak);
};

const propertySignature: JsRule = (n, ctx) => {
  const key = field(n, "name");
  const parts: Doc[] = [];
  for (const c of n.children) {
    if (c === key) break;
    if (!isComment(c)) parts.push(c.named ? p(ctx, c) : t(ctx, c), text(" "));
  }
  const after = key ? n.children.slice(n.children.indexOf(key) + 1) : [];
  return [
    parts,
    printKey(ctx, n),
    t(
      ctx,
      after.find((c) => !c.named && c.kind === "?"),
    ),
    p(ctx, field(n, "type")),
    memberSemicolon(ctx, n),
  ];
};

const methodSignature: JsRule = (n, ctx) => {
  const key = field(n, "name");
  const parts: Doc[] = [];
  for (const c of n.children) {
    if (c === key) break;
    if (!isComment(c)) parts.push(c.named ? p(ctx, c) : t(ctx, c), text(" "));
  }
  const after = key ? n.children.slice(n.children.indexOf(key) + 1) : [];
  parts.push(
    printKey(ctx, n),
    t(
      ctx,
      after.find((c) => !c.named && c.kind === "?"),
    ),
  );
  const parametersDoc = printFunctionParameters(ctx, n, false, true);
  const returnNode = field(n, "return_type");
  const returnTypeDoc = returnNode ? p(ctx, returnNode) : [];
  parts.push(
    shouldGroupFunctionParameters(n, returnTypeDoc)
      ? group(parametersDoc)
      : parametersDoc,
  );
  if (returnNode) parts.push(group(returnTypeDoc));
  return [group(parts), memberSemicolon(ctx, n)];
};

const indexSignature: JsRule = (n, ctx) => {
  const name = field(n, "name");
  const indexType = field(n, "index_type");
  const colon = anonKid(n, ":");
  const parts: Doc[] = [];
  for (const c of n.children) {
    if (!c.named && c.kind === "[") break;
    if (!isComment(c)) parts.push(c.named ? p(ctx, c) : t(ctx, c), text(" "));
  }
  const parameter: Doc = name
    ? [p(ctx, name), t(ctx, colon), text(" "), p(ctx, indexType)]
    : [];
  return [
    parts,
    t(ctx, anonKid(n, "[")),
    name ? group([indent([softline, parameter]), softline]) : [],
    t(ctx, anonKid(n, "]")),
    p(ctx, field(n, "type")),
    memberSemicolon(ctx, n),
  ];
};

/** Prettier's printFunctionType, for function and constructor types and call and construct signatures. */
const functionType: JsRule = (n, ctx) => {
  const parts: Doc[] = [];
  const abstractKw = anonKid(n, "abstract");
  if (abstractKw) parts.push(t(ctx, abstractKw), text(" "));
  const newKw = anonKid(n, "new");
  if (newKw) parts.push(t(ctx, newKw), text(" "));
  let parametersDoc = printFunctionParameters(ctx, n, false, true);
  const isSignature =
    n.kind === "call_signature" || n.kind === "construct_signature";
  const returnNode = field(n, "return_type") ?? field(n, "type");
  const returnTypeDoc: Doc = !returnNode
    ? []
    : isSignature
      ? p(ctx, returnNode)
      : [text(" "), t(ctx, anonKid(n, "=>")), text(" "), p(ctx, returnNode)];
  if (shouldGroupFunctionParameters(n, returnTypeDoc))
    parametersDoc = group(parametersDoc);
  parts.push(parametersDoc, returnTypeDoc);
  // `(): (r: U) => S => x` parses without parentheses around the arrow's return type; prettier adds them.
  if (
    n.kind === "function_type" &&
    n.parent?.kind !== "parenthesized_type" &&
    typeNeedsParens(n)
  )
    return [synthetic(n, "("), group(parts), synthetic(n, ")")];
  return [group(parts), isSignature ? memberSemicolon(ctx, n) : []];
};

export const typeRules: Record<string, JsRule> = {
  parenthesized_type: parenthesizedType,
  literal_type: (n, ctx) => p(ctx, first(n)),
  type_annotation: annotation,
  opting_type_annotation: annotation,
  omitting_type_annotation: annotation,
  adding_type_annotation: annotation,
  type_predicate_annotation: annotation,
  asserts_annotation: annotation,
  asserts: (n, ctx) => words(ctx, n),
  type_predicate: typePredicate,
  array_type: arrayType,
  lookup_type: lookupType,
  optional_type: optionalType,
  rest_type: restType,
  generic_type: genericType,
  type_query: typeQuery,
  index_type_query: (n, ctx) => words(ctx, n),
  readonly_type: (n, ctx) => words(ctx, n),
  template_literal_type: templateLiteralType,
  template_type: templateType,
  infer_type: inferType,
  union_type: unionType,
  intersection_type: intersectionType,
  type_parameters: typeParameters,
  type_arguments: typeParameters,
  type_parameter: typeParameter,
  type_alias_declaration: typeAlias,
  enum_declaration: enumDeclaration,
  enum_body: (n, ctx, args) => (objectRules.object as JsRule)(n, ctx, args),
  enum_assignment: enumAssignment,
  module: moduleDeclaration,
  internal_module: moduleDeclaration,
  ambient_declaration: ambientDeclaration,
  as_expression: castExpression,
  satisfies_expression: castExpression,
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
