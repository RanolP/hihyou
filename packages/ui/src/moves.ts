import type { AstSteps, Side } from "@hihyou/engine";
import type { DiffFile, SideName } from "./rows.js";

/** A `diff` fragment's side: file and fragment by index. */
export interface SideRef {
  file: number;
  fragment: number;
  side: SideName;
}

const namesOf = (f: DiffFile) =>
  [f.path, f.change?.oldPath].filter((p) => p !== undefined);

/** One path is a prefix of the other: the same node, or one inside the other. */
const nested = (p: AstSteps, q: AstSteps) =>
  p.length <= q.length
    ? p.every((s, i) => s === q[i])
    : q.every((s, i) => s === p[i]);

/**
 * The other half of the move at `from`: the opposite side, in the counterpart's file, of a fragment that
 * points back at `from`'s file. A fragment holding the counterpart's node beats one that only points back.
 */
export function findCounterpart(
  files: readonly DiffFile[],
  from: SideRef,
): SideRef | undefined {
  const source = files[from.file];
  const fragment = source?.fragments[from.fragment];
  if (!source || fragment?.kind !== "diff") return undefined;
  const move = fragment[from.side].move;
  if (!move) return undefined;
  const side: SideName = from.side === "before" ? "after" : "before";
  const back = namesOf(source);
  let fallback: SideRef | undefined;
  for (const [file, f] of files.entries()) {
    if (!namesOf(f).includes(move.counterpart.path)) continue;
    for (const [i, g] of f.fragments.entries()) {
      if (g.kind !== "diff") continue;
      const s: Side = g[side];
      if (!s.move || !back.includes(s.move.counterpart.path)) continue;
      const ref = { file, fragment: i, side };
      if (s.at.some((p) => move.counterpart.at.some((q) => nested(p, q))))
        return ref;
      fallback ??= ref;
    }
  }
  return fallback;
}
