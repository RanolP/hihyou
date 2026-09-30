// Prettier's TypeScript type printers (print/typescript.js and the files it dispatches to: type-annotation.js,
// union-type.js, intersection-type.js, type-parameters.js, type-alias.js, function-type.js, index-signature.js,
// mapped-type.js, method-signature.js, enum.js, module-declaration.js, binary-cast-expression.js) and the
// TypeScript half of class-body.js.

import type { CustomRule, TokenRule } from "../../../fmt/dsl/runtime.js";
import {
  commentFacts,
  printLeadingComment,
  printLeadingComments,
  printTrailingComment,
  printTrailingComments,
  type Trailed,
  type StreamRule,
} from "../../../fmt/stream-format.js";
import { lfAfter, newlineBetween, nextLineEmpty } from "../../../fmt/text.js";
import { NO_NODE } from "../../../core/arena.js";
import { firstLeaf, nextLeaf, prevLeaf } from "../../../fmt/tree.js";
import {
  BROKEN,
  capture,
  close,
  closeChoice,
  closeState,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  openChoice,
  openAlign,
  openState,
  place,
  SOFT,
  sHardline,
  sLine,
  sText,
  sToken,
  withComments,
} from "../sink.js";
import { sPrintAssignment } from "./assignment.js";
import { isTestCall } from "./calls.js";
import {
  sPrintFunctionParameters,
  sShouldGroupFunctionParameters,
  shouldHugTheOnlyFunctionParameter,
} from "./functions.js";
import { sPrintKey } from "./objects.js";
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
  isIgnoreComment,
  isMember,
  isSimpleType,
  items,
  type JsCtx,
  type JsOptions,
  kind,
  lastChildWhere,
  named,
  parent,
  separators,
  src,
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

/** Prettier's shouldHugType. */
function shouldHugType(ctx: JsCtx, n: number): boolean {
  if (isSimpleType(ctx, n) || kind(ctx, n) === "object_type") return true;
  return kind(ctx, n) === "union_type" && shouldHugUnionType(ctx, n);
}

/**
 * Prettier's shouldUnionTypePrintOwnComments: a union prints its comments itself, around its members and inside
 * the indent it opens (`a: // c` above `| A | B`, or `extends A | B // c` breaking after `extends`), unless it hugs,
 * is a member of another union or intersection, or is one of several tuple elements.
 */
export const unionOwnsComments = (x: JsCtx, n: number) => {
  if (kind(x, n) !== "union_type" || isTransparentType(x, n) || !hasComment(x, n)) return false;
  const up = typeRole(x, n).parent;
  if (UNION_LIKE.has(kind(x, up) ?? "")) return false;
  if (kind(x, up) === "tuple_type" && items(x, up as number).length > 1) return false;
  return !shouldHugUnionType(x, n);
};

/** Prettier's printUnionType. */
const unionType: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  printUnionType(ctx, n, unionOwnsComments(ctx.js, n));
};

