import { For, type JSX, Show } from "solid-js";
import { modalKeymap } from "../modal.js";
import type { Score } from "../viewed.js";

/** The key actions a mouse reaches too, each showing the keys that do the same, pressed in turn. */
const toolbar = [
  { key: "v", label: "Viewed" },
  { key: "s 2", label: "+2" },
  { key: "s 1", label: "+1" },
  { key: "s q", label: "-1" },
  { key: "s w", label: "-2" },
  { key: "s 0", label: "Clear score" },
  { key: "c", label: "Comment" },
  { key: "b", label: "Prev word" },
  { key: "w", label: "Next word" },
  { key: "B", label: "Grow word back" },
  { key: "W", label: "Grow word on" },
  { key: "Enter", label: "Expand" },
  { key: "g", label: "Counterpart" },
  { key: "o", label: "Parent" },
  { key: "i", label: "Child" },
  { key: "p", label: "Prev sibling" },
  { key: "n", label: "Next sibling" },
  { key: "[", label: "Prev unviewed" },
  { key: "]", label: "Next unviewed" },
  { key: "?", label: "Keys" },
] as const;

const groups = [
  { group: "move", title: "Move" },
  { group: "extend", title: "Extend" },
  { group: "act", title: "Act" },
] as const;

/** The sign is text, so a score never reads by colour alone. */
export const scoreText = (score: Score) =>
  score > 0 ? `+${score}` : `${score}`;

/** Shown while something is selected; a click runs the button's keys as if pressed. */
export function KeyToolbar(props: {
  shown: () => boolean;
  press: (key: string) => void;
  /** The primary selection's score, when it has one. */
  score: () => Score | null;
}): JSX.Element {
  return (
    <Show when={props.shown()}>
      <div class="hh-toolbar" role="toolbar" aria-label="Review actions">
        <For each={toolbar}>
          {(b) => (
            <button
              type="button"
              class="hh-tool"
              aria-label={`${b.label} (${b.key})`}
              title={`${b.label} (${b.key})`}
              on:click={() => {
                for (const k of b.key.split(" ")) props.press(k);
              }}
            >
              {b.label} <kbd>{b.key}</kbd>
            </button>
          )}
        </For>
        <Show when={props.score()}>
          {(s) => (
            <output
              class={`hh-score hh-score-${s() > 0 ? "plus" : "minus"}`}
              aria-label={`Code-Review ${scoreText(s())}`}
            >
              Code-Review {scoreText(s())}
            </output>
          )}
        </Show>
      </div>
    </Show>
  );
}

/** Shown while a review is started: how many comments it holds, and the button that publishes them. */
export function SubmitReview(props: {
  /** The host knows a pending review, which may hold comments written elsewhere (on github.com). */
  reviewing: () => boolean;
  pending: () => number;
  error: () => string | undefined;
  press: (key: string) => void;
}): JSX.Element {
  return (
    <Show when={props.reviewing()}>
      <div class="hh-toolbar" role="toolbar" aria-label="Pending review">
        <button
          type="button"
          class="hh-tool"
          aria-label="Submit review (R)"
          title="Submit review (R)"
          on:click={() => props.press("R")}
        >
          Submit review <kbd>R</kbd>
        </button>
        <output class="hh-review-pending">
          {props.pending()} pending{" "}
          {props.pending() === 1 ? "comment" : "comments"}
        </output>
        <Show when={props.error()}>
          {(e) => (
            <output class="hh-comment-error" role="alert">
              {e()}
            </output>
          )}
        </Show>
      </div>
    </Show>
  );
}

/**
 * Kakoune's info box: every bound key, by what it does, or while a prefix key waits, only the keys that can
 * follow it.
 */
export function KeyInfo(props: {
  open: () => boolean;
  pending: () => "s" | undefined;
}): JSX.Element {
  return (
    <Show
      when={props.pending()}
      fallback={
        <Show when={props.open()}>
          <aside class="hh-keyinfo" aria-label="Keys" aria-live="off">
            <For each={groups}>
              {(g) => (
                <KeyGroup
                  title={g.title}
                  keys={modalKeymap.filter(
                    (k) => k.group === g.group && !k.prefix,
                  )}
                />
              )}
            </For>
          </aside>
        </Show>
      }
    >
      {(p) => (
        <aside class="hh-keyinfo" aria-label="Score keys" aria-live="polite">
          <KeyGroup
            title="Score"
            keys={modalKeymap.filter((k) => k.prefix === p())}
          />
        </aside>
      )}
    </Show>
  );
}

function KeyGroup(props: {
  title: string;
  keys: readonly { key: string; label: string }[];
}): JSX.Element {
  return (
    <section>
      <h2 class="hh-keyinfo-title">{props.title}</h2>
      <dl>
        <For each={props.keys}>
          {(k) => (
            <>
              <dt>
                <kbd>{k.key}</kbd>
              </dt>
              <dd>{k.label}</dd>
            </>
          )}
        </For>
      </dl>
    </section>
  );
}
