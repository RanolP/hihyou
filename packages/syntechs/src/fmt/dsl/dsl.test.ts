import { expect, it } from "vitest";
import {
  defineFormat,
  grpBrace,
  grpParen,
  option,
  sepBy,
  space,
  tok,
} from "./dsl.js";

// Written out rather than imported: this project reads the bundles without allowJs, so their types are `any`
// here. The shapes are node-types.json's, as the bundle's `fieldTypes` and `childTypes` carry them.
const slot = <R extends boolean, M extends boolean>(required: R, multiple: M) =>
  ({ required, multiple, types: [] as string[] }) as const;
const grammar = {
  kinds: ["document", "object", "pair", "if_statement", "else_clause", "block"],
  tokens: [",", ":", "{", "}", "if", "else"],
  fields: {},
  comments: [],
  fieldTypes: {
    pair: { key: slot(true, false), value: slot(true, false) },
    if_statement: {
      condition: slot(true, false),
      consequence: slot(true, false),
      alternative: slot(false, false),
    },
    else_clause: { body: slot(true, false) },
  },
  childTypes: { object: slot(false, true), block: slot(false, true) },
} as const;
interface Options {
  bracketSpacing: boolean;
  objectWrap: "preserve" | "collapse";
}
const format = defineFormat<typeof grammar, Options>();

// A spec naming what its grammar or options lack would print nothing there, or crash at generate time; the
// typecheck rejects it instead. Each `@ts-expect-error` fails `tsc -b` once its line stops being an error.
it("a typo'd kind, field, token, separator or option fails to typecheck, so a spec never silently drops a slot", () => {
  const specs = () => [
    format({
      structure: {
        // @ts-expect-error: `pairs` is not a kind
        pairs: () => [],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `pair` has no field `val`
        pair: ($) => [$.key, ":", space, $.val],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `;` is not a token
        pair: ($) => [$.key, ";", space, $.value],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `;` is not a token, printed through a rule or not
        pair: ($) => [$.key, ":", space, $.value, tok(";").via("semi")],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: the separator `;` is not a token
        object: ($) => grpBrace(sepBy(";", $.children)),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `bracketSpaceing` is not an option
        object: ($) => grpBrace(sepBy(",", $.children), { pad: option("bracketSpaceing") }),
      },
    }),
    format({
      structure: {
        // @ts-expect-error: `objectWrap` is never "always"
        object: ($) => grpBrace(sepBy(",", $.children, { trailing: option("objectWrap").is("always") })),
      },
    }),
    format({
      structure: {
        // A required field is a node, an optional one an Option printed through `andThen`, a list only through a
        // list idiom: this spec is well typed.
        if_statement: ($) => [
          "if",
          grpParen($.condition),
          space,
          $.consequence,
          $.alternative.andThen((a) => [space, a]),
        ],
        object: ($) =>
          grpBrace(sepBy(",", $.children), { pad: option("bracketSpacing") }),
      },
      wrapping: { object: { keepExpanded: option("objectWrap").is("preserve") } },
    }),
    format({
      structure: {
        // @ts-expect-error: an Option is not a node
        if_statement: ($) => ["if", $.condition, $.alternative],
      },
    }),
    format({
      structure: {
        // @ts-expect-error: a list is not a node
        block: ($) => ["{", $.children, "}"],
      },
    }),
  ];
  expect(specs).toBeTypeOf("function");
});

// An `.at` the IR loses prints the first child wherever the spec names a later one.
it("`.at` reaches the IR, with a `.via` after it", () => {
  const ir = format({
    structure: {
      object: ($) => $.children.at(1).andThen((c) => [space, c.via("second")]),
    },
  });
  expect(ir.structure["object"]).toEqual({
    t: "opt",
    ref: { t: "ref", name: "children", at: 1 },
    then: { t: "seq", parts: [expect.anything(), { t: "ref", name: "children", at: 1, via: "second" }] },
  });
});

// A `.via` the IR loses prints the child by its own rule, silently skipping the custom its parent named.
it("`.via` reaches the IR on a required field and inside `andThen`", () => {
  const ir = format({
    structure: {
      if_statement: ($) => [
        $.condition.via("cond"),
        $.alternative.andThen((a) => [space, a.via("alt")]),
      ],
    },
  });
  expect(ir.structure["if_statement"]).toEqual({
    t: "seq",
    parts: [
      { t: "ref", name: "condition", via: "cond" },
      {
        t: "opt",
        ref: { t: "ref", name: "alternative" },
        then: {
          t: "seq",
          parts: [expect.anything(), { t: "ref", name: "alternative", via: "alt" }],
        },
      },
    ],
  });
});

// A `tok(...).via` the IR loses prints the source token as written, silently skipping the rule that inserts or drops it.
it("`tok(text).via(name)` reaches the IR as a token printed through its rule", () => {
  const ir = format({ structure: { pair: ($) => [$.key, ":", $.value, tok(",").via("comma")] } });
  expect(ir.structure["pair"]).toEqual({
    t: "seq",
    parts: [expect.anything(), expect.anything(), expect.anything(), { t: "tok", text: ",", via: "comma" }],
  });
});
