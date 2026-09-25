import { eastAsianWidth } from "get-east-asian-width";

// biome-ignore lint/complexity/useRegexLiterals: the `v` flag is ES2024 syntax and the package targets ES2023.
const emoji = new RegExp("\\p{RGI_Emoji}", "gv");
const nonAscii = /[^\x20-\x7F]/;

/** Terminal columns `text` occupies, as prettier measures them: wide and fullwidth characters and emoji take 2. */
export function textWidth(text: string): number {
  if (!nonAscii.test(text)) return text.length;
  let width = 0;
  for (const char of text.replace(emoji, () => {
    width += 2;
    return "";
  })) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    if (cp >= 0x300 && cp <= 0x36f) continue;
    if (cp >= 0xfe00 && cp <= 0xfe0f) continue;
    width += eastAsianWidth(cp);
  }
  return width;
}
