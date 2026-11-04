import { createSignal, createUniqueId, type JSX } from "solid-js";
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
  "A changed node is one syntax node the diff tracks, so the count differs from line counts. It counts as read when its file or move is marked Viewed or it sits inside a scored node.";

// The same rules as the titles, but stated whatever the current state is, since the reader opens it to learn them.
const explanation =
  "The diff is approved once every changed node is read and the lowest Code-Review score is +2; a -2 anywhere blocks it. " +
  "Scores run -2 must not merge, -1 would rather not, +1 looks good to me, +2 good to merge, and marking an unscored node Viewed counts as +1. " +
  "A changed node is one syntax node the diff tracks, so the count differs from line counts; it counts as read when its file or move is marked Viewed or it sits inside a scored node.";

/** The Diffset's derived approval, its state in words so it never reads by colour alone. */
export function ApprovalBadge(props: {
  approval: () => Approval;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const explanationId = createUniqueId();
  const score = () => {
    const heaviest = props.approval().heaviest;
    return `Lowest score: ${heaviest === null ? "none" : scoreText(heaviest)}`;
  };
  return (
    <div
      class={`hh-approval hh-approval-${props.approval().state}`}
    >
      <output aria-live="polite">
        <span title={approvalTitles[props.approval().state]}>
          {words[props.approval().state]}
        </span>{" "}
        ·{" "}
        <span title={scoreTitle}>{score()}</span>{" "}
        ·{" "}
        <span title={readTitle}>
          {props.approval().read} of {props.approval().edits} changed nodes read
        </span>
      </output>
      <button
        type="button"
        class="hh-button hh-approval-help"
        aria-expanded={expanded()}
        aria-controls={explanationId}
        on:click={() => setExpanded((value) => !value)}
      >
        What is this?
      </button>
      <p
        id={explanationId}
        class="hh-approval-explain"
        hidden={!expanded()}
      >
        {explanation}
      </p>
    </div>
  );
}
