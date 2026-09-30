import { expect, test } from "vitest";
import { kotlinInputs } from "../../core/corpus.node.js";
import { parseTree } from "../../core/index.js";
import { language } from "./index.js";

// A regression here is a scanner port or table bug that turns valid Kotlin into ERROR or MISSING nodes, which a
// formatter would then have to leave unformatted or mangle.
test("every vendored Kotlin input parses with no ERROR or MISSING node", () => {
  const inputs = kotlinInputs();
  expect(inputs.length).toBeGreaterThan(90);
  const broken: string[] = [];
  for (const { name, text } of inputs) {
    const tree = parseTree(language, text);
    const stack = [tree.root];
    for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
      if (tree.kindName(n) === "ERROR" || tree.missing(n)) {
        broken.push(
          `${name}: ${tree.missing(n) ? "MISSING " : ""}${tree.kindName(n)} at ${tree.start(n)} ${JSON.stringify(text.slice(tree.start(n), tree.start(n) + 40))}`,
        );
        break;
      }
      for (let i = 0; i < tree.count(n); i++) stack.push(tree.child(n, i));
    }
  }
  expect(broken).toEqual([]);
});

// A regression here reads a `when` entry that starts with `in` as `previousBody in range`, merging two entries.
test("an `in` condition on its own line starts a new `when` entry", () => {
  const tree = parseTree(language, "fun f() {\n  when (x) {\n    1 -> a\n    in 1..3 -> b\n  }\n}\n");
  const kinds: string[] = [];
  const stack = [tree.root];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    kinds.push(tree.kindName(n));
    for (let i = 0; i < tree.count(n); i++) stack.push(tree.child(n, i));
  }
  expect(kinds).toContain("range_test");
  expect(kinds).not.toContain("check_expression");
});

// A regression here calls the whole `a ?: C.g` with `<T>(r)`, since the call and the elvis tied, instead of `C.g`.
test("type arguments call the postfix operand, not a binary expression", () => {
  const tree = parseTree(language, "val x = a ?: C.g<T>(r)\n");
  const stack = [tree.root];
  let elvis = -1;
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    if (tree.kindName(n) === "elvis_expression") elvis = n;
    for (let i = 0; i < tree.count(n); i++) stack.push(tree.child(n, i));
  }
  expect(tree.kindName(tree.child(elvis, tree.count(elvis) - 1))).toBe("call_expression");
});

// A regression here cuts `return emit(x)` into a bare `return` and a separate `emit(x)`, which changes what it means.
test("a returned expression starting with `e` stays the return's value", () => {
  const tree = parseTree(language, "fun f() {\n  if (c) return emit(x)\n  return@f else1\n}\n");
  const jumps: number[] = [];
  const stack = [tree.root];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    if (tree.kindName(n) === "jump_expression") jumps.push(tree.count(n));
    for (let i = 0; i < tree.count(n); i++) stack.push(tree.child(n, i));
  }
  expect(jumps.sort()).toEqual([2, 3]);
});

// A regression here reads a multi-dollar string (`$$"""`) as ERROR, which leaves its whole file unformatted, or
// takes a `$x` in one for a template when its templates need `$$x`.
test("a multi-dollar string's templates take as many `$`s as its prefix has", () => {
  const text = 'val s = $$"""$x $$y $$${z} $${w}"""\n';
  const tree = parseTree(language, text);
  const kinds: string[] = [];
  const stack = [tree.root];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    kinds.push(`${tree.kindName(n)} ${text.slice(tree.start(n), tree.end(n))}`);
    for (let i = 0; i < tree.count(n); i++) stack.push(tree.child(n, i));
  }
  expect(kinds.filter((k) => k.startsWith("ERROR"))).toEqual([]);
  expect(kinds.filter((k) => k.startsWith("interpolated_")).sort()).toEqual([
    "interpolated_expression w",
    "interpolated_expression z",
    "interpolated_identifier y",
  ]);
});
