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

// The formatter DSL types `$.field` from these: a lost `required` makes a required field an Option, and a lost
// `multiple` makes a list a single node.
test("a bundle's fields and children carry whether they are required and repeated, and what they hold", () => {
  expect(json.fieldTypes.pair.key).toEqual({
    required: true,
    multiple: false,
    types: ["string"],
  });
  expect(json.childTypes.object).toEqual({
    required: false,
    multiple: true,
    types: ["pair"],
  });
  expect(typescript.fieldTypes.if_statement.alternative).toMatchObject({
    required: false,
    multiple: false,
  });
});
