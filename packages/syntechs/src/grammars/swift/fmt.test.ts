import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { format } from "../../fmt/format.js";
import { swift } from "./fmt.js";
import { language } from "./index.js";

const run = (text: string) => format(parseTree(language, text), swift);

// Every expected text below is swift-format 6.3.0's output for the input.

// A regression here is the #if re-indent dropped or applied at the wrong depth, so a flush conditional body would
// show as unchanged where swift-format indents it.
test("a flush #if body is indented two spaces per nesting level", () => {
  const flat = run("#if os(macOS)\nimport AppKit\n#endif\n");
  expect(flat.ok && flat.text).toBe("#if os(macOS)\n  import AppKit\n#endif\n");
  const out = run(
    "func f() {\n  #if A\n  let a = 1\n  #if B\n  let b = 2\n  #else\n  let c = 3\n  #endif\n  #endif\n}\n",
  );
  expect(out.ok && out.text).toBe(
    "func f() {\n  #if A\n    let a = 1\n    #if B\n      let b = 2\n    #else\n      let c = 3\n    #endif\n  #endif\n}\n",
  );
});

// A regression here is a refusal check loosened, so syntechs would print as written a file swift-format rewrites
// (operator spacing, brace spacing, semicolons, `else` placement, import order, 4-space indent).
test("input swift-format would rewrite and syntechs cannot is refused", () => {
  for (const input of [
    "let a = 1+2\n",
    "func f(){\n  let a = 1\n}\n",
    "let a = b ;let c = d\n",
    "if a {\n  b()\n}\nelse {\n  c()\n}\n",
    "import B\nimport A\n",
    "func f() {\n    let a = 1\n}\n",
    "let a = b\n  .c()\n",
  ])
    expect(run(input).ok, input).toBe(false);
});

// A regression here is the whitespace cleanup lost: trailing spaces, a run of blank lines, or edge blank lines kept.
test("trailing whitespace and extra blank lines are removed", () => {
  const out = run("\n\nlet a = 1   \n\n\n\nlet b = 2\n\n\n");
  expect(out.ok && out.text).toBe("let a = 1\n\nlet b = 2\n");
});
