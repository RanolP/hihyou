// Definitions: functions, classes, decorators, parameters, and type parameters.
import { space, tok } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const stmtDef = {
  decorated_definition: ($) => [$.children.at(0).andThen((d) => d.via("def.decorators")), $.definition],
  decorator: ($) => ["@", $.children.via("def.decorator")],
  function_definition: ($) => [
    tok("async").via("def.async"),
    "def",
    space,
    $.name,
    $.type_parameters.andThen((tp) => tp.via("def.typeParams")),
    $.parameters.via("def.signature"),
    ":",
    $.body.via("def.body"),
  ],
  class_definition: ($) => [
    "class",
    space,
    $.name,
    $.type_parameters.andThen((tp) => tp.via("def.typeParams")),
    $.superclasses.andThen((a) => a.via("def.classArgs")),
    ":",
    $.body.via("def.body"),
  ],
  typed_parameter: ($) => [$.children, ":", $.type.via("def.annotation")],
  default_parameter: ($) => [$.name, "=", $.value.via("def.default")],
  typed_default_parameter: ($) => [
    $.name,
    ":",
    $.type.via("def.annotation"),
    space,
    "=",
    $.value.via("def.default"),
  ],
  list_splat_pattern: ($) => ["*", $.children],
  dictionary_splat_pattern: ($) => ["**", $.children],
} satisfies Structure;
