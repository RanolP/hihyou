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
import { hasNewline, isNextLineEmpty } from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { isTemplateOnItsOwnLine, isTestCall } from "./calls.js";
import { role } from "./parens.js";
import {
  ArgExpansionBailout,
  type Args,
  CF,
  callArguments,
  callee,
  danglingCommentsInList,
  field,
  first,
  hasComment,
  isBinaryish,
  isCall,
  isComment,
  isJsx,
  items,
  type JsCtx,
  type JsRule,
  objectOf,
  p,
  parameters,
  removeLines,
  semi,
  separators,
  src,
  t,
  trailingCommaAllowed,
  unparen,
} from "./util.js";

const anonKid = (n: FormatNode, kind: string) =>
  n.children.find((c) => !c.named && c.kind === kind);

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

function paramShape(param: FormatNode): {
  shape: ParamShape;
  pattern: FormatNode | undefined;
  type: FormatNode | undefined;
  value: FormatNode | undefined;
  optional: boolean;
} {
  if (
    param.kind === "required_parameter" ||
    param.kind === "optional_parameter"
  ) {
    const pattern = field(param, "pattern");
    const type = field(param, "type");
    const value = field(param, "value");
    const optional = param.kind === "optional_parameter";
    const shape: ParamShape = param.children.some((c) =>
      PARAMETER_PROPERTY_MODIFIERS.has(c.kind),
    )
      ? "TSParameterProperty"
      : value
        ? "AssignmentPattern"
        : shapeOf(pattern);
    return { shape, pattern, type, value, optional };
  }
  if (param.kind === "assignment_pattern")
    return {
      shape: "AssignmentPattern",
      pattern: field(param, "left"),
      type: undefined,
      value: field(param, "right"),
      optional: false,
    };
  return {
    shape: shapeOf(param),
    pattern: param,
    type: undefined,
    value: undefined,
    optional: false,
  };
}

