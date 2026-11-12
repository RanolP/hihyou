import type {
  ChangedFileRef,
  CodeFragment,
  FileDiff,
  LinePair,
  Side,
  SideMove,
  Span,
} from "@hihyou/engine";

/**
 * One file as the renderer takes it: the engine's `FileDiff`, plus the `ChangedFileRef` it came from when the
 * host has it, for the old path and the added/deleted status. Both are plain data, so a host posts this
 * across a webview boundary as is.
 */
export type DiffFile = FileDiff & {
  change?: ChangedFileRef;
  /** Existing GitHub review threads placed on lines from the original sources. */
  reviewThreads?: ReviewThread[];
  /** Lines revealed out of the `elided` fragment at each index, so the rest of that run stays a gap. */
  revealed?: Record<number, Revealed>;
};

export interface ReviewComment {
  author: string;
  avatarUrl?: string;
  /** ISO 8601, as the host reports when the comment was created. */
  createdAt?: string;
  /** Plain text, without Markdown rendering. */
  body: string;
  /** GitHub-rendered HTML, when the host requested that media type. */
  bodyHtml?: string;
}

export interface ReviewThread {
  /** Original source line on each side of the GitHub diff row. */
  before?: number;
  after?: number;
  /** Absent when the host cannot observe resolution state. */
  resolved?: boolean;
  comments: ReviewComment[];
}

export type Unchanged = CodeFragment & { kind: "unchanged" };

export interface Revealed {
  /** Revealed below the code above the gap, in line order. */
  top: Unchanged[];
  /** Revealed above the code below the gap, in line order. */
  bottom: Unchanged[];
  /** A run to the end of the file has nothing left to reveal. */
  exhausted?: boolean;
}

/** What is still hidden of the `elided` fragment at `fragment`. */
export interface Gap {
  fragment: number;
  /** The fragment's own first lines, which name it across a round trip. */
  origin: LinePair;
  /** First line still hidden. */
  lines: LinePair;
  /** Lines still hidden; unknown only for a run to the end of the file. */
  count?: number;
  /** Hidden lines counted in the original text, which is what the line numbers show. */
  sourceCount?: number;
  revealed: boolean;
  /** Nothing comes before the run, so it can only grow up from the code below it. */
  atStart: boolean;
  /** The run reaches the end of the file, so it can only grow down from the code above it. */
  atEnd: boolean;
  /** Git's default function context nearest the next shown after-side line. */
  scope?: string;
}

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
      /** Per side, the move whose first line is on this row. */
      move?: Partial<Record<SideName, SideMove>>;
      /** Per side whose line on this row lies inside a move; `last` closes the moved block. */
      moved?: Partial<Record<SideName, { last: boolean }>>;
    }
  | ({ kind: "elided" } & Gap);

