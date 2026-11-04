import type { CollapseReason } from "@hihyou/engine";
import { createSignal, type JSX, onCleanup } from "solid-js";
import { type DiffFile, lineCounts, statusOf } from "../rows.js";
import { useDraw } from "./context.js";
import { FileTable } from "./table.jsx";
import { ViewedToggle } from "./viewed-toggle.jsx";
import { wholeFileStatus } from "../whole.js";

export const collapseReasons: Record<CollapseReason, string> = {
  generated: "Generated file",
  lockfile: "Lockfile",
  binary: "Binary file",
  submodule: "Submodule",
  "too-large": "Too large for a syntax diff",
  "parse-error": "Did not parse cleanly",
  "format-only": "Only formatting changed",
  moved: "Only moved code",
  deleted: "This file was deleted",
};

function FilePath(props: { path: string }): JSX.Element {
  const basenameAt = props.path.lastIndexOf("/") + 1;
  return (
    <>
      <span class="hh-path-directory">{props.path.slice(0, basenameAt)}</span>
      <span>{props.path.slice(basenameAt)}</span>
    </>
  );
}

function FileHeader(props: {
  index: number;
  file: DiffFile;
  collapsed: () => boolean;
}): JSX.Element {
  const ctx = useDraw();
  const { index, file } = props;
  const oldPath = file.change?.oldPath;
  const whole = wholeFileStatus(file);
  const status = whole ?? (file.change && statusOf(file.change));
  const counts = file.fragments.length > 0 ? lineCounts(file) : undefined;
  const [copied, setCopied] = createSignal(false);
  let copyReset: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copyReset));
  const measureHeight = (header: HTMLElement) => {
    const observer = new ResizeObserver(() => {
      header.parentElement?.style.setProperty(
        "--hh-file-header-height",
        `${header.getBoundingClientRect().height}px`,
      );
    });
    observer.observe(header);
    onCleanup(() => observer.disconnect());
  };
  const copyPath = () => {
    void navigator.clipboard.writeText(file.path).then(
      () => {
        setCopied(true);
        clearTimeout(copyReset);
        copyReset = setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <header
      ref={measureHeight}
      class="hh-file-header"
      classList={{ "hh-collapsed": props.collapsed() }}
      on:click={(event) => {
        if (props.collapsed() && !(event.target as Element).closest("button"))
          ctx.open(file.path);
      }}
    >
      <h2 class="hh-path">
        {oldPath !== undefined &&
          oldPath !== file.path && [
            <span class="hh-old-path">
              <FilePath path={oldPath} />
            </span>,
            " → ",
          ]}
        <FilePath path={file.path} />
      </h2>
      <button
        type="button"
        class="hh-button hh-copy-path"
        aria-label="Copy file path"
        title="Copy file path"
        on:click={copyPath}
      >
        {copied() ? "Copied" : "Copy"}
      </button>
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
      {props.collapsed() && file.collapsed && (
        <span class="hh-collapse-reason">
          {collapseReasons[file.collapsed.reason]}
        </span>
      )}
      {file.fallback === "parse-error" && (
        <span class="hh-collapse-reason">
          Did not parse cleanly — plain line diff
        </span>
      )}
      <ViewedToggle
        on={() => ctx.fileViewed(index, file)}
        set={(on) => ctx.setFileViewed(index, file, on)}
        id={`file\n${file.path}`}
        what={file.path}
      />
      {props.collapsed() && file.fragments.length > 0 && (
        <button
          type="button"
          class="hh-button hh-show-diff"
          on:click={() => ctx.open(file.path)}
        >
          Show diff
        </button>
      )}
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
  const collapsed = () => ctx.fileCollapsed(index, file);
  // The table first: its rows place their text in draw order, and the header places none.
  const table = <FileTable index={index} file={file} />;
  return (
    <section class="hh-file" data-path={file.path}>
      <FileHeader index={index} file={file} collapsed={collapsed} />
      {!collapsed() && (
        <div class="hh-scroll" data-path={file.path}>
          {table}
        </div>
      )}
    </section>
  );
}
