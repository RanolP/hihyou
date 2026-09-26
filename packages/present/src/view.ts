import type { Edit, FileDiff, Position } from "@hihyou/engine";
import { diffArrays } from "diff";
import { type Alignment, align } from "./align.js";
import type { Formatter, Unformatted } from "./format.js";

export type HighlightKind = Edit["kind"];

/** Columns are 0-based UTF-16 offsets into `ViewLine.text`, end exclusive. */
export interface Highlight {
  kind: HighlightKind;
  from: number;
  to: number;
  /** Index into `FileDiff.edits`. */
  edit: number;
  /** For a move, the original line of the other side; set only on the line where the edit begins. */
  peerLine?: number;
  /** For a move to or from another file, that file's path; set with `peerLine`. */
  peerPath?: string;
}

export interface ViewLine {
  text: string;
  /** Line number in the file as committed, for GitHub line anchors; absent on lines the formatter added. */
  originalLine?: number;
  highlights: Highlight[];
}

/** `other-side-unformatted`: this side would format, but the other could not, and a formatted side against a raw one shows the formatter's rewrites as changes. */
export type SideStatus =
  | { formatted: true }
  | {
      formatted: false;
      reason: Unformatted | "other-side-unformatted";
      message?: string;
    };

export type SideView = { lines: ViewLine[] } & SideStatus;

/** Indices into the sides' `lines`. */
export type Row =
  | { old: number; new?: number; changed: boolean }
  | { old?: number; new: number; changed: boolean };

export interface FileView {
  old: SideView;
  new: SideView;
  /** One row per displayed line: unchanged lines once, changed lines as an old row and a new row. */
  unified: Row[];
  /** Changed old and new lines paired up side by side. */
  split: Row[];
}

/** Shows both sides of a text file re-formatted, with the file's edits mapped onto the formatted text. */
export async function presentFile(
  file: FileDiff,
  texts: { old: string; new: string },
  formatter: Formatter,
): Promise<FileView> {
  let [oldSide, newSide] = await Promise.all([
    side("base", file.oldPath ?? file.path, texts.old, formatter),
    side("head", file.path, texts.new, formatter),
  ]);
  if (oldSide.status.formatted !== newSide.status.formatted) {
    if (oldSide.status.formatted && oldSide.original !== "")
      oldSide = asOriginal(oldSide);
    if (newSide.status.formatted && newSide.original !== "")
      newSide = asOriginal(newSide);
  }
  const oldView = view(oldSide);
  const newView = view(newSide);
  // A side that lies in another file (`from`/`to`) is that file's to show.
  file.edits.forEach((edit, index) => {
    const across: { from?: string | undefined; to?: string | undefined } =
      edit.kind === "update" || edit.kind === "move" ? edit : {};
    if ("old" in edit && across.from === undefined)
      mark(oldView, oldSide, edit.old, {
        kind: edit.kind,
        edit: index,
        ...(edit.kind === "move" && {
          peerLine: edit.new.start.line,
          ...(across.to !== undefined && { peerPath: across.to }),
        }),
      });
    if ("new" in edit && across.to === undefined)
      mark(newView, newSide, edit.new, {
        kind: edit.kind,
        edit: index,
        ...(edit.kind === "move" && {
          peerLine: edit.old.start.line,
          ...(across.from !== undefined && { peerPath: across.from }),
        }),
      });
  });
  const unified = unifiedRows(oldView.lines, newView.lines);
  return { old: oldView, new: newView, unified, split: splitRows(unified) };
}

/**
 * A line cut into runs of one highlight kind each. Where highlights nest, the narrower one wins: an edit inside
 * a moved function shows as that edit, and a function moved into an inserted `export` shows as moved.
 * At equal width the move gives way to the edit on the same range.
 */
export function segments(
  line: ViewLine,
): { text: string; kind?: HighlightKind }[] {
  const kinds: (HighlightKind | undefined)[] = new Array(line.text.length);
  const ordered = line.highlights.toSorted(
    (p, q) =>
      q.to - q.from - (p.to - p.from) ||
      Number(q.kind === "move") - Number(p.kind === "move"),
  );
  for (const h of ordered) kinds.fill(h.kind, h.from, h.to);
  const out: { text: string; kind?: HighlightKind }[] = [];
  for (let i = 0; i < line.text.length; ) {
    const kind = kinds[i];
    let j = i + 1;
    while (j < line.text.length && kinds[j] === kind) j++;
    out.push({ text: line.text.slice(i, j), ...(kind && { kind }) });
    i = j;
  }
  return out;
}

interface Side {
  original: string;
  originalStarts: number[];
  text: string;
  starts: number[];
  alignment: Alignment;
  status: SideStatus;
}

const identity: Alignment = {
  range: (start, end) => [start, end],
  original: (start) => start,
};

