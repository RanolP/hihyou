import {
  createSignal,
  type JSX,
  onCleanup,
  onMount,
} from "solid-js";
import type { Point } from "../modal.js";
import {
  type MergedSpan,
  type ReviewThread,
  shownLine,
  type SideName,
  type UnifiedRow,
} from "../rows.js";
import { blockCells, type TableDraw } from "./block.js";
import type { DrawContext } from "./context.js";
import { ElidedRow } from "./elided.jsx";
import { MoveLabel } from "./pair.jsx";
import { SpanNodes, whollyChanged } from "./spans.jsx";

const signs: Record<SideName, string> = { before: "-", after: "+" };
const tabSize = 4;
const maxWrappedIndent = 40;

const codeStyle = (spans: readonly MergedSpan[]) => {
  let column = 0;
  for (const span of spans) {
    for (const character of span.text) {
      if (character === " ") column++;
      else if (character === "\t") column += tabSize - (column % tabSize);
      else return `--hh-indent: ${Math.min(column, maxWrappedIndent)}`;
    }
  }
  return `--hh-indent: ${Math.min(column, maxWrappedIndent)}`;
};

const unsafeCommentElements =
  "script, style, link, meta, base, iframe, object, embed, form";

function sanitizedCommentNodes(html: string, owner: Document): Node[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll(unsafeCommentElements).forEach((element) =>
    element.remove(),
  );
  for (const element of parsed.body.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      const compactValue = Array.from(attribute.value)
        .filter((character) => character.charCodeAt(0) > 0x20)
        .join("");
      if (
        attribute.name.toLowerCase().startsWith("on") ||
        /^javascript:/i.test(compactValue)
      )
        element.removeAttribute(attribute.name);
    }
    if (element instanceof HTMLAnchorElement) {
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
  }
  return [...parsed.body.childNodes].map((node) => owner.adoptNode(node));
}

