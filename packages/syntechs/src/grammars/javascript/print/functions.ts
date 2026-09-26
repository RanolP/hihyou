// Prettier's function printers: function.js, function-parameters.js, arrow-function.js.

import {
  breakParent,
  type Doc,
  group,
  hardline,
  ifBreak,
  indent,
  indentIfBreak,
  join,
  line,
  softline,
  synthetic,
  text,
  willBreak,
} from "../../../fmt/doc.js";
import { lfAfter, nextLineEmpty } from "../../../fmt/text.js";
import { isTemplateOnItsOwnLine, isTestCall } from "./calls.js";
import { role } from "./parens.js";
import {
  anon,
  ArgExpansionBailout,
  type Args,
  CF,
  callArguments,
  callee,
  childWhere,
  children,
  danglingCommentsInList,
  field,
  first,
  hasComment,
  type HasTree,
  isBinaryish,
  isCall,
  isComment,
  isJsx,
  items,
  type JsCtx,
  type JsRule,
  kind,
  lastChildWhere,
  named,
  objectOf,
  p,
  parameters,
  parent,
  removeLines,
  semi,
  separators,
  src,
  t,
  trailingCommaAllowed,
  unparen,
} from "./util.js";

/** A parameter as prettier's AST would type it. */
type ParamShape =
  | "Identifier"
  | "ObjectPattern"
  | "ArrayPattern"
  | "AssignmentPattern"
  | "RestElement"
  | "TSParameterProperty"
  | "Other";

const PARAMETER_PROPERTY_MODIFIERS = new Set([
  "accessibility_modifier",
  "readonly",
  "override",
]);

function paramShape(
  x: HasTree,
  param: number,
): {
  shape: ParamShape;
  pattern: number | undefined;
  type: number | undefined;
  value: number | undefined;
  optional: boolean;
} {
  const k = kind(x, param);
  if (k === "required_parameter" || k === "optional_parameter") {
    const pattern = field(x, param, "pattern");
    const type = field(x, param, "type");
    const value = field(x, param, "value");
    const optional = k === "optional_parameter";
    const shape: ParamShape =
      childWhere(x, param, (c) =>
        PARAMETER_PROPERTY_MODIFIERS.has(kind(x, c)),
      ) !== undefined
        ? "TSParameterProperty"
        : value !== undefined
          ? "AssignmentPattern"
          : shapeOf(x, pattern);
    return { shape, pattern, type, value, optional };
  }
  if (k === "assignment_pattern")
    return {
      shape: "AssignmentPattern",
      pattern: field(x, param, "left"),
      type: undefined,
      value: field(x, param, "right"),
      optional: false,
    };
  return {
    shape: shapeOf(x, param),
    pattern: param,
    type: undefined,
    value: undefined,
    optional: false,
  };
}

function shapeOf(x: HasTree, n: number | undefined): ParamShape {
  switch (kind(x, n)) {
    case "identifier":
    case "this":
      return "Identifier";
    case "object_pattern":
      return "ObjectPattern";
    case "array_pattern":
      return "ArrayPattern";
    case "rest_pattern":
      return "RestElement";
    case "assignment_pattern":
      return "AssignmentPattern";
    default:
      return "Other";
  }
}

const returnTypeNode = (x: HasTree, fn: number) => {
  const k = kind(x, fn);
  const r =
    field(x, fn, "return_type") ??
    (k === "construct_signature" || k === "constructor_type"
      ? field(x, fn, "type")
      : undefined);
  if (r === undefined) return undefined;
  return kind(x, r) === "type_annotation" ? (first(x, r) ?? r) : r;
};

const OBJECT_TYPES = new Set(["object_type", "mapped_type_clause"]);
const isObjectType = (x: HasTree, n: number | undefined) =>
  n !== undefined && OBJECT_TYPES.has(kind(x, n));

