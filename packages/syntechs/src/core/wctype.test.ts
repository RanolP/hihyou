import { expect, test } from "vitest";
import { iswalnum, iswalpha, iswdigit, iswspace } from "./wctype.js";

// Catches a scanner classifying a code point differently from the musl build web-tree-sitter ran, which silently
// changes trees (e.g. `a\ninͣ b` parsed as `in` plus an identifier instead of one identifier). The digests were
// taken while these functions matched musl's exports on every code point up to U+10FFFF.
test("each wctype function the scanners call keeps musl's answer on every code point", () => {
  const digest = (fn: (c: number) => boolean) => {
    let count = 0;
    let hash = 0x811c9dc5;
    for (let c = 0; c <= 0x10ffff; c++)
      if (fn(c)) {
        count++;
        hash = Math.imul(hash ^ c, 16777619) >>> 0;
      }
    return `${count} ${hash.toString(16)}`;
  };
  expect({
    iswalpha: digest(iswalpha),
    iswalnum: digest(iswalnum),
    iswdigit: digest(iswdigit),
    iswspace: digest(iswspace),
  }).toEqual({
    iswalpha: "132549 cffe2952",
    iswalnum: "132559 7c04f647",
    iswdigit: "10 f9808ff2",
    iswspace: "21 d3248435",
  });
  // Where musl and JS's \p{Alphabetic} disagree, named so a failure reads as the likely cause.
  expect([iswalpha(0x363), iswalpha(0x660)]).toEqual([false, true]);
});
