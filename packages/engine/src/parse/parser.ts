import { type Language, parseTree } from "syntechs/core";
import type { LanguageId } from "./languages.js";
import type { SyntaxParser } from "./tree.js";

// Loaded on first use: a grammar bundle is hundreds of KiB, and most diffs touch one or two languages.
const grammars: Record<LanguageId, () => Promise<{ language: Language }>> = {
  typescript: () => import("syntechs/grammars/typescript"),
  tsx: () => import("syntechs/grammars/tsx"),
  javascript: () => import("syntechs/grammars/javascript"),
  json: () => import("syntechs/grammars/json"),
  python: () => import("syntechs/grammars/python"),
  css: () => import("syntechs/grammars/css"),
};

export function createSyntaxParser(): SyntaxParser {
  return {
    async parse(lang, text) {
      return parseTree((await grammars[lang]()).language, text);
    },
  };
}
