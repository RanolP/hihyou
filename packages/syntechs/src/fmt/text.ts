// Prettier's source-text probes (src/utilities, 3.9.9), which decide comment placement and blank lines. Each
// looks only at the few characters around one offset.

const isNewline = (c: string) =>
  c === "\n" || c === "\r" || c === " " || c === " ";

function skipSpaces(text: string, i: number, backwards = false): number {
  while (i >= 0 && i < text.length) {
    const c = text.charAt(i);
    if (c !== " " && c !== "\t") return i;
    i += backwards ? -1 : 1;
  }
  return i;
}

function skipNewline(text: string, i: number, backwards = false): number {
  const c = text.charAt(i);
  if (backwards) {
    if (c === "\n" && text.charAt(i - 1) === "\r") return i - 2;
    return isNewline(c) ? i - 1 : i;
  }
  if (c === "\r" && text.charAt(i + 1) === "\n") return i + 2;
  return isNewline(c) ? i + 1 : i;
}

/** Whether only spaces and tabs stand between `i` and a line break (looking left of `i` when `backwards`). */
export function hasNewline(
  text: string,
  i: number,
  backwards = false,
): boolean {
  const at = skipSpaces(text, backwards ? i - 1 : i, backwards);
  return skipNewline(text, at, backwards) !== at;
}

export function hasNewlineInRange(text: string, from: number, to: number) {
  for (let i = from; i < to; i++) if (text.charAt(i) === "\n") return true;
  return false;
}

/** Whether the line after the one holding `i` is blank, skipping separators and comments that end that line. */
export function isNextLineEmpty(text: string, i: number): boolean {
  for (let old = -1; i !== old; ) {
    old = i;
    while (i < text.length && ",; \t".includes(text.charAt(i))) i++;
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end !== -1) i = end + 2;
    }
    i = skipSpaces(text, i);
  }
  if (text.startsWith("//", i))
    while (i < text.length && !isNewline(text.charAt(i))) i++;
  const next = skipNewline(text, i);
  return next !== i && hasNewline(text, next);
}

/** Whether the line before the one holding `i` is blank. */
export function isPreviousLineEmpty(text: string, i: number): boolean {
  let at = skipSpaces(text, i - 1, true);
  at = skipNewline(text, at, true);
  at = skipSpaces(text, at, true);
  return skipNewline(text, at, true) !== at;
}
