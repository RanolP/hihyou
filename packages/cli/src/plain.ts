import type { FileDiff, ReviewDoc } from "@hihyou/engine";
import {
  type FileView,
  type HighlightKind,
  type SideView,
  segments,
  type ViewLine,
} from "@hihyou/present";
import {
  editCount,
  fileLabel,
  foldReason,
  statusLetter,
  type ViewLoader,
} from "./review.js";

/** Unchanged lines kept around each change, as in `diff -U3`. */
const context = 3;

const markers: Record<HighlightKind, [string, string]> = {
  delete: ["[-", "-]"],
  insert: ["{+", "+}"],
  update: ["[~", "~]"],
  move: ["[>", "<]"],
};

export const legend =
  "[-deleted-] {+inserted+} [~updated~] [>moved<]; line numbers are the committed file's";

/** Pipe-friendly text: the same formatted view as the TUI, with edits bracketed instead of coloured. */
export async function* renderPlain(
  doc: ReviewDoc,
  load: ViewLoader,
): AsyncGenerator<string> {
  const short = (id: string) => id.slice(0, 12);
  yield `diffset ${short(doc.diffset.base)}..${short(doc.diffset.head)}, ${doc.files.length} files`;
  yield legend;
  for (const [index, file] of doc.files.entries()) {
    yield "";
    const folded = foldReason(file);
    if (folded) {
      yield `${fileHeader(file)} (folded: ${folded})`;
      continue;
    }
    const view = await load(index);
    yield [fileHeader(file), unformattedNote(view)].filter(Boolean).join(" ");
    yield* hunks(view);
  }
}

export function fileHeader(file: FileDiff): string {
  const fallback = file.fallbackReason ? `: ${file.fallbackReason}` : "";
  return `${statusLetter[file.status]} ${fileLabel(file)}  [${file.diffMode}${fallback}, ${editCount(file)}]`;
}

/** Says which side is shown as committed rather than formatted, and why. */
export function unformattedNote(view: FileView): string {
  const reason = (side: SideView) =>
    side.formatted
      ? undefined
      : `${side.reason}${side.message ? `: ${side.message.split("\n")[0]}` : ""}`;
  const [o, n] = [reason(view.old), reason(view.new)];
  if (!o && !n) return "";
  if (o === n) return `(unformatted: ${o})`;
  return [o && `(old unformatted: ${o})`, n && `(new unformatted: ${n})`]
    .filter(Boolean)
    .join(" ");
}

function* hunks(view: FileView): Generator<string> {
  const rows = view.unified;
  const keep = rows.map(() => false);
  rows.forEach((row, i) => {
    if (!row.changed) return;
    for (
      let k = Math.max(0, i - context);
      k <= Math.min(rows.length - 1, i + context);
      k++
    )
      keep[k] = true;
  });
  let skipped = false;
  for (const [i, row] of rows.entries()) {
    if (!keep[i]) {
      skipped = true;
      continue;
    }
    if (skipped && i > 0) yield "  ...";
    skipped = false;
    const oldLine = row.old === undefined ? undefined : view.old.lines[row.old];
    const newLine = row.new === undefined ? undefined : view.new.lines[row.new];
    const sign = !row.changed ? " " : oldLine ? "-" : "+";
    const line = (newLine ?? oldLine) as ViewLine;
    yield `${gutter(oldLine)} ${gutter(newLine)} ${sign} ${renderLine(line, newLine ? "new" : "old")}`;
  }
}

function gutter(line: ViewLine | undefined): string {
  return String(line?.originalLine ?? "").padStart(5);
}

function renderLine(line: ViewLine, side: "old" | "new"): string {
  const text = segments(line)
    .map((s) => {
      if (!s.kind) return s.text;
      const [open, close] = markers[s.kind];
      return `${open}${s.text}${close}`;
    })
    .join("");
  return text + movePointer(line, side);
}

export function movePointer(line: ViewLine, side: "old" | "new"): string {
  const peer = line.highlights.find((h) => h.peerLine !== undefined)?.peerLine;
  if (peer === undefined) return "";
  return side === "new" ? `  (moved from L${peer})` : `  (moved to L${peer})`;
}
