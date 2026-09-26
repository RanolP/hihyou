import type { Tree } from "syntechs/core";
import type { LanguageId } from "./languages.js";

export type { Tree } from "syntechs/core";

export interface SyntaxParser {
  parse(lang: LanguageId, text: string): Promise<Tree>;
}
