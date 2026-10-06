import type { JSX } from "solid-js";
import type { Approval } from "../approval.js";
import { scoreText } from "./keys.jsx";

const words = {
  blocked: "Blocked",
  approved: "Approved",
  pending: "Not approved",
} as const;

/** The Diffset's derived approval, its state in words so it never reads by colour alone. */
export function ApprovalBadge(props: {
  approval: () => Approval;
}): JSX.Element {
  const text = () => {
    const a = props.approval();
    const heaviest = a.heaviest === null ? "unscored" : scoreText(a.heaviest);
    return `${words[a.state]} · ${heaviest} · ${a.read}/${a.edits} edits read`;
  };
  return (
    <output
      class={`hh-approval hh-approval-${props.approval().state}`}
      aria-live="polite"
    >
      {text()}
    </output>
  );
}
