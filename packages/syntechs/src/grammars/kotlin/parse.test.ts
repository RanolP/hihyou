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