/** Prettier's shouldHugTheOnlyFunctionParameter. */
export function shouldHugTheOnlyFunctionParameter(
  ctx: JsCtx,
  fn: number | undefined,
): boolean {
  if (fn === undefined) return false;
  const params = parameters(ctx, fn);
  if (params.length !== 1) return false;
  const param = params[0] as number;
  if (hasComment(ctx, param)) return false;
  const { shape, pattern, type, value } = paramShape(ctx, param);
  if (shape === "ObjectPattern" || shape === "ArrayPattern") return true;
  if (
    shape === "Identifier" &&
    type !== undefined &&
    isObjectType(ctx, first(ctx, type))
  )
    return true;
  if (shape === "AssignmentPattern") {
    const left = pattern !== undefined ? shapeOf(ctx, pattern) : undefined;
    const right = value !== undefined ? unparen(ctx, value) : undefined;
    const rightKind = kind(ctx, right);
    return (
      (left === "ObjectPattern" || left === "ArrayPattern") &&
      right !== undefined &&
      (rightKind === "identifier" ||
        (rightKind === "object" && items(ctx, right).length === 0) ||
        (rightKind === "array" && items(ctx, right).length === 0))
    );
  }
  return false;
}

/** Prettier's shouldGroupFunctionParameters. */
export function shouldGroupFunctionParameters(
  x: HasTree,
  fn: number,
  returnTypeDoc: Doc,
): boolean {
  const returnType = returnTypeNode(x, fn);
  if (returnType === undefined) return false;
  const typeParameters = field(x, fn, "type_parameters");
  if (typeParameters !== undefined) {
    const params = items(x, typeParameters);
    if (params.length > 1) return false;
    if (params.length === 1) {
      const tp = params[0] as number;
      if (
        field(x, tp, "constraint") !== undefined ||
        field(x, tp, "value") !== undefined
      )
        return false;
    }
  }
  return (
    parameters(x, fn).length === 1 &&
    (isObjectType(x, returnType) || willBreak(returnTypeDoc))
  );
}

function shouldBreakFunctionParameters(x: HasTree, fn: number): boolean {
  const params = parameters(x, fn);
  return (
    params.length > 1 &&
    params.some((param) => paramShape(x, param).shape === "TSParameterProperty")
  );
}

const isSimpleName = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "identifier";

/** Prettier's isDecoratedFunction: `const x = decorator(options)(() => {...})`. */
function isDecoratedFunction(ctx: JsCtx, fn: number): boolean {
  if (
    kind(ctx, fn) !== "arrow_function" ||
    kind(ctx, field(ctx, fn, "body")) !== "statement_block"
  )
    return false;
  const { parent: c, key } = role(ctx, fn);
  if (
    c === undefined ||
    key !== "arguments" ||
    !isCall(ctx, c) ||
    callArguments(ctx, c).length !== 1
  )
    return false;
  const calleeNode = callee(ctx, c);
  const inner = calleeNode !== undefined ? unparen(ctx, calleeNode) : undefined;
  if (inner === undefined || !isCall(ctx, inner)) return false;
  const decorator = callee(ctx, inner);
  if (
    !(
      isSimpleName(ctx, decorator) ||
      (decorator !== undefined &&
        kind(ctx, decorator) === "member_expression" &&
        isSimpleName(ctx, objectOf(ctx, decorator)) &&
        kind(ctx, field(ctx, decorator, "property")) === "property_identifier")
    )
  )
    return false;
  const up = role(ctx, c);
  const holder = up.parent;
  if (holder === undefined) return false;
  const holderKind = kind(ctx, holder);
  if (holderKind === "variable_declarator" && up.key === "init") {
    const declaration = parent(ctx, holder);
    const declarationKind = kind(ctx, declaration);
    return (
      declarationKind !== "variable_declaration" &&
      (declarationKind !== "lexical_declaration" ||
        (src(ctx, declaration as number).startsWith("const") &&
          items(ctx, declaration as number).filter(
            (d) => kind(ctx, d) === "variable_declarator",
          ).length === 1))
    );
  }
  if (holderKind === "export_statement" && up.key === "declaration")
    return true;
  if (holderKind === "assignment_expression" && up.key === "right") {
    const left = field(ctx, holder, "left");
    return (
      left !== undefined &&
      src(ctx, left).replaceAll(/\s/g, "") === "module.exports"
    );
  }
  return false;
}

