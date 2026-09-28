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

const run = (text: string, keepImports: boolean) => {
  const out = format(parseTree(kotlin.parser, text), kotlin, { keepImports });
  if (!out.ok) throw new Error(out.detail);
  return out.text;
};

const importsInput = "import b.Used\nimport a.Unused\nimport b.Used\n\nimport c.*\nfun f(x: Used) = x\n";

// A regression here drops an import line from the diff viewer's formatted side, hiding an import the change
// adds or removes: the viewer always sets `keepImports`.
test("keepImports sorts the imports but keeps every line, unused and duplicate ones too", () => {
  expect(run(importsInput, true)).toBe(
    "import a.Unused\nimport b.Used\nimport b.Used\nimport c.*\n\nfun f(x: Used) = x\n",
  );
});

test("by default the imports are sorted, deduplicated and pruned of unused ones, as ktfmt does", () => {
  expect(run(importsInput, false)).toBe("import b.Used\nimport c.*\n\nfun f(x: Used) = x\n");
});

// A regression here breaks the formatted file's compile: each import is used, but only through a KDoc link in a
// file without a package header, a backticked name, or the `=` operator convention (#80).
test("pruning keeps imports used only by KDoc, backticked names or operator conventions", () => {
  const used = "import a.Bag\nimport a.`when`\nimport b.assign\n\n/** Fits a [Bag]. */\nfun f() = `when`()\n";
  expect(run(used, false)).toBe(used);
});