async function side(
  revision: "base" | "head",
  path: string,
  original: string,
  formatter: Formatter,
): Promise<Side> {
  const make = (
    text: string,
    alignment: Alignment,
    status: Side["status"],
  ): Side => ({
    original,
    originalStarts: lineStarts(original),
    text,
    starts: lineStarts(text),
    alignment,
    status,
  });
  if (original === "") return make("", identity, { formatted: true });
  const result = await formatter.format(path, original, revision);
  const unformatted = (reason: Unformatted, message?: string) =>
    make(original, identity, {
      formatted: false,
      reason,
      ...(message !== undefined && { message }),
    });
  if (!result.ok) return unformatted(result.reason, result.message);
  const alignment = align(original, result.text);
  if (!alignment) return unformatted("unalignable");
  return make(result.text, alignment, { formatted: true });
}

function asOriginal(s: Side): Side {
  return {
    ...s,
    text: s.original,
    starts: s.originalStarts,
    alignment: identity,
    status: { formatted: false, reason: "other-side-unformatted" },
  };
}

function view(s: Side): SideView {
  if (s.text === "") return { lines: [], ...s.status };
  const originalLineAt = lineAt(s.originalStarts);
  const lines = s.starts.map((start, i): ViewLine => {
    const end = s.starts[i + 1] ?? s.text.length + 1;
    const text = s.text.slice(start, end - 1).replace(/\r$/, "");
    const line: ViewLine = { text, highlights: [] };
    if (!s.status.formatted) line.originalLine = i + 1;
    else if (/\S/.test(text)) {
      const at = s.alignment.original(start, end);
      if (at !== undefined) line.originalLine = originalLineAt(at);
    }
    return line;
  });
  // A trailing newline ends the last line rather than starting an empty one.
  if (s.text.endsWith("\n")) lines.pop();
  return { lines, ...s.status };
}

function mark(
  v: SideView,
  s: Side,
  range: { start: Position; end: Position },
  highlight: Omit<Highlight, "from" | "to">,
) {
  const offset = (p: Position) =>
    (s.originalStarts[p.line - 1] ?? s.original.length) + p.column - 1;
  const [from, to] = s.alignment.range(offset(range.start), offset(range.end));
  const at = lineAt(s.starts);
  const first = at(from) - 1;
  const last = Math.max(first, at(Math.max(from, to - 1)) - 1);
  for (let i = first; i <= last; i++) {
    const line = v.lines[i];
    if (!line) continue;
    const start = s.starts[i] ?? 0;
    const clipped = {
      from: Math.max(0, from - start),
      to: Math.min(line.text.length, to - start),
    };
    // A blank line inside a multi-line edit has nothing to highlight; a zero-width edit keeps its one point.
    if (clipped.from === clipped.to && (from !== to || i !== first)) continue;
    const { peerLine, ...rest } = highlight;
    line.highlights.push({
      ...rest,
      ...clipped,
      ...(i === first && peerLine !== undefined && { peerLine }),
    });
  }
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    starts.push(i + 1);
  return starts;
}

/** 1-based line containing an offset. */
function lineAt(starts: number[]): (offset: number) => number {
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? Infinity) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const squash = (line: string) => line.replace(/\s+/g, "");

function unifiedRows(oldLines: ViewLine[], newLines: ViewLine[]): Row[] {
  const changes = diffArrays(oldLines, newLines, {
    comparator: (a, b) => squash(a.text) === squash(b.text),
  });
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  for (const change of changes) {
    for (let k = 0; k < change.count; k++) {
      if (change.removed) rows.push({ old: i++, changed: true });
      else if (change.added) rows.push({ new: j++, changed: true });
      // An equal line that carries an edit (a move, typically) is shown on both sides so the edit is visible.
      else if (oldLines[i]?.highlights.length || newLines[j]?.highlights.length)
        rows.push({ old: i++, changed: true }, { new: j++, changed: true });
      else rows.push({ old: i++, new: j++, changed: false });
    }
  }
  return rows;
}

function splitRows(unified: Row[]): Row[] {
  const rows: Row[] = [];
  let olds: number[] = [];
  let news: number[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(olds.length, news.length); k++) {
      const [o, n] = [olds[k], news[k]];
      if (o !== undefined)
        rows.push({
          old: o,
          ...(n !== undefined && { new: n }),
          changed: true,
        });
      else if (n !== undefined) rows.push({ new: n, changed: true });
    }
    olds = [];
    news = [];
  };
  for (const row of unified) {
    if (!row.changed) {
      flush();
      rows.push(row);
    } else if (row.old !== undefined) olds.push(row.old);
    else if (row.new !== undefined) news.push(row.new);
  }
  flush();
  return rows;
}
