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
