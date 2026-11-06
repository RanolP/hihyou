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
  [/\bpunctuation\.definition\.quote\.begin\.markdown/, "hh-md-mark"],
  [/\bpunctuation\.definition\.list\.begin\.markdown/, "hh-md-bullet"],
  [/\bpunctuation\.definition\.(?:heading|markdown|table)\b/, "hh-md-mark"],
  [/\bmarkup\.inline\.raw/, "hh-md-code"],
  [/\b(?:markup\.fenced_code|markup\.raw\.block)/, "hh-md-fence"],
  [/\bfenced_code\.block\.language/, "hh-md-lang"],
  [/\bmarkup\.underline\.link/, "hh-md-url"],
  [/\bstring\.other\.link\.description\.markdown/, "hh-md-image"],
  [/\b(?:string\.other\.link\.title|constant\.other\.reference\.link)/, "hh-md-link"],
  [/\bmarkup\.table/, "hh-md-table"],
  [/\bmarkup\.quote\.markdown/, "hh-md-quote"],
  [/\bmeta\.separator\.markdown/, "hh-md-rule"],
  [/\bmarkup\.bold/, "hh-md-strong"],
  [/\bmarkup\.italic/, "hh-md-em"],
  [/\bmarkup\.strikethrough/, "hh-md-del"],
  [/\bcomment\.block\.html\.markdown/, "hh-md-comment"],
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
  const scoped = markdownClass(span.scope);
  // A bullet marker (`-`, `*`, `+`, not `1.`) keeps its character, drawn over by a bullet glyph.
  const md =
    scoped?.includes("hh-md-bullet") && /^\s*[-*+]\s*$/.test(span.text)
      ? `${scoped} hh-md-dot`
      : scoped;
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
  // `abut`: the run directly follows a run of the other side, with no unchanged text between, so the two words would
  // read as one ("featuresFeature") without a gap.
  // `from`/`to`: the run's first and last span. A run whose edge word touches an unchanged word (a removed word sits
  // where only the other side had the space: "non-stablefeature") gets a gap on that edge too.
  let run:
    | {
        side: SideName;
        nodes: JSX.Element[];
        abut: boolean;
        from: number;
        to: number;
      }
    | undefined;
  const flush = () => {
    if (!run) return;
    const nodes = run.nodes;
    const name = [
      "hh-changed",
      run.abut || glued(spans[run.from - 1], spans[run.from], true)
        ? "hh-abut"
        : "",
      glued(spans[run.to + 1], spans[run.to], false) ? "hh-abut-end" : "",
    ]
      .filter(Boolean)
      .join(" ");
    out.push(
      run.side === "before" ? (
        <del class={name}>{nodes}</del>
      ) : (
        <ins class={name}>{nodes}</ins>
      ),
    );
    run = undefined;
  };
  // A pipe table row draws as a grid of cells; each pipe closes the cell before it, so a mark never spans one.
  const row = isTableRow(spans);
  const cells: JSX.Element[][] = [];
  // A quote or list item hangs its wrapped lines under its text, past the indentation, quote marks and marker.
  const lead = row ? { count: 0, quote: false } : leadOf(spans);
  let head: JSX.Element[] | undefined;
  for (const [index, span] of spans.entries()) {
    if (index === lead.count && lead.count > 0) {
      flush();
      head = out.splice(0);
    }
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
      const abut = run !== undefined;
      flush();
      run = { side: own, nodes: [], abut, from: index, to: index };
    }
    run.nodes.push(node);
    run.to = index;
  }
  flush();
  // An empty quote line (`>`) is all lead.
  if (lead.count > 0 && head === undefined) head = out.splice(0);
  if (head) {
    const alert = lead.quote ? alertOf(spans) : undefined;
    return (
      <span
        class={[
          "hh-md-item",
          lead.quote ? "hh-md-quoted" : "",
          alert !== undefined ? `hh-md-alert hh-md-alert-${alert}` : "",
        ].join(" ")}
      >
        <span class="hh-md-lead">{head}</span>
        <span class="hh-md-body">{out}</span>
      </span>
    );
  }
  if (!row)
    return isDelimiterRow(spans) ? <span class="hh-md-delim">{out}</span> : out;
  cells.push(out);
  // Whatever precedes the first pipe or follows the last (indentation, a stray space) stays outside the grid.
  const before = cells.shift() ?? [];
  const tail = cells.pop() ?? [];
  const count = (cells.length - 1) / 2;
  const weights = columnWeights(ctx.files()).get(count);
  const columns = cells
    .map((_, i) =>
      i % 2 === 0 ? "auto" : `minmax(0, ${weights?.[(i - 1) / 2] ?? 1}fr)`,
    )
    .join(" ");
  return [
    ...before,
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

/** The delimiter row (`|---|:--:|`) under a table's header. */
const isDelimiterRow = (spans: readonly MergedSpan[]): boolean =>
  spans.some(isTableSpan) &&
  /^\s*\|?[\s:]*-[\s|:-]*$/.test(spans.map((s) => s.text).join(""));

/** Whether an unchanged `neighbour` before (or after) a changed `edge` span joins it into one word on screen. */
const glued = (
  neighbour: MergedSpan | undefined,
  edge: MergedSpan | undefined,
  before: boolean,
): boolean => {
  if (neighbour === undefined || edge === undefined || neighbour.changed)
    return false;
  const word = /[\p{L}\p{N}]/u;
  return before
    ? word.test(neighbour.text.at(-1) ?? "") && word.test(edge.text[0] ?? "")
    : word.test(neighbour.text[0] ?? "") && word.test(edge.text.at(-1) ?? "");
};

const blank = (span: MergedSpan | undefined) =>
  span !== undefined && span.text !== "" && span.text.trim() === "";

/**
 * How many spans lead a quote or list item's line up to its text (indentation, quote marks, the list marker and its
 * space), and whether quote marks are among them. A line with neither has no lead.
 */
const leadOf = (
  spans: readonly MergedSpan[],
): { count: number; quote: boolean } => {
  let count = 0;
  let quote = false;
  for (const span of spans) {
    if (span.scope?.includes("punctuation.definition.quote")) quote = true;
    else if (!blank(span)) break;
    count++;
  }
  if (
    spans[count]?.scope?.includes("punctuation.definition.list.begin.markdown")
  )
    return { count: count + (blank(spans[count + 1]) ? 2 : 1), quote };
  return { count: quote ? count : 0, quote };
};

/** A GitHub alert's first line, `> [!NOTE]`, names its kind; the class colours it as GitHub does. */
const alertOf = (spans: readonly MergedSpan[]): string | undefined =>
  /^[\s>]*\[!(note|tip|important|warning|caution)\]\s*$/i
    .exec(spans.map((s) => s.text).join(""))?.[1]
    ?.toLowerCase();