/** Union `n`, with its own comments around its members when it `owns` them. */
function printUnionType(ctx: JsStreamCtx, n: number, owns: boolean) {
  const js = ctx.js;
  const args = ctx.args;
  if (isTransparentType(js, n)) return pr(ctx, items(js, n)[0], args);
  const { types, ops, lead } = flattenTypes(js, n);
  const bar = (x: number) => {
    const op = ops.get(x);
    if (op !== undefined) tok(js, op);
    else sToken(x, "|", true);
  };
  const hug = shouldHugUnionType(js, n);
  const { parent: up, field: key } = typeRole(js, n);
  const upKind = kind(js, up);
  const parenthesized =
    kind(js, parent(js, n)) === "parenthesized_type" && typeNeedsParens(js, n);
  const inTuple = upKind === "tuple_type" && items(js, up as number).length > 1;
  // oxfmt indents a conditional's branch under its `?` or `:` too, unless comments lead it there.
  const branchIndents = js.options.compat === "oxfmt" && ctx.leadingComments(n).length === 0;
  const noIndent =
    upKind === "type_assertion" ||
    upKind === "tuple_type" ||
    (upKind === "conditional_type" &&
      (key === "consequence" || key === "alternative") &&
      !branchIndents) ||
    upKind === "type_arguments";
  const indented =
    !hug &&
    !parenthesized &&
    !inTuple &&
    !noIndent &&
    args?.assignmentLayout !== "break-after-operator";
  if (hug)
    return types.forEach((x, i) => {
      if (i > 0) {
        sText(" ");
        bar(types[i - 1] as number);
        sText(" ");
      }
      ctx.print(x);
    });
  const oxfmt = js.options.compat === "oxfmt";
  // oxfmt keeps a line comment after `a:` on that line, and the union's trailing comments out of its indent.
  const first = ctx.leadingComments(n)[0];
  const head =
    oxfmt &&
    owns &&
    indented &&
    first !== undefined &&
    ctx.isLineComment(first) &&
    js.tree.lf(first) === 0
      ? first
      : undefined;
  const trailOutside = oxfmt && owns && indented;
  const printed = (grouped = true) => {
    if (owns)
      for (const c of ctx.leadingComments(n))
        if (c !== head) printLeadingComment(ctx, commentFacts(ctx, c));
    if (grouped) open(GROUP);
    types.forEach((x, i) => {
      if (i === 0) {
        open(IF_BROKEN);
        if (lead !== undefined) tok(js, lead);
        else sToken(x, "|", true);
        sText(" ");
        close();
      } else {
        sLine(0);
        bar(types[i - 1] as number);
        sText(" ");
      }
      // A member aligns under its `|`, and its comments do only when one leads it.
      const aligned = (fn: () => void) => {
        openAlign(2);
        fn();
        close();
      };
      // `A & B | C` prints `(A & B) | C`: prettier's needsParens parenthesizes an intersection in a union,
      // around an ignored member's source text too. The grammar needs no source parens there, so they are added.
      const bare =
        kind(js, x) === "intersection_type" && !isTransparentType(js, x)
          ? () => {
              sToken(x, "(", true);
              ctx.printBare(x);
              sToken(x, ")", true);
            }
          : () => ctx.printBare(x);
      // oxfmt aligns only the leading ones: an own-line comment before the next `|` stays at the `|`.
      if (js.comments(x).leading.length > 0 && oxfmt) {
        aligned(() => {
          printLeadingComments(ctx, x);
          bare();
        });
        printTrailingComments(ctx, x);
      } else if (js.comments(x).leading.length > 0)
        aligned(() => withComments(ctx, x, bare));
      else withComments(ctx, x, () => aligned(bare));
    });
    if (grouped) close();
    if (owns && !trailOutside) printTrailingComments(ctx, n);
  };
  if (parenthesized) {
    open(GROUP);
    open(INDENT);
    sLine(SOFT);
    // oxfmt breaks a union moved inside its parentheses at every `|`.
    printed(!oxfmt);
    close();
    sLine(SOFT);
    return close();
  }
  if (inTuple) {
    open(GROUP);
    open(INDENT);
    open(IF_BROKEN);
    sToken(n, "(", true);
    sLine(SOFT);
    close();
    printed();
    close();
    sLine(SOFT);
    open(IF_BROKEN);
    sToken(n, ")", true);
    close();
    return close();
  }
  // prettier 3.9 keeps a union that fits once moved to its own line on that line; oxfmt breaks it at every `|`,
  // so its `|`s break with the group that moves it there.
  if (!indented)
    return printed(!oxfmt || args?.assignmentLayout !== "break-after-operator");
  if (head !== undefined) ctx.comment(head);
  open(GROUP);
  open(INDENT);
  if (head !== undefined) sHardline();
  else sLine(SOFT);
  printed(!oxfmt);
  close();
  close();
  if (trailOutside) printTrailingComments(ctx, n);
}

