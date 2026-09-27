// JSX (customs: print/jsx.ts).
import { custom } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const jsx = {
  jsx_closing_element: () => custom("jsxClosing"),
  jsx_attribute: () => custom("jsxAttribute"),
  jsx_expression: () => custom("jsxExpression"),
  jsx_opening_element: () => custom("jsxOpening"),
  jsx_self_closing_element: () => custom("jsxSelfClosing"),
  jsx_element: () => custom("jsxElement"),
} satisfies JsStructure;
