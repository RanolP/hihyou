import { type AtomIndex, type NodeRef, type Target, treeOf } from "../atoms.js";
import { piecesIn } from "../highlight.js";
import { lineKey, type Placer } from "./placement.js";

/** The highlights the modal editor paints, lowest priority first. */
export const highlightNames = [
  "hh-viewed",
  "hh-selection",
  "hh-selection-primary",
] as const;
export type HighlightName = (typeof highlightNames)[number];

export const rangeOver = (text: Text, from: number, to: number) => {
  const r = text.ownerDocument.createRange();
  r.setStart(text, from);
  r.setEnd(text, to);
  return r;
};

/** Turns targets into Ranges over the drawn text, and keeps each highlight's share of this view's ranges. */
export function createPainter(doc: Document, placer: Placer) {
  const nodeRanges = (outline: AtomIndex, ref: NodeRef): Range[] => {
    const n = treeOf(outline, ref)?.nodes[ref.node];
    if (!n) return [];
    const at = (line: number) => placer.placed.get(lineKey({ ...ref, line }));
    return piecesIn(at, n.start, n.end).map((p) =>
      rangeOver(p.item, p.from, p.to),
    );
  };
  const targetRanges = (outline: AtomIndex, t: Target): Range[] => {
    if (t.kind === "node") return nodeRanges(outline, t);
    const prefix = `${t.file}:${t.kind === "hunk" ? `${t.fragment}:` : ""}`;
    const out: Range[] = [];
    for (const [key, list] of placer.placed)
      if (key.startsWith(prefix))
        for (const p of list) out.push(rangeOver(p.item, 0, p.length));
    return out;
  };
  /** Ranges this view added to each highlight, so several views on one page leave each other's alone. */
  const painted = new Map<HighlightName, Range[]>();
  const set = (name: HighlightName, ranges: Range[]) => {
    const win = doc.defaultView;
    const registry = win?.CSS?.highlights;
    if (!win || !registry || typeof win.Highlight !== "function") return;
    let h = registry.get(name);
    if (!h) {
      h = new win.Highlight();
      h.priority = highlightNames.indexOf(name);
      registry.set(name, h);
    }
    for (const r of painted.get(name) ?? []) h.delete(r);
    for (const r of ranges) h.add(r);
    painted.set(name, ranges);
  };
  return {
    nodeRanges,
    targetRanges,
    set,
    clear() {
      for (const name of highlightNames) set(name, []);
    },
  };
}
export type Painter = ReturnType<typeof createPainter>;
