// Prettier's function printers: function.js, function-parameters.js, arrow-function.js.

import type { Doc } from "../../../fmt/doc.js";
import { lfAfter, nextLineEmpty } from "../../../fmt/text.js";
import {
  BROKEN,
  capture,
  close,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  onDoc,
  open,
  openIndentIfBreak,
  type Part,
  place,
  removeLines,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sText,
  sToken,
  willBreak as partWillBreak,
  withComments,
} from "../sink.js";
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
  kind,
  lastChildWhere,
  named,
  objectOf,
  parameters,
  parent,
  semi,
  separators,
  src,
  trailingCommaAllowed,
  unparen,
} from "./util.js";
import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import { semiCustoms } from "./semi.js";
import type { JsOptions } from "./util.js";

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

/** Prettier's shouldGroupFunctionParameters, over `fn`'s printed return type. */
export function sShouldGroupFunctionParameters(
  x: HasTree,
  fn: number,
  printedReturnType: Part,
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
    (isObjectType(x, returnType) || partWillBreak(printedReturnType))
  );
}

/** `sShouldGroupFunctionParameters` for a rule still on the Doc (types.ts's methodSignature and functionType). */
export const shouldGroupFunctionParameters = (
  x: HasTree,
  fn: number,
  returnTypeDoc: Doc,
): boolean => sShouldGroupFunctionParameters(x, fn, { doc: returnTypeDoc });

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

/** `sPrintFunctionParameters` as a Doc, for the rules still on it (types.ts's methodSignature and functionType). */
export const printFunctionParameters = (
  ctx: JsCtx,
  fn: number,
  expand = false,
  withTypeParameters = false,
): Doc =>
  onDoc((n, s) =>
    sPrintFunctionParameters(s, n, expand, withTypeParameters),
  )(fn, ctx);

/** Prettier's printFunctionParameters for function `fn`, whose `formal_parameters` holds the list. */
export function sPrintFunctionParameters(
  s: StreamCtx<JsOptions>,
  fn: number,
  expand = false,
  withTypeParameters = false,
): void {
  const { js: ctx } = jsCtx(s);
  const typeParameters = capture(() =>
    pr(s, withTypeParameters ? field(ctx, fn, "type_parameters") : undefined),
  );
  place(typeParameters);
  const list = field(ctx, fn, "parameters");
  if (list === undefined) {
    // A lone parameter without parentheses, printed with them.
    sToken(fn, "(", true);
    pr(s, field(ctx, fn, "parameter"));
    sToken(fn, ")", true);
    return;
  }
  // `formal_parameters` has no rule of its own to print its comments around it.
  withComments(jsCtx(s), list, () =>
    printParameterList(s, fn, list, expand, typeParameters),
  );
}

/** The last anonymous `text` token among `n`'s children. */
const lastAnon = (ctx: JsCtx, n: number, text: string) =>
  lastChildWhere(ctx, n, (c) => !named(ctx, c) && kind(ctx, c) === text);

