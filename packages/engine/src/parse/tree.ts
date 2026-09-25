import type { SyntaxTree } from "syntechs/core";
import type { LanguageId } from "./languages.js";

export type { SyntaxNode, SyntaxTree } from "syntechs/core";

export interface SyntaxParser {
  parse(lang: LanguageId, text: string): Promise<SyntaxTree>;
}
