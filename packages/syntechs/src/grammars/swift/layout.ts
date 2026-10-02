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
import { type Tok, tk } from "./pretty.js";

/** Literals swift-format prints whole: a string's interpolations are its raw text (`ExpressionSegmentSyntax`). */
const WHOLE = new Set(["line_string_literal"]);
const LITERALS = new Set(["integer_literal", "real_literal", "boolean_literal", "line_string_literal", "nil"]);
/** The tree-sitter kinds of an operator sequence, which `binary` flattens and refolds. */
const BINARY = new Set([
  "additive_expression",
  "multiplicative_expression",
  "comparison_expression",
  "equality_expression",
  "conjunction_expression",
  "disjunction_expression",
  "nil_coalescing_expression",
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
  k: "ref" | "literal" | "keyPath" | "member" | "call" | "prefix" | "infix" | "try" | "array";
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
  gap: (leaf: number) => number,
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
  const innermost = (e: Expr): Expr => (e.k === "prefix" || e.k === "try" ? innermost(e.kids[0] as Expr) : e);

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
      const [target, suffix] = children(n) as [number, number];
      if (tree.count(n) !== 2 || kind(suffix) !== "navigation_suffix" || tree.count(suffix) !== 2) unsupported(n);
      const [dot, name] = children(suffix) as [number, number];
      if (kind(name) !== "simple_identifier") unsupported(suffix);
      // `\.name`: tree-sitter reads the backslash alone as the key path, then a member access on it.
      if (kind(target) === "key_path_expression") {
        if (tree.count(target) !== 1) unsupported(target);
        return { k: "keyPath", first: firstLeaf(tree, target), last: name, kids: [] };
      }
      const base = convert(target);
      const called = innermost(base);
      // `f(x).y`: swift-format then closes the call's arguments on their own line; not ported.
      if (called.k === "call" && called.values?.length && tree.text(called.last) === ")") unsupported(n);
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
      if (tree.count(n) !== 2 || kind(suffix) !== "call_suffix" || tree.count(suffix) !== 1) unsupported(n);
      const args = tree.child(suffix, 0);
      if (kind(args) !== "value_arguments") unsupported(args);
      const list = children(args);
      const values: Expr[] = [];
      for (const c of list) {
        if (kind(c) !== "value_argument") continue;
        const parts = children(c);
        values.push(convert(parts[parts.length - 1] as number));
      }
      const rparen = list[list.length - 1] as number;
      return postfix(convert(callee), (base) =>
        make({ k: "call", first: base.first, last: rparen, kids: [base], args, values }),
      );
    }
    if (k === "try_expression") {
      const [op, target] = children(n) as [number, number];
      if (tree.count(n) !== 2 || tree.count(op) !== 1) unsupported(n);
      const operand = convert(target);
      const keyword = firstLeaf(tree, op);
      return make({ k: "try", first: keyword, last: operand.last, kids: [operand], op: keyword });
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
      case "infix":
        return infix(e);
      case "try":
        return tryExpr(e);
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
    const list = children(e.args as number);
    const lparen = list[0] as number;
    const rparen = list[list.length - 1] as number;
    if ((e.values as Expr[]).length > 0) {
      const breakBeforeRight = e.parent?.k === "member" && e.parent.kids[0] === e;
      addAfter(lparen, tk.brk({ k: "open", block: true }, 0), tk.open());
      addBefore(rparen, tk.brk({ k: "close", mustBreak: breakBeforeRight }, 0), tk.close);
    }
    let v = 0;
    for (const [i, c] of list.entries()) {
      if (kind(c) !== "value_argument") continue;
      const parts = children(c);
      const value = (e.values as Expr[])[v++] as Expr;
      // A lone array, dictionary or closure argument is laid out compactly, which this does not port.
      const last = kind(parts[parts.length - 1] as number);
      if (last === "array_literal" || last === "dictionary_literal" || last === "lambda_literal") unsupported(c);
      addBefore(firstLeaf(tree, c), tk.open());
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
      } else addAfter(value.last, tk.close);
    }
    // The children after the call's own tokens, as the visitor walks them.
    expression(callee);
    for (const value of e.values as Expr[]) expression(value);
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

  /** `visit(TryExprSyntax)` with `connectingTokenForKeywordModifiedExpr`. */
  function tryExpr(e: Expr): void {
    const operand = e.kids[0] as Expr;
    addBefore(operand.first, tk.brk({ k: "continue" }));
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

  const isCompound = (e: Expr): boolean => e.k === "infix" || (e.k === "try" && isCompound(e.kids[0] as Expr));

  /**
   * `visit(ConditionElementSyntax)` (with `visit(OptionalBindingConditionSyntax)`) over each condition in `parts`,
   * after `before` runs for each condition's first and last token (the `if`/`guard` visitor, which runs first).
   */
  function conditions(parts: number[], around: (first: number, last: number, index: number) => void): number {
    let start = 0;
    let count = 0;
    let lastLeafOfAll = NaN;
    for (let i = 0; i <= parts.length; i++) {
      const comma = parts[i];
      if (comma !== undefined && tree.text(comma) !== ",") continue;
      const seg = parts.slice(start, i);
      start = i + 1;
      if (seg.length === 0) unsupported(parts[0] as number);
      const head = seg[0] as number;
      let value: Expr;
      let binding: { spec: number; eq: number } | undefined;
      if (kind(head) === "value_binding_pattern") {
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
  if (k === "property_declaration") binding(stmt);
  else if (k === "call_expression" || k === "try_expression") expression(convert(stmt));
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
    addBefore(brace, tk.brk({ k: "reset" }));
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
  } else unsupported(stmt);

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
    if (annotation !== undefined) {
      const [colon, type] = children(annotation) as [number, number];
      if (kind(type) !== "user_type") unsupported(type);
      for (const c of children(type)) if (kind(c) !== "type_identifier" && tree.text(c) !== ".") unsupported(type);
      addAfter(colon, tk.brk({ k: "open", block: false }));
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

  // `visit(_ token:)`: the before tokens, the text, then the after groups innermost (last added) first. The
  // statement is on one line as written, so each gap between its tokens is what the tokens there print when no
  // break fires; a plain space stands where swift-format prints one without a break.
  const tokens: Tok[] = [];
  let width = 0;
  for (const [i, l] of leaves.entries()) {
    const own = before.get(l) ?? [];
    for (const t of own) if (t.t === "break" || t.t === "space") width += t.size;
    if (i > 0) {
      const want = gap(l);
      if (width === 0 && want === 1) tokens.push(tk.space);
      else if (width !== want)
        throw new Error(`a gap of ${want} where the layout prints ${width} (line breaking): before \`${tree.text(l)}\``);
    }
    tokens.push(...own, tk.syntax(tree.text(l)));
    // A header's `{` ends the tokens: the body after it is kept as written.
    if (l === lastToken && header) break;
    width = 0;
    for (const group of [...(after.get(l) ?? [])].reverse())
      for (const t of group) {
        tokens.push(t);
        if (t.t === "break" || t.t === "space") width += t.size;
      }
  }
  return { tokens, last: lastToken };
}
