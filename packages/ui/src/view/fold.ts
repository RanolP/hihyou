type Kind = "removed" | "moved";

/**
 * A whole removed line, or a line of a move's removed side: the before gutter carries the removed bar or the moved
 * box, and nothing in the row is added. A row changed in place (`±`) is neither.
 */
const kindOf = (tr: Element): Kind | undefined => {
  if (tr.classList.contains("hh-merged")) return undefined;
  const [before, after] = tr.children;
  if (after?.classList.contains("hh-added") !== false) return undefined;
  if (before?.classList.contains("hh-removed")) return "removed";
  if (
    before?.classList.contains("hh-moved") &&
    tr.getAttribute("data-side") === "before"
  )
    return "moved";
  return undefined;
};

/** A row a comment or a review thread hangs under stays drawn, so the comment keeps its line. */
const annotated = (tr: Element) =>
  tr.nextElementSibling?.matches(".hh-comment-row, .hh-review-thread") === true;

interface Run {
  kind: Kind;
  rows: Element[];
}

/**
 * Folds each run of read removed lines to a thin rule in the removed colour, so code read through leaves only a
 * mark where it was. The rule is a button: a click, or Enter or Space on it, shows the run again, greyed as read
 * code is, and the run stays open until it is unread. A node selected inside a folded run opens it too, so keys
 * that walk the nodes never land on hidden text. Rows hide rather than leave, so every line keeps its number.
 */
export function createFolds(doc: Document) {
  /** Rows of runs the reader opened. */
  const opened = new Set<Element>();
  /** Each fold rule's row, by the first row of the run it stands for. */
  let rules = new Map<Element, HTMLTableRowElement>();
  let runOf = new WeakMap<Element, readonly Element[]>();

  const open = (rows: readonly Element[]) => {
    for (const tr of rows) opened.add(tr);
  };

  const rule = ({ kind, rows }: Run, old: HTMLTableRowElement | undefined) => {
    const first = rows[0]!;
    const row = old ?? doc.createElement("tr");
    let button = row.querySelector("button");
    if (!old) {
      row.className =
        kind === "moved" ? "hh-fold-rule hh-fold-rule-moved" : "hh-fold-rule";
      const td = doc.createElement("td");
      td.colSpan = [...first.children].reduce(
        (n, c) => n + ((c as HTMLTableCellElement).colSpan || 1),
        0,
      );
      button = doc.createElement("button");
      button.type = "button";
      button.className = "hh-fold-line";
      button.addEventListener("click", () => {
        reveal([first]);
        // The rule is gone, so the focus moves to the first line it showed.
        if (first instanceof HTMLElement) {
          first.tabIndex = -1;
          first.focus({ preventScroll: true });
        }
      });
      td.append(button);
      row.append(td);
    }
    const from = first.children[0]?.textContent ?? "";
    const to = rows.at(-1)!.children[0]?.textContent ?? "";
    const lines = from === to ? `line ${from}` : `lines ${from}–${to}`;
    const what = kind === "moved" ? "moved-away" : "deleted";
    const count = `${rows.length} ${what} ${rows.length === 1 ? "line" : "lines"}`;
    button!.title = `${count} (${lines}), read; click to show`;
    button!.setAttribute("aria-label", `${count}, ${lines}, folded. Show`);
    if (first.previousElementSibling !== row) first.before(row);
    return row;
  };

  /** Folds every run of read removed rows under `root`, after the rows' read state is painted. */
  const paint = (root: Element) => {
    for (const tr of opened)
      if (!tr.isConnected || !tr.classList.contains("hh-read"))
        opened.delete(tr);
    const runs: Run[] = [];
    let last: Element | undefined;
    for (const tr of root.querySelectorAll("tr.hh-read")) {
      const kind = kindOf(tr);
      if (!kind || annotated(tr)) {
        last = undefined;
        continue;
      }
      // A rule already standing before this row is not a break in the run.
      let before = tr.previousElementSibling;
      if (before?.classList.contains("hh-fold-rule"))
        before = before.previousElementSibling;
      const run = runs.at(-1);
      if (run && before === last && run.kind === kind) run.rows.push(tr);
      else runs.push({ kind, rows: [tr] });
      last = tr;
    }
    const kept = new Map<Element, HTMLTableRowElement>();
    runOf = new WeakMap();
    const folded = new Set<Element>();
    for (const run of runs) {
      const { rows } = run;
      for (const tr of rows) runOf.set(tr, rows);
      if (rows.some((tr) => opened.has(tr))) {
        open(rows);
        continue;
      }
      kept.set(rows[0]!, rule(run, rules.get(rows[0]!)));
      for (const tr of rows) folded.add(tr);
    }
    for (const [first, row] of rules) if (kept.get(first) !== row) row.remove();
    rules = kept;
    for (const tr of root.querySelectorAll("tr.hh-folded"))
      if (!folded.has(tr)) tr.classList.remove("hh-folded");
    for (const tr of folded) tr.classList.add("hh-folded");
  };

  /** Opens the folded runs `rows` sit in. */
  const reveal = (rows: Iterable<Element>) => {
    for (const tr of rows) {
      const run = runOf.get(tr);
      if (!run || opened.has(tr)) continue;
      open(run);
      rules.get(run[0]!)?.remove();
      rules.delete(run[0]!);
      for (const r of run) r.classList.remove("hh-folded");
    }
  };

  return { paint, reveal };
}
