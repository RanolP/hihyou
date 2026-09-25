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
  groupLabel,
  riskLabel,
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
  if (doc.groups.length > 0) {
    yield "";
    yield `${doc.groups.length} change${doc.groups.length === 1 ? "" : "s"} across files, riskiest first:`;
    for (const g of doc.groups)
      yield `  ${[groupLabel(g), riskLabel(g.risk)].filter(Boolean).join("  ")}`;
  }
  for (const [index, file] of doc.files.entries()) {
    yield "";
    if (file.fold) {
      yield `${fileHeader(file)} (folded: ${file.fold})`;
      continue;
    }
    if (file.error !== undefined) {
      yield `${fileHeader(file)} (error: ${file.error})`;
      continue;
    }
    let view: FileView;
    try {
      view = await load(index);
    } catch (error) {
      yield `${fileHeader(file)} (error: ${error instanceof Error ? error.message : String(error)})`;
      continue;
    }
    yield [fileHeader(file), unformattedNote(view)].filter(Boolean).join(" ");
    yield* hunks(view);
  }
}

export function fileHeader(file: FileDiff): string {
  const fallback = file.fallbackReason ? `: ${file.fallbackReason}` : "";
  const risk = riskLabel(file.risk);
  return `${statusLetter[file.status]} ${fileLabel(file)}  [${file.diffMode}${fallback}, ${editCount(file)}]${risk && ` ${risk}`}`;
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
    const line = newLine ?? oldLine;
    if (!line) continue;
    const sign = !row.changed ? " " : oldLine ? "-" : "+";
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
  const peer = line.highlights.find((h) => h.peerLine !== undefined);
  if (peer?.peerLine === undefined) return "";
  const at = `${peer.peerPath ? `${peer.peerPath}:` : ""}L${peer.peerLine}`;
  return side === "new" ? `  (moved from ${at})` : `  (moved to ${at})`;
}
