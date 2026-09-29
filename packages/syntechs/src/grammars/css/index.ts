import { type Language, loadLanguage } from "../../core/index.js";
import { grammar, keywordLex, lex, tables } from "./bundle.js";
import { parseFrontMatter } from "./front-matter.js";
import { createScanner } from "./scanner.js";

export const language: Language = {
  ...loadLanguage(tables, lex, keywordLex, createScanner),
  frontMatter: (text) => parseFrontMatter(text)?.raw.length ?? 0,
};
export { grammar };
