import type { FileDiff, ReviewDoc } from "@hihyou/engine";
import {
  type FileView,
  type HighlightKind,
  type Row,
  segments,
  type ViewLine,
} from "@hihyou/present";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useMemo, useState } from "react";
import { movePointer, unformattedNote } from "../plain.js";
import {
  editCount,
  fileLabel,
  groupLabel,
  groupsOf,
  riskLabel,
  statusLetter,
  type ViewLoader,
} from "../review.js";

interface Props {
  doc: ReviewDoc;
  load: ViewLoader;
  /** Overrides the terminal size, for tests where it is unknown. */
  size?: { columns: number; rows: number };
}

export function App({ doc, load, size }: Props) {
  const { exit } = useApp();
  const terminal = useWindowSize();
  const { columns, rows } = size ?? terminal;
  const [showFolded, setShowFolded] = useState(false);
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<"files" | "diff">("files");
  const [split, setSplit] = useState(false);
  const [top, setTop] = useState(0);
  const [loaded, setLoaded] = useState<{ index: number; view: FileView }>();
  const [failed, setFailed] = useState<{ index: number; message: string }>();

  const folded = doc.files.filter((f) => f.fold).length;
  // Doc order is kept; folded files either disappear or stay in place, dimmed.
  const listed = doc.files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => showFolded || !file.fold);
  const current = listed[Math.min(selected, listed.length - 1)];
  const view =
    current && loaded?.index === current.index ? loaded.view : undefined;
  const displayRows = view ? (split ? view.split : view.unified) : [];
  const jumps = useMemo(
    () => (view ? editStarts(view, displayRows) : []),
    [view, displayRows],
  );

  const shownFile = current?.file;
  const shownIndex = current?.index;
  const error =
    shownFile?.error ??
    (failed?.index === shownIndex ? failed?.message : undefined);
  useEffect(() => {
    if (
      !shownFile ||
      shownIndex === undefined ||
      shownFile.fold ||
      shownFile.error !== undefined
    )
      return;
    let live = true;
    load(shownIndex).then(
      (v) => live && setLoaded({ index: shownIndex, view: v }),
      (e: unknown) =>
        live &&
        setFailed({
          index: shownIndex,
          message: e instanceof Error ? e.message : String(e),
        }),
    );
    return () => {
      live = false;
    };
  }, [shownFile, shownIndex, load]);

  const bodyHeight = Math.max(3, rows - 3);
  const foldedRow = !showFolded && folded > 0;
  // Inside the border, less the "N folded" row; the window ends on the selected file once it scrolls.
  const listRows = Math.max(1, bodyHeight - 2 - (foldedRow ? 1 : 0));
  const firstListed = Math.max(0, selected - listRows + 1);
  const diffHeight = bodyHeight - 1;
  const scrollTo = (row: number) =>
    setTop(Math.max(0, Math.min(row, displayRows.length - 1)));

  useInput((input, key) => {
    if (input === "q") return exit();
    if (key.tab) return setFocus(focus === "files" ? "diff" : "files");
    if (input === "s") {
      setSplit(!split);
      setTop(0);
      return;
    }
    if (input === "f") {
      setShowFolded(!showFolded);
      setSelected(0);
      setTop(0);
      return;
    }
    if (input === "n") {
      const next = jumps.find((r) => r > top);
      if (next !== undefined) scrollTo(next);
      return;
    }
    if (input === "p") {
      const prev = jumps.findLast((r) => r < top);
      if (prev !== undefined) scrollTo(prev);
      return;
    }
    const step =
      input === "j" || key.downArrow
        ? 1
        : input === "k" || key.upArrow
          ? -1
          : 0;
    if (!step) return;
    if (focus === "diff") return scrollTo(top + step);
    setSelected(Math.max(0, Math.min(listed.length - 1, selected + step)));
    setTop(0);
  });

  const listWidth = Math.min(48, Math.floor(columns / 3));
  const diffWidth = columns - listWidth;
  return (
    <Box flexDirection="column">
      <Box height={bodyHeight}>
        <Box
          width={listWidth}
          flexDirection="column"
          borderStyle="single"
          borderColor={focus === "files" ? "cyan" : "gray"}
        >
          {listed
            .slice(firstListed, firstListed + listRows)
            .map(({ file, index }) => {
              const reason = file.fold;
              return (
                <Text
                  key={index}
                  wrap="truncate-start"
                  inverse={index === current?.index}
                  dimColor={!!reason}
                >
                  {statusLetter[file.status]} {fileLabel(file)}{" "}
                  {reason
                    ? `(${reason})`
                    : `${file.diffMode} ${editCount(file)}${file.risk.score ? ` r${file.risk.score}` : ""}`}
                </Text>
              );
            })}
          {foldedRow && <Text dimColor>{folded} folded (f to show)</Text>}
        </Box>
        <Box
          width={diffWidth}
          flexDirection="column"
          borderStyle="single"
          borderColor={focus === "diff" ? "cyan" : "gray"}
        >
          <Text wrap="truncate" bold>
            {current ? fileLabel(current.file) : "no files"}{" "}
            <Text dimColor>{view ? unformattedNote(view) : ""}</Text>
          </Text>
          <Text wrap="truncate" color="yellow">
            {current ? contextLine(doc, current.file) : ""}
          </Text>
          {error ? (
            <Text color="red">{error}</Text>
          ) : current?.file.fold ? (
            <Text dimColor>folded: {current.file.fold}</Text>
          ) : !view ? (
            <Text dimColor>loading...</Text>
          ) : (
            displayRows.slice(top, top + diffHeight - 3).map((row, i) => (
              <RowLine
                key={top + i}
                view={view}
                row={row}
                split={split}
                width={diffWidth - 2}
              />
            ))
          )}
        </Box>
      </Box>
      <Text dimColor wrap="truncate">
        {hint}
      </Text>
    </Box>
  );
}