/** Prettier's printFunctionParameters for function `fn`, whose `formal_parameters` holds the list. */
export function printFunctionParameters(
  ctx: JsCtx,
  fn: number,
  expand = false,
  withTypeParameters = false,
): Doc {
  const typeParametersNode = withTypeParameters
    ? field(ctx, fn, "type_parameters")
    : undefined;
  const typeParametersDoc = p(ctx, typeParametersNode);
  const list = field(ctx, fn, "parameters");
  if (list === undefined) {
    // A lone parameter without parentheses, printed with them.
    const single = field(ctx, fn, "parameter");
    return [
      typeParametersDoc,
      synthetic(fn, "("),
      p(ctx, single),
      synthetic(fn, ")"),
    ];
  }
  return [
    typeParametersDoc,
    ctx.withComments(
      list,
      parametersDoc(ctx, fn, list, expand, typeParametersDoc),
    ),
  ];
}

/** The last anonymous `text` token among `n`'s children. */
const lastAnon = (ctx: JsCtx, n: number, text: string) =>
  lastChildWhere(ctx, n, (c) => !named(ctx, c) && kind(ctx, c) === text);

function parametersDoc(
  ctx: JsCtx,
  fn: number,
  list: number,
  expand: boolean,
  typeParametersDoc: Doc,
): Doc {
  const open = t(ctx, anon(ctx, list, "("));
  const close = t(ctx, lastAnon(ctx, list, ")"));
  const params = items(ctx, list);
  if (params.length === 0)
    return [open, danglingCommentsInList(ctx, list), close];
  const commas = separators(ctx, list, params);
  const inTestCall = isTestCall(ctx, role(ctx, fn).parent);
  const hug = shouldHugTheOnlyFunctionParameter(ctx, fn);
  const printed: Doc[] = [];
  params.forEach((param, index) => {
    printed.push(p(ctx, param));
    if (index === params.length - 1) return;
    printed.push(t(ctx, commas.get(param)));
    if (inTestCall || hug) printed.push(text(" "));
    else if (nextLineEmpty(ctx.tree, param)) printed.push(hardline, hardline);
    else printed.push(line);
  });
  if (expand && !isDecoratedFunction(ctx, fn)) {
    if (willBreak(typeParametersDoc) || willBreak(printed))
      throw new ArgExpansionBailout();
    return group([open, removeLines(printed), close]);
  }
  const decorated = params.some(
    (param) =>
      childWhere(ctx, param, (c) => kind(ctx, c) === "decorator") !==
      undefined,
  );
  if ((hug && !decorated) || inTestCall) return [open, ...printed, close];
  const last = params.at(-1) as number;
  const hasRest =
    paramShape(ctx, last).shape === "RestElement" ||
    kind(ctx, paramShape(ctx, last).pattern) === "rest_pattern";
  return [
    open,
    indent([softline, ...printed]),
    !hasRest && trailingCommaAllowed(ctx, "all")
      ? ifBreak(synthetic(last, ","))
      : [],
    softline,
    close,
  ];
}

/** Prettier's printReturnType. */
const printReturnType = (ctx: JsCtx, fn: number): Doc =>
  p(ctx, field(ctx, fn, "return_type"));

/** Prettier's canPrintParamsWithoutParens. */
export function canPrintParamsWithoutParens(ctx: JsCtx, fn: number): boolean {
  const params = parameters(ctx, fn);
  if (params.length !== 1) return false;
  const param = params[0] as number;
  const { shape, type, optional } = paramShape(ctx, param);
  const list = field(ctx, fn, "parameters");
  return (
    field(ctx, fn, "type_parameters") === undefined &&
    !(list !== undefined && ctx.dangling(list).length > 0) &&
    shape === "Identifier" &&
    kind(ctx, param) !== "this" &&
    type === undefined &&
    !hasComment(ctx, param) &&
    !optional &&
    field(ctx, fn, "return_type") === undefined
  );
}

/** The keyword tokens before a function's name or parameters: `async`, `function`, `*`. */
const keyword = (ctx: JsCtx, n: number, kind: string): Doc =>
  t(ctx, anon(ctx, n, kind));

