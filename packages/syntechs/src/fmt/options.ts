import type { Layout } from "./printer.js";

/** `auto` takes the first line ending of the input, as prettier and ruff both do, and `lf` when it has none. */
export type EndOfLine = "lf" | "crlf" | "cr" | "auto";

/** What the core applies itself; a language derives it from its own options (`LanguageSpec.settings`). */
export interface Settings extends Layout {
  endOfLine: EndOfLine;
}

/**
 * The options every prettier-family language reads, by prettier's names, so a resolved `.prettierrc` passes
 * through unchanged. A language adds the ones only it reads (`singleQuote`, `semi`, `trailingComma`, ...).
 */
export interface PrettierOptions {
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
  endOfLine: EndOfLine;
  bracketSpacing: boolean;
  /** `preserve`: an object the author broke after its `{` stays broken. */
  objectWrap: "preserve" | "collapse";
}

export const prettierDefaults: PrettierOptions = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  endOfLine: "lf",
  bracketSpacing: true,
  objectWrap: "preserve",
};

export const prettierSettings = (o: PrettierOptions): Settings => ({
  lineWidth: o.printWidth,
  indentWidth: o.tabWidth,
  useTabs: o.useTabs,
  endOfLine: o.endOfLine,
});

/**
 * The layout options of ruff's `[format]` section, by ruff's names. Python adds the ones only it reads
 * (`quote-style`, `skip-magic-trailing-comma`, ...).
 */
export interface RuffOptions {
  "line-length": number;
  "indent-width": number;
  "indent-style": "space" | "tab";
  "line-ending": "auto" | "lf" | "cr-lf" | "native";
}

export const ruffDefaults: RuffOptions = {
  "line-length": 88,
  "indent-width": 4,
  "indent-style": "space",
  "line-ending": "auto",
};

const ruffEndOfLine: Record<RuffOptions["line-ending"], EndOfLine> = {
  auto: "auto",
  lf: "lf",
  "cr-lf": "crlf",
  // A browser has no native line ending; the page shows `\n`.
  native: "lf",
};

export const ruffSettings = (o: RuffOptions): Settings => ({
  lineWidth: o["line-length"],
  indentWidth: o["indent-width"],
  useTabs: o["indent-style"] === "tab",
  ruff: true,
  endOfLine: ruffEndOfLine[o["line-ending"]],
});
