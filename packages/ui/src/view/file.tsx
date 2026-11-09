import type { CollapseReason } from "@hihyou/engine";
import {
  createSignal,
  getOwner,
  type JSX,
  onCleanup,
  runWithOwner,
} from "solid-js";
import { type DiffFile, lineCounts, statusOf } from "../rows.js";
import { useDraw } from "./context.js";
import { estimatedRows } from "./lazy.js";
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
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      header.parentElement?.style.setProperty(
        "--hh-file-header-height",
        `${entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height}px`,
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
          ctx.setFileCollapsed(file.path, false);
      }}
    >
      <button
        ref={(b) => ctx.focusable(b, `fold\n${file.path}`)}
        type="button"
        class="hh-button hh-fold"
        aria-expanded={!props.collapsed()}
        aria-label={props.collapsed() ? "Expand file" : "Collapse file"}
        title={props.collapsed() ? "Expand file" : "Collapse file"}
        on:click={() => ctx.setFileCollapsed(file.path, !props.collapsed())}
      >
        <span aria-hidden="true">{props.collapsed() ? "▸" : "▾"}</span>
      </button>
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
    </header>
  );
}

/**
 * One file: its header, then its table in a scroller whose position survives a redraw. The table draws once the
 * file is reached (`DrawContext.lazy`) and open, and stays drawn while the file folds; until then a placeholder
 * as tall as its rows stands in.
 */
export function FileSection(props: {
  index: number;
  file: DiffFile;
}): JSX.Element {
  const ctx = useDraw();
  const { index, file } = props;
  const collapsed = () => ctx.fileCollapsed(index, file);
  const [reached, setReached] = createSignal(ctx.lazy.drawn(file.path));
  const rows = { "--hh-rows": String(estimatedRows(file)) };
  // Off screen a drawn body is skipped: a redraw's new body stands at the height the old one showed, not the estimate.
  const shown = ctx.lazy.bodyHeight(file.path);
  // Owned by the section, not by the branch that shows it, so folding the file keeps the table alive.
  const owner = getOwner();
  let table: JSX.Element | undefined;
  const drawTable = () => {
    if (table === undefined) {
      table = runWithOwner(owner, () => (
        <FileTable index={index} file={file} />
      ));
      ctx.lazy.drew();
    }
    return table;
  };
  return (
    <section
      ref={(section) =>
        onCleanup(ctx.lazy.watch(file.path, section, () => setReached(true)))
      }
      class="hh-file"
      data-path={file.path}
    >
      <FileHeader index={index} file={file} collapsed={collapsed} />
      {!collapsed() &&
        (reached() ? (
          <div
            class="hh-scroll"
            data-path={file.path}
            style={{
              ...rows,
              ...(shown !== undefined && {
                "contain-intrinsic-size": `auto ${shown}px`,
              }),
            }}
          >
            {drawTable()}
          </div>
        ) : (
          <div class="hh-placeholder" style={rows} />
        ))}
    </section>
  );
}