/** A stretch of rows inside the same chain of declarations, outermost label first. */
export interface Section {
  path: string[];
  rows: Row[];
  /** Whether the section opens with a header naming `path`; see `buildSections` for when it does. */
  heading: boolean;
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

export const lineCount = (f: Unchanged) => splitLines(f.spans).length;

interface MovedRun {
  first: number;
  last: number;
  move: SideMove;
}

/** A move's visible runs, excluding lines made entirely from an insert or delete inside it. */
function movedRuns(side: Side, lines: readonly Span[][]): MovedRun[] {
  const out: MovedRun[] = [];
  const whollyChanged = (spans: readonly Span[]) => {
    const content = spans.filter((span) => span.text.trim() !== "");
    return content.length > 0 && content.every((span) => span.changed);
  };
  for (const move of side.moves ?? []) {
    let first: number | undefined;
    const close = (last: number) => {
      if (first === undefined) return;
      out.push({ first, last, move });
      first = undefined;
    };
    for (let line = move.first; line <= move.last; line++) {
      const spans = lines[line - side.startLine];
      if (spans && !whollyChanged(spans)) first ??= line;
      else close(line - 1);
    }
    close(move.last);
  }
  return out;
}

/** The part of the `elided` fragment at `index` that `file.revealed` has not shown yet. */
export function gapOf(file: DiffFile, index: number): Gap | undefined {
  const f = file.fragments[index];
  if (f?.kind !== "elided") return undefined;
  const next = file.fragments
    .slice(index + 1)
    .map(startOf)
    .find(Boolean);
  const r = file.revealed?.[index];
  const top = (r?.top ?? []).reduce((n, u) => n + lineCount(u), 0);
  const bottom = (r?.bottom ?? []).reduce((n, u) => n + lineCount(u), 0);
  const count = next
    ? next.after - f.lines.after - top - bottom
    : r?.exhausted
      ? 0
      : undefined;
  const sourceLines = file.sourceLines?.after;
  const firstSourceLine = sourceLines?.[f.lines.after + top - 1];
  const nextSourceLine =
    count === undefined
      ? undefined
      : sourceLines?.[f.lines.after + top + count - 1];
  const sourceCount =
    count === undefined
      ? undefined
      : firstSourceLine && nextSourceLine
        ? Math.max(0, nextSourceLine - firstSourceLine)
        : count;
  const funcnames = f.funcnames;
  const last =
    count === undefined ? undefined : f.lines.after + top + count - 1;
  const scope =
    last === undefined
      ? undefined
      : funcnames?.findLast(
          (candidate) => candidate.line <= last,
        )?.text;
  return {
    fragment: index,
    origin: f.lines,
    lines: { before: f.lines.before + top, after: f.lines.after + top },
    ...(count !== undefined && { count: Math.max(0, count) }),
    ...(sourceCount !== undefined && { sourceCount }),
    revealed: r !== undefined && (top > 0 || bottom > 0),
    atStart: f.lines.before === 1 && f.lines.after === 1,
    atEnd: next === undefined,
    ...(scope && { scope }),
  };
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

/** A gap row that still hides lines; one fully revealed leaves the code on both sides of it continuous. */
const hides = (row: Row) => row.kind === "elided" && row.count !== 0;

/**
 * The file's fragments as table rows: one row per line, grouped by the declarations enclosing them.
 * A new section starts wherever a `begin` or an `end` changes that chain, and after a gap that still hides lines.
 *
 * A header only says what the reader cannot already see, since one on every hunk is noise. A declaration is out
 * of sight once a hidden gap separates its first line from the code being read: a gap hides every declaration
 * open across it, and a `begin` right after a gap had its first line inside it. A section opens with a header
 * when a top-level header above would otherwise stay stuck over declaration context. Otherwise, it opens with
 * one only when a change inside its declarations comes before the next hidden gap (context and hidden lines alone
 * get none), and either a declaration on its path is out of sight and the header above does not already name it,
 * or the header above names a declaration this section is not in. A header stays stuck for the rest of the table,
 * so one shown goes stale only until the next one replaces it.
 */
export function buildSections(file: DiffFile): Section[] {
  const sections: Section[] = [];
  const path: string[] = [];
  // Per entry of `path`: its declaration's first line is out of sight.
  const hidden: boolean[] = [];
  const unseen = new Map<Section, boolean[]>();
  let current: Section | undefined;
  let afterGap = false;
  const rows = () => {
    if (afterGap) close();
    afterGap = false;
    if (!current) {
      current = { path: [...path], rows: [], heading: false };
      unseen.set(current, [...hidden]);
    }
    return current.rows;
  };
  const unchangedRows = (f: Unchanged) =>
    splitLines(f.spans).forEach((spans, i) =>
      rows().push({
        kind: "unchanged",
        before: { line: f.lines.before + i, spans },
        after: { line: f.lines.after + i, spans },
      }),
    );
  const close = () => {
    if (current && current.rows.length > 0) sections.push(current);
    current = undefined;
  };

  file.fragments.forEach((f, index) => {
    switch (f.kind) {
      case "begin": {
        close();
        let j = index - 1;
        while (j >= 0 && /^(begin|end)$/.test(file.fragments[j]?.kind ?? ""))
          j--;
        const gap = gapOf(file, j);
        path.push(f.label);
        hidden.push(gap !== undefined && gap.count !== 0);
        return;
      }
      case "end":
        close();
        path.pop();
        hidden.pop();
        return;
      case "unchanged":
        unchangedRows(f);
        return;
      case "diff": {
        const before = splitLines(f.before.spans);
        const after = splitLines(f.after.spans);
        const moves = {
          before: movedRuns(f.before, before),
          after: movedRuns(f.after, after),
        };
        for (let i = 0; i < Math.max(before.length, after.length); i++) {
          const b = before[i];
          const a = after[i];
          const move: Partial<Record<SideName, SideMove>> = {};
          const moved: Partial<Record<SideName, { last: boolean }>> = {};
          for (const side of ["before", "after"] as const) {
            if (!(side === "before" ? b : a)) continue;
            const line = f[side].startLine + i;
            const run = moves[side].find(
              (candidate) => candidate.first <= line && line <= candidate.last,
            );
            if (!run) continue;
            if (run.first === line) move[side] = run.move;
            moved[side] = { last: line === run.last };
          }
          rows().push({
            kind: "diff",
            fragment: index,
            ...(b && { before: { line: f.before.startLine + i, spans: b } }),
            ...(a && { after: { line: f.after.startLine + i, spans: a } }),
            ...((move.before || move.after) && { move }),
            ...((moved.before || moved.after) && { moved }),
          });
        }
        return;
      }
      case "elided": {
        const gap = gapOf(file, index);
        const r = file.revealed?.[index];
        for (const u of r?.top ?? []) unchangedRows(u);
        if (gap) {
          const row: Row = { kind: "elided", ...gap };
          rows().push(row);
          if (hides(row)) {
            hidden.fill(true);
            afterGap = true;
          }
        }
        for (const u of r?.bottom ?? []) unchangedRows(u);
      }
    }
  });
  close();

  // The header stuck at the top while reading a section: the last one shown above it.
  let stuck: string[] | undefined;
  // Per section: a change inside its declarations comes before the next hidden gap.
  const changes: boolean[] = [];
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    const next = sections[i + 1];
    if (!section) continue;
    const first = section.rows.find((r) => r.kind === "diff" || hides(r));
    changes[i] = first
      ? first.kind === "diff"
      : next !== undefined &&
        section.path.every((label, j) => next.path[j] === label) &&
        (changes[i + 1] ?? false);
  }
  sections.forEach((section, i) => {
    const { path } = section;
    const topLevelStale =
      stuck !== undefined && stuck.length === 0 && path.length > 0;
    if (!changes[i] && !topLevelStale) return;
    const stale =
      topLevelStale || (stuck?.some((label, j) => path[j] !== label) ?? false);
    const deepest = (unseen.get(section) ?? []).lastIndexOf(true);
    if (stale || (stuck?.length ?? 0) <= deepest) {
      section.heading = true;
      stuck = path;
    }
  });
  return sections;
}

/**
 * A span of a merged unified line; a changed span says which side it came from. A `kept` one is unchanged text
 * drawn inside a side's changed run, once per side (`coalesce`).
 */
export type MergedSpan = Span & { side?: SideName; kept?: true };

/**
 * A row of the unified layout. A `diff` fragment (or else a pair of its lines) whose two sides read the same
 * outside their changed nodes is a run of `merged` lines; any other `diff` line stands on its own as a `line`
 * of one side.
 */
export type UnifiedRow =
  | Extract<Row, { kind: "unchanged" | "elided" }>
  | {
      kind: "merged";
      fragment: number;
      /** The before line whose first character lands on this row, if one does. */
      before?: number;
      /** Absent on a before line deleted whole, which keeps a row of its own. */
      after?: number;
      spans: MergedSpan[];
    }
  | {
      kind: "line";
      fragment: number;
      side: SideName;
      cell: Cell;
      /** On the first line of a move. */
      move?: SideMove;
      moved?: { last: boolean };
    };

type MergedRow = Extract<UnifiedRow, { kind: "merged" }>;

const blank = (text: string) => text.trim() === "";
/** Whether at least half of the lines' text, whitespace aside, is unchanged. */
const mostlyKept = (
  lines: readonly { spans: readonly MergedSpan[] }[],
): boolean => {
  let kept = 0;
  let all = 0;
  for (const span of lines.flatMap((c) => c.spans)) {
    // A `kept` copy counts once, as the unchanged text it is.
    if (span.kept && span.side === "before") continue;
    const length = span.text.replace(/\s+/g, "").length;
    all += length;
    if (!span.changed || span.kept) kept += length;
  }
  return kept * 2 >= all;
};
/** A line of a Markdown code block, fenced or indented. */
const codeLine = (row: MergedRow): boolean =>
  row.spans.some((s) =>
    /\bmarkup\.(?:fenced_code|raw\.block)/.test(s.scope ?? ""),
  );

const skeleton = (lines: readonly Cell[]) =>
  lines
    .flatMap((c) => c.spans)
    .filter((s) => !s.changed)
    .map((s) => s.text.replace(/\s+/g, ""))
    .join("");

/**
 * The engine marks every difference inside a `diff` fragment as a `changed` span, so two sides whose other text
 * is the same once whitespace is dropped (the skeleton) differ only by those spans and by how that text is laid
 * out, as in a reflow. They merge onto the after side's lines: each before run goes in at its offset into the
 * skeleton, ahead of an after run at the same offset. A before run that opens its line stays ahead of the text
 * after it, any other stays behind the text before it, so a deletion keeps its neighbour across a reflow. A
 * before line of nothing but changed text keeps a row of its own. Sides sharing no skeleton stay apart.
 *
 * Each row carries its after line, and the before line whose first character lands on it.
 */
export function mergeLines(
  fragment: number,
  before: readonly Cell[],
  after: readonly Cell[],
): MergedRow[] | undefined {
  const shared = skeleton(after);
  if (shared === "" || shared !== skeleton(before)) return undefined;

  type Run = { span: Span; opens: boolean; line?: number };
  const runs = new Map<number, Run[]>();
  const whole = new Map<number, Cell[]>();
  // Skeleton offset -> the before line that skeleton character opens.
  const opens = new Map<number, number>();
  let offset = 0;
  for (const cell of before) {
    if (cell.spans.every((s) => s.changed || blank(s.text))) {
      if (cell.spans.some((s) => !blank(s.text)))
        whole.set(offset, [...(whole.get(offset) ?? []), cell]);
      continue;
    }
    let first = true;
    for (const span of cell.spans) {
      if (span.changed) {
        const list = runs.get(offset) ?? [];
        const opening = first && !blank(span.text);
        list.push({ span, opens: first, ...(opening && { line: cell.line }) });
        runs.set(offset, list);
        if (opening) first = false;
        continue;
      }
      for (const ch of span.text) {
        if (/\s/.test(ch)) continue;
        if (first) opens.set(offset, cell.line);
        first = false;
        offset++;
      }
    }
  }

  const rows: MergedRow[] = [];
  const wholeRows = (upTo: number) => {
    for (const [at, cells] of whole) {
      if (at > upTo) continue;
      for (const cell of cells)
        rows.push({
          kind: "merged",
          fragment,
          before: cell.line,
          spans: cell.spans.map((s) =>
            s.changed ? { ...s, side: "before" } : s,
          ),
        });
      whole.delete(at);
    }
  };
  let row: MergedRow | undefined;
  // `trailing` puts out only the runs that close a before line, keeping the ones that open the next.
  const deleted = (trailing: boolean) => {
    const list = runs.get(offset);
    if (!list || !row) return;
    const keep = trailing ? list.filter((r) => r.opens) : [];
    for (const r of list) {
      if (keep.includes(r)) continue;
      row.spans.push({ ...r.span, side: "before" });
      if (r.line !== undefined) row.before ??= r.line;
    }
    if (keep.length > 0) runs.set(offset, keep);
    else runs.delete(offset);
  };
  wholeRows(0);
  offset = 0;
  for (const cell of after) {
    row = { kind: "merged", fragment, after: cell.line, spans: [] };
    rows.push(row);
    for (const span of cell.spans) {
      if (span.changed) {
        deleted(false);
        row.spans.push({ ...span, side: "after" });
        continue;
      }
      let text = "";
      for (const ch of span.text) {
        if (!/\s/.test(ch)) {
          if (runs.has(offset)) {
            if (text !== "") row.spans.push({ ...span, text });
            text = "";
            deleted(false);
          }
          const line = opens.get(offset);
          if (line !== undefined) row.before ??= line;
          offset++;
        }
        text += ch;
      }
      if (text !== "") row.spans.push({ ...span, text });
    }
    deleted(true);
    wholeRows(offset);
  }
  deleted(false);
  wholeRows(Infinity);
  for (const r of rows) r.spans = coalesce(r.spans);
  return rows;
}

/** Unchanged text that reads as part of the changes around it: at most two characters, none a letter, digit or `_`. */
const separator = (text: string) =>
  text.length > 0 &&
  text.length <= 2 &&
  // A table's `|` closes a cell; a run drawn across it would leave a cell with no pipe.
  !/[\p{L}\p{N}_|]/u.test(text);

/**
 * Two changed runs a separator apart, an added run before it and a removed run after it, weave the sides together:
 * `1.111` -> `15.250` drawn run by run is `[-1][+15].[-111][+250]`, read as `115.111250`. Such runs coalesce into
 * one change, every removed span (with the separator) ahead of every added span (with the separator again), each
 * copy of the separator `kept`. A wider gap, or runs that do not weave, stay as they are.
 */
function coalesce(spans: MergedSpan[]): MergedSpan[] {
  const out: MergedSpan[] = [];
  // The changed run being read, as drawn; the sides' spans apart once a separator joins another run to it.
  let run: MergedSpan[] = [];
  let removed: MergedSpan[] = [];
  let added: MergedSpan[] = [];
  let joined = false;
  const flush = () => {
    out.push(...(joined ? [...removed, ...added] : run));
    run = [];
    removed = [];
    added = [];
    joined = false;
  };
  for (let i = 0; i < spans.length; ) {
    const span = spans[i] as MergedSpan;
    if (span.side !== undefined) {
      run.push(span);
      (span.side === "before" ? removed : added).push(span);
      i++;
      continue;
    }
    let end = i;
    while (end < spans.length && spans[end]?.side === undefined) end++;
    const gap = spans.slice(i, end);
    const next = spans[end];
    if (
      added.length > 0 &&
      next?.side === "before" &&
      separator(gap.map((s) => s.text).join(""))
    ) {
      joined = true;
      for (const s of gap) {
        removed.push({ ...s, changed: true, side: "before", kept: true });
        added.push({ ...s, changed: true, side: "after", kept: true });
      }
    } else {
      flush();
      out.push(...gap);
    }
    i = end;
  }
  flush();
  return out;
}

/**
 * A section's rows in the unified layout. A fragment merges whole when it can, else each line with the one
 * across from it; lines that do not merge are kept in runs, the before side's lines ahead of the after side's.
 * A moved line never merges, so a move stays one box; a fragment holding one merges only line by line.
 * In `prose` (Markdown), sides that are both mostly rewritten stay apart as - and + lines too: woven word by word
 * they read as neither sentence.
 */
export function unifiedRows(rows: readonly Row[], prose = false): UnifiedRow[] {
  const alike = (before: readonly Cell[], after: readonly Cell[]) =>
    !prose || mostlyKept(before) || mostlyKept(after);
  // A code block's lines are records (a command's output, statements), not reflowable prose: one woven with
  // another line's removed words reads as neither, so each code line of a merge must itself be mostly kept.
  const readable = (merged: MergedRow[] | undefined) =>
    merged !== undefined &&
    (!prose || merged.every((r) => !codeLine(r) || mostlyKept([r])))
      ? merged
      : undefined;
  const out: UnifiedRow[] = [];
  let removed: UnifiedRow[] = [];
  let added: UnifiedRow[] = [];
  const flush = () => {
    out.push(...removed, ...added);
    removed = [];
    added = [];
  };
  let fragment: number | undefined;
  let wholeMerged = false;
  for (const row of rows) {
    if (row.kind !== "diff") {
      flush();
      fragment = undefined;
      out.push(row);
      continue;
    }
    if (row.fragment !== fragment) {
      flush();
      fragment = row.fragment;
      const own = rows.filter(
        (r): r is Row & { kind: "diff" } =>
          r.kind === "diff" && r.fragment === fragment,
      );
      const moving = own.some((r) => r.moved !== undefined);
      const cells = (side: SideName) => own.flatMap((r) => r[side] ?? []);
      const whole =
        moving || !alike(cells("before"), cells("after"))
        ? undefined
        : readable(mergeLines(row.fragment, cells("before"), cells("after")));
      if (whole) out.push(...whole);
      wholeMerged = whole !== undefined;
    }
    if (wholeMerged) continue;
    const merged =
      row.before &&
      row.after &&
      row.moved === undefined &&
      alike([row.before], [row.after])
        ? readable(mergeLines(row.fragment, [row.before], [row.after]))
        : undefined;
    if (merged) {
      flush();
      out.push(...merged);
      continue;
    }
    for (const side of ["before", "after"] as const) {
      const cell = row[side];
      if (!cell) continue;
      const move = row.move?.[side];
      const moved = row.moved?.[side];
      (side === "before" ? removed : added).push({
        kind: "line",
        fragment: row.fragment,
        side,
        cell,
        ...(move && { move }),
        ...(moved && { moved }),
      });
    }
  }
  flush();
  return out;
}

export type FileStatus = "added" | "deleted" | "renamed" | "modified";

export function statusOf(change: ChangedFileRef): FileStatus {
  if (change.before === null) return "added";
  if (change.after === null) return "deleted";
  return change.oldPath !== undefined && change.oldPath !== change.path
    ? "renamed"
    : "modified";
}

/** Lines added and removed in the original texts, or in the rendered fragments when unavailable. */
export function lineCounts(file: FileDiff): { removed: number; added: number } {
  if (file.stats) return file.stats;
  let removed = 0;
  let added = 0;
  for (const f of file.fragments) {
    if (f.kind !== "diff") continue;
    removed += splitLines(f.before.spans).length;
    added += splitLines(f.after.spans).length;
  }
  return { removed, added };
}

export function shownLine(
  file: FileDiff,
  side: "before" | "after",
  line: number,
): number | undefined {
  const table = file.sourceLines?.[side];
  if (!table) return line;
  const shown = table[line - 1] || undefined;
  return shown !== undefined && table[line - 2] === shown ? undefined : shown;
}
