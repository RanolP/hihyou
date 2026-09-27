import { expect, test } from "vitest";
import { formatAll, ktfmtMissing } from "./ktfmt.node.js";

const missing = ktfmtMissing();
if (missing) console.warn(`skipping the ktfmt runner test: ${missing}`);

// A regression here is the runner misreading ktfmt's per-file stderr report (a new ktfmt wording, a path
// spelled differently), which would hand back the unformatted input as ktfmt's output, or blame the wrong file.
test("ktfmt formats each input in one run and reports a syntax error against its own input", (ctx) => {
  if (missing) ctx.skip(missing);
  expect(
    formatAll([
      { name: "a.kt", text: "fun  main( ) { val x=listOf(1,2) }\n" },
      { name: "b.kt", text: "fun f( {\n" },
      { name: "c.kts", text: 'plugins {  id("x") }\n' },
    ]).map((o) => (o instanceof Error ? `Error: ${o.message}` : o)),
  ).toEqual([
    "fun main() {\n    val x = listOf(1, 2)\n}\n",
    "Error: ktfmt b.kt: b.kt:1:7: error: Expecting ')'",
    'plugins { id("x") }\n',
  ]);
});
