import { For, type JSX, Show } from "solid-js";
import type { ReviewEvent } from "../comments.js";
import { type KeyBinding, type KeySection, modalKeymap } from "../modal.js";
import type { Score } from "../viewed.js";

/** A key the host binds itself (the browser's `/` to filter files), shown in the key panel beside the modal's. */
export interface HostKey {
  key: string;
  label: string;
  section: KeySection;
  run(): void;
}

interface KeyPanelProps {
  /** `undefined` docks the panel where the host mounted it; `"inline"` lays it along the bottom of the diff. */
  placement?: "inline";
  collapsed: () => boolean;
  toggle: () => void;
  hasSelection: () => boolean;
  reviewing: () => boolean;
  pending: () => "s" | undefined;
  /** The selected node's score, when it has one. */
  score: () => Score | null;
  press: (key: string) => void;
  hostKeys: readonly HostKey[];
}

interface SubmitReviewProps {
  /** The host knows a pending review, which may hold comments written elsewhere (on github.com). */
  reviewing: () => boolean;
  pending: () => number;
  /** What `R` sends, shown before it is pressed. */
  event: () => ReviewEvent;
  error: () => string | undefined;
  press: (key: string) => void;
}

/**
 * Every key, grouped by what the reviewer is trying to do, always on screen. A click runs the button's keys as if
 * pressed; a key with nothing to act on stays listed but greyed, so the panel never shifts as the selection does.
 */
export const KeyPanel = (props: KeyPanelProps): JSX.Element => {
  const enabled = (k: KeyBinding) =>
    k.needs === "selection"
      ? props.hasSelection()
      : k.needs === "review"
        ? props.reviewing()
        : true;
  const entries = (section: KeySection) => [
    ...modalKeymap
      .filter((k) => k.section === section)
      .map((k) => ({
        key: k.prefix ? `${k.prefix} ${k.key}` : k.key,
        shown: k.key,
        label: k.label,
        detail: k.detail,
        enabled: () => enabled(k),
        run: () => {
          if (k.prefix && props.pending() !== k.prefix) props.press(k.prefix);
          props.press(k.key);
        },
      })),
    ...props.hostKeys
      .filter((k) => k.section === section)
      .map((k) => ({
        key: k.key,
        shown: k.key,
        label: k.label,
        detail: undefined,
        enabled: () => true,
        run: () => k.run(),
      })),
  ];
  const hint = () => {
    if (props.pending() === "s")
      return "Score it: press 2, 1, q, w or 0.";
    if (!props.hasSelection())
      return "Click any code, or press j, to select a change.";
    return undefined;
  };
  return (
    <section
      class="hh-keys"
      classList={{
        "hh-keys-inline": props.placement === "inline",
        "hh-keys-collapsed": props.collapsed(),
      }}
      aria-label="Keyboard shortcuts"
    >
      <h2 class="hh-keys-head">
        <button
          type="button"
          class="hh-keys-toggle"
          aria-expanded={!props.collapsed()}
          title={`${props.collapsed() ? "Show" : "Hide"} shortcuts (?)`}
          on:click={() => props.toggle()}
        >
          Keyboard shortcuts <kbd>?</kbd>
        </button>
      </h2>
      <Show when={!props.collapsed()}>
        <p class="hh-keys-hint" aria-live="polite">
          <Show
            when={hint()}
            fallback={
              <Show
                when={props.score()}
                fallback="Code selected; Esc clears it."
              >
                {(s) => (
                  <output
                    class={`hh-score hh-score-${s() > 0 ? "plus" : "minus"}`}
                    aria-label={`Code-Review ${scoreText(s())}`}
                  >
                    Code-Review {scoreText(s())}
                  </output>
                )}
              </Show>
            }
          >
            {(h) => h()}
          </Show>
        </p>
        <For each={sections}>
          {(g) => (
            <section
              class="hh-keys-group"
              classList={{
                "hh-keys-active": g.section === "score" && !!props.pending(),
              }}
            >
              <h3 class="hh-keys-group-title">{g.title}</h3>
              <div class="hh-keys-list">
                <For each={entries(g.section)}>
                  {(e) => (
                    <button
                      type="button"
                      class="hh-key"
                      disabled={!e.enabled()}
                      aria-label={`${e.label} (${e.key})`}
                      title={`${e.detail ?? e.label} (${e.key})`}
                      on:click={() => e.run()}
                    >
                      <kbd>{keyText(e.shown)}</kbd>
                      <span>{e.label}</span>
                    </button>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </section>
  );
};

/** Shown while a review is started: how many comments it holds, and the button that publishes them. */
export const SubmitReview = (props: SubmitReviewProps): JSX.Element => {
  const label = () => eventLabel[props.event()];
  return (
    <Show when={props.reviewing()}>
      <div class="hh-toolbar" role="toolbar" aria-label="Pending review">
        <button
          type="button"
          class="hh-tool"
          aria-label={`Submit review (R): ${label()}`}
          title={`Submit review (R): ${label()}`}
          on:click={() => props.press("R")}
        >
          Submit review <kbd>R</kbd> · {label()}
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
};

const sections: readonly { section: KeySection; title: string }[] = [
  { section: "find", title: "Find changes" },
  { section: "select", title: "Select code" },
  { section: "words", title: "Narrow to words" },
  { section: "review", title: "Review" },
  { section: "score", title: "Score (s, then…)" },
];

const keyText = (key: string) => (key === "Escape" ? "Esc" : key);

/** The sign is text, so a score never reads by colour alone. */
export const scoreText = (score: Score) =>
  score > 0 ? `+${score}` : `${score}`;

/** The names GitHub's own review dialog gives each event. */
const eventLabel: Record<ReviewEvent, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
};
