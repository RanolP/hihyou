import { expect, test } from "vitest";
import { grammar as json } from "../grammars/json/index.js";
import { grammar as typescript } from "../grammars/typescript/index.js";

// Catches the list reading losing a separator, a bracket or the trailing flag when `commaSep` sits inside an
// optional, which is how most grammars write their bracketed lists.
test("a bundle's lists carry the separator, the brackets and the trailing separator", () => {
  expect(json.lists.object).toEqual([
    { element: ["pair"], separator: ",", open: "{", close: "}" },
  ]);
  expect(typescript.lists.formal_parameters).toEqual([
    {
      element: ["_formal_parameter"],
      separator: ",",
      trailing: true,
      open: "(",
      close: ")",
    },
  ]);
  expect(typescript.lists.statement_block).toEqual([
    { element: ["statement"], open: "{", close: "}" },
  ]);
});