const intersectionType: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  if (isTransparentType(js, n)) return pr(ctx, items(js, n)[0], ctx.args);
  const { types, ops } = flattenTypes(js, n);
  // tree-sitter nests `A & B & C` as `(A & B) & C`; a comment after `B` trails the inner node, which the flat
  // list never prints, so it prints after `B`, where prettier's flat intersection has it.
  const member = (x: number) => {
    ctx.print(x);
    for (
      let up = parent(js, x), last = x;
      up !== undefined && up !== n && kind(js, up) === "intersection_type";
      last = up, up = parent(js, up)
    ) {
      if (lastChildWhere(js, up, (c) => named(js, c) && !isComment(js, c)) !== last) break;
      printTrailingComments(ctx, up);
    }
  };
  const indented = (x: number) => {
    open(INDENT);
    member(x);
    close();
  };
  let wasIndented = false;
  open(GROUP);
  types.forEach((x, i) => {
    if (i === 0) return member(x);
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
      return wasIndented ? indented(x) : member(x);
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
      member(x);
      return close();
    }
    if (i > 1) wasIndented = true;
    sText(" ");
    amp();
    sText(" ");
    return i > 1 ? indented(x) : member(x);
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
  // Prettier's grandparent: the call an arrow is an argument of, past the `arguments` node its AST lacks.
  const grand =
    kind(ctx, annotated) === "arguments" ? parent(ctx, annotated) : annotated;
  const shouldInline =
    !isArrowFunctionVariable &&
    (isTestCall(ctx, grand, parent(ctx, grand)) ||
      (params.length === 1 && shouldHugType(ctx, params[0] as number))) &&
    // oxfmt hugs a type argument whatever comments it carries.
    ((ctx.options.compat === "oxfmt" && kind(ctx, n) === "type_arguments") ||
      !params.some((x) => {
        const comments = getComments(ctx, x, CF.Leading | CF.Trailing);
        return (
          comments.length > 0 &&
          (comments.some((c) => ctx.isLineComment(c)) ||
            lfAfter(ctx.tree, comments.at(-1) as number) > 0)
        );
      }));
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
  else if (!trailingCommaAllowed(ctx, "es5")) tok(ctx, lastComma, "");
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


// --- declarations ---------------------------------------------------------------------------------------------

/** A type alias up to its `;`, `.via("typeAlias")` on its name: prettier's printAssignment. */
const typeAlias: CustomRule<JsOptions> = (name, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const n = parent(js, name)!;
  sPrintAssignment(
    ctx,
    n,
    () => {
      tok(js, anonKid(js, n, "type"));
      sText(" ");
      withComments(ctx, name, () => ctx.printNode(name));
      pr(ctx, field(js, n, "type_parameters"));
    },
    () => {
      sText(" ");
      tok(js, anonKid(js, n, "="));
    },
    field(js, n, "value"),
  );
};

/** A module's body, `.via("moduleBody")`: a group of its own. */
const moduleBody: CustomRule<JsOptions> = (body, sctx) => {
  open(GROUP);
  jsCtx(sctx).printNode(body);
  close();
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

/**
 * oxfmt's slots for the comments between a cast's expression and its type (as_or_satisfies_expression.rs): the
 * run before the operator that stays on the expression's line and spans no lines trails the expression (`glued`);
 * the run after it still on the operator's line prints there (`after`), unless a union takes it or comments moved
 * from before the operator are pending; the `rest` leads the type, which breaks onto its own line when a glued line
 * comment rides the operator or a rest comment ends its line on a line of its own or spanning lines. Undefined
 * when there are none, or an ignore comment is among them, which the type's own leading pass keeps.
 */
export interface CastGap {
  glued: number[];
  after: number[];
  rest: number[];
  ownLine: boolean;
}

export function castGap(x: HasTree, n: number): CastGap | undefined {
  const t = x.tree;
  const keyword = anonKids(x, n).find((c) => kind(x, c) === "as" || kind(x, c) === "satisfies");
  if (keyword === undefined) return;
  const before: number[] = [];
  for (let l = prevLeaf(t, keyword); l !== NO_NODE; l = prevLeaf(t, l)) {
    if (isComment(x, l)) before.unshift(l);
    else if (kind(x, l) !== ")" || kind(x, parent(x, l)) !== "parenthesized_expression") break;
  }
  const after: number[] = [];
  for (let l = nextLeaf(t, keyword); l !== NO_NODE && isComment(x, l); l = nextLeaf(t, l)) after.push(l);
  const all = [...before, ...after];
  if (all.length === 0 || all.some((c) => isIgnoreComment(x, c))) return;
  const spans = (c: number) => t.text(c).startsWith("/*") && t.text(c).includes("\n");
  const ownLineBefore = (c: number) => t.lf(c) > 0;
  const endsLine = (c: number) => lfAfter(t, c) > 0;
  const isLine = (c: number) => t.text(c).startsWith("//");
  let g = 0;
  while (g < before.length && !ownLineBefore(before[g] as number) && !spans(before[g] as number)) g++;
  const type = items(x, n)[1];
  const union = type !== undefined && kind(x, type) === "union_type" && items(x, type).length > 1;
  let a = 0;
  if (!union && g === before.length)
    while (a < after.length && !ownLineBefore(after[a] as number) && !(spans(after[a] as number) && endsLine(after[a] as number)))
      a++;
  const glued = before.slice(0, g);
  const rest = [...before.slice(g), ...after.slice(a)];
  const promoted = (c: number) => endsLine(c) && (ownLineBefore(c) || spans(c));
  const ownLine =
    glued.some(isLine) || after.slice(0, a).some(isLine) || (!union && rest.some(promoted));
  return { glued, after: after.slice(0, a), rest, ownLine };
}

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
        // oxc's is_callee_or_object leaves `new` callees out.
        (kind(js, up) === "new_expression" &&
          js.options.compat !== "oxfmt"))) ||
    (key === "object" && isMember(js, up));
  if (grouped) {
    open(GROUP);
    open(INDENT);
    sLine(SOFT);
  }
  const gap = js.options.compat === "oxfmt" ? castGap(js, n) : undefined;
  pr(ctx, expression);
  sText(" ");
  tok(js, keyword);
  let trailed: Trailed | undefined;
  for (const c of gap?.after ?? []) trailed = printTrailingComment(ctx, commentFacts(ctx, c), trailed);
  if (gap?.ownLine) {
    open(INDENT);
    sHardline();
  } else sText(" ");
  if (type !== undefined) ctx.print(type);
  else {
    // `as const` has no type node to lead, so the cast holds the rest.
    for (const c of gap?.rest ?? []) printLeadingComment(ctx, commentFacts(ctx, c));
    tok(js, anonKid(js, n, "const"));
  }
  if (gap?.ownLine) close();
  if (grouped) {
    close();
    sLine(SOFT);
    close();
  }
};

