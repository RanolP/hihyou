import emojiRegex from "emoji-regex";
import { eastAsianWidth } from "get-east-asian-width";
import { isNarrowEmojiCharacter } from "narrow-emojis";

const nonAscii = /[^\x20-\x7F]/;

/**
 * Terminal columns `text` occupies, measured as prettier 3.9.9's getStringWidth measures them, with the
 * versions of its width tables it bundles: wide and fullwidth characters and most emoji take 2.
 */
export function textWidth(text: string): number {
  if (!nonAscii.test(text)) return text.length;
  let width = 0;
  const rest = text.replace(emojiRegex(), (emoji) => {
    width += isNarrowEmojiCharacter(emoji) ? 1 : 2;
    return "";
  });
  for (const char of rest) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    if (cp >= 0x300 && cp <= 0x36f) continue;
    if (cp >= 0xfe00 && cp <= 0xfe0f) continue;
    width += eastAsianWidth(cp);
  }
  return width;
}
