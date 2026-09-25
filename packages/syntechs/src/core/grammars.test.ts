import { parse } from "syntechs/core";
import { language as json } from "syntechs/grammars/json";
import { expect, test } from "vitest";

// Catches the `./grammars/*` subpath export breaking, which leaves consumers no way to obtain a Language.
test("a grammar imported by its package subpath parses", () => {
  expect(json.name).toBe("json");
  expect(parse(json, '{"a": 1}').nodes.length).toBeGreaterThan(0);
});