/** `<T>x`, TS-only: the tsx grammar the spec is typed against has no such kind, so typeRules names it. */
const typeAssertion: StreamRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const args = childWhere(js, n, (c) => kind(js, c) === "type_arguments");
  const expression = items(js, n).find((c) => c !== args);
  const cast = capture(() => {
    if (args === undefined) return;
    open(GROUP);
    tok(js, anonKid(js, args, "<"));
    open(INDENT);
    sLine(SOFT);
    const inner = items(js, args)[0];
    if (inner !== undefined) ctx.print(inner);
    close();
    sLine(SOFT);
    tok(js, lastAnonKid(js, args, ">"));
    close();
  });
  const printed = capture(() => {
    if (expression !== undefined) ctx.print(expression);
  });
  const bare =
    expression !== undefined ? kind(js, unparen(js, expression)) : undefined;
  if (bare === "array" || bare === "object") {
    open(GROUP);
    place(cast);
    place(printed);
    close();
    return;
  }
  const state = (body: () => void) => {
    openState();
    place(cast);
    body();
    closeState();
  };
  openChoice(false);
  state(() => place(printed));
  state(() => {
    open(GROUP, -1, BROKEN);
    open(IF_BROKEN);
    sToken(n, "(", true);
    close();
    open(INDENT);
    sLine(SOFT);
    place(printed);
    close();
    sLine(SOFT);
    open(IF_BROKEN);
    sToken(n, ")", true);
    close();
    close();
  });
  state(() => place(printed));
  closeChoice();
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

/**
 * The source separator an ignored type member keeps: the TS AST's member spans its `;` or `,`, so prettier-ignore
 * prints it with the member's text, and prints none where the source has none.
 */
export const ignoredMemberSeparator = (x: HasTree, n: number) =>
  TYPE_MEMBER_BODIES.has(kind(x, parent(x, n)) ?? "") ? memberSeparator(x, n) : undefined;
const TYPE_MEMBER_BODIES = new Set(["interface_body", "object_type"]);

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

/**
 * A type member's separator, which a spec writes as `tok(";").via("memberSemi")`: prettier's
 * printClassMemberSemicolon. The separator is the body's child after the member, never the member's own, so the
 * rule finds it from the member; it prints as `;`, is dropped, or shows only while the body breaks (or stays flat).
 */
