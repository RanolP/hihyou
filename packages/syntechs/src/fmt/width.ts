import emojiRegex from "emoji-regex";
import { eastAsianWidth } from "get-east-asian-width";
import { isNarrowEmojiCharacter } from "narrow-emojis";

/**
 * Terminal columns `text` occupies, measured as prettier 3.9.9's getStringWidth measures them, with the
 * versions of its width tables it bundles: wide and fullwidth characters and most emoji take 2.
 */
export function textWidth(text: string): number {
  // Printable ASCII, nearly every token, is one column a character; a loop answers that before a regex would.
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c > 0x7f) return nonAsciiWidth(text);
  }
  return text.length;
}

function nonAsciiWidth(text: string): number {
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
