// The token streams swift-format 6.3.0's TokenStreamCreator builds, for the statements syntechs can lay out:
// a `let`/`var` with one binding, a call, `try` or `return` standing as a statement, and the header of an `if`
// or `guard` up to its body's `{`. Each rule names the TokenStreamCreator visitor it ports. Any other node in
// the statement throws, so the caller refuses the file instead of printing a layout swift-format would not.
//
// tree-sitter nests operators and prefixes differently from SwiftSyntax (`a || b || c` to the right, `!a.b` as
// `(!a).b`, `a == b || c` as `a == (b || c)`), so expressions are first rebuilt into the shape SwiftSyntax gives
// them after `foldAll`: an operator sequence folded by Swift's precedence groups, a prefix over the whole
// postfix chain. The visitors then run over that shape.

import type { FormatTree } from "../../fmt/tree.js";
import { type BreakKind, type Tok, tk } from "./pretty.js";

/** Literals swift-format prints whole: a string's interpolations are its raw text (`ExpressionSegmentSyntax`). */
const WHOLE = new Set(["line_string_literal", "raw_string_literal"]);
const LITERALS = new Set([
  "integer_literal",
  "hex_literal",
  "oct_literal",
  "bin_literal",
  "real_literal",
  "boolean_literal",
  "line_string_literal",
  "raw_string_literal",
  "nil",
]);
/** The tree-sitter kinds of an operator sequence, which `binary` flattens and refolds. */
const BINARY = new Set([
  "additive_expression",
  "multiplicative_expression",
  "comparison_expression",
  "equality_expression",
  "conjunction_expression",
  "disjunction_expression",
  "nil_coalescing_expression",
  // `a != b` after a long name, among others.
  "infix_expression",
]);
/** Swift's standard precedence groups by operator: [precedence, associativity]. */
const PRECEDENCE: Record<string, [number, "left" | "right" | "none"]> = {
  "*": [150, "left"],
  "/": [150, "left"],
  "%": [150, "left"],
  "+": [140, "left"],
  "-": [140, "left"],
  "??": [131, "right"],
  "==": [130, "none"],
  "!=": [130, "none"],
  "<": [130, "none"],
  ">": [130, "none"],
  "<=": [130, "none"],
  ">=": [130, "none"],
  "===": [130, "none"],
  "!==": [130, "none"],
  "&&": [120, "left"],
  "||": [110, "left"],
};

/** An expression as SwiftSyntax shapes it, spanning the leaves `first` to `last`. */
interface Expr {
  k:
    | "ref"
    | "literal"
    | "keyPath"
    | "member"
    | "call"
    | "prefix"
    | "infix"
    | "try"
    | "array"
    | "ternary"
    | "optional"
    | "unwrap"
    | "closure"
    | "tuple";
  first: number;
  last: number;
  /** `member`: the base, if any; `call`: the callee; `prefix`/`try`: the operand; `infix`: lhs, rhs; `array`: elements. */
  kids: Expr[];
  /** `member`: the `.`; `prefix`/`infix`/`try`: the operator or keyword. */
  op?: number;
  /** `member`: the name. */
  name?: number;
  /** `call`: the argument list node (`value_arguments`), whose first child is `(` or `[`. */
  args?: number;
  /** `call`: each argument's value, in order. */
  values?: Expr[];
  /** `call`: its trailing closure. */
  trailing?: Expr;
  /** `closure`: its signature's parameter names and `in`, when it has one. */
  signature?: { params: number[]; inKeyword: number };
  parent?: Expr;
}

/** The first token of `n` as swift-format reads it: a string is one. */
function firstLeaf(tree: FormatTree, n: number): number {
  while (tree.count(n) > 0 && !WHOLE.has(tree.kindName(n))) n = tree.child(n, 0);
  return n;
}

function lastLeaf(tree: FormatTree, n: number): number {
  while (tree.count(n) > 0 && !WHOLE.has(tree.kindName(n))) n = tree.child(n, tree.count(n) - 1);
  return n;
}

/**
 * The tokens swift-format prints `stmt` with, up to and including the leaf `last` (the whole statement, or an
 * `if`/`guard` header through its `{`); throws naming what is not covered.
 */
