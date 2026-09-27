import { describe, expect, it } from "vitest";
import {
  closeDead,
  closeFlat,
  closeSpan,
  openDead,
  openFlat,
  openSpan,
  printStream,
  resetStream,
  sJump,
  willBreak as streamWillBreak,
} from "../../../fmt/stream.js";
import {
  bestFitParenthesize,
  bestFitting,
  breakParent,
  emit,
  type Format,
  fitsExpanded,
  group,
  groupIfBreak,
  HARD,
  ifBreak,
  indent,
  indentIfBreak,
  lineOf,
  lineSuffix,
  removeSoftLines,
  SOFT,
  synthetic,
  text,
  token,
  willBreak,
} from "./elements.js";

// A Python part moving to the stream is queried and flattened there: the stream's willBreak and its flat
// interval must read a part as elements.ts's Probe and RemoveSoftLines buffers do, ruff's layouts included.

const line = lineOf(0);
const soft = lineOf(SOFT);
const hard = lineOf(HARD);
const words = (...ws: string[]): Format => ws.map((w, i) => (i === 0 ? text(w) : [line, text(w)]));

const parts: Record<string, () => Format> = {
  "a best-fitting breaking in its last variant only": () =>
    bestFitting([words("aa", "bb"), [text("aa"), breakParent], group(words("aa", "bb"), true)]),
  "a best-fitting breaking in its first variant only": () =>
    bestFitting([[words("aa", "bb"), breakParent], group(words("aa", "bb"))]),
  "a best-fitting with a hard line in its first variant only": () =>
    bestFitting([[text("aa"), hard, text("bb")], group(words("aa", "bb"))]),
  "a best-fit-parenthesize holding a hard line": () =>
    bestFitParenthesize(synthetic(0, "("), group([text("aa"), hard, text("bb")]), synthetic(0, ")")),
  "a best-fit-parenthesize holding a broken group": () =>
    bestFitParenthesize(synthetic(0, "("), group(words("aa", "bb"), true), synthetic(0, ")")),
  "a best-fit-parenthesize that does not break": () =>
    bestFitParenthesize(synthetic(0, "("), group([text("aa"), soft, text("bb")]), synthetic(0, ")")),
  "a fitsExpanded holding a broken group": () => fitsExpanded(group(words("aa", "bb"), true)),
  "a fitsExpanded holding soft lines": () => fitsExpanded(group(words("aa", "bb", "cc"))),
  "an indent holding a hard line": () => group([text("a"), indent([soft, text("bb"), hard, text("cc")])]),
  "a group built broken": () => group([text("a"), indent([soft, words("bb", "cc")])], true),
  "an ifBreak breaking in its broken branch only": () => group([text("a"), ifBreak([text("b"), breakParent], text("c"))]),
  "a line suffix holding a group": () => [text("a"), lineSuffix(group([text(" #"), line, text("c")]), 2), text("b")],
  "an indentIfBreak and a groupIfBreak on a group": () => {
    const g = group(words("aa", "bb", "cc"));
    return [g, indentIfBreak([soft, text("dd")], g), groupIfBreak(words("ee", "ff"), g)];
  },
};

/** `build`'s part written into a span inside a dead interval, as the Python sink captures a part. */
function captured(build: () => Format): number {
  const d = openDead();
  const t = openSpan();
  emit(build());
  closeSpan();
  closeDead(d);
  return t;
}

describe("the stream reads a Python part as elements.ts's buffers do", () => {
  it.each(Object.entries(parts))("willBreak of %s", (_, build) => {
    resetStream(true);
    const t = captured(build);
    expect(streamWillBreak(t)).toBe(willBreak(build()));
    const d = openDead();
    const f = openSpan();
    openFlat();
    sJump(captured(build));
    closeFlat();
    closeSpan();
    closeDead(d);
    expect(streamWillBreak(f)).toBe(willBreak(removeSoftLines(build())));
  });

  it.each(Object.entries(parts))("the flat print of %s", (_, build) => {
    for (const lineWidth of [4, 8, 80]) {
      const layout = { lineWidth, indentWidth: 4, useTabs: false, ruff: true };
      resetStream(true);
      emit(group([token(1, "x"), text(" ="), indent([line, removeSoftLines(build())]), hard, text("y")]));
      const want = printStream(layout).text;
      resetStream(true);
      const t = captured(build);
      emit(
        group([
          token(1, "x"),
          text(" ="),
          indent([
            line,
            () => {
              openFlat();
              sJump(t);
              closeFlat();
            },
          ]),
          hard,
          text("y"),
        ]),
      );
      expect(printStream(layout).text, `width ${lineWidth}`).toBe(want);
    }
  });
});
