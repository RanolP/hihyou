import { type Language, loadLanguage } from "../../core/index.js";
// Both dialects include the same common/scanner.h.
import { createScanner } from "../typescript/scanner.js";
import { grammar, keywordLex, lex, tables } from "./bundle.js";

export const language: Language = loadLanguage(
  tables,
  lex,
  keywordLex,
  createScanner,
);
export { grammar };
// TSX scopes names as TypeScript does; JSX tag names are already not references.
export { scope } from "../typescript/scope.js";
