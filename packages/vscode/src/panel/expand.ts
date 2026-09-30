import type { CodeFragment } from "@hihyou/engine";
import type { DiffFile, ElidedRef } from "@hihyou/ui";

/**
 * `file` with the elided run `ref` names replaced by the unchanged lines it hid, read off `afterText` (the
 * after blob's text). This holds only while no formatter is bound: then the engine's display text is the blob
 * text, so its line numbers index the blob directly. Undefined when the fragment is no longer that elided run
 * (the files were refreshed in the meantime) or the lines fall outside the text.
 */
export function expandElided(
  file: DiffFile,
  ref: ElidedRef,
  afterText: string,
): DiffFile | undefined {
  const target = file.fragments[ref.fragment];
  if (
    target?.kind !== "elided" ||
    target.lines.before !== ref.lines.before ||
    target.lines.after !== ref.lines.after
  )
    return undefined;
  const starts = lineStarts(afterText);
  const first = ref.lines.after - 1;
  const start = starts[first];
  if (start === undefined) return undefined;
  const end =
    ref.count === undefined
      ? afterText.length
      : (starts[first + ref.count] ?? afterText.length);
  const unchanged: CodeFragment = {
    kind: "unchanged",
    spans: [{ text: afterText.slice(start, end) }],
    // The renderer never reads `at`; anchoring a comment to expanded context is not supported yet.
    at: [],
    lines: target.lines,
  };
  return {
    ...file,
    fragments: file.fragments.with(ref.fragment, unchanged),
  };
}

/** Offset of each line's first character, as the engine counts lines: a final newline starts no line. */
function lineStarts(text: string): number[] {
  if (text.length === 0) return [];
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    if (i + 1 < text.length) starts.push(i + 1);
  return starts;
}
