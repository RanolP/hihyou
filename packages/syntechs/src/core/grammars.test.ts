import { parseTree } from "syntechs/core";
import { language as json } from "syntechs/grammars/json";
import { expect, test } from "vitest";

// Catches the `./grammars/*` subpath export breaking, which leaves consumers no way to obtain a Language.
test("a grammar imported by its package subpath parses", () => {
  expect(json.name).toBe("json");
  expect(parseTree(json, '{"a": 1}').nodeCount).toBeGreaterThan(0);
});
