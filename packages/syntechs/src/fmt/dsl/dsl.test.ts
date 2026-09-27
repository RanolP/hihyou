import { expect, it } from "vitest";
import {
  defineFormat,
  grpBrace,
  grpParen,
  option,
  sepBy,
  space,
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
