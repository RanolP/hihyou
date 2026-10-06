import type { ModalRoot } from "../modal.js";

/** Keys a focused control keeps for itself rather than the modal editor. */
const controlKeys = new Set(["Enter", " "]);
export const controls =
  "button, input, textarea, select, a[href], [contenteditable]";
/** Where the reviewer types text (a comment draft): every key is that text's, the modal editor sees none. */
const textEntry = "input, textarea, [contenteditable]";

/**
 * The modal editor's view of the root: it sees keys while focus is anywhere inside, except the keys a focused
 * control (a Viewed toggle, an expander) acts on. Inside a shadow root, the document's active element is the
 * host, so focus is read from the root's own tree.
 */
export function modalRoot(root: HTMLElement): ModalRoot {
  const doc = root.ownerDocument;
  const wrapped = new Map<
    (e: KeyboardEvent) => void,
    (e: KeyboardEvent) => void
  >();
  return {
    addEventListener(type, listener) {
      const w = (e: KeyboardEvent) => {
        const t = e.target instanceof Element ? e.target : null;
        if (t?.closest(textEntry)) return;
        if (controlKeys.has(e.key) && t?.closest(controls)) return;
        listener(e);
      };
      wrapped.set(listener, w);
      root.addEventListener(type, w);
    },
    removeEventListener(type, listener) {
      const w = wrapped.get(listener);
      if (w) root.removeEventListener(type, w);
      wrapped.delete(listener);
    },
    contains: (other) => root.contains(other),
    ownerDocument: {
      get activeElement() {
        const r = root.getRootNode();
        return r instanceof ShadowRoot ? r.activeElement : doc.activeElement;
      },
    },
  };
}
