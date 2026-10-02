/**
 * Blinks one outline around a jump's target rows, a move's "Moved" label row included when they are a move.
 * One overlay, so the box blinks as a unit, not line by line.
 */
export function flash(
  rows: readonly HTMLTableRowElement[],
  moved: boolean,
): void {
  const scroll = rows[0]?.closest<HTMLElement>(".hh-scroll");
  if (!scroll) return;
  const boxes: Element[] = [];
  if (moved) {
    const label = rows[0]?.previousElementSibling;
    if (label?.classList.contains("hh-move")) boxes.push(label);
  }
  boxes.push(...rows);
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
