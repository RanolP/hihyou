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
   * Formats `text` as the file `file` (its name picks the language) with prettier-named `options`; throws when
   * the tool rejects the input or an option.
   */
  format(
    file: string,
    text: string,
    options: Record<string, unknown>,
  ): Promise<string>;
}

export const oxfmt: Reference = {
  name: `oxfmt ${versionOf("oxfmt")}`,
  async format(file, text, options) {
    // oxfmt reads prettier's option names and rejects the ones it lacks. It sorts package.json by default, which
    // prettier never does.
    const r = await oxfmtFormat(file, text, {
      sortPackageJson: false,
      ...options,
    });
    if (r.errors.length > 0)
      throw new Error(r.errors.map((e) => e.message).join("; "));
    return r.code;
  },
};
