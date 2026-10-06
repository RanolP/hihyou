import { parseTree } from "syntechs/core";
import { language } from "syntechs/grammars/typescript";
import { expect, test } from "vitest";
import { nodeAt, nodesOnLines, stepsOf } from "./anchor.js";
import { plainVersion } from "./file.js";

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

// A GitHub thread on a line inside a function reopened on the whole function (or the file), not the statement it was on.
test("nodesOnLines finds the statement on a thread's line, and the enclosing node for a line holding only a brace", () => {
  const text = `function f() {\n  const a = 1;\n  return a;\n}\n`;
  const tree = parseTree(language, text);
  const v = plainVersion(text, tree);
  const kind = (steps: number[]) =>
    tree.kindName(nodeAt(tree, steps) as number);
  expect(nodesOnLines(tree, v, { start: 2, end: 2 }).map(kind)).toEqual([
    "lexical_declaration",
  ]);
  expect(nodesOnLines(tree, v, { start: 2, end: 3 }).map(kind)).toEqual([
    "lexical_declaration",
    "return_statement",
  ]);
  expect(nodesOnLines(tree, v, { start: 4, end: 4 }).map(kind)).toEqual([
    "statement_block",
  ]);
});
