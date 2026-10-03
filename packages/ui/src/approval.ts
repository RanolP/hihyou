import type { AtomIndex, NodeRef, SideName } from "./atoms.js";
import type { Score } from "./viewed.js";

/**
 * A Diffset's approval, derived from the Code-Review scores on its nodes and never stored (`docs/design/review-core.md`,
 * "A Diffset's approval is derived").
 */
export interface Approval {
  state: "blocked" | "approved" | "pending";
  /** The minimum score on any of the Diffset's nodes; `null` when none is scored. */
  heaviest: Score | null;
  /** Edits (atoms) a person read: scored at or above one of their nodes, or viewed. */
  read: number;
  edits: number;
}

const sides: readonly SideName[] = ["before", "after"];

/**
 * Reads only nodes in `index`, so a score kept for another iteration's nodes never counts here. A viewed edit
 * that no score covers counts as +1, derived here and never written to the score store.
 */
export function approvalOf(
  index: AtomIndex,
  scoreOf: (ref: NodeRef) => Score | null,
  isViewed: (atom: string) => boolean,
): Approval {
  let heaviest: Score | null = null;
  const covered = new Set<number>();
  for (const hunks of index.hunks)
    for (const hunk of hunks)
      for (const side of sides) {
        const tree = hunk[side];
        for (let node = 0; node < tree.nodes.length; node++) {
          const score = scoreOf({
            file: hunk.file,
            fragment: hunk.fragment,
            side,
            node,
          });
          if (score === null) continue;
          if (heaviest === null || score < heaviest) heaviest = score;
          for (const a of tree.atoms[node] ?? []) covered.add(a);
        }
      }
  let read = covered.size;
  index.atoms.forEach((atom, a) => {
    if (covered.has(a) || !isViewed(atom.id)) return;
    read++;
    if (heaviest === null || heaviest > 1) heaviest = 1;
  });
  const edits = index.atoms.length;
  const state =
    heaviest === -2
      ? "blocked"
      : heaviest === 2 && edits > 0 && read === edits
        ? "approved"
        : "pending";
  return { state, heaviest, read, edits };
}
