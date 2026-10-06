import type { ScopeRules } from "../../diff/scope.js";
import { scope as javascript } from "../javascript/scope.js";

// A parameter with one of these declares a class field of its name too.
const parameterProperty = [
  "accessibility_modifier",
  "override_modifier",
  "readonly",
];

/** Lexical scoping of TypeScript: JavaScript's, with typed parameters and type-level names inert. */
export const scope: ScopeRules = {
  ...javascript,
  inert: [...javascript.inert, "type_identifier", "predefined_type"],
  exports: [...javascript.exports, "ambient_declaration"],
  binders: [
    ...javascript.binders.filter((r) => r.holder !== "formal_parameters"),
    {
      holder: "required_parameter",
      field: "pattern",
      scope: 2,
      opaqueWith: parameterProperty,
    },
    {
      holder: "optional_parameter",
      field: "pattern",
      scope: 2,
      opaqueWith: parameterProperty,
    },
    {
      holder: "abstract_class_declaration",
      field: "name",
      scope: "block",
      opaque: true,
    },
    { holder: "enum_declaration", field: "name", scope: "block", opaque: true },
    { holder: "internal_module", field: "name", scope: "block", opaque: true },
    {
      holder: "function_signature",
      field: "name",
      scope: "block",
      opaque: true,
    },
  ],
  // `import a = N.b` inside a namespace binds a name the rules do not place.
  uncertain: [...javascript.uncertain, { kind: "import_alias" }],
};
