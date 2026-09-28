import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { format } from "../../fmt/format.js";
import { kotlin } from "./fmt.js";
import { language } from "./index.js";

const kdocWords = (text: string) =>
  (/\/\*\*[\s\S]*?\*\//.exec(text)?.[0] ?? "")
    .slice(3, -2)
    .split("\n")
    .map((l) => l.trimStart().replace(/^\*/, ""))
    .join(" ")
    .split(/\s+/)
    .filter((w) => w !== "");

// A regression here is KDoc reflow dropping, duplicating or reordering a word of the comment, which the viewer
// would show as the file's doc content silently changed.
test("KDoc reflow changes only the whitespace between the comment's words", () => {
  const input = `class K {
      /**
        *   Words   with  extra    spaces.   And a very long sentence that goes on and on and on and on past the limit.
        *
        * - item one that is also very long and keeps going for a while so that it must wrap onto the next line
        *   continued - with @inline 1. markers
        * \`\`\`kotlin
        * val   x =   1
        * \`\`\`
        * @param a first parameter with a long description that goes on and on and on and on to wrap past width
        *    continued
        */
    fun d(a: Int) {}
}
`;
  const out = format(parseTree(language, input), kotlin, {});
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.text).not.toBe(input);
  expect(kdocWords(out.text)).toEqual(kdocWords(input));
});
