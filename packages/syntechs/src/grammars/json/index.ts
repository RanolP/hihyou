import { type Language, loadLanguage } from "../../core/index.js";
import { grammar, keywordLex, lex, tables } from "./bundle.js";

export const language: Language = loadLanguage(
  tables,
  lex,
  keywordLex,
  undefined,
);
export { grammar };
