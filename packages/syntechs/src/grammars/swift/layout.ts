// The token streams swift-format 6.3.0's TokenStreamCreator builds, for the statements syntechs can lay out:
// a `let`/`var` with one binding and a call, member access, `&&`/`||` or literal value, and a call standing as
// a statement. Each rule names the TokenStreamCreator visitor it ports. Any other node in the statement throws,
// so the caller refuses the file instead of printing a layout swift-format would not.

import { NO_NODE } from "../../core/arena.js";
import type { FormatTree } from "../../fmt/tree.js";
import { type Tok, tk } from "./pretty.js";

const ATOMS = new Set(["simple_identifier", "integer_literal", "real_literal", "boolean_literal", "line_string_literal"]);
/** Literals swift-format prints whole: a string's interpolations are its raw text (`ExpressionSegmentSyntax`). */
const WHOLE = new Set(["line_string_literal"]);

/** The first token of `n` as swift-format reads it: a string is one. */
function firstLeaf(tree: FormatTree, n: number): number {
  while (tree.count(n) > 0 && !WHOLE.has(tree.kindName(n))) n = tree.child(n, 0);
  return n;
}

function lastLeaf(tree: FormatTree, n: number): number {
  while (tree.count(n) > 0 && !WHOLE.has(tree.kindName(n))) n = tree.child(n, tree.count(n) - 1);
  return n;
}

