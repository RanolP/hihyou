// Regression: savePatch() used to drop the notes header entirely when grammar.patch held only notes
// and no diff yet, because `if (diff) ... else rmSync(...)` deleted the file whenever there was
// nothing to diff -- notes or not. patchNotes() had its own bug too: `old.search(...)` returns -1 with
// no diff section to find, and slicing up to `Math.max(0, -1)` collapsed that to "" instead of the
// whole text.
import assert from "node:assert/strict";
import { nextPatch, patchNotes } from "./build.mjs";

const header = "# Why this patch exists\n# (no diff recorded yet)\n";
assert.equal(patchNotes(header), header, "notes-only patch: header must be preserved");

assert.equal(
  nextPatch(header, ""),
  header,
  "notes-only, nothing edited yet: the header must survive, not get deleted",
);

const headerWithDiff =
  header +
  "===================================================================\n" +
  "--- a/grammar.js\n" +
  "+++ b/grammar.js\n";
assert.equal(
  patchNotes(headerWithDiff),
  header,
  "patch with an existing diff: header must still be preserved",
);
assert.equal(nextPatch(header, "+++ a diff +++\n"), header + "+++ a diff +++\n");
assert.equal(nextPatch("", ""), null, "no notes and no diff: the patch file should go away");

console.log("build.test.mjs: ok");
