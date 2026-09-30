// The other formatter the matrix and the benchmark measure beside syntechs, as context: oxfmt (native, through
// its JS API). It takes prettier's option names here; the conformance matrix scores it against prettier's expected
// output exactly as it scores syntechs.

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

export const oxfmt: Reference = {
  name: `oxfmt ${versionOf("oxfmt")}`,
  async format(file, text, { parser, jsxBracketSameLine, ...options }) {
    // oxfmt reads prettier's option names and rejects the ones it lacks. It defaults printWidth to 100 where
    // prettier says 80, and sorts package.json by default, which prettier never does. It silently ignores
    // prettier's deprecated jsxBracketSameLine, which prettier still honours beside bracketSameLine.
    const r = await oxfmtFormat(oxfmtFile(file, parser), text, {
      printWidth: 80,
      sortPackageJson: false,
      ...options,
      ...(jsxBracketSameLine === true ? { bracketSameLine: true } : {}),
    });
    if (r.errors.length > 0)
      throw new Error(r.errors.map((e) => e.message).join("; "));
    return r.code;
  },
};
