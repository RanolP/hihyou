import { expect, test } from "vitest";
import { parseTree } from "syntechs/core";
import { scopeRuns } from "syntechs/highlight";
import { languageForPath, syntechsGrammars } from "./grammars.js";

const PATCH = `diff --git a/src/value.ts b/src/value.ts
index 1234567..89abcde 100644
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-let value = 1;
+const value = 2;
`;

function stackAt(stacks: string[], runs: Int32Array, offset: number): string {
  for (let i = 0; i < runs.length; i += 3)
    if ((runs[i] as number) <= offset && offset < (runs[i + 1] as number))
      return stacks[runs[i + 2] as number] as string;
  return "";
}

test("a patch gets diff line scopes and embedded TypeScript scopes", async () => {
  expect(languageForPath("patches/expo-image@57.0.5.patch")).toBe("diff");
  const grammar = await syntechsGrammars().forPath("patches/example.patch");
  if (!grammar?.highlight) throw new Error("no diff highlighter");
  const tree = parseTree(grammar.language, PATCH);
  await grammar.prepare?.(tree);
  const { stacks, runs } = scopeRuns(tree, grammar.highlight, PATCH.length);

  expect(stackAt(stacks, runs, PATCH.indexOf("+const"))).toContain(
    "markup.inserted.diff",
  );
  expect(stackAt(stacks, runs, PATCH.indexOf("-let"))).toContain(
    "markup.deleted.diff",
  );
  expect(stackAt(stacks, runs, PATCH.indexOf("@@"))).toContain(
    "meta.diff.range.unified",
  );
  expect(stackAt(stacks, runs, PATCH.indexOf("diff --git"))).toContain(
    "meta.diff.header.git",
  );
  expect(stackAt(stacks, runs, PATCH.indexOf("index "))).toContain(
    "meta.diff.index",
  );
  expect(stackAt(stacks, runs, PATCH.indexOf("---"))).toContain(
    "meta.diff.header.from-file",
  );
  expect(stackAt(stacks, runs, PATCH.indexOf("+++"))).toContain(
    "meta.diff.header.to-file",
  );
  expect(stackAt(stacks, runs, PATCH.indexOf("const"))).toContain(
    "keyword.control.js",
  );
});

// patch-package writes only ---/+++ headers, with a/ and b/ prefixes, and several hunks per file.
const SWIFT_PATCH = `--- a/node_modules/expo-image/ios/ImageView.swift\t2026-01-01 00:00:00
+++ b/node_modules/expo-image/ios/ImageView.swift\t2026-01-02 00:00:00
@@ -1,2 +1,2 @@
 import UIKit
-var size = 1
+let size = 2
@@ -10,1 +10,2 @@
 func load() {
+  return
`;

test("a patch-package patch colours each hunk as its file's language", async () => {
  const grammar = await syntechsGrammars().forPath("patches/expo-image+57.0.5.patch");
  if (!grammar?.highlight) throw new Error("no diff highlighter");
  const tree = parseTree(grammar.language, SWIFT_PATCH);
  await grammar.prepare?.(tree);
  const { stacks, runs } = scopeRuns(tree, grammar.highlight, SWIFT_PATCH.length);
  for (const word of ["+let", "-var", " import", " func", "+  return"])
    expect(stackAt(stacks, runs, SWIFT_PATCH.indexOf(word) + word.search(/\w/)), word).toMatch(/keyword|storage/);
  expect(stackAt(stacks, runs, SWIFT_PATCH.indexOf("+let"))).toContain("markup.inserted.diff");
});

const NEW_FILE_PATCH = `--- /dev/null
+++ b/node_modules/expo-image/ios/NewView.swift\t2026-01-02 00:00:00
@@ -0,0 +1 @@
+let isReady = true
`;

test("a new file patch uses the +++ path for its embedded language", async () => {
  const grammar = await syntechsGrammars().forPath("patches/expo-image+57.0.5.patch");
  if (!grammar?.highlight) throw new Error("no diff highlighter");
  const tree = parseTree(grammar.language, NEW_FILE_PATCH);
  await grammar.prepare?.(tree);
  const { stacks, runs } = scopeRuns(tree, grammar.highlight, NEW_FILE_PATCH.length);

  expect(stackAt(stacks, runs, NEW_FILE_PATCH.indexOf("let"))).toMatch(/keyword|storage/);
  expect(stackAt(stacks, runs, NEW_FILE_PATCH.indexOf("+let"))).toContain("markup.inserted.diff");
});
