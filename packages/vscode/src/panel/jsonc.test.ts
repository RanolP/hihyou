import { expect, test } from "vitest";
import { parseJsonc } from "./jsonc.js";

// Most installed themes carry comments or trailing commas; a strict parse sends every one of them to the
// GitHub fallback, and a careless strip mangles a scope string holding "//" or ",]".
test("a theme with comments and trailing commas parses, strings untouched", () => {
  const text = `{
    // line comment
    "name": "a // b, ]", /* block */
    "tokenColors": [{ "scope": "x", "settings": { "foreground": "#fff", }, },],
  }`;
  expect(parseJsonc(text)).toEqual({
    name: "a // b, ]",
    tokenColors: [{ scope: "x", settings: { foreground: "#fff" } }],
  });
});