function shapeOf(n: FormatNode | undefined): ParamShape {
  switch (n?.kind) {
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

const returnTypeNode = (fn: FormatNode) => {
  const r =
    field(fn, "return_type") ??
    (fn.kind === "construct_signature" || fn.kind === "constructor_type"
      ? field(fn, "type")
      : undefined);
  if (!r) return undefined;
  return r.kind === "type_annotation" ? (first(r) ?? r) : r;
};

const OBJECT_TYPES = new Set(["object_type", "mapped_type_clause"]);
const isObjectType = (n: FormatNode | undefined) =>
  n !== undefined && OBJECT_TYPES.has(n.kind);

/** Prettier's shouldHugTheOnlyFunctionParameter. */
export function shouldHugTheOnlyFunctionParameter(
  ctx: JsCtx,
  fn: FormatNode | undefined,
): boolean {
  if (!fn) return false;
  const params = parameters(fn);
  if (params.length !== 1) return false;
  const param = params[0] as FormatNode;
  if (hasComment(ctx, param)) return false;
  const { shape, pattern, type, value } = paramShape(param);
  if (shape === "ObjectPattern" || shape === "ArrayPattern") return true;
  if (shape === "Identifier" && type && isObjectType(first(type))) return true;
  if (shape === "AssignmentPattern") {
    const left = pattern && shapeOf(pattern);
    const right = value && unparen(value);
    return (
      (left === "ObjectPattern" || left === "ArrayPattern") &&
      right !== undefined &&
      (right.kind === "identifier" ||
        (right.kind === "object" && items(right).length === 0) ||
        (right.kind === "array" && items(right).length === 0))
    );
  }
  return false;
}

/** Prettier's shouldGroupFunctionParameters. */
export function shouldGroupFunctionParameters(
  fn: FormatNode,
  returnTypeDoc: Doc,
): boolean {
  const returnType = returnTypeNode(fn);
  if (!returnType) return false;
  const typeParameters = field(fn, "type_parameters");
  if (typeParameters) {
    const params = items(typeParameters);
    if (params.length > 1) return false;
    if (params.length === 1) {
      const tp = params[0] as FormatNode;
      if (field(tp, "constraint") || field(tp, "value")) return false;
    }
  }
  return (
    parameters(fn).length === 1 &&
    (isObjectType(returnType) || willBreak(returnTypeDoc))
  );
}

function shouldBreakFunctionParameters(fn: FormatNode): boolean {
  const params = parameters(fn);
  return (
    params.length > 1 &&
    params.some((x) => paramShape(x).shape === "TSParameterProperty")
  );
}

const isSimpleName = (n: FormatNode | undefined) => n?.kind === "identifier";

/** Prettier's isDecoratedFunction: `const x = decorator(options)(() => {...})`. */
function isDecoratedFunction(ctx: JsCtx, fn: FormatNode): boolean {
  if (
    fn.kind !== "arrow_function" ||
    field(fn, "body")?.kind !== "statement_block"
  )
    return false;
  const { parent: c, key } = role(fn);
  if (!c || key !== "arguments" || !isCall(c) || callArguments(c).length !== 1)
    return false;
  const inner = callee(c) && unparen(callee(c) as FormatNode);
  if (!inner || !isCall(inner)) return false;
  const decorator = callee(inner);
  if (
    !(
      isSimpleName(decorator) ||
      (decorator?.kind === "member_expression" &&
        isSimpleName(objectOf(decorator)) &&
        field(decorator, "property")?.kind === "property_identifier")
    )
  )
    return false;
  const up = role(c);
  const holder = up.parent;
  if (!holder) return false;
  if (holder.kind === "variable_declarator" && up.key === "init") {
    const declaration = holder.parent;
    return (
      declaration?.kind !== "variable_declaration" &&
      (declaration?.kind !== "lexical_declaration" ||
        (src(ctx, declaration).startsWith("const") &&
          items(declaration).filter((d) => d.kind === "variable_declarator")
            .length === 1))
    );
  }
  if (holder.kind === "export_statement" && up.key === "declaration")
    return true;
  if (holder.kind === "assignment_expression" && up.key === "right") {
    const left = field(holder, "left");
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
  fn: FormatNode,
  expand = false,
  withTypeParameters = false,
): Doc {
  const typeParametersNode = withTypeParameters
    ? field(fn, "type_parameters")
    : undefined;
  const typeParametersDoc = p(ctx, typeParametersNode);
  const list = field(fn, "parameters");
  if (!list) {
    // A lone parameter without parentheses, printed with them.
    const single = field(fn, "parameter");
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

function parametersDoc(
  ctx: JsCtx,
  fn: FormatNode,
  list: FormatNode,
  expand: boolean,
  typeParametersDoc: Doc,
): Doc {
  const open = t(ctx, anonKid(list, "("));
  const close = t(
    ctx,
    list.children.findLast((c) => !c.named && c.kind === ")"),
  );
  const params = items(list);
  if (params.length === 0)
    return [open, danglingCommentsInList(ctx, list), close];
  const commas = separators(list, params);
  const inTestCall = isTestCall(ctx, role(fn).parent);
  const hug = shouldHugTheOnlyFunctionParameter(ctx, fn);
  const printed: Doc[] = [];
  params.forEach((param, index) => {
    printed.push(p(ctx, param));
    if (index === params.length - 1) return;
    printed.push(t(ctx, commas.get(param)));
    if (inTestCall || hug) printed.push(text(" "));
    else if (isNextLineEmpty(ctx.source, param.end))
      printed.push(hardline, hardline);
    else printed.push(line);
  });
  if (expand && !isDecoratedFunction(ctx, fn)) {
    if (willBreak(typeParametersDoc) || willBreak(printed))
      throw new ArgExpansionBailout();
    return group([open, removeLines(printed), close]);
  }
  const decorated = params.some((param) =>
    param.children.some((c) => c.kind === "decorator"),
  );
  if ((hug && !decorated) || inTestCall) return [open, ...printed, close];
  const last = params.at(-1) as FormatNode;
  const hasRest =
    paramShape(last).shape === "RestElement" ||
    paramShape(last).pattern?.kind === "rest_pattern";
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
const printReturnType = (ctx: JsCtx, fn: FormatNode): Doc =>
  p(ctx, field(fn, "return_type"));

/** Prettier's canPrintParamsWithoutParens. */
export function canPrintParamsWithoutParens(
  ctx: JsCtx,
  fn: FormatNode,
): boolean {
  const params = parameters(fn);
  if (params.length !== 1) return false;
  const param = params[0] as FormatNode;
  const { shape, type, optional } = paramShape(param);
  const list = field(fn, "parameters");
  return (
    !field(fn, "type_parameters") &&
    !(list && ctx.dangling(list).length > 0) &&
    shape === "Identifier" &&
    param.kind !== "this" &&
    !type &&
    !hasComment(ctx, param) &&
    !optional &&
    !field(fn, "return_type")
  );
}

/** The keyword tokens before a function's name or parameters: `async`, `function`, `*`. */
const keyword = (ctx: JsCtx, n: FormatNode, kind: string): Doc =>
  t(ctx, anonKid(n, kind));

const functionRule: JsRule = (n, ctx, args?: Args) => {
  let shouldExpandParameters = false;
  if (
    (n.kind === "function_expression" || n.kind === "generator_function") &&
    args?.expandLastArg
  ) {
    const parent = role(n).parent;
    if (
      parent !== undefined &&
      isCall(parent) &&
      (callArguments(parent).length > 1 ||
        parameters(n).every((x) => {
          const s = paramShape(x);
          return s.shape === "Identifier" && !s.type;
        }))
    )
      shouldExpandParameters = true;
  }
  const parametersDoc = printFunctionParameters(ctx, n, shouldExpandParameters);
  const returnTypeDoc = printReturnType(ctx, n);
  const shouldGroup = shouldGroupFunctionParameters(n, returnTypeDoc);
  const declare = anonKid(n, "declare");
  const async = anonKid(n, "async");
  const star = anonKid(n, "*");
  const name = field(n, "name");
  const body = field(n, "body");
  return [
    declare ? [t(ctx, declare), text(" ")] : [],
    async ? [t(ctx, async), text(" ")] : [],
    keyword(ctx, n, "function"),
    star ? t(ctx, star) : [],
    text(" "),
    p(ctx, name),
    p(ctx, field(n, "type_parameters")),
    group([shouldGroup ? group(parametersDoc) : parametersDoc, returnTypeDoc]),
    body ? [text(" "), p(ctx, body)] : semi(ctx, n),
  ];
};

/** Prettier's printMethodValue: the parameters, return type and body of a method. */
export function printMethodValue(ctx: JsCtx, n: FormatNode): Doc {
  const parametersDoc = printFunctionParameters(ctx, n);
  const returnTypeDoc = printReturnType(ctx, n);
  const shouldGroup = shouldGroupFunctionParameters(n, returnTypeDoc);
  const body = field(n, "body");
  return [
    p(ctx, field(n, "type_parameters")),
    group([
      shouldBreakFunctionParameters(n)
        ? group(parametersDoc, true)
        : shouldGroup
          ? group(parametersDoc)
          : parametersDoc,
      returnTypeDoc,
    ]),
    body ? [text(" "), p(ctx, body)] : semi(ctx, n),
  ];
}

// --- arrow functions ----------------------------------------------------------------------------------------

/** Whether `n`'s leftmost token belongs to an object literal (prettier's startsWithNoLookaheadToken). */
function startsWithObject(n: FormatNode): boolean {
  for (let x: FormatNode | undefined = n; x; ) {
    if (x.kind === "object") return true;
    switch (x.kind) {
      case "parenthesized_expression":
        return false;
      case "ternary_expression":
        x = field(x, "condition");
        break;
      case "binary_expression":
      case "assignment_expression":
      case "augmented_assignment_expression":
        x = field(x, "left");
        break;
      case "call_expression":
        x = callee(x);
        break;
      case "member_expression":
      case "subscript_expression":
        x = objectOf(x);
        break;
      case "sequence_expression":
      case "non_null_expression":
      case "as_expression":
      case "satisfies_expression":
        x = first(x);
        break;
      case "update_expression":
        x = x.children[0]?.named ? x.children[0] : undefined;
        break;
      default:
        return false;
    }
  }
  return false;
}

const shouldAddParensIfNotBreak = (n: FormatNode) =>
  n.kind === "ternary_expression" && !startsWithObject(n);

function mayBreakAfterShortPrefix(ctx: JsCtx, body: FormatNode): boolean {
  return (
    body.kind === "array" ||
    body.kind === "object" ||
    body.kind === "arrow_function" ||
    body.kind === "statement_block" ||
    isJsx(body) ||
    isTemplateOnItsOwnLine(ctx, body)
  );
}

const isCallLike = (n: FormatNode | undefined) =>
  n !== undefined &&
  (n.kind === "call_expression" || n.kind === "new_expression");

function printArrowSignature(ctx: JsCtx, n: FormatNode, args: Args): Doc {
  const parts: Doc[] = [];
  const async = anonKid(n, "async");
  if (async) parts.push(t(ctx, async), text(" "));
  if (
    ctx.options.arrowParens === "avoid" &&
    canPrintParamsWithoutParens(ctx, n)
  ) {
    const list = field(n, "parameters");
    if (list) {
      // `(a) => a` loses its parentheses.
      const param = parameters(n)[0] as FormatNode;
      parts.push(
        ctx.withComments(list, [
          t(ctx, anonKid(list, "("), ""),
          p(ctx, param),
          t(
            ctx,
            list.children.findLast((c) => !c.named && c.kind === ","),
            "",
          ),
          t(
            ctx,
            list.children.findLast((c) => !c.named && c.kind === ")"),
            "",
          ),
        ]),
      );
    } else parts.push(p(ctx, field(n, "parameter")));
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

const arrowToken = (ctx: JsCtx, n: FormatNode): Doc => [
  text(" "),
  t(ctx, anonKid(n, "=>")),
];

const arrow: JsRule = (node, ctx, args?: Args) => {
  const signatureDocs: Doc[] = [];
  const arrows: FormatNode[] = [];
  let bodyDoc: Doc = [];
  let shouldBreakChain = false;
  const bodyOf = (x: FormatNode) => field(x, "body") as FormatNode;
  const shouldPrintAsChain =
    !args?.expandLastArg && unparen(bodyOf(node)).kind === "arrow_function";
  let functionBody = bodyOf(node);
  let bodyNode = functionBody;

  for (let x = node; ; ) {
    const signature = printArrowSignature(ctx, x, args);
    signatureDocs.push(
      signatureDocs.length === 0 ? signature : ctx.withComments(x, signature),
    );
    arrows.push(x);
    if (shouldPrintAsChain) {
      const params = parameters(x);
      shouldBreakChain ||=
        (field(x, "return_type") !== undefined && params.length > 0) ||
        field(x, "type_parameters") !== undefined ||
        params.some((param) => paramShape(param).shape !== "Identifier");
    }
    const body = bodyOf(x);
    if (!shouldPrintAsChain || unparen(body).kind !== "arrow_function") {
      bodyNode = body;
      bodyDoc = p(ctx, body, args);
      functionBody = unparen(body);
      break;
    }
    x = unparen(body);
  }

  const hasLeadingOwnLine = [bodyNode, functionBody].some((b) =>
    hasComment(ctx, b, CF.Leading, (c) => hasNewline(ctx.source, c.end)),
  );
  const shouldPutBodyOnSameLine =
    !hasLeadingOwnLine &&
    (functionBody.kind === "sequence_expression" ||
      mayBreakAfterShortPrefix(ctx, functionBody) ||
      (!shouldBreakChain && shouldAddParensIfNotBreak(functionBody)));

  const { parent, key } = role(node);
  const isCallee = key === "callee" && isCallLike(parent);

  // Prettier's printArrowFunctionSignatures.
  const joinSignatures = () => {
    const out: Doc[] = [];
    signatureDocs.forEach((s, i) => {
      if (i > 0) out.push(arrowToken(ctx, arrows[i - 1] as FormatNode), line);
      out.push(s);
    });
    return out;
  };
  let signaturesDoc: Doc;
  if (signatureDocs.length === 1) signaturesDoc = signatureDocs[0] as Doc;
  else if ((key !== "callee" && isCallLike(parent)) || isBinaryish(parent)) {
    const rest: Doc[] = [];
    signatureDocs.slice(1).forEach((s, i) => {
      if (i > 0) rest.push(arrowToken(ctx, arrows[i] as FormatNode), line);
      rest.push(s);
    });
    signaturesDoc = group(
      [
        signatureDocs[0] as Doc,
        arrowToken(ctx, arrows[0] as FormatNode),
        indent([line, rest]),
      ],
      shouldBreakChain,
    );
  } else if ((key === "callee" && isCallLike(parent)) || args?.assignmentLayout)
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
    (args?.expandLastArg || parent?.kind === "jsx_expression") &&
    !hasComment(ctx, node)
      ? softline
      : [];
  let body: Doc;
  if (shouldPutBodyOnSameLine && shouldAddParensIfNotBreak(functionBody))
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
    arrowToken(ctx, arrows.at(-1) as FormatNode),
    shouldPrintAsChain ? indentIfBreak(body, chainGroup) : group(body),
    shouldPrintAsChain && isCallee ? ifBreak(softline, [], chainGroup) : [],
  ]);
};

// --- parameters ---------------------------------------------------------------------------------------------

/** A TS parameter: modifiers, pattern, `?`, type, default. */
const parameter: JsRule = (n, ctx) => {
  const parts: Doc[] = [];
  const decorators: FormatNode[] = [];
  const pattern = field(n, "pattern") ?? field(n, "name");
  const value = field(n, "value");
  for (const c of n.children) {
    if (c === pattern) break;
    if (isComment(c)) continue;
    if (c.kind === "decorator") decorators.push(c);
    else parts.push(p(ctx, c), text(" "));
  }
  parts.push(
    p(ctx, pattern),
    t(ctx, anonKid(n, "?")),
    p(ctx, field(n, "type")),
  );
  if (value)
    parts.push(text(" "), t(ctx, anonKid(n, "=")), text(" "), p(ctx, value));
  if (decorators.length === 0) return parts;
  // Prettier's print() wraps a decorated node as group([printDecorators, doc]).
  const broken = decorators.some((d) => hasNewline(ctx.source, d.end));
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
  p(ctx, field(n, "left")),
  text(" "),
  t(ctx, anonKid(n, "=")),
  text(" "),
  p(ctx, field(n, "right")),
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
