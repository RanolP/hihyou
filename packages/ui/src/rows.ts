import type {
  ChangedFileRef,
  CodeFragment,
  FileDiff,
  LinePair,
  Side,
  Span,
} from "@hihyou/engine";

/**
 * One file as the renderer takes it: the engine's `FileDiff`, plus the `ChangedFileRef` it came from when the
 * host has it, for the old path and the added/deleted status. Both are plain data, so a host posts this
 * across a webview boundary as is.
 */
export type DiffFile = FileDiff & { change?: ChangedFileRef };

export type SideName = "before" | "after";

export interface Cell {
  /** 1-based. */
  line: number;
  /** This line's spans, its newline dropped. */
  spans: Span[];
}

export type Row =
  | { kind: "unchanged"; before: Cell; after: Cell }
  | {
      kind: "diff";
      /** Index into `FileDiff.fragments`. */
      fragment: number;
      /** A side with fewer lines than the other leaves its cell empty. */
      before?: Cell;
      after?: Cell;
      /** Only on the fragment's first row, per side that is one half of a move. */
      move?: Partial<Record<SideName, Side["move"]>>;
    }
  | {
      kind: "elided";
      fragment: number;
      lines: LinePair;
      /** Unknown only for a run that reaches the end of the file. */
      count?: number;
    };

/** A stretch of rows inside the same chain of declarations, outermost label first. */
export interface Section {
  path: string[];
  rows: Row[];
}

/** Spans cut at each newline, so a span running over several lines shows on each, keeping its flags. */
export function splitLines(spans: readonly Span[]): Span[][] {
  const lines: Span[][] = [];
  let line: Span[] = [];
  let open = false;
  for (const span of spans) {
    const pieces = span.text.split("\n");
    pieces.forEach((text, i) => {
      if (i > 0) {
        lines.push(line);
        line = [];
        open = false;
      }
      if (text === "") return;
      line.push({ ...span, text });
      open = true;
    });
  }
  if (open) lines.push(line);
  return lines;
}

/** First line of a fragment on each side, for fragments that have one. */
function startOf(f: CodeFragment): LinePair | undefined {
  switch (f.kind) {
    case "unchanged":
    case "elided":
      return f.lines;
    case "diff":
      return { before: f.before.startLine, after: f.after.startLine };
    default:
      return undefined;
  }
}

/**
 * The file's fragments as table rows: one row per line, grouped by the declarations enclosing them.
 * A new section starts wherever a `begin` or an `end` changes that chain.
 */
export function buildSections(file: FileDiff): Section[] {
  const sections: Section[] = [];
  const path: string[] = [];
  let current: Section | undefined;
  const rows = () => {
    current ??= { path: [...path], rows: [] };
    return current.rows;
  };
  const close = () => {
    if (current && current.rows.length > 0) sections.push(current);
    current = undefined;
  };

  file.fragments.forEach((f, index) => {
    switch (f.kind) {
      case "begin":
        close();
        path.push(f.label);
        return;
      case "end":
        close();
        path.pop();
        return;
      case "unchanged":
        splitLines(f.spans).forEach((spans, i) =>
          rows().push({
            kind: "unchanged",
            before: { line: f.lines.before + i, spans },
            after: { line: f.lines.after + i, spans },
          }),
        );
        return;
      case "diff": {
        const before = splitLines(f.before.spans);
        const after = splitLines(f.after.spans);
        const move: Partial<Record<SideName, Side["move"]>> = {};
        if (f.before.move) move.before = f.before.move;
        if (f.after.move) move.after = f.after.move;
        for (let i = 0; i < Math.max(before.length, after.length); i++) {
          const b = before[i];
          const a = after[i];
          rows().push({
            kind: "diff",
            fragment: index,
            ...(b && { before: { line: f.before.startLine + i, spans: b } }),
            ...(a && { after: { line: f.after.startLine + i, spans: a } }),
            ...(i === 0 && (move.before || move.after) && { move }),
          });
        }
        return;
      }
      case "elided": {
        const next = file.fragments
          .slice(index + 1)
          .map(startOf)
          .find(Boolean);
        rows().push({
          kind: "elided",
          fragment: index,
          lines: f.lines,
          ...(next && { count: next.after - f.lines.after }),
        });
      }
    }
  });
  close();
  return sections;
}

export type FileStatus = "added" | "deleted" | "renamed" | "modified";

export function statusOf(change: ChangedFileRef): FileStatus {
  if (change.before === null) return "added";
  if (change.after === null) return "deleted";
  return change.oldPath !== undefined && change.oldPath !== change.path
    ? "renamed"
    : "modified";
}

/** Lines on the before side and on the after side of every `diff` fragment. */
export function lineCounts(file: FileDiff): { removed: number; added: number } {
  let removed = 0;
  let added = 0;
  for (const f of file.fragments) {
    if (f.kind !== "diff") continue;
    removed += splitLines(f.before.spans).length;
    added += splitLines(f.after.spans).length;
  }
  return { removed, added };
}