function RowLine(props: {
  view: FileView;
  row: Row;
  split: boolean;
  width: number;
}) {
  const { view, row, split, width } = props;
  const oldLine = row.old === undefined ? undefined : view.old.lines[row.old];
  const newLine = row.new === undefined ? undefined : view.new.lines[row.new];
  if (split) {
    const half = Math.floor(width / 2);
    return (
      <Box>
        <Box width={half}>
          <Line line={oldLine} side="old" sign={row.changed ? "-" : " "} />
        </Box>
        <Box width={width - half}>
          <Line line={newLine} side="new" sign={row.changed ? "+" : " "} />
        </Box>
      </Box>
    );
  }
  const sign = !row.changed ? " " : oldLine ? "-" : "+";
  return (
    <Line
      line={newLine ?? oldLine}
      side={newLine ? "new" : "old"}
      sign={sign}
    />
  );
}

function Line(props: {
  line: ViewLine | undefined;
  side: "old" | "new";
  sign: string;
}) {
  const { line, side, sign } = props;
  if (!line) return <Text> </Text>;
  return (
    <Text wrap="truncate">
      <Text dimColor>
        {String(line.originalLine ?? "").padStart(5)} {sign}{" "}
      </Text>
      {segments(line).map((s, i) =>
        s.kind ? (
          <Text key={i} color="black" backgroundColor={colours[s.kind]}>
            {s.text}
          </Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
      <Text color="cyan">{movePointer(line, side)}</Text>
    </Text>
  );
}

/** The first displayed row of each edit, so n/p visit every edit once even when it spans both sides and many lines. */
function editStarts(view: FileView, rows: Row[]): number[] {
  const seen = new Set<number>();
  const starts: number[] = [];
  rows.forEach((row, i) => {
    const lines = [
      row.old === undefined ? undefined : view.old.lines[row.old],
      row.new === undefined ? undefined : view.new.lines[row.new],
    ];
    for (const line of lines)
      for (const h of line?.highlights ?? [])
        if (!seen.has(h.edit)) {
          seen.add(h.edit);
          if (starts.at(-1) !== i) starts.push(i);
        }
  });
  return starts;
}

/**
 * The changes across files the file's edits belong to, then why it ranks where it does; groups come first
 * since the list already shows the score, and a narrow pane truncates the end.
 */
function contextLine(doc: ReviewDoc, file: FileDiff): string {
  const parts = [
    ...groupsOf(doc, file).map((g) => `in: ${groupLabel(g)}`),
    riskLabel(file.risk),
  ].filter(Boolean);
  return parts.length ? parts.join("  ·  ") : " ";
}

const hint =
  "j/k move  tab switch pane  n/p next/prev edit  s split/unified  f folded  q quit";

const colours: Record<HighlightKind, string> = {
  delete: "red",
  insert: "green",
  update: "yellow",
  move: "magenta",
};
