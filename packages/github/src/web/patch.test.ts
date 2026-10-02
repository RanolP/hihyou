import { expect, test } from "vitest";
import { parseDiff, reverseApply } from "./patch.js";

// A blank context line whose leading space was lost would otherwise end the hunk early and drop its later lines.
test("a hunk reads its lines by the header's counts, taking an empty line as context", () => {
  const [file] = parseDiff(
    [
      "diff --git a/x b/x",
      "index 1111111..2222222 100644",
      "--- a/x",
      "+++ b/x",
      "@@ -1,3 +1,3 @@",
      " a",
      "",
      "-b",
      "+c",
      "",
    ].join("\n"),
  );
  expect(file?.hunks[0]?.lines).toEqual([" a", " ", "-b", "+c"]);
});

// git quotes paths with spaces or non-ASCII bytes; reading the quotes as part of the path would 404 the raw fetch.
test("quoted paths are unquoted and decoded as UTF-8", () => {
  const [file] = parseDiff(
    'diff --git "a/\\355\\225\\234 x" "b/\\355\\225\\234 y"\n',
  );
  expect([file?.oldPath, file?.newPath]).toEqual(["한 x", "한 y"]);
});

// The "\ No newline at end of file" marker under a removed last line means the old file lacked the final newline;
// getting it backwards makes the rebuilt before side fail its blob-id check.
test("reverseApply restores a missing final newline on the old side", () => {
  const hunks = [
    {
      newStart: 1,
      newLines: 2,
      lines: [" a", "-b", "\\ No newline at end of file", "+b", "+c"],
    },
  ];
  expect(reverseApply("a\nb\nc\n", hunks, "x")).toBe("a\nb");
});

// A hunk that only deletes names the line before it as newStart; an off-by-one puts the deleted lines in the wrong place.
test("reverseApply places a pure deletion after the line its header names", () => {
  const hunks = [{ newStart: 1, newLines: 0, lines: ["-x"] }];
  expect(reverseApply("a\nb\n", hunks, "x")).toBe("a\nx\nb\n");
});
