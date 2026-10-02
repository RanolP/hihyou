import type { Span } from "@hihyou/engine";
import type { JSX } from "solid-js";
import type { Point } from "../modal.js";
import type { MergedSpan, SideName } from "../rows.js";
import { type DrawContext, useDraw } from "./context.js";

export type Place = (span: MergedSpan) => Point | readonly Point[] | undefined;

/**
 * Syntax colour inside, diff emphasis (a background) around it, so both show. The text is one Text node the
 * placer records, so the highlight painter and a click find it.
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
  if (!style?.foreground && !style?.fontStyle) return text;
  const font = style.fontStyle ?? "";
  const lines = ["underline", "strikethrough"].filter((l) => font.includes(l));
  return (
    <span
      style={{
        color: style.foreground,
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
  place?: Place | undefined;
}): JSX.Element {
  const ctx = useDraw();
  // Read once: a prop given as a call is a getter, and a fresh line cursor per span would place every span at 0.
  const { spans, side, place } = props;
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
  for (const span of spans) {
    const node = spanNode(ctx, span, place?.(span));
    if (!span.changed) {
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
  return out;
}
