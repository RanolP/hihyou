// How the CSS and HTML formatters print and compare front matter. It reads YAML through the YAML formatter, so it
// stays apart from front-matter.ts, which the CSS grammar loads: generating yaml/fmt.gen.ts loads that grammar.
import type { PrettierOptions } from "../../fmt/options.js";
import { meaning } from "../../fmt/check.js";
import { formatYaml, yaml } from "../yaml/fmt.js";
import { type FrontMatter, parseFrontMatter } from "./front-matter.js";

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