export function statementTokens(
  tree: FormatTree,
  stmt: number,
  /** The spaces between `leaf` and the leaf before it, or undefined across a line break. */
  gap: (leaf: number) => number | undefined,
  /**
   * A dictionary element on a line of its own (`stmt` is its key): its `:`, value and `,`, which tree-sitter keeps
   * as the key's siblings in the dictionary literal.
   */
  element?: { colon: number; value: number; comma: number | undefined },
): { tokens: Tok[]; last: number } {
  const before = new Map<number, Tok[]>();
  const after = new Map<number, Tok[][]>();
  const addBefore = (leaf: number, ...toks: Tok[]) => before.set(leaf, [...(before.get(leaf) ?? []), ...toks]);
  const addAfter = (leaf: number, ...toks: Tok[]) => after.set(leaf, [...(after.get(leaf) ?? []), toks]);
  /** Adds tokens as though their visitor ran before the others there: before tokens first, an after group last. */
  const prependBefore = (leaf: number, ...toks: Tok[]) => before.set(leaf, [...toks, ...(before.get(leaf) ?? [])]);
  const prependAfter = (leaf: number, ...toks: Tok[]) => after.set(leaf, [toks, ...(after.get(leaf) ?? [])]);
  const kind = (n: number) => tree.kindName(n);
  const children = (n: number) => Array.from({ length: tree.count(n) }, (_, i) => tree.child(n, i));
  const unsupported = (n: number): never => {
    throw new Error(`a \`${kind(n)}\` in a line past the width (line breaking): \`${tree.text(n).split("\n")[0]}\``);
  };
  const preVisited = new Set<Expr>();
  /** `closingDelimiterTokens`: the commas ending an argument or a condition. */
  const delimiters = new Set<number>();

  const leaves: number[] = [];
  const collect = (n: number) => {
    if (tree.count(n) === 0 || WHOLE.has(kind(n))) leaves.push(n);
    else for (const c of children(n)) collect(c);
  };
  collect(stmt);
  if (element !== undefined) for (const n of [element.colon, element.value, element.comma]) if (n !== undefined) collect(n);
  const isComment = (n: number) => kind(n) === "comment" || kind(n) === "multiline_comment";
  const leafAfter = (leaf: number) => leaves[leaves.indexOf(leaf) + 1];

  // ---- The SwiftSyntax shape.

  const make = (e: Expr): Expr => {
    for (const c of e.kids) c.parent = e;
    for (const c of e.values ?? []) c.parent = e;
    return e;
  };
  /** A postfix node over `base`, the prefix operators and `try` on `base` hoisted over it (`!a.b` is `!(a.b)`). */
  const postfix = (base: Expr, build: (base: Expr) => Expr): Expr => {
    if (base.k !== "prefix" && base.k !== "try") return build(base);
    const inner = postfix(base.kids[0] as Expr, build);
    return make({ k: base.k, first: base.first, last: inner.last, kids: [inner], op: base.op as number });
  };
  const innermostTry = (e: Expr): Expr => (e.k === "try" ? innermostTry(e.kids[0] as Expr) : e);

  function convert(n: number): Expr {
    const k = kind(n);
    if (k === "simple_identifier" || k === "self_expression")
      return { k: "ref", first: firstLeaf(tree, n), last: lastLeaf(tree, n), kids: [] };
    if (LITERALS.has(k)) {
      if (tree.text(n).includes("\n")) unsupported(n);
      return { k: "literal", first: firstLeaf(tree, n), last: lastLeaf(tree, n), kids: [] };
    }
    if (BINARY.has(k)) return binary(n);
    if (k === "navigation_expression") {
      const kids = children(n);
      // `a?.b`: tree-sitter puts the `?` between the target and the suffix; SwiftSyntax reads a member access on
      // an `OptionalChainingExprSyntax` over the target.
      const optional = kids.length === 3 && tree.text(kids[1] as number) === "?" ? lastLeaf(tree, kids[1] as number) : undefined;
      const [target, suffix] = (optional === undefined ? kids : [kids[0], kids[2]]) as [number, number];
      if ((optional === undefined && tree.count(n) !== 2) || kind(suffix) !== "navigation_suffix" || tree.count(suffix) !== 2)
        unsupported(n);
      const [dot, name] = children(suffix) as [number, number];
      // A name, or a tuple element's index (`a.0`).
      if (kind(name) !== "simple_identifier" && kind(name) !== "integer_literal") unsupported(suffix);
      // `\.name`: tree-sitter reads the backslash alone as the key path, then a member access on it.
      if (kind(target) === "key_path_expression") {
        if (tree.count(target) !== 1) unsupported(target);
        return { k: "keyPath", first: firstLeaf(tree, target), last: name, kids: [] };
      }
      const converted = convert(target);
      const base =
        optional === undefined
          ? converted
          : postfix(converted, (b) => make({ k: "optional", first: b.first, last: optional, kids: [b], op: optional }));
      // `f(x).y` breaks before the call's `)` (`call`'s mustBreakBeforeClosingDelimiter); `f(x)?.y` does not.
      return postfix(base, (base) =>
        make({ k: "member", first: base.first, last: name, kids: [base], op: dot, name }),
      );
    }
    if (k === "prefix_expression") {
      const [op, target] = children(n) as [number, number];
      if (tree.count(n) !== 2) unsupported(n);
      // `.name`: an implicit member access, which has no base.
      if (tree.text(op) === ".") {
        if (kind(target) !== "simple_identifier") unsupported(n);
        return { k: "member", first: op, last: target, kids: [], op, name: target };
      }
      if (kind(op) !== "bang") unsupported(n);
      const operand = convert(target);
      return make({ k: "prefix", first: op, last: operand.last, kids: [operand], op });
    }
    if (k === "call_expression") {
      const [callee, suffix] = children(n) as [number, number];
      if (tree.count(n) !== 2 || kind(suffix) !== "call_suffix") unsupported(n);
      // `!(a ?? b)`: tree-sitter reads a call of the `!`; SwiftSyntax a prefix `!` on a parenthesized expression.
      if (kind(callee) === "bang") {
        const args = tree.child(suffix, 0);
        const list = children(args);
        const arg = list[1] as number;
        if (tree.count(suffix) !== 1 || kind(args) !== "value_arguments" || list.length !== 3 || tree.count(arg) !== 1) unsupported(n);
        const inner = convert(tree.child(arg, 0));
        const paren = make({ k: "tuple", first: list[0] as number, last: list[2] as number, kids: [inner] });
        return make({ k: "prefix", first: callee, last: paren.last, kids: [paren], op: callee });
      }
      // `f(a)`, `f(a) { … }` or `f { … }`: the arguments, then a trailing closure.
      const parts = children(suffix);
      const args = parts.find((c) => kind(c) === "value_arguments");
      const closure = parts.find((c) => kind(c) === "lambda_literal");
      if (parts.length !== (args === undefined ? 0 : 1) + (closure === undefined ? 0 : 1)) unsupported(suffix);
      if (args !== undefined && parts[0] !== args) unsupported(suffix);
      const values: Expr[] = [];
      if (args !== undefined)
        for (const c of children(args)) {
          if (kind(c) !== "value_argument") continue;
          const kids = children(c);
          values.push(convert(kids[kids.length - 1] as number));
        }
      const trailing = closure === undefined ? undefined : convert(closure);
      const last = trailing?.last ?? lastLeaf(tree, args as number);
      return postfix(convert(callee), (base) =>
        make({
          k: "call",
          first: base.first,
          last,
          kids: trailing === undefined ? [base] : [base, trailing],
          ...(args === undefined ? {} : { args }),
          values,
          ...(trailing === undefined ? {} : { trailing }),
        }),
      );
    }
    if (k === "lambda_literal") {
      // `ClosureExprSyntax` with at most one statement, its signature, if any, bare parameter names.
      const parts = children(n);
      const lbrace = parts[0] as number;
      const rbrace = parts[parts.length - 1] as number;
      let i = 1;
      let signature: Expr["signature"];
      if (kind(parts[i] as number) === "lambda_function_type") {
        const type = parts[i++] as number;
        const inKeyword = parts[i++] as number;
        if (kind(type) !== "lambda_function_type" || tree.count(type) !== 1 || tree.text(inKeyword) !== "in") unsupported(type);
        const list = tree.child(type, 0);
        if (kind(list) !== "lambda_function_type_parameters") unsupported(type);
        const params: number[] = [];
        for (const c of children(list)) {
          if (tree.text(c) === ",") {
            params.push(c);
            continue;
          }
          if (kind(c) !== "lambda_parameter" || tree.count(c) !== 1 || kind(tree.child(c, 0)) !== "simple_identifier") unsupported(c);
          params.push(tree.child(c, 0));
        }
        signature = { params, inKeyword };
      }
      const body: Expr[] = [];
      const statements = parts[i];
      if (statements !== undefined && statements !== rbrace) {
        if (kind(statements) !== "statements" || tree.count(statements) !== 1) unsupported(statements);
        body.push(convert(tree.child(statements, 0)));
        i++;
      }
      if (parts[i] !== rbrace || tree.text(lbrace) !== "{") unsupported(n);
      return make({ k: "closure", first: lbrace, last: rbrace, kids: body, ...(signature === undefined ? {} : { signature }) });
    }
    if (k === "tuple_expression") {
      // `TupleExprSyntax`: one element is a parenthesized expression, more a tuple; labels are not ported.
      const parts = children(n);
      const elements = parts.filter((c) => tree.named(c));
      if (elements.length === 0 || parts.some((c) => tree.fieldName(c) === "name")) unsupported(n);
      return make({ k: "tuple", first: parts[0] as number, last: parts[parts.length - 1] as number, kids: elements.map(convert) });
    }
    if (k === "postfix_expression") {
      // `a!`: `ForceUnwrapExprSyntax`.
      const [target, op] = children(n) as [number, number];
      if (tree.count(n) !== 2 || kind(op) !== "bang") unsupported(n);
      return postfix(convert(target), (base) => make({ k: "unwrap", first: base.first, last: lastLeaf(tree, op), kids: [base] }));
    }
    if (k === "try_expression") {
      const [op, target] = children(n) as [number, number];
      if (tree.count(n) !== 2 || tree.count(op) !== 1) unsupported(n);
      const operand = convert(target);
      const keyword = firstLeaf(tree, op);
      return make({ k: "try", first: keyword, last: operand.last, kids: [operand], op: keyword });
    }
    if (k === "ternary_expression") {
      const [cond, question, then, colon, otherwise] = children(n) as [number, number, number, number, number];
      if (tree.count(n) !== 5 || tree.text(question) !== "?" || tree.text(colon) !== ":") unsupported(n);
      const parts = [convert(cond), convert(then), convert(otherwise)];
      return make({ k: "ternary", first: parts[0]!.first, last: parts[2]!.last, kids: parts, op: question, name: colon });
    }
    if (k === "array_literal") {
      const elements = children(n).filter((c) => tree.named(c));
      // ArrayElementListSyntax's commas are not ported.
      if (elements.length !== 1 || tree.count(n) !== 3) unsupported(n);
      return make({ k: "array", first: firstLeaf(tree, n), last: lastLeaf(tree, n), kids: elements.map(convert) });
    }
    return unsupported(n);
  }

  /** `SwiftOperators.foldAll` over the operator sequence tree-sitter nested as `n`. */
  function binary(n: number): Expr {
    const operands: Expr[] = [];
    const ops: number[] = [];
    const flatten = (m: number): void => {
      if (!BINARY.has(kind(m))) {
        // An operand that is a ternary is one tree-sitter misnested: the ternary binds loosest.
        if (kind(m) === "ternary_expression") unsupported(m);
        operands.push(convert(m));
        return;
      }
      if (tree.count(m) !== 3) unsupported(m);
      const [lhs, op, rhs] = children(m) as [number, number, number];
      if (PRECEDENCE[tree.text(op)] === undefined) unsupported(m);
      flatten(lhs);
      ops.push(op);
      flatten(rhs);
    };
    flatten(n);
    // `foldAll` hoists a `try` on the leftmost operand over the whole sequence.
    const first = operands[0] as Expr;
    if (first.k === "try") {
      operands[0] = first.kids[0] as Expr;
      const folded = fold();
      return make({ k: "try", first: first.first, last: folded.last, kids: [folded], op: first.op as number });
    }
    return fold();
    function fold(): Expr {
    let next = 0;
    const climb = (min: number): Expr => {
      let lhs = operands[next] as Expr;
      while (next < ops.length) {
        const op = ops[next] as number;
        const [prec, assoc] = PRECEDENCE[tree.text(op)] as [number, string];
        if (prec < min) break;
        next++;
        const rhs = climb(assoc === "right" ? prec : prec + 1);
        const following = ops[next];
        // Comparisons do not chain.
        if (assoc === "none" && following !== undefined && PRECEDENCE[tree.text(following)]?.[0] === prec) unsupported(n);
        lhs = make({ k: "infix", first: lhs.first, last: rhs.last, kids: [lhs, rhs], op });
      }
      return lhs;
    };
    return climb(0);
    }
  }

  // ---- The visitors.

  /** `insertContextualBreaks`: the breaks before each `.` of a member chain. */
  function contextual(expr: Expr, top: boolean): { compound: boolean; member: boolean } {
    preVisited.add(expr);
    if (expr.k === "member") {
      const base = expr.kids[0];
      const called = expr.parent?.k === "call" && expr.parent.kids[0] === expr;
      if (base !== undefined && !called) addBefore(expr.op as number, tk.brk({ k: "contextual" }, 0));
      const compound = base === undefined ? false : contextual(base, false).compound;
      if (top) {
        addBefore(expr.first, tk.ctxStart);
        addAfter(expr.last, tk.ctxEnd);
      }
      return { compound, member: true };
    }
    if (expr.k === "call") {
      const callee = expr.kids[0] as Expr;
      const { member } = contextual(callee, false);
      if (callee.k === "member") {
        if (callee.kids[0] !== undefined) addBefore(callee.op as number, tk.brk({ k: "contextual" }, 0));
        addBefore(callee.op as number, tk.ctxStart);
        addAfter(expr.last, tk.ctxEnd);
        if (top) {
          addBefore(expr.first, tk.ctxStart);
          addAfter(expr.last, tk.ctxEnd);
        }
      } else {
        addBefore(expr.first, tk.ctxStart);
        addAfter(expr.last, tk.ctxEnd);
      }
      return { compound: true, member };
    }
    addBefore(expr.first, tk.ctxStart);
    addAfter(expr.last, tk.ctxEnd);
    return { compound: expr.k !== "ref", member: false };
  }

  function expression(e: Expr): void {
    switch (e.k) {
      case "ref":
      case "literal":
        return;
      case "keyPath":
        // `visit(KeyPathExprSyntax)`.
        addBefore(e.first, tk.open());
        addAfter(e.last, tk.close);
        return;
      case "member":
        if (!preVisited.has(e)) contextual(e, true);
        if (e.kids[0] !== undefined) expression(e.kids[0]);
        return;
      case "call":
        return call(e);
      case "prefix":
        return expression(e.kids[0] as Expr);
      case "optional":
      case "unwrap":
        // `visit(OptionalChainingExprSyntax)` and `visit(ForceUnwrapExprSyntax)` visit their children; a member
        // chain below is a root of its own.
        return expression(e.kids[0] as Expr);
      case "closure":
        return closure(e);
      case "tuple":
        return tuple(e);
      case "infix":
        return infix(e);
      case "try":
        return tryExpr(e);
      case "ternary":
        return ternary(e);
      case "array":
        // `visit(ArrayExprSyntax)`.
        addAfter(e.first, tk.brk({ k: "open", block: true }, 0), tk.open());
        addBefore(e.last, tk.brk({ k: "close", mustBreak: true }, 0), tk.close);
        for (const c of e.kids) expression(c);
        return;
    }
  }

  /** `visit(FunctionCallExprSyntax)` and `visit(SubscriptCallExprSyntax)` with `arrangeFunctionCallArgumentList`. */
  function call(e: Expr): void {
    if (!preVisited.has(e)) contextual(e, true);
    const callee = e.kids[0] as Expr;
    const base = callee.k === "member" ? callee.kids[0] : undefined;
    if (base?.k === "ref") {
      // Not when a `try` before it groups the same tokens.
      const prev = leaves[leaves.indexOf(base.first) - 1];
      if (prev === undefined || kind(tree.parent(prev)) !== "try_operator") {
        addBefore(base.first, tk.open());
        addAfter(callee.name as number, tk.close);
      }
    }
    const list = e.args === undefined ? [] : children(e.args);
    const values = e.values as Expr[];
    // `isCompactSingleFunctionCallArgument`: a lone array, dictionary or closure argument; only a closure is ported.
    const compact = values.length === 1 && (values[0] as Expr).k === "closure";
    for (const c of list)
      if (kind(c) === "value_argument") {
        const last = kind(children(c).at(-1) as number);
        if (last === "array_literal" || last === "dictionary_literal") unsupported(c);
      }
    if (e.trailing !== undefined)
      addBefore(e.trailing.first, tk.elective({ k: "same" }));
    if (values.length > 0) {
      const lparen = list[0] as number;
      const rparen = list[list.length - 1] as number;
      // A trailing closure keeps the `)` down with its `{`; so does a member after the call
      // (`mustBreakBeforeClosingDelimiter`), unless the argument is compact.
      const memberAfter = e.parent?.k === "member" && e.parent.kids[0] === e;
      const breakBeforeRight = !compact && (e.trailing !== undefined || memberAfter);
      addAfter(lparen, tk.brk({ k: "open", block: true }, 0), ...(compact ? [] : [tk.open()]));
      addBefore(rparen, tk.brk({ k: "close", mustBreak: breakBeforeRight }, 0), ...(compact ? [] : [tk.close]));
    }
    let v = 0;
    for (const [i, c] of list.entries()) {
      if (kind(c) !== "value_argument") continue;
      const parts = children(c);
      const value = values[v++] as Expr;
      if (!compact) addBefore(firstLeaf(tree, c), tk.open());
      if (parts.length === 3) {
        const colon = parts[1] as number;
        if (tree.text(colon) !== ":" || kind(parts[0] as number) !== "value_argument_label") unsupported(c);
        const opener = tree.text(value.first);
        addAfter(colon, opener === "(" || opener === "[" || opener === "{" ? tk.space : tk.brk({ k: "continue" }));
      } else if (parts.length !== 1) unsupported(c);
      const next = list[i + 1] as number;
      if (tree.text(next) === ",") {
        delimiters.add(next);
        addAfter(next, tk.close, tk.brk({ k: "same" }));
      } else if (!compact) addAfter(value.last, tk.close);
    }
    // The children after the call's own tokens, as the visitor walks them.
    expression(callee);
    for (const value of values) expression(value);
    if (e.trailing !== undefined) expression(e.trailing);
  }

  /** `visit(TupleExprSyntax)` with `arrangeAsTupleExprElement`. */
  function tuple(e: Expr): void {
    if (e.kids.length === 1) {
      addAfter(e.first, tk.open());
      addBefore(e.last, tk.close);
      delimiters.add(e.last);
    } else {
      addAfter(e.first, tk.brk({ k: "open", block: true }, 0), tk.open());
      addBefore(e.last, tk.brk({ k: "close", mustBreak: true }, 0), tk.close);
      for (const c of e.kids) {
        addBefore(c.first, tk.open());
        const comma = leafAfter(c.last);
        if (comma !== undefined && tree.text(comma) === ",") {
          delimiters.add(comma);
          addAfter(comma, tk.close, tk.brk({ k: "same" }));
        } else addAfter(c.last, tk.close);
      }
    }
    for (const c of e.kids) expression(c);
  }

  /**
   * `visit(ClosureExprSyntax)` (`arrangeBracesAndContents` without a reset for one with no signature),
   * `visit(ClosureSignatureSyntax)` over bare parameter names, and `visit(CodeBlockItemListSyntax)` over its one
   * statement, if any.
   */
  function closure(e: Expr): void {
    // `.break(.close)` is `mustBreak: true`: a `}` on another line than its `{` starts its own line.
    const body = e.kids[0];
    const sig = e.signature;
    if (sig !== undefined) {
      addAfter(e.first, tk.brk({ k: "open", block: true }));
      addAfter(sig.inKeyword, tk.brk({ k: "same" }, body === undefined ? 0 : 1));
      addBefore(e.last, tk.brk({ k: "close", mustBreak: true }));
      // The signature's group, and the parameters' (not parenthesized, so no open or close breaks).
      const first = sig.params[0] as number;
      addBefore(first, tk.open(), tk.open());
      addAfter(sig.params[sig.params.length - 1] as number, tk.close);
      for (const c of sig.params) if (tree.text(c) === ",") addAfter(c, tk.brk({ k: "same" }));
      addBefore(sig.inKeyword, tk.brk({ k: "same" }));
      addAfter(sig.inKeyword, tk.close);
    } else if (body !== undefined) {
      addAfter(e.first, tk.brk({ k: "open", block: true }), tk.open());
      addBefore(e.last, tk.brk({ k: "close", mustBreak: true }), tk.close);
    } else {
      addAfter(e.first, tk.brk({ k: "open", block: true }, 0));
      addBefore(e.last, tk.brk({ k: "close", mustBreak: true }, 0));
    }
    if (body === undefined) return;
    addBefore(body.first, tk.open());
    addAfter(body.last, tk.close, tk.brk({ k: "reset" }, 0));
    expression(body);
  }

  /** `visit(InfixOperatorExprSyntax)`, with `stackedIndentationBehavior` stacking `&&` and `||`. */
  function infix(e: Expr): void {
    const [lhs, rhs] = e.kids as [Expr, Expr];
    const op = e.op as number;
    // `maybeGroupAroundSubexpression`.
    if (rhs.k === "member" || rhs.k === "call") {
      addBefore(rhs.first, tk.open());
      addAfter(rhs.last, tk.close);
    }
    const text = tree.text(op);
    if (text === "&&" || text === "||") {
      // `outermostEnclosingNode`: an operand that ends just before an argument's or a condition's comma
      // unindents after that comma.
      const next = leafAfter(rhs.last);
      const unindent = next !== undefined && delimiters.has(next) ? next : rhs.last;
      addBefore(op, tk.brk({ k: "open", block: false }), tk.open());
      addAfter(unindent, tk.brk({ k: "reset" }, 0), tk.brk({ k: "close", mustBreak: false }, 0), tk.close);
    } else addBefore(op, tk.brk({ k: "continue" }));
    addAfter(op, tk.space);
    expression(lhs);
    expression(rhs);
  }

  /** `visit(TernaryExprSyntax)`: the `? a : b` part is grouped ahead of `c ? a`. */
  function ternary(e: Expr): void {
    const [cond, then, otherwise] = e.kids as [Expr, Expr, Expr];
    const question = e.op as number;
    const colon = e.name as number;
    addBefore(question, tk.brk({ k: "open", block: false }), tk.open());
    addAfter(question, tk.space);
    addBefore(colon, tk.brk({ k: "close", mustBreak: false }, 0), tk.brk({ k: "open", block: false }), tk.open());
    addAfter(colon, tk.space);
    // `outermostEnclosingNode`: an argument's or a condition's comma joins the scope.
    const next = leafAfter(otherwise.last);
    const scope = next !== undefined && delimiters.has(next) ? next : otherwise.last;
    addAfter(scope, tk.brk({ k: "close", mustBreak: false }, 0), tk.close, tk.close);
    expression(cond);
    expression(then);
    expression(otherwise);
  }

  /** `visit(TryExprSyntax)` with `connectingTokenForKeywordModifiedExpr`. */
  function tryExpr(e: Expr): void {
    const operand = e.kids[0] as Expr;
    addBefore(operand.first, tk.elective({ k: "continue" }));
    const anchor = (x: Expr): number | undefined => {
      if (x.k === "try" || x.k === "call") return anchor(x.kids[0] as Expr);
      if (x.k === "member") {
        const base = x.kids[0];
        if (base === undefined) return undefined;
        return base.k === "ref" ? x.name : anchor(base);
      }
      return x.k === "ref" ? x.last : undefined;
    };
    const token = anchor(operand);
    if (token !== undefined && e.parent?.k !== "try") {
      addBefore(e.op as number, tk.open());
      addAfter(token, tk.close);
    }
    expression(operand);
  }

  const isCompound = (e: Expr): boolean => e.k === "infix" || e.k === "ternary" || (e.k === "try" && isCompound(e.kids[0] as Expr));

  /**
   * `visit(ConditionElementSyntax)` (with `visit(OptionalBindingConditionSyntax)`) over each condition in `parts`,
   * after `before` runs for each condition's first and last token (the `if`/`guard` visitor, which runs first).
   */
  function conditions(parts: number[], around: (first: number, last: number, index: number) => void): number {
    let start = 0;
    let count = 0;
    let lastLeafOfAll = NaN;
    for (let i = 0; i <= parts.length; i++) {
      // A `case` condition's pattern holds commas of its own (tree-sitter flattens it into the statement): it runs
      // to its `=` and the one value after it.
      if (i === start && parts[i] !== undefined && tree.text(parts[i] as number) === "case") {
        const eq = parts.findIndex((c, j) => j > i && tree.text(c) === "=" && kind(c) === "=");
        if (eq < 0) unsupported(parts[i] as number);
        i = eq + 1;
        continue;
      }
      const comma = parts[i];
      if (comma !== undefined && tree.text(comma) !== ",") continue;
      const seg = parts.slice(start, i);
      start = i + 1;
      if (seg.length === 0) unsupported(parts[0] as number);
      const head = seg[0] as number;
      let value: Expr;
      let binding: { spec: number; eq: number } | undefined;
      let matching: { keyword: number; eq: number } | undefined;
      if (tree.text(head) === "case" && kind(head) === "case") {
        // `visit(MatchingPatternConditionSyntax)`: its pattern is kept as written (a break in it is not ported, so a
        // pattern that cannot fit is refused by the width check), then `visit(InitializerClauseSyntax)`.
        const eq = seg[seg.length - 2] as number;
        if (seg.length < 4 || tree.text(eq) !== "=") unsupported(head);
        value = convert(seg[seg.length - 1] as number);
        matching = { keyword: head, eq };
      } else if (kind(head) === "value_binding_pattern") {
        const [spec, name, eq, val] = seg as [number, number, number, number];
        if (seg.length !== 4 || kind(name) !== "simple_identifier" || tree.text(eq) !== "=" || tree.count(spec) !== 1)
          unsupported(head);
        value = convert(val);
        binding = { spec: firstLeaf(tree, spec), eq };
      } else {
        if (seg.length !== 1) unsupported(head);
        value = convert(head);
      }
      const first = firstLeaf(tree, head);
      const last = comma ?? value.last;
      around(first, last, count++);
      lastLeafOfAll = last;
      addBefore(first, tk.open());
      if (comma !== undefined) {
        delimiters.add(comma);
        addAfter(comma, tk.close, tk.brk({ k: "same" }));
      } else addAfter(value.last, tk.close);
      if (binding !== undefined) {
        addAfter(binding.spec, tk.brk({ k: "continue" }));
        addBefore(binding.eq, tk.space);
        addAfter(binding.eq, tk.brk({ k: "continue" }));
      }
      if (matching !== undefined) {
        addBefore(matching.keyword, tk.open());
        addAfter(matching.keyword, tk.brk({ k: "continue" }));
        addBefore(matching.eq, tk.space);
        addAfter(matching.eq, tk.brk({ k: "continue" }));
        addAfter(value.last, tk.close);
      }
      expression(value);
    }
    return lastLeafOfAll;
  }

  /** The direct children of `n` after its keyword and before the first `stop` token, and those after it. */
  const split = (n: number, stop: string) => {
    const parts = children(n);
    const end = parts.findIndex((c) => tree.text(c) === stop && kind(c) === stop);
    if (end < 0) unsupported(n);
    return { parts: parts.slice(1, end), stop: parts[end] as number, rest: parts.slice(end + 1) };
  };

  let lastToken = leaves[leaves.length - 1] as number;
  let header = false;
  const k = kind(stmt);
  if (element !== undefined) {
    // `visit(DictionaryElementListSyntax)`: a group around the element, a break after its `:`; the `same` break
    // after its `,` ends the line it stands on.
    const key = convert(stmt);
    const value = convert(element.value);
    addBefore(key.first, tk.open());
    addAfter(element.colon, tk.brk({ k: "continue" }));
    addAfter(value.last, tk.close);
    expression(key);
    expression(value);
  } else if (k === "property_declaration") binding(stmt);
  else if (["call_expression", "try_expression", "navigation_expression", "postfix_expression"].includes(k)) expression(convert(stmt));
  else if (k === "control_transfer_statement") {
    // `visit(ReturnStmtSyntax)`.
    const [keyword, result] = children(stmt) as [number, number];
    if (tree.count(stmt) !== 2 || tree.text(keyword) !== "return") unsupported(stmt);
    const value = convert(result);
    addBefore(value.first, tk.brk({ k: "continue" }));
    expression(value);
  } else if (k === "if_statement") {
    // `visit(IfExprSyntax)`, up to the body's `{` (`arrangeBracesAndContents` resets before it). The consistent
    // group `visit(CodeBlockItemSyntax)` puts around the whole `if` holds no break before the `{` that its
    // forced breaking would change: the reset there decides by the continuation state alone.
    const { parts, stop: brace } = split(stmt, "{");
    addAfter(firstLeaf(tree, stmt), tk.space);
    let firstOfAll = NaN;
    const last = conditions(parts, (first, lastOfCond, index) => {
      if (index === 0) {
        firstOfAll = first;
        return;
      }
      prependBefore(first, tk.brk({ k: "open", block: false }, 0));
      prependAfter(lastOfCond, tk.brk({ k: "close", mustBreak: false }, 0));
    });
    prependBefore(firstOfAll, tk.open());
    prependAfter(last, tk.close);
    addBefore(brace, tk.elective({ k: "reset" }));
    lastToken = brace;
    header = true;
  } else if (k === "assignment") {
    // `visit(InfixOperatorExprSyntax)` over an assigning operator.
    const [target, op, result] = children(stmt) as [number, number, number];
    if (tree.count(stmt) !== 3 || kind(target) !== "directly_assignable_expression" || tree.count(target) !== 1)
      unsupported(stmt);
    if (!["=", "+=", "-="].includes(tree.text(op))) unsupported(op);
    const lhs = convert(tree.child(target, 0));
    const rhs = convert(result);
    // `stackedIndentationBehavior(after:rhs:)` stacks around a ternary's condition; not ported.
    if (rhs.k === "ternary") unsupported(result);
    // `maybeGroupAroundSubexpression`: not around a function call assigned to an lvalue.
    if (rhs.k === "member" || (rhs.k === "call" && tree.text(children(rhs.args as number)[0] as number) === "[")) {
      addBefore(rhs.first, tk.open());
      addAfter(rhs.last, tk.close);
    }
    if (isCompound(rhs)) {
      addAfter(rhs.last, tk.close);
      addAfter(op, tk.brk({ k: "continue" }), tk.open());
    } else addAfter(op, tk.brk({ k: "continue" }));
    addBefore(op, tk.space);
    expression(lhs);
    expression(rhs);
  } else if (k === "while_statement") {
    // `visit(WhileStmtSyntax)`: as an `if`, without a group around the conditions or breaks around the first.
    const { parts, stop: brace } = split(stmt, "{");
    addAfter(firstLeaf(tree, stmt), tk.space);
    conditions(parts, (first, lastOfCond, index) => {
      if (index === 0) return;
      prependBefore(first, tk.brk({ k: "open", block: false }, 0));
      prependAfter(lastOfCond, tk.brk({ k: "close", mustBreak: false }, 0));
    });
    addBefore(brace, tk.elective({ k: "reset" }));
    lastToken = brace;
    header = true;
  } else if (k === "guard_statement") {
    // `visit(GuardStmtSyntax)`, up to the body's `{`.
    const { parts, stop: elseKeyword, rest } = split(stmt, "else");
    const brace = rest[0];
    if (brace === undefined || tree.text(brace) !== "{") return unsupported(stmt);
    addAfter(firstLeaf(tree, stmt), tk.space);
    conditions(parts, (first, lastOfCond) => {
      prependBefore(first, tk.brk({ k: "open", block: false }, 0));
      prependAfter(lastOfCond, tk.brk({ k: "close", mustBreak: false }, 0));
    });
    addBefore(elseKeyword, tk.brk({ k: "reset" }), tk.open());
    addAfter(elseKeyword, tk.space);
    addBefore(brace, tk.close);
    lastToken = brace;
    header = true;
  } else if (k === "function_declaration" || k === "init_declaration") {
    lastToken = functionHeader(stmt);
    header = true;
  } else if (k === "protocol_declaration") {
    lastToken = protocolHeader(stmt);
    header = true;
  } else if (k === "switch_entry") {
    // `visit(SwitchCaseLabelSyntax)`, up to its `:`: a space after `case`, each item a group, a `continue` break
    // after each item's `,`.
    const parts = children(stmt);
    const keyword = parts[0] as number;
    const colon = parts.find((c) => tree.text(c) === ":" && kind(c) === ":");
    if (tree.text(keyword) !== "case" || colon === undefined) unsupported(stmt);
    addBefore(keyword, tk.open());
    addAfter(keyword, tk.space);
    for (const [i, c] of parts.entries()) {
      if (kind(c) !== "switch_pattern") continue;
      const pattern = tree.child(c, 0);
      if (tree.count(c) !== 1 || kind(pattern) !== "pattern" || tree.count(pattern) !== 1) unsupported(c);
      const item = convert(tree.child(pattern, 0));
      addBefore(item.first, tk.open());
      const next = parts.slice(i + 1).find((x) => !isComment(x));
      if (next !== undefined && tree.text(next) === ",") addAfter(next, tk.close, tk.brk({ k: "continue" }));
      else addAfter(item.last, tk.close);
      expression(item);
    }
    addAfter(colon as number, tk.close);
    lastToken = colon as number;
    header = true;
  } else unsupported(stmt);

  /** The member type breaks of a dotted name (`visit(MemberTypeSyntax)`); `.Protocol` and `.Type` are metatypes. */
  function dotted(parts: number[], name: string): void {
    for (const [i, c] of parts.entries()) {
      if (kind(c) === name) continue;
      const next = parts[i + 1];
      if (tree.text(c) !== "." || next === undefined || kind(next) !== name) return unsupported(c);
      if (tree.text(next) !== "Protocol" && tree.text(next) !== "Type") addBefore(c, tk.brk({ k: "continue" }, 0));
    }
  }

  /** The tokens of a type: a plain or dotted name, an array, a dictionary or an optional of those. */
  function typeTokens(n: number): void {
    const parts = children(n);
    switch (kind(n)) {
      case "user_type":
        return dotted(parts, "type_identifier");
      case "array_type":
        if (parts.length !== 3) unsupported(n);
        return typeTokens(parts[1] as number);
      case "dictionary_type":
        // `visit(DictionaryTypeSyntax)`.
        if (parts.length !== 5 || tree.text(parts[2] as number) !== ":") unsupported(n);
        addAfter(parts[2] as number, tk.brk({ k: "continue" }));
        typeTokens(parts[1] as number);
        return typeTokens(parts[3] as number);
      case "optional_type":
        if (parts.length !== 2 || tree.text(parts[1] as number) !== "?") unsupported(n);
        return typeTokens(parts[0] as number);
      case "metatype":
        // `X.Type`, `X.Protocol`.
        if (parts.length !== 3 || tree.text(parts[1] as number) !== ".") unsupported(n);
        return typeTokens(parts[0] as number);
      case "tuple_type": {
        // `visit(TupleTypeSyntax)` and `visit(TupleTypeElementSyntax)` over one unlabeled element (`(any P)`).
        const item = parts[0] as number;
        const inner = children(item);
        if (parts.length !== 1 || kind(item) !== "tuple_type_item" || inner.length !== 3) unsupported(n);
        const [lparen, element, rparen] = inner as [number, number, number];
        if (tree.text(lparen) !== "(" || tree.text(rparen) !== ")") unsupported(n);
        addAfter(lparen, tk.brk({ k: "open", block: true }, 0), tk.open());
        addBefore(rparen, tk.brk({ k: "close", mustBreak: true }, 0), tk.close);
        addBefore(firstLeaf(tree, element), tk.open());
        addAfter(lastLeaf(tree, element), tk.close);
        return typeTokens(element);
      }
      case "existential_type":
      case "opaque_type":
        // `visit(SomeOrAnyTypeSyntax)`.
        if (parts.length !== 2) unsupported(n);
        addAfter(parts[0] as number, tk.space);
        return typeTokens(parts[1] as number);
      case "protocol_composition_type":
        // `visit(CompositionTypeElementSyntax)`.
        for (const c of parts)
          if (tree.text(c) === "&") {
            addBefore(c, tk.brk({ k: "continue" }));
            addAfter(c, tk.space);
          } else typeTokens(c);
        return;
    }
    unsupported(n);
  }
  function isMemberType(n: number): boolean {
    const parts = children(n);
    return (
      kind(n) === "user_type" &&
      parts.some((c, i) => tree.text(c) === "." && !["Protocol", "Type"].includes(tree.text(parts[i + 1] as number)))
    );
  }

  /**
   * `visit(FunctionDeclSyntax)` / `visit(InitializerDeclSyntax)` with `arrangeFunctionLikeDecl`,
   * `arrangeParameterClause`, `visit(FunctionParameterSyntax)`, `visit(FunctionSignatureSyntax)`,
   * `visit(ReturnClauseSyntax)`, `arrangeEffectSpecifiers` and `visit(GenericWhereClauseSyntax)`, up to the body's
   * `{`. Returns that `{`.
   */
  function functionHeader(n: number): number {
    const parts = children(n);
    let i = 0;
    // The decl's group (`arrangeFunctionLikeDecl`) and the one keeping `<modifiers> func <name>(` together.
    addBefore(firstLeaf(tree, n), tk.open(), tk.open());
    if (kind(parts[0] as number) === "modifiers") {
      for (const m of children(parts[0] as number)) {
        // `arrangeAttributeList` is not ported.
        if (kind(m) === "attribute") unsupported(m);
        addAfter(lastLeaf(tree, m), tk.brk({ k: "continue" }));
      }
      i++;
    }
    const keyword = parts[i++] as number;
    const isInit = kind(n) === "init_declaration";
    if (tree.text(keyword) !== (isInit ? "init" : "func")) unsupported(keyword);
    if (!isInit) {
      addAfter(keyword, tk.brk({ k: "continue" }));
      if (kind(parts[i++] as number) !== "simple_identifier") unsupported(n);
    }
    let generic = false;
    if (kind(parts[i] as number) === "type_parameters") {
      // `visit(GenericParameterClauseSyntax)` and `visit(GenericParameterSyntax)`.
      generic = true;
      const list = children(parts[i++] as number);
      addAfter(list[0] as number, tk.brk({ k: "open", block: true }, 0), tk.open());
      addBefore(list[list.length - 1] as number, tk.brk({ k: "close", mustBreak: false }, 0), tk.close);
      for (const [j, c] of list.slice(1, -1).entries()) {
        if (tree.text(c) === ",") continue;
        const p = children(c);
        if (kind(c) !== "type_parameter" || kind(p[0] as number) !== "type_identifier") unsupported(c);
        addBefore(firstLeaf(tree, c), tk.open());
        if (p.length === 3 && tree.text(p[1] as number) === ":") {
          addAfter(p[1] as number, tk.brk({ k: "continue" }));
          typeTokens(p[2] as number);
        } else if (p.length !== 1) unsupported(c);
        const comma = list[j + 2] as number;
        if (tree.text(comma) === ",") addAfter(comma, tk.close, tk.brk({ k: "same" }));
        else addAfter(lastLeaf(tree, c), tk.close);
      }
    }
    const lparen = parts[i++] as number;
    if (tree.text(lparen) !== "(") unsupported(n);
    const rp = parts.findIndex((c, j) => j >= i && kind(c) === ")");
    if (rp < 0) unsupported(n);
    const params = parts.slice(i, rp);
    const rparen = parts[rp] as number;
    i = rp + 1;
    if (params.length > 0) {
      addAfter(lparen, tk.brk({ k: "open", block: true }, 0), tk.open());
      addBefore(rparen, tk.brk({ k: "close", mustBreak: true }, 0), tk.close);
    }
    addAfter(params.length > 0 || generic ? lparen : rparen, tk.close);
    for (let start = 0; start < params.length; ) {
      let end = start;
      while (end < params.length && tree.text(params[end] as number) !== ",") end++;
      const [param, eq, value, ...extra] = params.slice(start, end) as [number, number?, number?];
      const comma = params[end];
      start = end + 1;
      if (kind(param) !== "parameter" || extra.length > 0 || (eq !== undefined && (tree.text(eq) !== "=" || value === undefined)))
        unsupported(param);
      addBefore(firstLeaf(tree, param), tk.open());
      const p = children(param);
      let j = 0;
      if (kind(p[j] as number) !== "simple_identifier") unsupported(param);
      j++;
      if (kind(p[j] as number) === "simple_identifier") addBefore(p[j++] as number, tk.elective({ k: "continue" }));
      const colon = p[j++] as number;
      if (tree.text(colon) !== ":") unsupported(param);
      addAfter(colon, tk.brk({ k: "continue" }));
      let attributed: number | undefined;
      if (kind(p[j] as number) === "parameter_modifiers") {
        // `visit(AttributedTypeSyntax)` over `inout`.
        attributed = p[j++] as number;
        if (tree.text(attributed) !== "inout") unsupported(attributed);
      }
      const type = p[j++] as number;
      if (type === undefined) unsupported(param);
      if (attributed !== undefined) {
        addBefore(firstLeaf(tree, attributed), tk.open());
        addAfter(lastLeaf(tree, attributed), tk.elective({ k: "continue" }));
        addAfter(lastLeaf(tree, type), tk.close);
      }
      typeTokens(type);
      if (j < p.length && !(j === p.length - 1 && tree.text(p[j] as number) === "...")) unsupported(param);
      if (comma !== undefined) addAfter(comma, tk.close, tk.brk({ k: "same" }));
      else addAfter(lastLeaf(tree, value ?? param), tk.close);
      if (eq !== undefined && value !== undefined) {
        // `visit(InitializerClauseSyntax)`.
        addBefore(eq, tk.space);
        addAfter(eq, tk.brk({ k: "continue" }));
        expression(convert(value));
      }
    }
    // `arrangeEffectSpecifiers`.
    const effects: number[] = [];
    while (kind(parts[i] as number) === "async" || kind(parts[i] as number) === "throws") effects.push(parts[i++] as number);
    for (const e of effects) {
      if (tree.count(e) !== 0) unsupported(e);
      addBefore(e, tk.brk({ k: "continue" }));
    }
    if (effects.length === 2) {
      addBefore(effects[0] as number, tk.open());
      addAfter(effects[1] as number, tk.close);
    } else if (effects.length > 2) unsupported(n);
    if (tree.text(parts[i] as number) === "->") {
      const arrow = parts[i++] as number;
      const type = parts[i++] as number;
      addBefore(arrow, tk.brk({ k: "continue" }));
      addAfter(arrow, tk.space);
      if (isMemberType(type)) {
        addBefore(firstLeaf(tree, type), tk.open());
        addAfter(lastLeaf(tree, type), tk.close);
      }
      typeTokens(type);
    }
    let whereClose = false;
    if (kind(parts[i] as number) === "type_constraints") {
      whereClause(parts[i++] as number);
      whereClose = true;
    }
    const body = parts[i++] as number;
    if (body === undefined || kind(body) !== "function_body" || i !== parts.length) unsupported(n);
    const brace = tree.child(body, 0);
    if (tree.text(brace) !== "{") unsupported(body);
    addBefore(brace, tk.elective({ k: "reset" }));
    // The where clause's group and the decl's close after the body; the stream ends at `{`, so they close there.
    addAfter(brace, ...(whereClose ? [tk.close] : []), tk.close);
    return brace;
  }

  /**
   * A `where` clause before a body's `{`: the `same` break and group before it (`arrangeTypeDeclBlock`,
   * `arrangeFunctionLikeDecl`), `visit(GenericWhereClauseSyntax)` and each requirement's.
   */
  function whereClause(n: number): void {
    {
      const clause = children(n);
      const where = clause[0] as number;
      if (tree.text(where) !== "where" || clause.length < 2) unsupported(where);
      addBefore(where, tk.brk({ k: "same" }), tk.open());
      const requirements = clause.slice(1);
      const lastReq = lastLeaf(tree, requirements[requirements.length - 1] as number);
      addAfter(where, tk.brk({ k: "open", block: true }));
      addAfter(lastReq, tk.brk({ k: "close", mustBreak: false }, 0));
      addBefore(firstLeaf(tree, requirements[0] as number), tk.open());
      addAfter(lastReq, tk.close);
      for (const [j, c] of requirements.entries()) {
        if (tree.text(c) === ",") continue;
        // `visit(GenericRequirementSyntax)` and `visit(ConformanceRequirementSyntax)`.
        const req = children(c)[0] as number;
        if (kind(c) !== "type_constraint" || kind(req) !== "inheritance_constraint" || tree.count(req) !== 3) unsupported(c);
        const [name, colon, type] = children(req) as [number, number, number];
        if (kind(name) !== "identifier") unsupported(c);
        addBefore(firstLeaf(tree, c), tk.open());
        dotted(children(name), "simple_identifier");
        addAfter(colon, tk.brk({ k: "continue" }));
        typeTokens(type);
        const comma = requirements[j + 1];
        if (comma !== undefined && tree.text(comma) === ",") addAfter(comma, tk.close, tk.brk({ k: "same" }));
        else addAfter(lastLeaf(tree, c), tk.close);
      }
    }
  }

  /**
   * `visit(ProtocolDeclSyntax)` with `arrangeTypeDeclBlock` and `visit(InheritanceClauseSyntax)`, up to the body's
   * `{`, over a protocol with no attributes, modifiers or associated types. Returns that `{`.
   */
  function protocolHeader(n: number): number {
    const parts = children(n);
    const [keyword, name] = parts as [number, number];
    if (tree.text(keyword) !== "protocol" || kind(name) !== "type_identifier") unsupported(n);
    let i = 2;
    addBefore(keyword, tk.open(), tk.open());
    addAfter(keyword, tk.brk({ k: "continue" }));
    let keywordGroupEnd = name;
    if (tree.text(parts[i] as number) === ":") {
      keywordGroupEnd = parts[i++] as number;
      const inherited: number[] = [];
      while (kind(parts[i] as number) === "inheritance_specifier" || tree.text(parts[i] as number) === ",") inherited.push(parts[i++] as number);
      if (inherited.length !== 1) unsupported(n);
      const type = tree.child(inherited[0] as number, 0);
      addBefore(firstLeaf(tree, type), tk.open(), tk.brk({ k: "open", block: true }));
      addAfter(lastLeaf(tree, type), tk.brk({ k: "close", mustBreak: true }, 0), tk.close);
      typeTokens(type);
    }
    addAfter(keywordGroupEnd, tk.close);
    let whereClose = false;
    if (kind(parts[i] as number) === "type_constraints") {
      whereClause(parts[i++] as number);
      whereClose = true;
    }
    const body = parts[i++] as number;
    if (body === undefined || kind(body) !== "protocol_body" || i !== parts.length) unsupported(n);
    const brace = tree.child(body, 0);
    if (tree.text(brace) !== "{") unsupported(body);
    addBefore(brace, tk.brk({ k: "reset" }));
    addAfter(brace, ...(whereClose ? [tk.close] : []), tk.close);
    return brace;
  }

  /** `visit(VariableDeclSyntax)` with one binding, `visit(PatternBindingSyntax)` and `visit(InitializerClauseSyntax)`. */
  function binding(n: number): void {
    const parts = children(n);
    let i = 0;
    if (kind(parts[i] as number) === "modifiers") {
      for (const m of children(parts[i] as number)) if (tree.count(m) > 1 || kind(m) === "attribute") unsupported(m);
      i++;
    }
    if (kind(parts[i] as number) !== "value_binding_pattern") unsupported(n);
    i++;
    const pattern = parts[i++] as number;
    if (kind(pattern) !== "pattern") unsupported(pattern);
    const inner = children(pattern);
    const lparen = inner[0] as number;
    const rparen = inner[inner.length - 1] as number;
    if (inner.length === 1 && kind(lparen) === "simple_identifier") {
      // A plain name.
    } else if (tree.text(lparen) === "(" && tree.text(rparen) === ")") {
      // `visit(TuplePatternSyntax)` and `visit(TuplePatternElementSyntax)`, over names only.
      addAfter(lparen, tk.brk({ k: "open", block: true }, 0), tk.open());
      addBefore(rparen, tk.brk({ k: "close", mustBreak: true }, 0), tk.close);
      for (const c of inner.slice(1, -1))
        if (tree.text(c) === ",") addAfter(c, tk.brk({ k: "same" }));
        else if (kind(c) !== "pattern" || tree.count(c) !== 1 || kind(tree.child(c, 0)) !== "simple_identifier")
          unsupported(c);
    } else unsupported(pattern);
    let annotation: number | undefined;
    if (kind(parts[i] as number) === "type_annotation") annotation = parts[i++];
    const eq = parts[i++] as number;
    const valueNode = parts[i++] as number;
    if (eq === undefined || tree.text(eq) !== "=" || valueNode === undefined || i !== parts.length) unsupported(n);
    const value = convert(valueNode);
    // `stackedIndentationBehavior(rhs:)` stacks around a ternary's condition; not ported.
    if (innermostTry(value).k === "ternary") unsupported(valueNode);
    if (annotation !== undefined) {
      const [colon, type] = children(annotation) as [number, number];
      if (kind(type) !== "user_type") unsupported(type);
      for (const c of children(type)) if (kind(c) !== "type_identifier" && tree.text(c) !== ".") unsupported(type);
      addAfter(colon, tk.elective({ k: "open", block: false }));
      addBefore(firstLeaf(tree, type), tk.open());
      addAfter(lastLeaf(tree, type), tk.close);
    }
    // `stackedIndentationBehavior(rhs:)` is nil for every value `convert` accepts (no ternary, no parentheses).
    addAfter(eq, tk.brk({ k: "continue" }));
    if (isCompound(value)) {
      addBefore(value.first, tk.open());
      addAfter(value.last, tk.close);
    }
    if (annotation !== undefined) addAfter(value.last, tk.brk({ k: "close", mustBreak: true }, 0));
    addBefore(eq, tk.space);
    expression(value);
  }

  // `visit(_ token:)`: the before tokens, the text, then the after groups innermost (last added) first. Each gap
  // between two tokens on one line as written is what the tokens there print when no break fires; a plain space
  // stands where swift-format prints one without a break. A line break as written is a discretionary newline
  // (`extractLeadingTrivia`), which `appendNewlines` puts on the most recent break.
  const tokens: Tok[] = [];
  let lastBreak = -1;
  let canMerge = false;
  const append = (t: Tok) => {
    tokens.push(t);
    if (t.t === "break") {
      lastBreak = tokens.length - 1;
      canMerge = true;
    } else if (t.t !== "open" && t.t !== "ctxStart") canMerge = false;
  };
  /** `isBreakMoreRecentThanNonbreakingContent`. */
  const breakIsRecent = (ts: readonly Tok[]): boolean | undefined => {
    for (let j = ts.length - 1; j >= 0; j--) {
      const t = ts[j] as Tok;
      if (t.t === "break") return !t.ignoresDiscretionary;
      if (t.t === "space" || t.t === "syntax") return false;
    }
    return undefined;
  };
  const opensScope = (t: Tok) =>
    t.t === "open" || (t.t === "break" && (t.kind.k === "open" || t.kind.k === "continue" || t.kind.k === "same" || t.kind.k === "contextual"));
  let width = 0;
  /**
   * A block comment within a line, after the leaf before it: `afterTokensForTrailingComment` puts a space, the
   * comment and a size-0 `same` break right after that leaf, ahead of its after tokens. Any other comment is not
   * ported.
   */
  const trailingComment = (i: number): number | undefined => {
    const c = leaves[i + 1];
    if (c === undefined || !isComment(c)) return undefined;
    const t = tree.text(c);
    const after = leaves[i + 2];
    if (!t.startsWith("/*") || t.includes("\n") || gap(c) !== 1 || after === undefined || isComment(after) || gap(after) === undefined)
      unsupported(c);
    return c;
  };
  let skip: number | undefined;
  for (const [i, l] of leaves.entries()) {
    if (l === skip) continue;
    if (i === 0 && isComment(l)) unsupported(l);
    const own = before.get(l) ?? [];
    let want = i > 0 ? gap(l) : 0;
    if (want === undefined) {
      // A newline swift-format drops: the line is joined as the tokens there print.
      if (!(breakIsRecent(own) ?? breakIsRecent(tokens) ?? true)) want = NaN;
    }
    if (want === undefined) {
      // `splitScopingBeforeTokens`: the tokens opening a scope go before the newline, the rest after it.
      const split = own.findIndex((t) => !opensScope(t));
      const opening = split < 0 ? own : own.slice(0, split);
      opening.forEach(append);
      const merged = tokens[lastBreak];
      if (canMerge && merged?.t === "break") tokens[lastBreak] = { ...merged, newline: true };
      else {
        const k = merged?.t === "break" ? merged.kind.k : "same";
        const compatible: BreakKind = k === "continue" ? { k: "continue" } : k === "contextual" ? { k: "contextual" } : { k: "same" };
        append({ t: "break", kind: compatible, size: 0, newline: true });
      }
      (split < 0 ? [] : own.slice(split)).forEach(append);
    } else {
      for (const t of own) if (t.t === "break" || t.t === "space") width += t.size;
      if (Number.isNaN(want)) {
        // Where the layout prints nothing, swift-format may print a space this does not port.
        if (width === 0) throw new Error(`a line break swift-format joins without a break (line breaking): before \`${tree.text(l)}\``);
      } else if (i > 0) {
        if (width === 0 && want === 1) append(tk.space);
        else if (width !== want)
          throw new Error(`a gap of ${want} where the layout prints ${width} (line breaking): before \`${tree.text(l)}\``);
      }
      own.forEach(append);
    }
    append(tk.syntax(tree.text(l)));
    // A header's `{` ends the tokens: the body after it is kept as written, the groups open there closed.
    if (l === lastToken && header) {
      for (const group of after.get(l) ?? []) for (const t of group) if (t.t === "close") append(t);
      break;
    }
    width = 0;
    skip = trailingComment(i);
    if (skip !== undefined) append(tk.space), append(tk.comment(tree.text(skip))), append(tk.brk({ k: "same" }, 0));
    for (const group of [...(after.get(l) ?? [])].reverse())
      for (const t of group) {
        append(t);
        if (t.t === "break" || t.t === "space") width += t.size;
      }
  }
  return { tokens, last: lastToken };
}