function printParameterList(
  s: StreamCtx<JsOptions>,
  fn: number,
  list: number,
  expand: boolean,
  typeParameters: Part,
): void {
  const { js: ctx } = jsCtx(s);
  const openParen = anon(ctx, list, "(");
  const closeParen = lastAnon(ctx, list, ")");
  const params = items(ctx, list);
  if (params.length === 0) {
    // Prettier's printDanglingCommentsInList.
    tk(ctx, openParen);
    const dangling = s.danglingComments(list);
    if (dangling.length > 0) {
      open(INDENT);
      sLine(SOFT);
      dangling.forEach((c, i) => {
        if (i > 0) sHardline();
        s.comment(c);
      });
      close();
      if (dangling.some((c) => s.isLineComment(c))) sHardline();
      else sLine(SOFT);
    }
    tk(ctx, closeParen);
    return;
  }
  const commas = separators(ctx, list, params);
  const inTestCall = isTestCall(ctx, role(ctx, fn).parent);
  const hug = shouldHugTheOnlyFunctionParameter(ctx, fn);
  const printed = capture(() =>
    params.forEach((param, index) => {
      s.print(param);
      if (index === params.length - 1) return;
      tk(ctx, commas.get(param));
      if (inTestCall || hug) sText(" ");
      else if (nextLineEmpty(ctx.tree, param)) {
        sHardline();
        sHardline();
      } else sLine(0);
    }),
  );
  if (expand && !isDecoratedFunction(ctx, fn)) {
    if (partWillBreak(typeParameters) || partWillBreak(printed))
      throw new ArgExpansionBailout();
    open(GROUP);
    tk(ctx, openParen);
    place(removeLines(printed));
    tk(ctx, closeParen);
    close();
    return;
  }
  const decorated = params.some(
    (param) =>
      childWhere(ctx, param, (c) => kind(ctx, c) === "decorator") !== undefined,
  );
  tk(ctx, openParen);
  if ((hug && !decorated) || inTestCall) {
    place(printed);
    tk(ctx, closeParen);
    return;
  }
  const last = params.at(-1) as number;
  const hasRest =
    paramShape(ctx, last).shape === "RestElement" ||
    kind(ctx, paramShape(ctx, last).pattern) === "rest_pattern";
  open(INDENT);
  sLine(SOFT);
  place(printed);
  close();
  if (!hasRest && trailingCommaAllowed(ctx, "all")) {
    open(IF_BROKEN);
    sToken(last, ",", true);
    close();
  }
  sLine(SOFT);
  tk(ctx, closeParen);
}

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

/** Prettier's printFunction, for function declarations, expressions and signatures. */
const printFunction: CustomRule<JsOptions> = (n, s) => {
  const { js: ctx, args } = jsCtx(s);
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
          const shape = paramShape(ctx, x);
          return shape.shape === "Identifier" && shape.type === undefined;
        }))
    )
      shouldExpandParameters = true;
  }
  const params = capture(() => sPrintFunctionParameters(s, n, shouldExpandParameters));
  const returnType = capture(() => pr(s, field(ctx, n, "return_type")));
  const shouldGroup = sShouldGroupFunctionParameters(ctx, n, returnType);
  for (const keyword of ["declare", "async"]) {
    const c = anon(ctx, n, keyword);
    if (c === undefined) continue;
    tk(ctx, c);
    sText(" ");
  }
  tk(ctx, anon(ctx, n, "function"));
  tk(ctx, anon(ctx, n, "*"));
  sText(" ");
  pr(s, field(ctx, n, "name"));
  pr(s, field(ctx, n, "type_parameters"));
  open(GROUP);
  if (shouldGroup) open(GROUP);
  place(params);
  if (shouldGroup) close();
  place(returnType);
  close();
  const body = field(ctx, n, "body");
  if (body !== undefined) {
    sText(" ");
    s.print(body);
  } else semiCustoms.semi(lastAnon(ctx, n, ";"), n, s);
};

/** Prettier's printMethodValue: the parameters, return type and body of a method. */
export function sPrintMethodValue(ctx: JsStreamCtx, n: number): void {
  const js = ctx.js;
  const parameters = capture(() => sPrintFunctionParameters(ctx, n));
  const returnType = capture(() => pr(ctx, field(js, n, "return_type")));
  const shouldGroup = sShouldGroupFunctionParameters(js, n, returnType);
  const typeParameters = field(js, n, "type_parameters");
  if (typeParameters !== undefined) ctx.print(typeParameters);
  const shouldBreak = shouldBreakFunctionParameters(js, n);
  open(GROUP);
  if (shouldBreak || shouldGroup) {
    open(GROUP, -1, shouldBreak ? BROKEN : 0);
    place(parameters);
    close();
  } else place(parameters);
  place(returnType);
  close();
  const body = field(js, n, "body");
  if (body !== undefined) {
    sText(" ");
    return ctx.print(body);
  }
  const c = lastChildWhere(js, n, (c) => !named(js, c) && kind(js, c) === ";");
  const present = c !== undefined && src(js, c) !== "";
  if (!js.options.semi) {
    if (present) sToken(c, "");
  } else if (present) sToken(c, ";");
  else sToken(n, ";", true);
}