const memberSemi: TokenRule<JsOptions> = (_token, n, sctx) => {
  const js = jsCtx(sctx).js;
  const up = parent(js, n);
  if (up === undefined) return;
  const sep = memberSeparator(js, n);
  const put = (text: string) => {
    if (sep !== undefined) sToken(sep, text);
    else if (text) sToken(n, text, true);
  };
  const drop = () => tok(js, sep, "");
  const within = (frame: number, write: () => void) => {
    open(frame);
    write();
    close();
  };
  const upKind = kind(js, up);
  if (upKind === "interface_body" || upKind === "class_body")
    return put(js.options.semi ? ";" : "");
  if (upKind !== "object_type") return drop();
  const members = items(js, up);
  const next = members[members.indexOf(n) + 1];
  if (next === undefined) {
    if (!js.options.semi) return put("");
    within(IF_BROKEN, () => put(";"));
    if (sep !== undefined) within(IF_FLAT, drop);
    return;
  }
  if (js.options.semi || needsInterfaceSemicolon(js, n, next)) return put(";");
  if (sep !== undefined) within(IF_BROKEN, drop);
  within(IF_FLAT, () => put(";"));
};

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

/** `n`'s dangling comments, one per line. */
function danglingLines(ctx: JsStreamCtx, n: number): void {
  ctx.danglingComments(n).forEach((c, i) => {
    if (i > 0) sHardline();
    ctx.comment(c);
  });
}

/** Prettier's printTypeScriptMappedType, over tree-sitter's `{ [K in T]: V }` object type. */
function mappedType(
  ctx: JsStreamCtx,
  n: number,
  signature: number,
  clause: number,
): void {
  const js = ctx.js;
  const openBrace = anonKid(js, n, "{");
  let shouldBreak = false;
  // A line break between `{` and the first thing after it, a comment included.
  if (js.options.objectWrap === "preserve" && openBrace !== undefined)
    shouldBreak = lfAfter(js.tree, openBrace) > 0;
  const spacing = js.options.bracketSpacing ? 0 : SOFT;
  const readonlyKw = anonKid(js, signature, "readonly");
  const alias = field(js, clause, "alias");
  const sep = memberSeparator(js, signature);
  open(GROUP, -1, shouldBreak ? BROKEN : 0);
  tok(js, openBrace);
  open(INDENT);
  sLine(spacing);
  // One per line; the last breaks the line after it only when it is a line comment, ends its line or runs long.
  const dangling = ctx.danglingComments(n);
  dangling.forEach((c, i) => {
    if (i === dangling.length - 1) return;
    ctx.comment(c);
    sHardline();
  });
  const last = dangling.at(-1);
  if (last !== undefined) {
    open(GROUP);
    ctx.comment(last);
    if (src(js, last).startsWith("//") || lfAfter(js.tree, last) > 0)
      sHardline();
    else sLine(0);
    close();
  }
  if (readonlyKw !== undefined) {
    tok(js, field(js, signature, "sign"));
    tok(js, readonlyKw);
    sText(" ");
  }
  open(GROUP);
  tok(js, anonKid(js, signature, "["));
  open(INDENT);
  sLine(SOFT);
  pr(ctx, field(js, clause, "name"));
  sText(" ");
  tok(js, anonKid(js, clause, "in"));
  sText(" ");
  pr(ctx, field(js, clause, "type"));
  if (alias !== undefined) {
    sText(" ");
    tok(js, anonKid(js, clause, "as"));
    sText(" ");
    ctx.print(alias);
  }
  close();
  sLine(SOFT);
  tok(js, anonKid(js, signature, "]"));
  close();
  // The signature's type owns its comments: `indexSignature` prints them, reached through it.
  const type = field(js, signature, "type");
  if (type !== undefined) withComments(ctx, type, () => ctx.printNode(type));
  if (js.options.semi) {
    open(IF_BROKEN);
    if (sep !== undefined) sToken(sep, ";");
    else sToken(signature, ";", true);
    close();
    if (sep !== undefined) {
      open(IF_FLAT);
      sToken(sep, "");
      close();
    }
  } else tok(js, sep, "");
  close();
  sLine(spacing);
  tok(js, lastAnonKid(js, n, "}"));
  close();
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

/** Prettier's printClassBody for `TSTypeLiteral` and `TSInterfaceBody`; each member prints its own separator. */
const typeBody: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const isObjectType = kind(js, n) === "object_type";
  const mapped = isObjectType ? mappedClauseOf(js, n) : undefined;
  if (mapped !== undefined)
    return mappedType(ctx, n, mapped.signature, mapped.clause);
  const members = items(js, n);
  const hasDangling = ctx.danglingComments(n).length > 0;
  const openBrace = anonKid(js, n, "{");
  const closeBrace = lastAnonKid(js, n, "}");
  const parts = () => {
    members.forEach((m, i) => {
      ctx.print(m);
      const next = members[i + 1];
      if (!isObjectType && needsInterfaceSemicolon(js, m, next))
        sToken(m, ";", true);
      if (next !== undefined) {
        if (isObjectType) sLine(0);
        else sHardline();
        if (nextLineEmpty(js.tree, m)) sHardline();
      }
    });
    if (hasDangling) danglingLines(ctx, n);
  };
  const empty = members.length === 0 && !hasDangling;
  if (!isObjectType) {
    tok(js, openBrace);
    if (!empty) {
      open(INDENT);
      sHardline();
      parts();
      close();
      sHardline();
    }
    return tok(js, closeBrace);
  }
  if (empty) {
    open(GROUP);
    tok(js, openBrace);
    tok(js, closeBrace);
    return close();
  }
  const shouldBreak =
    hasComment(js, n, CF.Dangling | CF.Line) ||
    (js.options.objectWrap === "preserve" &&
      members[0] !== undefined &&
      newlineBetween(
        js.tree,
        firstLeaf(js.tree, n),
        firstLeaf(js.tree, members[0]),
      ));
  const spacing =
    !js.options.bracketSpacing || (members.length === 0 && !shouldBreak)
      ? SOFT
      : 0;
  const grouped = !isHuggedParameterType(js, n);
  if (grouped) open(GROUP, -1, shouldBreak ? BROKEN : 0);
  tok(js, openBrace);
  open(INDENT);
  sLine(spacing);
  parts();
  close();
  sLine(spacing);
  tok(js, closeBrace);
  if (grouped) close();
};

