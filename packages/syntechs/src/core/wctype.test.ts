import { expect, test } from "vitest";
import { iswalnum, iswalpha, iswdigit, iswspace } from "./wctype.js";
import { loadMuslWctype, MAX_CODE_POINT } from "./wctype.node.js";

// Catches a scanner classifying a code point differently from the musl build web-tree-sitter runs, which
// silently changes trees (e.g. `a\ninͣ b` parsed as `in` plus an identifier instead of one identifier).
test("each wctype function the scanners call matches musl on every code point", () => {
  const musl = loadMuslWctype();
  const ours = { iswalpha, iswalnum, iswdigit, iswspace };
  const diverging: string[] = [];
  for (const [name, fn] of Object.entries(ours)) {
    const reference = musl[name as keyof typeof ours];
    for (let c = 0; c <= MAX_CODE_POINT; c++) {
      if (fn(c) !== (reference(c) !== 0))
        diverging.push(`${name}(U+${c.toString(16).toUpperCase()})`);
      if (diverging.length > 20) break;
    }
  }
  expect(diverging).toEqual([]);
});
