import type { PrettierOptions } from "../../fmt/options.js";
import { meaning } from "../../fmt/check.js";
import { formatYaml, yaml } from "../yaml/fmt.js";

/** A block that opens the file in another language, as prettier 3.9.9 reads one (main/front-matter/parse.js). */
export interface FrontMatter {
  /** `---` or `+++`, and what closes it: the same, or `...` after YAML's `---`. */
  startDelimiter: string;
  endDelimiter: string;
  /** What follows the opening delimiter on its line, trimmed; null when nothing does. */
  explicitLanguage: string | null;
  /** The explicit language, else `yaml` for `---` and `toml` for `+++`. */
  language: string;
  /** The lines between the delimiters. */
  value: string;
  /** The whole block, from the opening delimiter to the end of the closing one. */
  raw: string;
}

/** The front matter `text` opens with, or undefined: prettier's `parseFrontMatter`, its quirks included. */
export function parseFrontMatter(text: string): FrontMatter | undefined {
  const startDelimiter = text.slice(0, 3);
  if (startDelimiter !== "---" && startDelimiter !== "+++") return undefined;
  const firstLineEnd = text.indexOf("\n", 3);
  if (firstLineEnd === -1) return undefined;
  const explicitLanguage = text.slice(3, firstLineEnd).trim();
  const language =
    explicitLanguage || (startDelimiter === "+++" ? "toml" : "yaml");
  let end = text.indexOf(`\n${startDelimiter}`, firstLineEnd);
  if (end === -1 && startDelimiter === "---" && language === "yaml")
    end = text.indexOf("\n...", firstLineEnd);
  if (end === -1) return undefined;
  // Prettier then tests the character after the closing delimiter with `/\s?/`, which anything passes.
  const raw = text.slice(0, end + 4);
  return {
    startDelimiter,
    endDelimiter: raw.slice(-3),
    explicitLanguage: explicitLanguage || null,
    language,
    value: text.slice(firstLineEnd + 1, end),
    raw,
  };
}

/**
 * The front matter as oxfmt prints it, one string per line. With embedded formatting on, a blank one prints as its
 * delimiters alone and YAML's value prints trimmed through the YAML formatter between them; anything else, and
 * YAML that does not parse, prints as written (prettier has no TOML parser to embed).
 */
export function frontMatterLines(fm: FrontMatter, embed: boolean, options: Partial<PrettierOptions> = {}): string[] {
  const raw = fm.raw.split(/\r?\n/);
  if (!embed) return raw;
  const value = fm.value.replace(/\r\n?/g, "\n").trim();
  const formatted = value === "" ? "" : fm.language === "yaml" ? formatYaml(value, options) : undefined;
  if (formatted === undefined) return raw;
  return [
    fm.startDelimiter + (fm.explicitLanguage ?? ""),
    ...(formatted === "" ? [] : formatted.split("\n")),
    fm.endDelimiter,
  ];
}

/**
 * Front matter `text` as `check` compares it: a YAML one by what its YAML says, which the YAML formatter keeps
 * through any layout; any other by its non-blank lines, trimmed.
 */
export function frontMatterMeaning(text: string): string {
  const fm = parseFrontMatter(text.replace(/\r\n?/g, "\n"));
  if (fm?.language === "yaml")
    return [fm.startDelimiter + (fm.explicitLanguage ?? ""), meaning(yaml, fm.value.trim()), fm.endDelimiter].join("\n");
  return text
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("\n");
}
