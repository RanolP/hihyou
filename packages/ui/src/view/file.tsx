import type { JSX } from "solid-js";
import { type DiffFile, lineCounts, statusOf } from "../rows.js";
import { useDraw } from "./context.js";
import { FileTable } from "./table.jsx";
import { ViewedToggle } from "./viewed-toggle.jsx";
import { wholeFileStatus } from "../whole.js";

function FileHeader(props: { index: number; file: DiffFile }): JSX.Element {
  const ctx = useDraw();
  const { index, file } = props;
  const oldPath = file.change?.oldPath;
  const whole = wholeFileStatus(file);
  const status = whole ?? (file.change && statusOf(file.change));
  const counts = file.fragments.length > 0 ? lineCounts(file) : undefined;
  return (
    <header class="hh-file-header">
      <h2 class="hh-path">
        {oldPath !== undefined &&
          oldPath !== file.path && [
            <span class="hh-old-path">{oldPath}</span>,
            " → ",
          ]}
        <span>{file.path}</span>
      </h2>
      {status && (
        <span class={`hh-status hh-status-${status}`}>
          {whole ? `${whole} file` : status}
        </span>
      )}
      {counts && (
        <span
          class="hh-counts"
          aria-label={`${counts.added} lines added, ${counts.removed} lines removed`}
        >
          <span class="hh-count-added">{`+${counts.added}`}</span>{" "}
          <span class="hh-count-removed">{`−${counts.removed}`}</span>
        </span>
      )}
      <ViewedToggle
        on={() => ctx.fileViewed(index, file)}
        set={(on) => ctx.setFileViewed(index, file, on)}
        id={`file\n${file.path}`}
        what={file.path}
      />
    </header>
  );
}

/** One file: its header, then its table in a scroller whose position survives a redraw. */
export function FileSection(props: {
  index: number;
  file: DiffFile;
}): JSX.Element {
  const ctx = useDraw();
  const { index, file } = props;
  // The table first: its rows place their text in draw order, and the header places none.
  const table = <FileTable index={index} file={file} />;
  return (
    <section
      class="hh-file"
      classList={{ "hh-file-viewed": ctx.fileViewed(index, file) }}
    >
      <FileHeader index={index} file={file} />
      <div class="hh-scroll" data-path={file.path}>
        {table}
      </div>
    </section>
  );
}