const functionRule: JsRule = (n, ctx, args?: Args) => {
  let shouldExpandParameters = false;
  const k = kind(ctx, n);
  if (
    (k === "function_expression" || k === "generator_function") &&
    args?.expandLastArg
  ) {
    const parent = role(ctx, n).parent;
    if (
      parent !== undefined &&
      isCall(ctx, parent) &&
      (callArguments(ctx, parent).length > 1 ||
        parameters(ctx, n).every((x) => {
          const s = paramShape(ctx, x);
          return s.shape === "Identifier" && s.type === undefined;
        }))
    )
      shouldExpandParameters = true;
  }
  const parametersDoc = printFunctionParameters(ctx, n, shouldExpandParameters);
  const returnTypeDoc = printReturnType(ctx, n);
  const shouldGroup = shouldGroupFunctionParameters(ctx, n, returnTypeDoc);
  const declare = anon(ctx, n, "declare");
  const async = anon(ctx, n, "async");
  const star = anon(ctx, n, "*");
  const name = field(ctx, n, "name");
  const body = field(ctx, n, "body");
  return [
    declare !== undefined ? [t(ctx, declare), text(" ")] : [],
    async !== undefined ? [t(ctx, async), text(" ")] : [],
    keyword(ctx, n, "function"),
    star !== undefined ? t(ctx, star) : [],
    text(" "),
    p(ctx, name),
    p(ctx, field(ctx, n, "type_parameters")),
    group([shouldGroup ? group(parametersDoc) : parametersDoc, returnTypeDoc]),
    body !== undefined ? [text(" "), p(ctx, body)] : semi(ctx, n),
  ];
};

/** Prettier's printMethodValue: the parameters, return type and body of a method. */
export function printMethodValue(ctx: JsCtx, n: number): Doc {
  const parametersDoc = printFunctionParameters(ctx, n);
  const returnTypeDoc = printReturnType(ctx, n);
  const shouldGroup = shouldGroupFunctionParameters(ctx, n, returnTypeDoc);
  const body = field(ctx, n, "body");
  return [
    p(ctx, field(ctx, n, "type_parameters")),
    group([
      shouldBreakFunctionParameters(ctx, n)
        ? group(parametersDoc, true)
        : shouldGroup
          ? group(parametersDoc)
          : parametersDoc,
      returnTypeDoc,
    ]),
    body !== undefined ? [text(" "), p(ctx, body)] : semi(ctx, n),
  ];
}

// --- arrow functions ----------------------------------------------------------------------------------------

/** Whether `n`'s leftmost token belongs to an object literal (prettier's startsWithNoLookaheadToken). */
function startsWithObject(h: HasTree, n: number): boolean {
  for (let x: number | undefined = n; x !== undefined; ) {
    const k = kind(h, x);
    if (k === "object") return true;
    switch (k) {
      case "parenthesized_expression":
        return false;
      case "ternary_expression":
        x = field(h, x, "condition");
        break;
      case "binary_expression":
      case "assignment_expression":
      case "augmented_assignment_expression":
        x = field(h, x, "left");
        break;
      case "call_expression":
        x = callee(h, x);
        break;
      case "member_expression":
      case "subscript_expression":
        x = objectOf(h, x);
        break;
      case "sequence_expression":
      case "non_null_expression":
      case "as_expression":
      case "satisfies_expression":
        x = first(h, x);
        break;
      case "update_expression": {
        const head: number | undefined = children(h, x)[0];
        x = head !== undefined && named(h, head) ? head : undefined;
        break;
      }
      default:
        return false;
    }
  }
  return false;
}

const shouldAddParensIfNotBreak = (x: HasTree, n: number) =>
  kind(x, n) === "ternary_expression" && !startsWithObject(x, n);

function mayBreakAfterShortPrefix(ctx: JsCtx, body: number): boolean {
  const k = kind(ctx, body);
  return (
    k === "array" ||
    k === "object" ||
    k === "arrow_function" ||
    k === "statement_block" ||
    isJsx(ctx, body) ||
    isTemplateOnItsOwnLine(ctx, body)
  );
}

const isCallLike = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return k === "call_expression" || k === "new_expression";
};

