import { expect, test } from "vitest";
import { parseTree } from "syntechs/core";
import { scopeRuns } from "syntechs/highlight";
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

/** The scope stack the highlighter gives the first character of `needle` in `text`. */
async function stackAt(path: string, text: string, needle: string): Promise<string> {
  const grammar = await syntechsGrammars().forPath(path);
  if (!grammar?.highlight) throw new Error(`no highlighter for ${path}`);
  const at = text.indexOf(needle);
  const { stacks, runs } = scopeRuns(parseTree(grammar.language, text), grammar.highlight, text.length);
  for (let r = 0; r < runs.length; r += 3)
    if ((runs[r] as number) <= at && at < (runs[r + 1] as number)) return stacks[runs[r + 2] as number] as string;
  return "";
}

// A loader that hands out the highlighter before its injected languages load paints a JSDoc comment as one
// flat comment, as syntechs did before it compiled injections.scm; .tsx once got no injection query at all.
test.each(["src/greet.ts", "src/greet.tsx"])("a JSDoc tag in %s carries the jsdoc scope", async (path) => {
  const text = "/**\n * @param {string} name the user\n */\nfunction greet(name: string) {}\n";
  expect(await stackAt(path, text, "@param")).toMatch(/storage\.type\.class\.jsdoc$/);
  expect(await stackAt(path, text, "string}")).toMatch(/entity\.name\.type\.instance\.jsdoc$/);
});

// Without the regex injection, a regex literal's pattern is one string-coloured run: quantifiers and character
// classes lose the colours VS Code gives them.
test("a regex literal's quantifier and character class carry regexp scopes", async () => {
  const text = "const digits = /[0-9]+x/;\n";
  expect(await stackAt("src/digits.ts", text, "+x")).toMatch(/keyword\.operator\.quantifier\.regexp$/);
  expect(await stackAt("src/digits.ts", text, "0-9")).toMatch(/constant\.other\.character-class\.set\.regexp/);
});
