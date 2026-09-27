// JSX (customs: print/jsx.ts).
import { custom } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const jsx = {
  jsx_closing_element: () => custom("jsxClosing"),
  jsx_attribute: () => custom("jsxAttribute"),
  jsx_expression: () => custom("jsxExpression"),
} satisfies JsStructure;
