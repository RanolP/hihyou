import type { DiffFile } from "../rows.js";

/** A file body's height before it draws, in rows: every line of both sides, plus a row per gap and scope. */
export function estimatedRows(file: DiffFile): number {
  const lines = (spans: readonly { text: string }[]) => {
    let n = 0;
    for (const s of spans)
      for (let at = s.text.indexOf("\n"); at >= 0; at = s.text.indexOf("\n", at + 1)) n++;
    return spans.length > 0 ? n + 1 : 0;
  };
  let rows = 0;
  for (const f of file.fragments) {
    if (f.kind === "diff") rows += lines(f.before.spans) + lines(f.after.spans);
    else if (f.kind === "unchanged") rows += lines(f.spans);
    else rows += 1;
  }
  return Math.max(1, rows);
}

/**
 * Draws each file's rows once its section nears the viewport, and the rest one by one in idle time, so a large
 * diffset shows its first screen without building every row first. A file once drawn stays drawn through every
 * redraw, so in the end every row is in the page for find-in-page to reach.
 */
export interface LazyFiles {
  /** Whether the file at `path` has been drawn in this view. */
  drawn(path: string): boolean;
  /** Draws `section`'s file through `draw` when it is reached; the returned function stops watching it. */
  watch(path: string, section: HTMLElement, draw: () => void): () => void;
  /** Draws the file at `path` now, for a jump or a scroll into it. */
  draw(path: string): void;
  /** Takes `section`'s current height as known, after the caller kept the page in place across its change. */
  settle(section: Element): void;
  /** The height the file at `path` last showed its body at, which a redraw's new body stands at off screen. */
  bodyHeight(path: string): number | undefined;
  /** A file's table drew after the list did: the highlights repaint once for every file drawn in this task. */
  drew(): void;
  dispose(): void;
}

export function createLazyFiles(
  win: Window | null,
  repaint: () => void,
): LazyFiles {
  const drawn = new Set<string>();
  const pathOf = new WeakMap<Element, string>();
  /** Each file's last section height, so a redraw's new section is measured against it rather than from nothing. */
  const sectionHeights = new Map<string, number>();
  const bodyHeights = new Map<string, number>();
  /** The sections waiting to draw, in document order. */
  const waiting = new Map<string, { section: HTMLElement; draw: () => void }>();
  const draw = (path: string) => {
    drawn.add(path);
    const entry = waiting.get(path);
    if (!entry) return;
    waiting.delete(path);
    near?.unobserve(entry.section);
    entry.draw();
  };
  const near =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries)
              if (e.isIntersecting) {
                const path = pathOf.get(e.target);
                if (path !== undefined) draw(path);
              }
          },
          { rootMargin: "200% 0px" },
        )
      : undefined;

  // The page turns off the browser's scroll anchoring, so a file growing above the viewport (drawn, or laid out at
  // its real height for the first time) would push what the reader looks at down; the scroll takes the growth.
  const heights = new WeakMap<Element, number>();
  const sized =
    win && typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          let dy = 0;
          // Entries come in document order, so the growth of the sections above is already in this one's bottom.
          let moved = 0;
          for (const e of entries) {
            const height = e.borderBoxSize[0]?.blockSize ?? e.contentRect.height;
            const before = heights.get(e.target);
            heights.set(e.target, height);
            const path = pathOf.get(e.target);
            if (path !== undefined) {
              sectionHeights.set(path, height);
              const body = e.target.querySelector(":scope > .hh-scroll");
              if (body)
                bodyHeights.set(path, body.getBoundingClientRect().height);
            }
            if (before === undefined || before === height) continue;
            const grew = height - before;
            if (e.target.getBoundingClientRect().bottom - moved - grew <= 0)
              dy += grew;
            moved += grew;
          }
          if (dy !== 0) win.scrollBy({ top: dy, behavior: "instant" });
        })
      : undefined;

  let queued = false;
  let disposed = false;
  /** Cancels the booked idle call, when there is one. */
  let idle: (() => void) | undefined;
  const schedule = () => {
    if (idle !== undefined || waiting.size === 0 || !win) return;
    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(drawIdle);
      idle = () => win.cancelIdleCallback(id);
    } else {
      const id = win.setTimeout(() => drawIdle(), 0);
      idle = () => win.clearTimeout(id);
    }
  };
  /** Draws waiting files while the idle period lasts, at least one per call, and books the next period. */
  const drawIdle = (deadline?: IdleDeadline) => {
    idle = undefined;
    const end = performance.now() + 8;
    do {
      const next = waiting.keys().next();
      if (next.done) break;
      draw(next.value);
    } while (deadline ? deadline.timeRemaining() > 0 : performance.now() < end);
    schedule();
  };

  return {
    drawn: (path) => drawn.has(path),
    watch(path, section, drawSection) {
      pathOf.set(section, path);
      const known = sectionHeights.get(path);
      if (known !== undefined) heights.set(section, known);
      sized?.observe(section);
      if (!drawn.has(path)) {
        waiting.set(path, { section, draw: drawSection });
        if (near) near.observe(section);
        else draw(path);
        schedule();
      }
      return () => {
        sized?.unobserve(section);
        near?.unobserve(section);
        if (waiting.get(path)?.section === section) waiting.delete(path);
      };
    },
    draw,
    settle(section) {
      heights.set(section, section.getBoundingClientRect().height);
    },
    bodyHeight: (path) => bodyHeights.get(path),
    drew() {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed) repaint();
      });
    },
    dispose() {
      disposed = true;
      near?.disconnect();
      sized?.disconnect();
      waiting.clear();
      idle?.();
    },
  };
}
