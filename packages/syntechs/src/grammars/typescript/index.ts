import { type Language, loadLanguage } from "../../core/index.js";
import { grammar, keywordLex, lex, tables } from "./bundle.js";
import { createScanner } from "./scanner.js";

export const language: Language = loadLanguage(
  tables,
  lex,
  keywordLex,
  createScanner,
);
export { grammar };