/**
 * The modifiers before a member's key, the key as prettier's printKey prints it, and the `?` after it. A spec
 * reaches it through the member's key (`$.name.via("memberKey")`), so it prints from the member, the key's parent.
 */
function memberHead(ctx: JsStreamCtx, n: number): void {
  const js = ctx.js;
  const key = field(js, n, "name");
  const kids = children(js, n);
  for (const c of kids) {
    if (c === key) break;
    if (isComment(js, c)) continue;
    if (named(js, c)) ctx.print(c);
    else tok(js, c);
    sText(" ");
  }
  sPrintKey(ctx, n);
  if (key === undefined) return;
  const question = kids
    .slice(kids.indexOf(key) + 1)
    .find((c) => !named(js, c) && kind(js, c) === "?");
  if (question === undefined) return;
  tok(js, question);
  // Only oxfmt's placement leaves a comment there: `a? /* c */()`.
  printTrailingComments(ctx, question);
}

const memberKey: CustomRule<JsOptions> = (key, sctx) => {
  const ctx = jsCtx(sctx);
  const n = parent(ctx.js, key);
  if (n !== undefined) memberHead(ctx, n);
};

/** A method signature up to its separator, reached through its key (`$.name.via("methodSignature")`). */
const methodSignature: CustomRule<JsOptions> = (key, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const n = parent(js, key);
  if (n === undefined) return;
  open(GROUP);
  memberHead(ctx, n);
  const parameters = capture(() =>
    sPrintFunctionParameters(ctx, n, false, true),
  );
  const returnNode = field(js, n, "return_type");
  const returnType = capture(() => pr(ctx, returnNode));
  const groupParameters = sShouldGroupFunctionParameters(js, n, returnType);
  if (groupParameters) open(GROUP);
  place(parameters);
  if (groupParameters) close();
  if (returnNode !== undefined) {
    open(GROUP);
    place(returnType);
    close();
  }
  close();
};