const printMethodValueDoc = onDoc((n, ctx) => sPrintMethodValue(jsCtx(ctx), n));
/** `sPrintMethodValue` for a rule still on the Doc (classes.ts's and objects.ts's methods). */
export const printMethodValue = (ctx: JsCtx, n: number): Doc =>
  printMethodValueDoc(n, ctx);

// --- arrow functions ----------------------------------------------------------------------------------------

/** Whether `n`'s leftmost token belongs to an object literal (prettier's startsWithNoLookaheadToken). */
function startsWithObject(h: HasTree, n: number): boolean {
  for (let x: number | undefined = n; x !== undefined;) {
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

/** `c` printed as nothing, a parenthesis or comma the layout drops; nothing when absent. */
const drop = (c: number | undefined) => {
  if (c !== undefined) sToken(c, "");
};

function printArrowSignature(s: StreamCtx<JsOptions>, n: number, args: Args): void {
  const { js: ctx } = jsCtx(s);
  const async = anon(ctx, n, "async");
  if (async !== undefined) {
    tk(ctx, async);
    sText(" ");
  }
  if (
    ctx.options.arrowParens === "avoid" &&
    canPrintParamsWithoutParens(ctx, n)
  ) {
    const list = field(ctx, n, "parameters");
    if (list !== undefined) {
      // `(a) => a` loses its parentheses.
      const param = parameters(ctx, n)[0] as number;
      withComments(jsCtx(s), list, () => {
        drop(anon(ctx, list, "("));
        s.print(param);
        drop(lastAnon(ctx, list, ","));
        drop(lastAnon(ctx, list, ")"));
      });
    } else pr(s, field(ctx, n, "parameter"));
  } else {
    const expand = Boolean(args?.expandLastArg || args?.expandFirstArg);
    const returnType = capture(() => pr(s, field(ctx, n, "return_type")));
    if (expand && partWillBreak(returnType)) throw new ArgExpansionBailout();
    open(GROUP);
    sPrintFunctionParameters(s, n, expand, true);
    if (expand) {
      open(GROUP);
      place(removeLines(returnType));
      close();
    } else place(returnType);
    close();
  }
  const dangling = s.danglingComments(n);
  if (dangling.length > 0) {
    sText(" ");
    dangling.forEach((c, i) => {
      if (i > 0) sHardline();
      s.comment(c);
    });
  }
}

const arrowToken = (ctx: JsCtx, n: number) => {
  sText(" ");
  tk(ctx, anon(ctx, n, "=>"));
};

/** Prettier's printArrowFunction: a chain of curried arrows, and the body beside or below the last `=>`. */
const arrow: CustomRule<JsOptions> = (node, s) => {
  const js = jsCtx(s);
  const { js: ctx, args } = js;
  const signatures: Part[] = [];
  const arrows: number[] = [];
  let bodyPart: Part | undefined;
  let shouldBreakChain = false;
  const bodyOf = (x: number) => field(ctx, x, "body") as number;
  const isArrow = (x: number) => kind(ctx, x) === "arrow_function";
  const shouldPrintAsChain =
    !args?.expandLastArg && isArrow(unparen(ctx, bodyOf(node)));
  let functionBody = bodyOf(node);
  let bodyNode = functionBody;

  for (let x = node; ;) {
    // A chained arrow is printed through its head, so its own comments go around its signature.
    const head = signatures.length === 0;
    signatures.push(
      capture(() => {
        if (head) printArrowSignature(s, x, args);
        else withComments(js, x, () => printArrowSignature(s, x, args));
      }),
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
      bodyPart = capture(() => js.print(body, args));
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
  const chainBreak = shouldBreakChain ? BROKEN : 0;

  // Prettier's printArrowFunctionSignatures.
  const joinSignatures = (from: number) =>
    signatures.slice(from).forEach((signature, i) => {
      if (i > 0) {
        arrowToken(ctx, arrows[from + i - 1] as number);
        sLine(0);
      }
      place(signature);
    });
  const printSignatures = () => {
    if (signatures.length === 1) place(signatures[0] as Part);
    else if (
      (key !== "callee" && isCallLike(ctx, parent)) ||
      isBinaryish(ctx, parent)
    ) {
      open(GROUP, -1, chainBreak);
      place(signatures[0] as Part);
      arrowToken(ctx, arrows[0] as number);
      open(INDENT);
      sLine(0);
      joinSignatures(1);
      close();
      close();
    } else if (
      (key === "callee" && isCallLike(ctx, parent)) ||
      args?.assignmentLayout
    ) {
      open(GROUP, -1, chainBreak);
      joinSignatures(0);
      close();
    } else {
      open(GROUP, -1, chainBreak);
      open(INDENT);
      joinSignatures(0);
      close();
      close();
    }
  };

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
  const printTrailing = () => {
    if (args?.expandLastArg && trailingCommaAllowed(ctx, "all")) {
      open(IF_BROKEN);
      sToken(node, ",", true);
      close();
    }
    if (
      (args?.expandLastArg || kind(ctx, parent) === "jsx_expression") &&
      !hasComment(ctx, node)
    )
      sLine(SOFT);
  };
  const printBody = () => {
    const body = bodyPart as Part;
    if (shouldPutBodyOnSameLine && shouldAddParensIfNotBreak(ctx, functionBody)) {
      sText(" ");
      open(GROUP);
      open(IF_FLAT);
      sToken(node, "(", true);
      close();
      open(INDENT);
      sLine(SOFT);
      place(body);
      close();
      open(IF_FLAT);
      sToken(node, ")", true);
      close();
      printTrailing();
      close();
    } else if (shouldPutBodyOnSameLine) {
      sText(" ");
      place(body);
    } else {
      open(INDENT);
      sLine(0);
      place(body);
      close();
      printTrailing();
    }
  };

  open(GROUP);
  const chainGroup = open(GROUP, -1, shouldBreakSignatures ? BROKEN : 0);
  if (shouldIndentSignatures) {
    open(INDENT);
    if (shouldPrintSoftlineInIndent) sLine(SOFT);
    printSignatures();
    close();
  } else printSignatures();
  close();
  arrowToken(ctx, arrows.at(-1) as number);
  if (shouldPrintAsChain) openIndentIfBreak(chainGroup);
  else open(GROUP);
  printBody();
  close();
  if (shouldPrintAsChain && isCallee) {
    open(IF_BROKEN, chainGroup);
    sLine(SOFT);
    close();
  }
  close();
};

// --- parameters ---------------------------------------------------------------------------------------------

/** `c` as the source token it is; nothing when absent. */
const tk = (ctx: JsCtx, c: number | undefined) => {
  if (c !== undefined) sToken(c, src(ctx, c));
};

/** `node` with its comments; nothing when absent. */
const pr = (s: StreamCtx<JsOptions>, node: number | undefined) => {
  if (node !== undefined) s.print(node);
};

/** A TS parameter: modifiers, pattern, `?`, type, default. */
const parameter: CustomRule<JsOptions> = (n, s) => {
  const { js: ctx } = jsCtx(s);
  const decorators: number[] = [];
  const modifiers: number[] = [];
  const pattern = field(ctx, n, "pattern") ?? field(ctx, n, "name");
  const value = field(ctx, n, "value");
  for (const c of children(ctx, n)) {
    if (c === pattern) break;
    if (isComment(ctx, c)) continue;
    if (kind(ctx, c) === "decorator") decorators.push(c);
    else modifiers.push(c);
  }
  // Prettier's print() wraps a decorated node as group([printDecorators, doc]).
  if (decorators.length > 0) {
    open(GROUP);
    if (decorators.some((d) => lfAfter(ctx.tree, d) > 0)) sBreakParent();
    decorators.forEach((d, i) => {
      if (i > 0) sLine(0);
      s.print(d);
    });
    sLine(0);
  }
  for (const c of modifiers) {
    s.print(c);
    sText(" ");
  }
  pr(s, pattern);
  tk(ctx, anon(ctx, n, "?"));
  pr(s, field(ctx, n, "type"));
  if (value !== undefined) {
    sText(" ");
    tk(ctx, anon(ctx, n, "="));
    sText(" ");
    s.print(value);
  }
  if (decorators.length > 0) close();
};

/** The customs format/functions.ts names, by the names its spec gives them. */
export const functionCustoms = {
  function: printFunction,
  arrow,
  parameter,
} satisfies Record<string, CustomRule<JsOptions>>;
