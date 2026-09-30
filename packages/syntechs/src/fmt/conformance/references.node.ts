// oxfmt (native, through its JS API): the expected output of the matrix's prettier-family rows, and a baseline the
// benchmark times. It takes prettier's option names here.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { format as oxfmtFormat } from "oxfmt";

const require = createRequire(import.meta.url);
export const versionOf = (pkg: string): string =>
  (
    JSON.parse(
      readFileSync(require.resolve(`${pkg}/package.json`), "utf8"),
    ) as { version: string }
  ).version;

export interface Reference {
  /** Name and version, as the reports print it. */
  name: string;
  /**
   * Formats `text` as the file `file` with prettier-named `options`, prettier's defaults for the ones left out;
   * the language is `options.parser` when given, else the file name's. Throws when the tool rejects the input
   * or an option.
   */
  format(
    file: string,
    text: string,
    options: Record<string, unknown>,
  ): Promise<string>;
}

/**
 * A name that makes oxfmt use prettier's `parser`: oxfmt takes no parser option and reads the syntax off the file
 * name alone, so a `.json` fixture prettier formats as jsonc, or a jsx/ `.js` fixture it parses as typescript,
 * needs renaming. oxfmt reaches its json-stringify printer only for package.json, the file prettier also formats
 * that way by default.
 */
function oxfmtFile(file: string, parser: unknown): string {
  switch (parser) {
    case "jsonc":
      return file.replace(/\.[^./]*$/, ".jsonc");
    case "json-stringify":
      return file.replace(/[^/]*$/, "package.json");
    case "typescript":
    case "babel-ts":
    case "oxc-ts":
      return /\.[cm]?tsx?$/.test(file)
        ? file
        : file.replace(/\.[^./]*$/, ".tsx");
    default:
      return file;
  }
}

/**
 * Prettier 3's default for every option oxfmt shares with it, and off for each of oxfmt's own extensions, so oxfmt
 * runs as prettier does and an option a fixture leaves out means prettier's default rather than oxfmt's. Of these,
 * oxfmt 0.70.0's own defaults differ only in printWidth (100) and sortPackageJson (on); the rest pin today's
 * agreement against a later oxfmt changing its default.
 */
const prettierDefaults = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  endOfLine: "lf",
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  quoteProps: "as-needed",
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  objectWrap: "preserve",
  arrowParens: "always",
  singleAttributePerLine: false,
  experimentalOperatorPosition: "end",
  embeddedLanguageFormatting: "auto",
  proseWrap: "preserve",
  htmlWhitespaceSensitivity: "css",
  vueIndentScriptAndStyle: false,
  // Prettier always ends a file with one newline.
  insertFinalNewline: true,
  // oxfmt's extensions, none of which prettier has without a plugin.
  sortPackageJson: false,
  sortImports: false,
  sortTailwindcss: false,
  jsdoc: false,
} as const;

export const oxfmt: Reference = {
  name: `oxfmt ${versionOf("oxfmt")}`,
  async format(file, text, { parser, jsxBracketSameLine, ...options }) {
    // oxfmt reads prettier's option names. It rejects experimentalTernaries, and silently ignores the other ones it
    // lacks: prettier's deprecated jsxBracketSameLine, which prettier still honours beside bracketSameLine, is one.
    const r = await oxfmtFormat(oxfmtFile(file, parser), text, {
      ...prettierDefaults,
      ...options,
      ...(jsxBracketSameLine === true ? { bracketSameLine: true } : {}),
    });
    if (r.errors.length > 0)
      throw new Error(r.errors.map((e) => e.message).join("; "));
    return r.code;
  },
};