/** An index signature up to its separator, reached through its type (`$.type.via("indexSignature")`). */
const indexSignature: CustomRule<JsOptions> = (type, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const n = parent(js, type);
  if (n === undefined) return;
  const name = field(js, n, "name");
  for (const c of children(js, n)) {
    if (!named(js, c) && kind(js, c) === "[") break;
    if (isComment(js, c)) continue;
    if (named(js, c)) ctx.print(c);
    else tok(js, c);
    sText(" ");
  }
  tok(js, anonKid(js, n, "["));
  if (name !== undefined) {
    open(GROUP);
    open(INDENT);
    sLine(SOFT);
    ctx.print(name);
    tok(js, anonKid(js, n, ":"));
    sText(" ");
    pr(ctx, field(js, n, "index_type"));
    close();
    sLine(SOFT);
    close();
  }
  tok(js, anonKid(js, n, "]"));
  withComments(ctx, type, () => ctx.printNode(type));
};

/**
 * Prettier's printFunctionType, for function and constructor types and, up to their separator, call and
 * construct signatures.
 */
const functionType: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const parameters = capture(() =>
    sPrintFunctionParameters(ctx, n, false, true),
  );
  const isSignature =
    kind(js, n) === "call_signature" || kind(js, n) === "construct_signature";
  const returnNode = field(js, n, "return_type") ?? field(js, n, "type");
  const returnType = capture(() => {
    if (returnNode === undefined) return;
    if (!isSignature) {
      sText(" ");
      tok(js, anonKid(js, n, "=>"));
      sText(" ");
    }
    ctx.print(returnNode);
  });
  // `(): (r: U) => S => x` parses without parentheses around the arrow's return type; prettier adds them.
  const parenthesized =
    kind(js, n) === "function_type" &&
    kind(js, parent(js, n)) !== "parenthesized_type" &&
    typeNeedsParens(js, n);
  if (parenthesized) sToken(n, "(", true);
  open(GROUP);
  for (const keyword of ["abstract", "new"]) {
    const c = anonKid(js, n, keyword);
    if (c === undefined) continue;
    tok(js, c);
    // oxfmt glues a comment after `new` to the `(`: `new /* c */(`.
    if (ctx.trailingComments(c).length > 0) printTrailingComments(ctx, c);
    else sText(" ");
  }
  const groupParameters = sShouldGroupFunctionParameters(js, n, returnType);
  if (groupParameters) open(GROUP);
  place(parameters);
  if (groupParameters) close();
  place(returnType);
  close();
  if (parenthesized) sToken(n, ")", true);
};

/** A `:` annotation with a leading comment, which prettier's printTypeAnnotationProperty spaces off (`x /* c *\/ : T`). */
export const annotationOwnsComments = (x: JsCtx, n: number) =>
  kind(x, n) === "type_annotation" && hasComment(x, n, CF.Leading);

const typeAnnotation: CustomRule<JsOptions> = (n, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const owns = annotationOwnsComments(js, n);
  if (owns) {
    sText(" ");
    printLeadingComments(ctx, n);
  }
  tok(js, anonKid(js, n, ":"));
  sText(" ");
  const type = first(js, n);
  if (type !== undefined) ctx.print(type);
  if (owns) printTrailingComments(ctx, n);
};

/** A call or construct signature up to its separator, reached through its parameters (`.via("signature")`). */
const signature: CustomRule<JsOptions> = (parameters, sctx) => {
  const n = parent(jsCtx(sctx).js, parameters);
  if (n !== undefined) functionType(n, sctx);
};

/** The TypeScript kinds format.ts lays out by hand, by the names its spec gives them. */
const nodeCustoms = {
  parenthesizedType,
  intersectionType,
  typeParameters,
  ambientDeclaration,
  castExpression,
  typeBody,
  memberKey,
  methodSignature,
  indexSignature,
  functionType,
  typeAnnotation,
  signature,
  unionType,
  moduleBody,
  typeAlias,
} satisfies Record<string, CustomRule<JsOptions>>;

export const typeCustoms = {
  ...nodeCustoms,
  memberSemi,
};

export const typeRules: Record<string, StreamRule<JsOptions>> = {
  type_assertion: typeAssertion,
};
