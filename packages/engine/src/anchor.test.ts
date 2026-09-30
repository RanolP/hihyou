import { parseTree } from "syntechs/core";
import { language } from "syntechs/grammars/typescript";
import { expect, test } from "vitest";
import { nodeAt, stepsOf } from "./anchor.js";

// A stored thread names its nodes by AstSteps; if stepsOf and nodeAt disagree, every thread reopens on the wrong code.
test("AstSteps round trip: nodeAt(stepsOf(n)) is n for every named node", () => {
  const tree = parseTree(
    language,
    `class A {\n  f(x: number) {\n    return x + 1;\n  }\n}\nconst g = () => [1, "two", { three: 3 }];\n`,
  );
  let named = 0;
  for (let ord = 0; ord < tree.nodeCount; ord++) {
    const n = tree.at(ord);
    if (!tree.named(n)) continue;
    named++;
    expect(nodeAt(tree, stepsOf(tree, n))).toBe(n);
  }
  expect(named).toBeGreaterThan(20);
});
