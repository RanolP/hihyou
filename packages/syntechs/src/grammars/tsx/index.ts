import { type Language, loadLanguage } from "../../core/index.js";
import { regroupPrefixes } from "../typescript/prefix.js";
// Both dialects include the same common/scanner.h.
import { createScanner } from "../typescript/scanner.js";
import { grammar, keywordLex, lex, tables } from "./bundle.js";

export const language: Language = regroupPrefixes(
  loadLanguage(tables, lex, keywordLex, createScanner),
);
export { grammar };
// TSX scopes names as TypeScript does; JSX tag names are already not references.
export { scope } from "../typescript/scope.js";
