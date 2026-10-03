import { For, type JSX, Show } from "solid-js";
import { modalKeymap } from "../modal.js";

/** The key actions a mouse reaches too, each showing the key that does the same. */
const toolbar = [
  { key: "v", label: "Viewed" },
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

/** Shown while something is selected; a click runs the button's key as if pressed. */
export function KeyToolbar(props: {
  shown: () => boolean;
  press: (key: string) => void;
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
              on:click={() => props.press(b.key)}
            >
              {b.label} <kbd>{b.key}</kbd>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

/** Kakoune's info box: every bound key, by what it does. */
export function KeyInfo(props: { open: () => boolean }): JSX.Element {
  return (
    <Show when={props.open()}>
      <aside class="hh-keyinfo" aria-label="Keys" aria-live="off">
        <For each={groups}>
          {(g) => (
            <section>
              <h2 class="hh-keyinfo-title">{g.title}</h2>
              <dl>
                <For each={modalKeymap.filter((k) => k.group === g.group)}>
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
          )}
        </For>
      </aside>
    </Show>
  );
}
