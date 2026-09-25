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
  foldReason,
  statusLetter,
  type ViewLoader,
} from "../review.js";

const colours: Record<HighlightKind, string> = {
  delete: "red",
  insert: "green",
  update: "yellow",
  move: "magenta",
};

export const hint =
  "j/k move  tab switch pane  n/p next/prev edit  s split/unified  f folded  q quit";

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

  const folded = doc.files.filter((f) => foldReason(f)).length;
  // Doc order is kept; folded files either disappear or stay in place, dimmed.
  const listed = doc.files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => showFolded || !foldReason(file));
  const current = listed[Math.min(selected, listed.length - 1)];
  const view =
    current && loaded?.index === current.index ? loaded.view : undefined;
  const displayRows = view ? (split ? view.split : view.unified) : [];
  const jumps = useMemo(
    () => (view ? editStarts(view, displayRows) : []),
    [view, displayRows],
  );

  const index = current?.index;
  const error = failed?.index === index ? failed?.message : undefined;
  useEffect(() => {
    if (index === undefined || foldReason(doc.files[index] as FileDiff)) return;
    let live = true;
    load(index).then(
      (v) => live && setLoaded({ index, view: v }),
      (e: unknown) =>
        live &&
        setFailed({
          index,
          message: e instanceof Error ? e.message : String(e),
        }),
    );
    return () => {
      live = false;
    };
  }, [doc, index, load]);

  const bodyHeight = Math.max(3, rows - 3);
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
            .slice(
              Math.max(0, selected - (bodyHeight - 3)),
              Math.max(0, selected - (bodyHeight - 3)) + bodyHeight - 3,
            )
            .map(({ file, index }) => {
              const reason = foldReason(file);
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
                    : `${file.diffMode} ${editCount(file)}`}
                </Text>
              );
            })}
          {!showFolded && folded > 0 && (
            <Text dimColor>{folded} folded (f to show)</Text>
          )}
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
          {error ? (
            <Text color="red">{error}</Text>
          ) : current && foldReason(current.file) ? (
            <Text dimColor>folded: {foldReason(current.file)}</Text>
          ) : !view ? (
            <Text dimColor>loading...</Text>
          ) : (
            displayRows.slice(top, top + diffHeight - 2).map((row, i) => (
              <RowLine
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
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
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <Text key={i} color="black" backgroundColor={colours[s.kind]}>
            {s.text}
          </Text>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
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
