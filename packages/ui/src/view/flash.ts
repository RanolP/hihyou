import type { SideName } from "../rows.js";
import type { DiffLayout } from "./context.js";

/**
 * Blinks one outline around a jump's target: the moved box of `side` (its "Moved" label row included) when that
 * side is a move, else the target rows. One overlay, so the box blinks as a unit, not line by line.
 */
export function flash(
  rows: readonly HTMLTableRowElement[],
  side: SideName,
  moved: boolean,
  layout: DiffLayout,
): void {
  const scroll = rows[0]?.closest<HTMLElement>(".hh-scroll");
  if (!scroll) return;
  const columns = side === "before" ? [0, 1] : [2, 3];
  const boxes: Element[] = [];
  if (moved && layout === "unified") {
    const label = rows[0]?.previousElementSibling;
    if (label?.classList.contains("hh-move")) boxes.push(label);
    boxes.push(...rows);
  } else if (moved) {
    const label = rows[0]?.previousElementSibling;
    if (label?.classList.contains("hh-move"))
      boxes.push(label.children[side === "before" ? 0 : 1] ?? label);
    for (const r of rows)
      for (const c of columns) {
        const cell = r.children[c];
        if (cell && !cell.classList.contains("hh-empty")) boxes.push(cell);
      }
  } else boxes.push(...rows);
  const rects = boxes.map((b) => b.getBoundingClientRect());
  if (rects.length === 0) return;
  const origin = scroll.getBoundingClientRect();
  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const right = Math.max(...rects.map((r) => r.right));
  scroll.querySelector(".hh-flash-box")?.remove();
  const box = scroll.ownerDocument.createElement("div");
  box.className = `hh-flash-box${moved ? " hh-flash-moved" : ""}`;
  Object.assign(box.style, {
    top: `${top - origin.top + scroll.scrollTop}px`,
    left: `${left - origin.left + scroll.scrollLeft}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`,
  });
  box.addEventListener("animationend", () => box.remove(), { once: true });
  scroll.append(box);
}
