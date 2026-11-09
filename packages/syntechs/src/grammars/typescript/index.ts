import { type Language, loadLanguage } from "../../core/index.js";
import { grammar, keywordLex, lex, tables } from "./bundle.js";
import { regroupPrefixes } from "./prefix.js";
import { createScanner } from "./scanner.js";

export const language: Language = regroupPrefixes(
  loadLanguage(tables, lex, keywordLex, createScanner),
);
export { grammar };
export { scope } from "./scope.js";
