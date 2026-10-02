import type { Point } from "../modal.js";
import { rangeOver } from "./highlights.js";
import type { Placer } from "./placement.js";

/** The caret under the pointer; inside a shadow root only `caretPositionFromPoint` given that root reaches it. */
const caretAt = (root: HTMLElement, x: number, y: number) => {
  const r = root.getRootNode();
  const shadowRoots = r instanceof ShadowRoot ? [r] : [];
  const d = root.ownerDocument as Document & {
    caretPositionFromPoint?(
      x: number,
      y: number,
      options?: { shadowRoots?: ShadowRoot[] },
    ): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  const p = d.caretPositionFromPoint?.(x, y, { shadowRoots });
  if (p) return { node: p.offsetNode, offset: p.offset };
  const range = d.caretRangeFromPoint?.(x, y);
  return range && { node: range.startContainer, offset: range.startOffset };
};

/** The side position under a click: the character the pointer is over, not the caret boundary nearest it. */
export function pointAt(
  root: HTMLElement,
  placer: Placer,
  e: MouseEvent,
  target: Element | null,
): Point | undefined {
  const caret = caretAt(root, e.clientX, e.clientY);
  const text = caret?.node;
  const at = text instanceof Text ? placer.placeOf(text) : undefined;
  if (text instanceof Text && at && caret) {
    let offset = caret.offset;
    if (offset > 0) {
      const box = rangeOver(text, offset - 1, offset).getBoundingClientRect();
      if (box.left <= e.clientX && e.clientX <= box.right) offset--;
    }
    offset = Math.max(0, Math.min(offset, text.length - 1));
    return { ...at, column: at.column + offset };
  }
  // No caret API reached the text: the cell's first placed text stands for the click.
  const cell = target?.closest(".hh-code");
  if (!cell) return undefined;
  const walker = root.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n instanceof Text ? placer.placeOf(n) : undefined;
    if (p) return p;
  }
  return undefined;
}
