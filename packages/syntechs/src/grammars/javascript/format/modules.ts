// Imports and exports (customs: print/modules.ts).
import { custom, inOrder, space } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const modules = {
  import_statement: () => custom("module.statement"),
  export_statement: () => custom("module.statement"),
  import_clause: () => custom("module.clause"),
  import_specifier: () => inOrder(space),
  export_specifier: () => inOrder(space),
  namespace_import: () => inOrder(space),
  namespace_export: () => inOrder(space),
  import_attribute: () => custom("module.attribute"),
  import_require_clause: ($) => [$.children, space, "=", space, "require", "(", $.source, ")"],
} satisfies JsStructure;