/** The tokens swift-format prints `stmt` (one line as written) with, or throws naming what is not covered. */
export function statementTokens(tree: FormatTree, stmt: number, gap: (leaf: number) => number): Tok[] {
  const before = new Map<number, Tok[]>();
  const after = new Map<number, Tok[][]>();
  const addBefore = (n: number, ...toks: Tok[]) => {
    const l = firstLeaf(tree, n);
    before.set(l, [...(before.get(l) ?? []), ...toks]);
  };
  const addAfter = (n: number, ...toks: Tok[]) => {
    const l = lastLeaf(tree, n);
    after.set(l, [...(after.get(l) ?? []), toks]);
  };
  const kind = (n: number) => tree.kindName(n);
  const children = (n: number) => Array.from({ length: tree.count(n) }, (_, i) => tree.child(n, i));
  const unsupported = (n: number): never => {
    throw new Error(`a \`${kind(n)}\` in a line past the width (line breaking): \`${tree.text(n).split("\n")[0]}\``);
  };
  const preVisited = new Set<number>();

  /** `insertContextualBreaks`: the breaks before each `.` of a member chain. */
  function contextual(expr: number, top: boolean): { compound: boolean; member: boolean } {
    preVisited.add(expr);
    if (kind(expr) === "navigation_expression") {
      const [target, suffix] = children(expr) as [number, number];
      const parent = tree.parent(expr);
      const called = kind(parent) === "call_expression" && tree.child(parent, 0) === expr;
      if (!called) addBefore(suffix, tk.brk({ k: "contextual" }, 0));
      const { compound } = contextual(target, false);
      if (top) {
        addBefore(expr, tk.ctxStart);
        addAfter(expr, tk.ctxEnd);
      }
      return { compound, member: true };
    }
    if (kind(expr) === "call_expression") {
      const callee = tree.child(expr, 0);
      const { member } = contextual(callee, false);
      if (kind(callee) === "navigation_expression") {
        const suffix = tree.child(callee, 1);
        addBefore(suffix, tk.brk({ k: "contextual" }, 0));
        addBefore(suffix, tk.ctxStart);
        addAfter(expr, tk.ctxEnd);
        if (top) {
          addBefore(expr, tk.ctxStart);
          addAfter(expr, tk.ctxEnd);
        }
      } else {
        addBefore(expr, tk.ctxStart);
        addAfter(expr, tk.ctxEnd);
      }
      return { compound: true, member };
    }
    addBefore(expr, tk.ctxStart);
    addAfter(expr, tk.ctxEnd);
    return { compound: kind(expr) !== "simple_identifier", member: false };
  }

  const isCompound = (n: number) => kind(n) === "conjunction_expression" || kind(n) === "disjunction_expression";

  function expression(n: number): void {
    const k = kind(n);
    if (ATOMS.has(k)) {
      if (k === "line_string_literal" && tree.text(n).includes("\n")) unsupported(n);
      return;
    }
    if (k === "navigation_expression") {
      if (!preVisited.has(n)) contextual(n, true);
      const [target, suffix] = children(n) as [number, number];
      if (suffix === undefined || kind(suffix) !== "navigation_suffix" || tree.count(suffix) !== 2) unsupported(n);
      if (kind(tree.child(suffix, 1)) !== "simple_identifier") unsupported(suffix);
      // tree-sitter binds a prefix operator tighter than `.`, which Swift does not (`!a.b` is `!(a.b)`).
      if (kind(target) === "prefix_expression") unsupported(target);
      expression(target);
      return;
    }
    if (k === "call_expression") return call(n);
    if (k === "prefix_expression") {
      const [op, target] = children(n) as [number, number];
      if (target === undefined || kind(op) !== "bang") unsupported(n);
      expression(target);
      return;
    }
    if (isCompound(n)) return infix(n);
    unsupported(n);
  }

  /** `visit(FunctionCallExprSyntax)` with `arrangeFunctionCallArgumentList`. */
  function call(n: number): void {
    if (!preVisited.has(n)) contextual(n, true);
    const [callee, suffix] = children(n) as [number, number];
    if (tree.count(n) !== 2 || kind(suffix) !== "call_suffix" || tree.count(suffix) !== 1) unsupported(n);
    const args = tree.child(suffix, 0);
    if (kind(args) !== "value_arguments") unsupported(args);
    if (kind(callee) === "navigation_expression" && kind(tree.child(callee, 0)) === "simple_identifier") {
      addBefore(callee, tk.open());
      addAfter(callee, tk.close);
    }
    const list = children(args);
    const values = list.filter((c) => kind(c) === "value_argument");
    const lparen = list[0] as number;
    const rparen = list[list.length - 1] as number;
    if (values.length > 0) {
      const parent = tree.parent(n);
      const breakBeforeRight = kind(parent) === "navigation_expression" && tree.child(parent, 0) === n;
      addAfter(lparen, tk.brk({ k: "open", block: true }, 0), tk.open());
      addBefore(rparen, tk.brk({ k: "close", mustBreak: breakBeforeRight }, 0), tk.close);
    }
    const valuesOf: number[] = [];
    for (const [i, c] of list.entries()) {
      if (kind(c) !== "value_argument") continue;
      const parts = children(c);
      const value = parts[parts.length - 1] as number;
      // A lone array, dictionary or closure argument is laid out compactly, which this does not port.
      if (kind(value) === "array_literal" || kind(value) === "dictionary_literal" || kind(value) === "lambda_literal")
        unsupported(value);
      addBefore(c, tk.open());
      if (parts.length === 3) {
        const colon = parts[1] as number;
        if (tree.text(colon) !== ":" || kind(parts[0] as number) !== "value_argument_label") unsupported(c);
        const opener = tree.text(firstLeaf(tree, value));
        addAfter(colon, opener === "(" || opener === "[" || opener === "{" ? tk.space : tk.brk({ k: "continue" }));
      } else if (parts.length !== 1) unsupported(c);
      const next = list[i + 1] as number;
      if (tree.text(next) === ",") addAfter(next, tk.close, tk.brk({ k: "same" }));
      else addAfter(c, tk.close);
      valuesOf.push(value);
    }
    // The children after the call's own tokens, as the visitor walks them.
    expression(callee);
    for (const value of valuesOf) expression(value);
  }

  /** `visit(InfixOperatorExprSyntax)` for `&&` and `||`, which `stackedIndentationBehavior` stacks. */
  function infix(n: number): void {
    const lhs = tree.child(n, 0);
    const op = tree.child(n, 1);
    const rhs = tree.child(n, 2);
    if (tree.count(n) !== 3) unsupported(n);
    // tree-sitter nests `a || b || c` and `a && b || c` to the right, where Swift folds them to the left.
    if (kind(rhs) === "disjunction_expression" || (kind(rhs) === "conjunction_expression" && kind(n) === kind(rhs)))
      unsupported(rhs);
    if (kind(rhs) === "navigation_expression" || kind(rhs) === "call_expression") {
      addBefore(rhs, tk.open());
      addAfter(rhs, tk.close);
    }
    // `outermostEnclosingNode`: an operand that ends just before a `,` or `)` unindents at that delimiter.
    const after = nextLeafIn(rhs);
    if (after !== NO_NODE) unsupported(n);
    addBefore(op, tk.brk({ k: "open", block: false }), tk.open());
    addAfter(rhs, tk.brk({ k: "reset" }, 0), tk.brk({ k: "close", mustBreak: false }, 0), tk.close);
    addAfter(op, tk.space);
    expression(lhs);
    expression(rhs);
  }

  /** The leaf after `n` within the statement, or `NO_NODE` when `n` ends it. */
  function nextLeafIn(n: number): number {
    const l = lastLeaf(tree, n);
    const i = leaves.indexOf(l);
    return i + 1 < leaves.length ? (leaves[i + 1] as number) : NO_NODE;
  }

  const leaves: number[] = [];
  const collect = (n: number) => {
    if (tree.count(n) === 0 || WHOLE.has(kind(n))) leaves.push(n);
    else for (const c of children(n)) collect(c);
  };
  collect(stmt);

  if (kind(stmt) === "property_declaration") binding(stmt);
  else if (kind(stmt) === "call_expression") call(stmt);
  else unsupported(stmt);

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
    if (kind(pattern) !== "pattern" || tree.count(pattern) !== 1 || kind(tree.child(pattern, 0)) !== "simple_identifier")
      unsupported(pattern);
    let annotation: number | undefined;
    if (kind(parts[i] as number) === "type_annotation") annotation = parts[i++];
    const eq = parts[i++] as number;
    const value = parts[i++] as number;
    if (eq === undefined || tree.text(eq) !== "=" || value === undefined || i !== parts.length) unsupported(n);
    if (annotation !== undefined) {
      const [colon, type] = children(annotation) as [number, number];
      if (kind(type) !== "user_type") unsupported(type);
      for (const c of children(type)) if (kind(c) !== "type_identifier" && tree.text(c) !== ".") unsupported(type);
      addAfter(colon, tk.brk({ k: "open", block: false }));
      addBefore(type, tk.open());
      addAfter(type, tk.close);
    }
    // `stackedIndentationBehavior(rhs:)` is nil for every value `expression` accepts.
    addAfter(eq, tk.brk({ k: "continue" }));
    if (isCompound(value)) {
      addBefore(value, tk.open());
      addAfter(value, tk.close);
    }
    if (annotation !== undefined) addAfter(value, tk.brk({ k: "close", mustBreak: true }, 0));
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
    width = 0;
    for (const group of (after.get(l) ?? []).reverse())
      for (const t of group) {
        tokens.push(t);
        if (t.t === "break" || t.t === "space") width += t.size;
      }
  }
  return tokens;
}
