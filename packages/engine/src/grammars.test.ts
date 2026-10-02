import { expect, test } from "vitest";
import { syntechsGrammars } from "./grammars.js";

// A language registered for parsing but not in the highlighter table renders as plain text in the extension,
// as Kotlin once did.
test("a .kt and a .kts path load the Kotlin grammar with its highlighter", async () => {
  const grammars = syntechsGrammars();
  for (const path of ["app/src/Main.kt", "build.gradle.kts"]) {
    const grammar = await grammars.forPath(path);
    expect(grammar?.id).toMatch(/^kotlin@/);
    expect(grammar?.highlight).toBeDefined();
  }
});
