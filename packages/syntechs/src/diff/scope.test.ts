import { expect, test } from "vitest";
import { parseTree } from "../core/index.js";
import { language, scope } from "../grammars/typescript/index.js";
import { alphaIds, resolveLocals } from "./scope.js";
import { Side } from "./side.js";

const intern = new Map<string, number>();

/** The canonical id of the first node of `kind` in `src`. */
const idOf = (src: string, kind: string): number => {
  const tree = parseTree(language, src);
  const side = Side.of(tree);
  const ids = alphaIds(side, resolveLocals(tree, scope), intern);
  const i = side.nodes.findIndex((n) => tree.kindName(n) === kind);
  if (i < 0) throw new Error(`no ${kind} in ${src}`);
  return ids[i] as number;
};
const same = (a: string, b: string, kind = "program") =>
  idOf(a, kind) === idOf(b, kind);

// Without use-based names a function whose locals were all renamed reads as rewritten, never as moved (#77).
test("renamed parameters, let/const, loop and catch variables compare equal", () => {
  expect(
    same(
      "function f(items) { let s = 0; for (const i of items) s += i; try { g(); } catch (e) { h(e); } return s; }",
      "function f(lines) { let sum = 0; for (const l of lines) sum += l; try { g(); } catch (x) { h(x); } return sum; }",
    ),
  ).toBe(true);
});

// Normalizing a free name would call a moved `g(a)` that became `h(a)` unchanged.
test("a renamed free name, import or declaration's own name is still a change", () => {
  expect(
    same("function f(a) { return g(a); }", "function f(a) { return h(a); }"),
  ).toBe(false);
  expect(
    same('import { g } from "m"; g();', 'import { h } from "m"; h();'),
  ).toBe(false);
  expect(
    same("function f(a) { return a; }", "function k(a) { return a; }"),
  ).toBe(false);
  expect(same("const a = 1; use(a);", "const b = 1; use(b);")).toBe(false);
});

// The doc's counterexample: the first `x` is an outer variable, so `x ↦ y` is not a rename of a local.
test("a shadowed name resolves to its own binder", () => {
  const a = "function k() { f(x); { const x = 1; g(x); } }";
  const b = "function k() { f(y); { const y = 1; g(y); } }";
  expect(same(a, b)).toBe(false);
  expect(same(a, b, "statement_block")).toBe(false);
  // The inner block alone binds what it renames.
  expect(
    idOf(a, "lexical_declaration") === idOf(b, "lexical_declaration"),
  ).toBe(false);
  expect(
    same(
      "function k(x) { { const x = 1; g(x); } return x; }",
      "function k(x) { { const y = 1; g(y); } return x; }",
    ),
  ).toBe(true);
  // Renaming the parameter alone would capture the inner `x`'s reader if resolution ignored shadowing.
  expect(
    same(
      "function k(x) { { const x = 1; g(x); } return x; }",
      "function k(y) { { const x = 1; g(y); } return y; }",
    ),
  ).toBe(false);
});

// `var` hoisting, `with` and `eval` can bind a name the rules cannot place; renaming there could change meaning.
test("a function holding var, with or eval keeps its names", () => {
  expect(
    same(
      "function f(a) { var t = a; return t; }",
      "function f(b) { var t = b; return t; }",
    ),
  ).toBe(false);
  expect(
    same(
      "function f(a) { with (o) { g(a); } }",
      "function f(b) { with (o) { g(b); } }",
    ),
  ).toBe(false);
  expect(
    same(
      'function f(a) { eval("a"); return a; }',
      'function f(b) { eval("a"); return b; }',
    ),
  ).toBe(false);
  // A sibling function without them is unaffected.
  expect(
    same(
      "function f(a) { return a; } function g() { var t; }",
      "function f(b) { return b; } function g() { var t; }",
    ),
  ).toBe(true);
});

// `{ a }` is also a key: renaming the local would change the object's shape.
test("a local spelled as a shorthand property keeps its name", () => {
  expect(same("const f = (a) => ({ a });", "const f = (b) => ({ b });")).toBe(
    false,
  );
  expect(same("const f = ({ a }) => a;", "const f = ({ b }) => b;")).toBe(
    false,
  );
});

// With positional (de Bruijn) names an inserted binder would renumber every later one, so no statement after it
// would equal its old self.
test("an inserted binder leaves the rest of the block equal", () => {
  const a = "function f(xs) { for (const i of xs) log(i, xs); }";
  const b = "function f(xs) { const z = 0; for (const j of xs) log(j, xs); }";
  expect(same(a, b)).toBe(false);
  expect(same(a, b, "for_in_statement")).toBe(true);
});