function printArrowSignature(ctx: JsCtx, n: number, args: Args): Doc {
  const parts: Doc[] = [];
  const async = anon(ctx, n, "async");
  if (async !== undefined) parts.push(t(ctx, async), text(" "));
  if (
    ctx.options.arrowParens === "avoid" &&
    canPrintParamsWithoutParens(ctx, n)
  ) {
    const list = field(ctx, n, "parameters");
    if (list !== undefined) {
      // `(a) => a` loses its parentheses.
      const param = parameters(ctx, n)[0] as number;
      parts.push(
        ctx.withComments(list, [
          t(ctx, anon(ctx, list, "("), ""),
          p(ctx, param),
          t(ctx, lastAnon(ctx, list, ","), ""),
          t(ctx, lastAnon(ctx, list, ")"), ""),
        ]),
      );
    } else parts.push(p(ctx, field(ctx, n, "parameter")));
  } else {
    const expand = Boolean(args?.expandLastArg || args?.expandFirstArg);
    let returnTypeDoc = printReturnType(ctx, n);
    if (expand) {
      if (willBreak(returnTypeDoc)) throw new ArgExpansionBailout();
      returnTypeDoc = group(removeLines(returnTypeDoc));
    }
    parts.push(
      group([printFunctionParameters(ctx, n, expand, true), returnTypeDoc]),
    );
  }
  const dangling = ctx.dangling(n);
  if (dangling.length > 0) parts.push(text(" "), join(hardline, dangling));
  return parts;
}

const arrowToken = (ctx: JsCtx, n: number): Doc => [
  text(" "),
  t(ctx, anon(ctx, n, "=>")),
];

const arrow: JsRule = (node, ctx, args?: Args) => {
  const signatureDocs: Doc[] = [];
  const arrows: number[] = [];
  let bodyDoc: Doc = [];
  let shouldBreakChain = false;
  const bodyOf = (x: number) => field(ctx, x, "body") as number;
  const isArrow = (x: number) => kind(ctx, x) === "arrow_function";
  const shouldPrintAsChain =
    !args?.expandLastArg && isArrow(unparen(ctx, bodyOf(node)));
  let functionBody = bodyOf(node);
  let bodyNode = functionBody;

  for (let x = node; ; ) {
    const signature = printArrowSignature(ctx, x, args);
    signatureDocs.push(
      signatureDocs.length === 0 ? signature : ctx.withComments(x, signature),
    );
    arrows.push(x);
    if (shouldPrintAsChain) {
      const params = parameters(ctx, x);
      shouldBreakChain ||=
        (field(ctx, x, "return_type") !== undefined && params.length > 0) ||
        field(ctx, x, "type_parameters") !== undefined ||
        params.some((param) => paramShape(ctx, param).shape !== "Identifier");
    }
    const body = bodyOf(x);
    if (!shouldPrintAsChain || !isArrow(unparen(ctx, body))) {
      bodyNode = body;
      bodyDoc = p(ctx, body, args);
      functionBody = unparen(ctx, body);
      break;
    }
    x = unparen(ctx, body);
  }

  const hasLeadingOwnLine = [bodyNode, functionBody].some((b) =>
    hasComment(ctx, b, CF.Leading, (c) => lfAfter(ctx.tree, c) > 0),
  );
  const shouldPutBodyOnSameLine =
    !hasLeadingOwnLine &&
    (kind(ctx, functionBody) === "sequence_expression" ||
      mayBreakAfterShortPrefix(ctx, functionBody) ||
      (!shouldBreakChain && shouldAddParensIfNotBreak(ctx, functionBody)));

  const { parent, key } = role(ctx, node);
  const isCallee = key === "callee" && isCallLike(ctx, parent);

  // Prettier's printArrowFunctionSignatures.
  const joinSignatures = () => {
    const out: Doc[] = [];
    signatureDocs.forEach((s, i) => {
      if (i > 0) out.push(arrowToken(ctx, arrows[i - 1] as number), line);
      out.push(s);
    });
    return out;
  };
  let signaturesDoc: Doc;
  if (signatureDocs.length === 1) signaturesDoc = signatureDocs[0] as Doc;
  else if (
    (key !== "callee" && isCallLike(ctx, parent)) ||
    isBinaryish(ctx, parent)
  ) {
    const rest: Doc[] = [];
    signatureDocs.slice(1).forEach((s, i) => {
      if (i > 0) rest.push(arrowToken(ctx, arrows[i] as number), line);
      rest.push(s);
    });
    signaturesDoc = group(
      [
        signatureDocs[0] as Doc,
        arrowToken(ctx, arrows[0] as number),
        indent([line, rest]),
      ],
      shouldBreakChain,
    );
  } else if (
    (key === "callee" && isCallLike(ctx, parent)) ||
    args?.assignmentLayout
  )
    signaturesDoc = group(joinSignatures(), shouldBreakChain);
  else signaturesDoc = group(indent(joinSignatures()), shouldBreakChain);

  let shouldBreakSignatures = false;
  let shouldIndentSignatures = false;
  let shouldPrintSoftlineInIndent = false;
  if (shouldPrintAsChain && (isCallee || args?.assignmentLayout)) {
    shouldIndentSignatures = true;
    // Prettier tests `Leading & Line`, which is no flag at all: any comment on the head arrow drops the softline.
    shouldPrintSoftlineInIndent = !hasComment(ctx, node);
    shouldBreakSignatures =
      args?.assignmentLayout === "chain-tail-arrow-chain" ||
      (isCallee && !shouldPutBodyOnSameLine);
  }

  // Prettier's printArrowFunctionBody.
  const trailingComma =
    args?.expandLastArg && trailingCommaAllowed(ctx, "all")
      ? ifBreak(synthetic(node, ","))
      : [];
  const trailingSpace =
    (args?.expandLastArg || kind(ctx, parent) === "jsx_expression") &&
    !hasComment(ctx, node)
      ? softline
      : [];
  let body: Doc;
  if (shouldPutBodyOnSameLine && shouldAddParensIfNotBreak(ctx, functionBody))
    body = [
      text(" "),
      group([
        ifBreak([], synthetic(node, "(")),
        indent([softline, bodyDoc]),
        ifBreak([], synthetic(node, ")")),
        trailingComma,
        trailingSpace,
      ]),
    ];
  else
    body = shouldPutBodyOnSameLine
      ? [text(" "), bodyDoc]
      : [indent([line, bodyDoc]), trailingComma, trailingSpace];

  const chainGroup = group(
    shouldIndentSignatures
      ? indent([shouldPrintSoftlineInIndent ? softline : [], signaturesDoc])
      : signaturesDoc,
    shouldBreakSignatures,
  );
  return group([
    chainGroup,
    arrowToken(ctx, arrows.at(-1) as number),
    shouldPrintAsChain ? indentIfBreak(body, chainGroup) : group(body),
    shouldPrintAsChain && isCallee ? ifBreak(softline, [], chainGroup) : [],
  ]);
};

