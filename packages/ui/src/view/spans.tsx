import type { Span } from "@hihyou/engine";
import type { JSX } from "solid-js";
import type { Point } from "../modal.js";
import type { MergedSpan, SideName } from "../rows.js";
import { type DrawContext, useDraw } from "./context.js";
import { columnWeights, isPipe, isTableSpan } from "./md-table.js";

export type Place = (span: MergedSpan) => Point | readonly Point[] | undefined;

export const whollyChanged = (
  spans: readonly MergedSpan[],
  side: SideName,
  allowTrailingTerminator: boolean,
) => {
  const last = spans.findLastIndex((span) => span.text.trim() !== "");
  return spans.every(
    (span, index) =>
      span.text.trim() === "" ||
      (span.changed && (span.side ?? side) === side) ||
      (allowTrailingTerminator &&
        index === last &&
        /^[;,]$/.test(span.text.trim()) &&
        !span.changed),
  );
};

/** Markdown scopes to the classes that draw them as they render; the table's `hh-md` styles them. */
const MARKDOWN: readonly (readonly [RegExp, string])[] = [
  [/\bheading\.([1-6])\.markdown/, "hh-md-h$1"],
  [/\bpunctuation\.definition\.quote\.begin\.markdown/, "hh-md-mark hh-md-bar"],
  [/\bpunctuation\.definition\.list\.begin\.markdown/, "hh-md-bullet"],
  [/\bpunctuation\.definition\.(?:heading|markdown|table)\b/, "hh-md-mark"],
  [/\bmarkup\.inline\.raw/, "hh-md-code"],
  [/\b(?:markup\.fenced_code|markup\.raw\.block)/, "hh-md-fence"],
  [/\bmarkup\.underline\.link/, "hh-md-url"],
  [/\b(?:string\.other\.link|constant\.other\.reference\.link)/, "hh-md-link"],
  [/\bmarkup\.table/, "hh-md-table"],
  [/\bmeta\.separator\.markdown/, "hh-md-rule"],
  [/\bmarkup\.bold/, "hh-md-strong"],
  [/\bmarkup\.italic/, "hh-md-em"],
  [/\bmarkup\.strikethrough/, "hh-md-del"],
];

const markdownClass = (scope: string | undefined): string | undefined => {
  if (scope === undefined || !scope.includes(".markdown")) return undefined;
  const classes = new Set<string>();
  for (const [pattern, name] of MARKDOWN) {
    const match = pattern.exec(scope);
    if (match) classes.add(match[1] ? name.replace("$1", match[1]) : name);
  }
  return classes.size > 0 ? [...classes].join(" ") : undefined;
};

/**
 * Syntax colour inside, diff emphasis (a background) around it, so both show. The text is one Text node the
 * placer records, so the highlight painter and a click find it. A Markdown span also gets classes that draw it as
 * it renders (heading size, code tint, dimmed markup), whether or not the theme colours it.
 */
const spanNode = (
  ctx: DrawContext,
  span: Span,
  at: Point | readonly Point[] | undefined,
): JSX.Element => {
  const text = ctx.doc.createTextNode(span.text);
  ctx.placer.place(text, at);
  const style =
    span.scope !== undefined ? ctx.theme()?.style(span.scope) : undefined;
  const md = markdownClass(span.scope);
  if (!style?.foreground && !style?.fontStyle && md === undefined) return text;
  const font = style?.fontStyle ?? "";
  const lines = ["underline", "strikethrough"].filter((l) => font.includes(l));
  return (
    <span
      class={md}
      style={{
        color: style?.foreground,
        "font-style": font.includes("italic") ? "italic" : undefined,
        "font-weight": font.includes("bold") ? "bold" : undefined,
        "text-decoration":
          lines.length > 0
            ? lines.join(" ").replace("strikethrough", "line-through")
            : undefined,
      }}
    >
      {text}
    </span>
  );
};

/**
 * A run of changed spans of one side goes into one mark, so a changed node gets one continuous background.
 * A merged line's spans carry their own side. Places each span as it draws, in order.
 */
export function SpanNodes(props: {
  spans: readonly MergedSpan[];
  side: SideName;
  wholeLine?: SideName | undefined;
  allowTrailingTerminator?: boolean | undefined;
  /** False on a line with no line of the other side beside it, where every word is new anyway. */
  emphasize?: boolean | undefined;
  place?: Place | undefined;
}): JSX.Element {
  const ctx = useDraw();
  // Read once: a prop given as a call is a getter, and a fresh line cursor per span would place every span at 0.
  const { spans, side, place, wholeLine, allowTrailingTerminator = false } =
    props;
  const emphasize =
    props.emphasize !== false &&
    (wholeLine === undefined ||
      !whollyChanged(spans, wholeLine, allowTrailingTerminator));
  const out: JSX.Element[] = [];
  let run: { side: SideName; nodes: JSX.Element[] } | undefined;
  const flush = () => {
    if (!run) return;
    const nodes = run.nodes;
    out.push(
      run.side === "before" ? (
        <del class="hh-changed">{nodes}</del>
      ) : (
        <ins class="hh-changed">{nodes}</ins>
      ),
    );
    run = undefined;
  };
  // A pipe table row draws as a grid of cells; each pipe closes the cell before it, so a mark never spans one.
  const row = isTableRow(spans);
  const cells: JSX.Element[][] = [];
  for (const span of spans) {
    const node = spanNode(ctx, span, place?.(span));
    if (row && isPipe(span)) {
      flush();
      cells.push(out.splice(0), [node]);
      continue;
    }
    if (!span.changed || !emphasize) {
      flush();
      out.push(node);
      continue;
    }
    const own = span.side ?? side;
    if (run?.side !== own) {
      flush();
      run = { side: own, nodes: [] };
    }
    run.nodes.push(node);
  }
  flush();
  if (!row) return out;
  cells.push(out);
  // Whatever precedes the first pipe or follows the last (indentation, a stray space) stays outside the grid.
  const lead = cells.shift() ?? [];
  const tail = cells.pop() ?? [];
  const count = (cells.length - 1) / 2;
  const weights = columnWeights(ctx.files()).get(count);
  const columns = cells
    .map((_, i) =>
      i % 2 === 0 ? "auto" : `minmax(0, ${weights?.[(i - 1) / 2] ?? 1}fr)`,
    )
    .join(" ");
  return [
    ...lead,
    <span class="hh-md-row" style={{ "grid-template-columns": columns }}>
      {cells.map((nodes, i) => (
        <span class={i % 2 === 0 ? "hh-md-pipe" : "hh-md-cell"}>{nodes}</span>
      ))}
    </span>,
    ...tail,
  ];
}

/** A header or body row of a pipe table: table content split by lone pipes. The delimiter row (`|---|`) is not one. */
const isTableRow = (spans: readonly MergedSpan[]): boolean =>
  spans.some(isTableSpan) &&
  spans.some(isPipe) &&
  !/^[\s|:-]+$/.test(spans.map((s) => s.text).join(""));
