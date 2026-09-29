import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
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

// A regression here detaches an import's trailing comment from it (it hoists above the whole list, or stays when
// the import is dropped), or keeps an import of the file's own package, as 6 ktfmt import fixtures caught.
test("an import's trailing comment moves and goes with it, and an own-package import is dropped", () => {
  const input =
    "package p\n\nimport b.Used /* why */\nimport a.Unused // note\nimport p.Here\nimport a.Other\nfun f(x: Used, y: Other) = Here\n";
  expect(run(input, false)).toBe(
    "package p\n\nimport a.Other\nimport b.Used /* why */\n\nfun f(x: Used, y: Other) = Here\n",
  );
  const out = format(parseTree(kotlin.parser, input), kotlin, {});
  expect(out.ok && check(kotlin, input, out.text)).toBeUndefined();
});

// A regression here puts back the blank line ktfmt drops between prose ending in `:` and the code block it
// introduces, and before a `<pre>`, which failed 16 ktfmt fixtures.
test("KDoc code blocks hug the prose that introduces them, as ktfmt prints them", () => {
  const input = "/**\n * Like so:\n *\n * ```\n * code\n * ```\n * Then.\n *\n * <pre>\n * x\n * </pre>\n */\nfun f() {}\n";
  expect(run(input, false)).toBe(
    "/**\n * Like so:\n * ```\n * code\n * ```\n *\n * Then.\n * <pre>\n * x\n * </pre>\n */\nfun f() {}\n",
  );
});

// A regression here stops realigning KDoc tables, or refuses a `:--` column the realigned table prints as plain
// dashes, which failed 11 ktfmt table fixtures.
test("KDoc tables are realigned as ktfmt prints them", () => {
  const input = "/**\n * Values:\n *\n * |a|bb|\n * |:--|---:|\n * |x|1|\n */\nfun f() {}\n";
  expect(run(input, false)).toBe(
    "/**\n * Values:\n *\n * | a   | bb  |\n * |-----|----:|\n * | x   |   1 |\n */\nfun f() {}\n",
  );
});

// A regression here glues an annotation to what it annotates (`@A List`, `@S("X") return`), which changes the
// code's meaning and refused 11 ktfmt annotation fixtures; or stops putting a declaration's annotations on lines of
// their own once the declaration breaks.
test("annotations stay apart from what they annotate, on lines of their own once the declaration breaks", () => {
  const input =
    '@A @B(1) fun f() = 1\n\n@A @B(1) fun g() {\n    val x: (@A List<Int>) -> Unit = h\n    @[C D] var y = 2\n    @S("X")\n    return z\n}\n';
  expect(run(input, false)).toBe(
    '@A @B(1) fun f() = 1\n\n@A\n@B(1)\nfun g() {\n    val x: (@A List<Int>) -> Unit = h\n    @[C D]\n    var y = 2\n    @S("X")\n    return z\n}\n',
  );
});

// A regression here prints a lambda or a type list with a trailing comma as written (the grammar recovers the comma
// as an ERROR), keeps that comma where ktfmt drops it, or stops breaking a type list the source breaks.
test("trailing commas drop from lambda parameters and one-line type lists, and a broken type list keeps one", () => {
  const input =
    "fun <A, B,> f() {\n    g<Int,>()\n    a {\n        x,\n        y, ->\n        z\n    }\n    h<\n        A,\n        B\n    >()\n}\n";
  expect(run(input, false)).toBe(
    "fun <A, B> f() {\n    g<Int>()\n    a { x, y ->\n        z\n    }\n    h<\n        A,\n        B,\n    >()\n}\n",
  );
});