// --- parameters ---------------------------------------------------------------------------------------------

/** A TS parameter: modifiers, pattern, `?`, type, default. */
const parameter: JsRule = (n, ctx) => {
  const parts: Doc[] = [];
  const decorators: number[] = [];
  const pattern = field(ctx, n, "pattern") ?? field(ctx, n, "name");
  const value = field(ctx, n, "value");
  for (const c of children(ctx, n)) {
    if (c === pattern) break;
    if (isComment(ctx, c)) continue;
    if (kind(ctx, c) === "decorator") decorators.push(c);
    else parts.push(p(ctx, c), text(" "));
  }
  parts.push(
    p(ctx, pattern),
    t(ctx, anon(ctx, n, "?")),
    p(ctx, field(ctx, n, "type")),
  );
  if (value !== undefined)
    parts.push(text(" "), t(ctx, anon(ctx, n, "=")), text(" "), p(ctx, value));
  if (decorators.length === 0) return parts;
  // Prettier's print() wraps a decorated node as group([printDecorators, doc]).
  const broken = decorators.some((d) => lfAfter(ctx.tree, d) > 0);
  return group([
    broken ? breakParent : [],
    join(
      line,
      decorators.map((d) => p(ctx, d)),
    ),
    line,
    parts,
  ]);
};

const assignmentPattern: JsRule = (n, ctx) => [
  p(ctx, field(ctx, n, "left")),
  text(" "),
  t(ctx, anon(ctx, n, "=")),
  text(" "),
  p(ctx, field(ctx, n, "right")),
];

export const functionRules: Record<string, JsRule> = {
  function_declaration: functionRule,
  function_expression: functionRule,
  generator_function: functionRule,
  generator_function_declaration: functionRule,
  function_signature: functionRule,
  arrow_function: arrow,
  required_parameter: parameter,
  optional_parameter: parameter,
  assignment_pattern: assignmentPattern,
};
