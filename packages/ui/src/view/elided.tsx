import { createSignal, type JSX } from "solid-js";
import { type ElidedRef, type ExpandDirection, expandStep } from "../expand.js";
import type { Gap } from "../rows.js";
import { useDraw } from "./context.js";

const icons: Record<ExpandDirection | "collapse", string> = {
  up: "M4 10l4-4 4 4",
  down: "M4 6l4 4 4-4",
  all: "M4 6l4-4 4 4M4 10l4 4 4-4",
  collapse: "M4 2l4 4 4-4M4 14l4-4 4 4",
};

function IconButton(props: {
  icon: keyof typeof icons;
  label: string;
  busy: boolean;
  action: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="hh-expander"
      aria-label={props.label}
      title={props.label}
      disabled={props.busy}
      aria-busy={props.busy || undefined}
      on:click={() => props.action()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={icons[props.icon]} />
      </svg>
    </button>
  );
}

const hidden = (count: number | undefined) =>
  count === 0
    ? "All hidden lines shown"
    : count === undefined
      ? "Hidden lines to the end of the file"
      : `${count} hidden ${count === 1 ? "line" : "lines"}`;

/** GitHub's expander: icon buttons in the gutter, a muted count beside them. */
export function ElidedRow(props: { path: string; gap: Gap }): JSX.Element {
  const ctx = useDraw();
  const { path, gap } = props;
  const { count } = gap;
  const unified = ctx.layout() === "unified";
  // Once asked, the buttons wait for the host's `update`, which redraws the row.
  const [busy, setBusy] = createSignal(false);
  const ref: ElidedRef = { fragment: gap.fragment, lines: gap.origin };
  const buttons: JSX.Element[] = [];
  const { onExpand, onCollapse } = ctx;
  if (onExpand) {
    const expander = (direction: ExpandDirection, label: string) => (
      <IconButton
        icon={direction}
        label={label}
        busy={busy()}
        action={() => {
          setBusy(true);
          onExpand(path, ref, direction);
        }}
      />
    );
    const step = `Expand ${expandStep} lines`;
    if (count !== 0) {
      if (count !== undefined && count <= expandStep)
        buttons.push(
          expander("all", `Expand all ${count} ${count === 1 ? "line" : "lines"}`),
        );
      else if (gap.atEnd) buttons.push(expander("down", `${step} down`));
      else if (gap.atStart) buttons.push(expander("up", `${step} up`));
      else
        buttons.push(
          expander("down", `${step} down`),
          expander("up", `${step} up`),
        );
    }
    if (gap.revealed && onCollapse)
      buttons.push(
        <IconButton
          icon="collapse"
          label="Collapse expanded lines"
          busy={busy()}
          action={() => {
            setBusy(true);
            onCollapse(path, ref);
          }}
        />,
      );
  }
  // The gutter covers both line numbers in the unified layout, the before side's alone in the split one.
  return (
    <tr class="hh-elided">
      <td class="hh-num hh-expander-cell" colSpan={unified ? 2 : undefined}>
        {buttons}
      </td>
      <td class="hh-elided-cell" colSpan={unified ? undefined : 3}>
        {hidden(count)}
      </td>
    </tr>
  );
}
