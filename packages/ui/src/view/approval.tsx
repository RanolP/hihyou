import type { JSX } from "solid-js";
import type { Approval } from "../approval.js";
import { scoreText } from "./keys.jsx";

const words = {
  blocked: "Blocked",
  approved: "Approved",
  pending: "Not approved",
} as const;

const approvalTitles = {
  blocked:
    "Blocked because at least one scored node has a -2 Code-Review score.",
  approved:
    "Approved because every edit is read and the lowest Code-Review score is +2.",
  pending:
    "Not approved. Approval requires at least one edit, every edit to be read, and the lowest Code-Review score to be +2.",
} as const;

const scoreTitle =
  "The lowest Code-Review score in this diff: -2 must not merge, -1 would rather not, +1 looks good to me, and +2 is good to merge. Marking an unscored edit Viewed counts as +1.";

const readTitle =
  "An edit is one changed syntax node tracked by the diff. It is read when marked Viewed or when it is inside a node with a Code-Review score.";

/** The Diffset's derived approval, its state in words so it never reads by colour alone. */
export function ApprovalBadge(props: {
  approval: () => Approval;
}): JSX.Element {
  const score = () => {
    const heaviest = props.approval().heaviest;
    return heaviest === null ? "unscored" : scoreText(heaviest);
  };
  return (
    <output
      class={`hh-approval hh-approval-${props.approval().state}`}
      aria-live="polite"
    >
      <span title={approvalTitles[props.approval().state]}>
        {words[props.approval().state]}
      </span>{" "}
      ·{" "}
      <span title={scoreTitle}>{score()}</span>{" "}
      ·{" "}
      <span title={readTitle}>
        {props.approval().read}/{props.approval().edits} edits read
      </span>
    </output>
  );
}
