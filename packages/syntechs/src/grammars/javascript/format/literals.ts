// Literals, strings, templates and identifiers (customs: print/literals.ts).
import { custom } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const literals = {
  number: () => custom("number"),
  regex: () => custom("regex"),
} satisfies JsStructure;
