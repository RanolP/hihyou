import type { JSX } from "solid-js";
import { useDraw } from "./context.js";

/** "Viewed" on a file header or a move label; `on` is reactive, so it flips without a redraw. */
export function ViewedToggle(props: {
  on: () => boolean;
  set: (on: boolean) => void;
  id: string;
  what: string;
}): JSX.Element {
  const ctx = useDraw();
  return (
    <button
      ref={(b) => ctx.focusable(b, `viewed\n${props.id}`)}
      type="button"
      class="hh-button hh-viewed-toggle"
      aria-pressed={props.on()}
      aria-label={`Viewed ${props.what}`}
      on:click={() => props.set(!props.on())}
    >
      {props.on() ? "✓ Viewed" : "Viewed"}
    </button>
  );
}