function ReviewCommentBody(props: {
  body: string;
  bodyHtml: string | undefined;
}): JSX.Element {
  const [long, setLong] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  let body!: HTMLDivElement;

  onMount(() => {
    if (props.bodyHtml !== undefined)
      body.replaceChildren(
        ...sanitizedCommentNodes(props.bodyHtml, body.ownerDocument),
      );
    else body.textContent = props.body;

    const measure = () => setLong(body.scrollHeight > 240);
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    onCleanup(() => observer.disconnect());
  });

  return (
    <>
      <div
        class="hh-comment-clip"
        classList={{
          "hh-comment-collapsed": long() && !expanded(),
          "hh-comment-expanded": expanded(),
        }}
      >
        <div
          ref={(element) => {
            body = element;
          }}
          class="hh-comment-body"
          classList={{ "hh-comment-html": props.bodyHtml !== undefined }}
        />
      </div>
      {long() && (
        <button
          type="button"
          class="hh-button hh-comment-toggle"
          aria-expanded={expanded()}
          on:click={() => setExpanded((value) => !value)}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function commentAge(createdAt: string): {
  text: string;
  title: string;
} | undefined {
  const created = new Date(createdAt);
  const delta = created.getTime() - Date.now();
  if (!Number.isFinite(delta)) return undefined;
  const title = created.toLocaleString();
  // Like GitHub: past a month the date itself, "on Jul 15", with the year only when it is not this one.
  if (Math.abs(delta) >= 30 * 24 * 60 * 60 * 1000) {
    const date = created.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(created.getFullYear() !== new Date().getFullYear() && {
        year: "numeric",
      }),
    });
    return { text: `on ${date}`, title };
  }
  const units = [
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
    ["second", 1000],
  ] as const;
  const [unit, milliseconds] =
    units.find(([, size]) => Math.abs(delta) >= size) ?? units[3];
  return {
    text: relativeTime.format(Math.round(delta / milliseconds), unit),
    title,
  };
}

function CommentAge(props: { createdAt: string }): JSX.Element {
  const age = commentAge(props.createdAt);
  return age ? (
    <time
      class="hh-comment-age"
      dateTime={props.createdAt}
      title={age.title}
    >
      {age.text}
    </time>
  ) : null;
}

function reviewRows(threads: readonly ReviewThread[]): JSX.Element[] {
  return threads.map((thread) => (
    <tr class="hh-review-thread">
      <td colSpan={3}>
        {thread.resolved && <span class="hh-comment-label">Resolved</span>}
        {thread.comments.map((comment) => (
          <div class="hh-review-comment">
            <div class="hh-comment-meta">
              {comment.avatarUrl !== undefined && (
                <img
                  class="hh-comment-avatar"
                  src={comment.avatarUrl}
                  alt=""
                  width="20"
                  height="20"
                />
              )}
              <span class="hh-comment-author">{comment.author}</span>
              {comment.createdAt !== undefined && (
                <CommentAge createdAt={comment.createdAt} />
              )}
            </div>
            <ReviewCommentBody
              body={comment.body}
              bodyHtml={comment.bodyHtml}
            />
          </div>
        ))}
      </td>
    </tr>
  ));
}

const Num = (props: { line: number | undefined; kind?: string }) => (
  <td class={`hh-num${props.kind ?? ""}`}>
    {props.line === undefined ? "" : String(props.line)}
  </td>
);

/** A merged row's code: shared text reads on both sides, a side's changed text on that side alone. */
function mergedCode(
  ctx: DrawContext,
  index: number,
  row: UnifiedRow & { kind: "merged" },
): JSX.Element {
  const { placer } = ctx;
  const { fragment } = row;
  const afterAt =
    row.after === undefined
      ? undefined
      : placer.lineCursor(index, fragment, "after", row.after);
  // A before line deleted whole keeps a row of its own, drawn in its own order.
  const wholeAt =
    row.after === undefined && row.before !== undefined
      ? placer.lineCursor(index, fragment, "before", row.before)
      : undefined;
  // Shared text is cut where its before copy breaks off, and each piece placed on both sides.
  const shared = new Map<MergedSpan, Point | undefined>();
  const spans = wholeAt
    ? row.spans
    : row.spans.flatMap((span) => {
        if (span.changed) return [span];
        return placer.shareBefore(index, fragment, span).map((cut) => {
          shared.set(cut.span, cut.before);
          return cut.span;
        });
      });
  return (
    <SpanNodes
      spans={spans}
      side="after"
      wholeLine={
        row.after === undefined
          ? "before"
          : row.before === undefined
            ? "after"
            : undefined
      }
      allowTrailingTerminator={
        // A grammar may keep a member's `;` or `,` outside its node, so an added member ends on an unchanged one.
        row.after === undefined || row.before === undefined
      }
      place={(span) => {
        if (wholeAt) {
          if (span.changed)
            placer.takeBefore(index, fragment, span.text, row.before);
          return wholeAt(span);
        }
        if (span.side === "before")
          return placer.takeBefore(index, fragment, span.text);
        const after = afterAt?.(span);
        const before = shared.get(span);
        return [after, before].filter((p) => p !== undefined);
      }}
    />
  );
}

/** Both line numbers, then one code cell whose sign column says which side a lone line belongs to. */
export function unifiedRow(
  ctx: DrawContext,
  table: TableDraw,
  row: UnifiedRow,
  out: JSX.Element[],
  scope?: string,
  lone = false,
  handover = false,
): void {
  const { index } = table;
  if (row.kind === "elided") {
    out.push(
      <ElidedRow
        path={ctx.files()[index]?.path ?? ""}
        gap={row}
        {...(scope ? { scope } : {})}
        handover={handover}
      />,
    );
    return;
  }
  const file = ctx.files()[index];
  const shown = (
    side: SideName,
    line: number | undefined,
    sourceLine?: number,
  ) =>
    line === undefined || !file
      ? line
      : shownLine(file, side, line, sourceLine);
  let tr: HTMLTableRowElement;
  switch (row.kind) {
    case "unchanged":
      tr = (
        <tr class="hh-line">
          <Num
            line={shown("before", row.before.line, row.before.sourceLine)}
          />
          <Num line={shown("after", row.after.line, row.after.sourceLine)} />
          <td class="hh-code" style={codeStyle(row.after.spans)}>
            <span class="hh-sign" />
            <SpanNodes
              spans={row.after.spans}
              side="after"
              place={ctx.placer.contextCursor(index, row.after.line)}
            />
          </td>
        </tr>
      ) as HTMLTableRowElement;
      break;
    case "merged": {
      // A side's bar marks a row holding that side's changed text; a row of reflowed text alone has none.
      const has = (s: SideName) =>
        row.spans.some((span) => span.changed && span.side === s);
      const code = mergedCode(ctx, index, row);
      // A row of one side's changed text alone reads as a removed or added line, so it keeps the line colour.
      const single =
        row.after === undefined
          ? "before"
          : row.before === undefined
            ? "after"
            : undefined;
      const wholeLine =
        single !== undefined && whollyChanged(row.spans, single, true);
      tr = (
        <tr class={wholeLine ? "hh-line" : "hh-line hh-merged"}>
          <Num
            line={shown("before", row.before)}
            kind={has("before") ? " hh-removed" : ""}
          />
          <Num
            line={shown("after", row.after)}
            kind={has("after") ? " hh-added" : ""}
          />
          <td class="hh-code" style={codeStyle(row.spans)}>
            <span class="hh-sign">
              {row.after === undefined ? signs.before : ""}
            </span>
            {(has("before") || has("after")) && (
              <span class="hh-sr">changed </span>
            )}
            {code}
          </td>
        </tr>
      ) as HTMLTableRowElement;
      ctx.remember(index, row.fragment, tr);
      break;
    }
    case "line": {
      const { side, cell, moved } = row;
      const last = moved?.last ? " hh-moved-last" : "";
      const edge = moved
        ? ` hh-moved${last}`
        : side === "before"
          ? " hh-removed"
          : " hh-added";
      const line = (s: SideName) => (s === side ? cell.line : undefined);
      if (row.move) {
        const view = ctx.pairs.of(index, row.fragment, side, row.move);
        const td = (
          <td class="hh-move-cell hh-moved" colSpan={3}>
            <MoveLabel
              file={index}
              fragment={row.fragment}
              side={side}
              move={row.move}
            />
          </td>
        ) as HTMLTableCellElement;
        out.push(<tr class="hh-move">{td}</tr>);
        if (view) {
          table.openPair[side] = view;
          ctx.pairOfElement.set(td, view);
        }
      }
      tr = (
        <tr
          class="hh-line"
          data-side={side}
          data-before={line("before")}
          data-after={line("after")}
        >
          <Num
            line={shown("before", line("before"), cell.sourceLine)}
            kind={edge}
          />
          <Num
            line={shown("after", line("after"), cell.sourceLine)}
            kind={moved ? ` hh-moved-inner${last}` : ""}
          />
          <td
            class={`hh-code${moved ? ` hh-moved${last}` : ""}`}
            style={codeStyle(cell.spans)}
          >
            <span class="hh-sign">{signs[side]}</span>
            {moved && <span class="hh-sr">moved </span>}
            <SpanNodes
              spans={cell.spans}
              side={side}
              wholeLine={side}
              allowTrailingTerminator
              emphasize={!lone}
              place={
                cell.sourceLine === undefined
                  ? ctx.placer.lineCursor(index, row.fragment, side, cell.line)
                  : undefined
              }
            />
          </td>
        </tr>
      ) as HTMLTableRowElement;
      ctx.remember(index, row.fragment, tr);
    }
  }
  out.push(tr);
  if (file) {
    const lines =
      row.kind === "unchanged"
        ? {
            before: shown(
              "before",
              row.before.line,
              row.before.sourceLine,
            ),
            after: shown("after", row.after.line, row.after.sourceLine),
          }
        : row.kind === "merged"
          ? {
              before: shown("before", row.before),
              after: shown("after", row.after),
            }
          : {
              [row.side]: shown(row.side, row.cell.line, row.cell.sourceLine),
            };
    const threads = (file.reviewThreads ?? []).filter(
      (thread) =>
        (thread.before === undefined || thread.before === lines.before) &&
        (thread.after === undefined || thread.after === lines.after),
    );
    out.push(...reviewRows(threads));
  }
  if (row.kind === "line" && row.fragment >= 0)
    blockCells(ctx, table, row.side, [...tr.children], row.moved, out)();
}
