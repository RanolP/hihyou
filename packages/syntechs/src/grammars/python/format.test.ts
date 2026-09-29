import { expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { format } from "../../fmt/format.js";
import { python } from "./fmt.js";
import { language } from "./index.js";

const fmt = (text: string) => {
  const r = format(parseTree(language, text), python, {});
  return r.ok ? r.text : `ERR ${r.detail}`;
};

// A `\` line continuation is a named extra in no field, so a spec's `$.children` counted it as the first child and
// handed it to a `.via` custom, which found no expression there and failed the format.
it("reads past a line continuation to a statement's children in no field", () => {
  expect(fmt("def f():\n    return \\\n        x\n")).toBe("def f():\n    return x\n");
  expect(fmt("assert \\\n  x, y\n")).toBe("assert x, y\n");
  expect(fmt("del \\\n  a\n")).toBe("del a\n");
});

// A leaf a spec rule prints (keyword_argument's `$.name`) has no rule of its own, so the core wrote it straight to
// the stream, ahead of the `dslPart` recording it belongs to: `f(a=1)` came out as `af(=1)`.
it("records a leaf a spec rule prints in place", () => {
  expect(fmt("f(a=1)\n")).toBe("f(a=1)\n");
});

// A decorated definition's statement node is the definition, whose parent is the decorated_definition, so a body
// opening with one printed that definition as its whole block and dropped the statements after it.
it("prints a whole block that opens with a decorated definition", () => {
  expect(fmt("if a:\n    @d\n    def f(): pass\n    x = 1\n")).toBe("if a:\n\n    @d\n    def f():\n        pass\n\n    x = 1\n");
});

// `check` read every pattern parenthesis as meaning, so it flagged the ones ruff adds around a long case pattern or a
// bare tuple subject; the ones it now lets go must stay those, never a nested tuple pattern's or a one-tuple's.
it("lets ruff add or drop only the parentheses that change no pattern's meaning", () => {
  const cases = (a: string, b: string) =>
    check(python, `match x:\n    case ${a}:\n        pass\n`, `match x:\n    case ${b}:\n        pass\n`);
  expect(cases("a, b,", "(a, b)")).toBeUndefined();
  expect(cases("A | B", "(A | B)")).toBeUndefined();
  expect(check(python, "match a, b,:\n    case _:\n        pass\n", "match (a, b):\n    case _:\n        pass\n")).toBeUndefined();
  expect(cases("[(a, b)]", "[a, b]")).toBeDefined();
  expect(cases("(a,)", "a")).toBeDefined();
});

// tree-sitter reads `with (a, *b):` as two items and `with (a,):` as one tuple item, the reverse of CPython: the
// formatter dropped the tuple's parentheses, making `*b` an item, and kept `(a,)` though ruff prints `with a:`.
it("reads a with's parentheses as CPython does: a tuple item, or parenthesized items", () => {
  expect(fmt("with (a, *b):\n    pass\n")).toBe("with (a, *b):\n    pass\n");
  expect(fmt("with (x := a, y := b):\n    pass\n")).toBe("with (x := a, y := b):\n    pass\n");
  expect(fmt("with (a,):\n    pass\n")).toBe("with (\n    a,\n):\n    pass\n");
  expect(check(python, "with (a,):\n    pass\n", "with a:\n    pass\n")).toBeUndefined();
  expect(check(python, "with (*a,):\n    pass\n", "with a:\n    pass\n")).toBeDefined();
});
