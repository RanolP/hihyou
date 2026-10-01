import { jsLanguage } from "../javascript/fmt.js";
import { grammar as tsxGrammar, language as tsxParser } from "../tsx/index.js";
import { grammar, language as parser } from "./index.js";

/** TypeScript as prettier's `typescript` parser prints it. */
export const typescript = jsLanguage(grammar, parser, { parser: "typescript", jsx: false });

/** TSX, the same rules over the grammar that also reads JSX. */
export const tsx = jsLanguage(tsxGrammar, tsxParser, { parser: "typescript" });
