import type { CodeFragment } from "@hihyou/engine";
import type { DiffFile, ElidedRef } from "@hihyou/ui";

/**
 * `file` with the elided run `ref` names replaced by `unchanged`, the lines the engine says it hid.
 * Undefined when the fragment is no longer that elided run (the files were refreshed in the meantime).
 */
export function expandElided(
  file: DiffFile,
  ref: ElidedRef,
  unchanged: CodeFragment & { kind: "unchanged" },
): DiffFile | undefined {
  const target = file.fragments[ref.fragment];
  if (
    target?.kind !== "elided" ||
    target.lines.before !== ref.lines.before ||
    target.lines.after !== ref.lines.after
  )
    return undefined;
  return {
    ...file,
    fragments: file.fragments.with(ref.fragment, unchanged),
  };
}
