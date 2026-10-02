import { expect, test } from "vitest";
import { language } from "../grammars/javascript/index.js";
import { kindError, kindIndex } from "./kinds.node.js";

// Without the named/anonymous check, `"identifier" @x` or `(if) @x` would compile into a pattern that never matches.
test("a kind the grammar has only under the other flavour is rejected", () => {
  const kinds = kindIndex(language);
  expect(kindError(kinds, "identifier", false, "javascript")).toBeUndefined();
  expect(kindError(kinds, "if", true, "javascript")).toBeUndefined();
  expect(kindError(kinds, "identifier", true, "javascript")).toMatch(/only as a named node/);
  expect(kindError(kinds, "if", false, "javascript")).toMatch(/only as an anonymous node/);
});
