import { describe, expect, it } from "vitest";
import { printStream, resetStream } from "../../../fmt/stream.js";
import { emit, willBreak as formatWillBreak } from "./elements.js";
import {
  BLANK,
  BROKEN,
  COLLAPSE,
  capture,
  close,
  closeBestFitParenthesize,
  closeVariant,
  GROUP,
  GROUP_IF_BROKEN,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  LINE_SUFFIX,
  open,
  openBestFitParenthesize,
  openBestFitting,
  openFitsExpanded,
  openIndentIfBreak,
  openReservedSuffix,
  openVariant,
  type Part,
  part,
  place,
  record,
  removeSoftLines,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sLiteral,
  sRuffLine,
  sText,
  sToken,
  willBreak,
} from "./sink.js";

// A ruff rule moving off elements.ts writes sink calls; while ruff's rules around it read Formats they are
// recorded, and once they are gone they go to the stream. Each script here prints the same both ways at every
// width, and a part it queries answers the same, so a rule's output cannot move when the stream takes over.

const widths = [4, 8, 12, 20, 40, 80];

function both(script: () => void): void {
  for (const lineWidth of widths) {
    const layout = { lineWidth, indentWidth: 4, useTabs: false, ruff: true };
    resetStream(true);
    emit(record(script));
    const want = printStream(layout).text;
    resetStream(true);
    script();
    expect(printStream(layout).text, `width ${lineWidth}`).toBe(want);  }
}

const words = (n: number, from = 0) => {
  for (let i = 0; i < n; i++) {
    if (i > 0) sLine(0);
    sToken(from + i, `w${from + i}`);
  }
};

const parenthesized = (body: () => void) => {
  const g = open(GROUP);
  sText("(");
  open(INDENT);
  sLine(SOFT);
  body();
  close();
  sLine(SOFT);
  sText(")");
  close();
  return g;
};

const scripts: Record<string, () => void> = {
  "group, indent, soft lines": () => {
    parenthesized(() => words(5));
  },
  "a broken group and a hard line": () => {
    open(GROUP, -1, BROKEN);
    words(2);
    sHardline();
    words(2, 2);
    close();
  },
  "ifBreak and ifFlat on a group and on the enclosing mode": () => {
    const g = parenthesized(() => {
      words(4);
      open(IF_BROKEN);
      sText(",");
      close();
    });
    open(IF_BROKEN, g);
    sText(" #broken");
    close();
    open(IF_FLAT, g);
    sText(" #flat");
    close();
  },
  "line suffixes, reserved and not, and ruff's lines": () => {
    words(2);
    openReservedSuffix(4);
    sText("  # a");
    close();
    sRuffLine(HARD | COLLAPSE);
    sRuffLine(HARD | COLLAPSE);
    words(1, 2);
    open(LINE_SUFFIX);
    sText("  # b");
    close();
    sLine(HARD | BLANK);
    sBreakParent();
    parenthesized(() => words(4, 3));
  },
  "a literal token": () => {
    parenthesized(() => {
      words(2);
      sLine(0);
      sLiteral(9, '"""a\n  b"""');
    });
  },
  "a best-fitting of a part placed in each variant": () => {
    const p = capture(() => parenthesized(() => words(4)));
    sText("x = ");
    const k = openBestFitting(false);
    let v = openVariant(k);
    place(p);
    closeVariant(v);
    v = openVariant(k);
    open(GROUP, -1, BROKEN);
    sText("(");
    open(INDENT);
    sLine(SOFT);
    place(p);
    close();
    sLine(SOFT);
    sText(")");
    close();
    closeVariant(v);
    close();
  },
  "a best-fit-parenthesize asked by an ifBreak": () => {
    sText("x = ");
    const k = openBestFitParenthesize(() => sToken(0, "(", true));
    words(5);
    closeBestFitParenthesize(k, () => sToken(0, ")", true));
    open(IF_BROKEN, k);
    sText("  # parenthesized");
    close();
  },
  "a fitsExpanded, an indentIfBreak and a groupIfBreak on a group": () => {
    const g = open(GROUP);
    words(3);
    close();
    openIndentIfBreak(g);
    sLine(SOFT);
    words(2, 3);
    close();
    open(GROUP_IF_BROKEN, g);
    words(3, 5);
    close();
    openFitsExpanded(g);
    parenthesized(() => words(3, 8));
    close();
    openFitsExpanded(-1);
    parenthesized(() => words(3, 11));
    close();
  },
  "a recording asking a group written before it": () => {
    const g = parenthesized(() => words(4));
    part(
      record(() => {
        open(IF_BROKEN, g);
        sText(" #broken");
        close();
      }),
    );
  },
  "a part placed by what willBreak reads of it": () => {
    for (const hard of [false, true]) {
      const p = capture(() =>
        parenthesized(() => {
          words(2);
          if (hard) sHardline();
          words(2, 2);
        }),
      );
      if (willBreak(p)) sText("#");
      place(p);
      sHardline();
    }
  },
  "a part with its soft lines removed": () => {
    const p = capture(() =>
      parenthesized(() => {
        words(3);
        open(IF_BROKEN);
        sText(",");
        close();
      }),
    );
    sText("x = ");
    place(removeSoftLines(p));
    sHardline();
    place(p);
  },
};

describe("a Python sink script prints the same recorded and on the stream", () => {
  it.each(Object.entries(scripts))("%s", (_, script) => both(script));
});

describe("a Python part answers the same recorded and on the stream", () => {
  const parts: Record<string, () => void> = {
    "a hard line": () => parenthesized(() => {
      words(2);
      sLine(HARD);
      words(1, 2);
    }),
    "a best-fitting breaking in its last variant only": () => {
      const k = openBestFitting(false);
      const v = openVariant(k);
      words(2);
      closeVariant(v);
      const w = openVariant(k);
      sBreakParent();
      closeVariant(w);
      close();
    },
    "a best-fitting breaking in its first variant only": () => {
      const k = openBestFitting(false);
      const v = openVariant(k);
      sBreakParent();
      closeVariant(v);
      const w = openVariant(k);
      words(2);
      closeVariant(w);
      close();
    },
    "no break": () => parenthesized(() => words(3)),
  };
  it.each(Object.entries(parts))("willBreak of %s, soft lines removed or not", (_, build) => {
    const recorded = capture0(true, build);
    resetStream(true);
    const streamed = capture0(false, build);
    expect(willBreak(streamed)).toBe(willBreak(recorded));
    expect(willBreak(removeSoftLines(streamed))).toBe(willBreak(removeSoftLines(recorded)));
    expect(formatWillBreak(record(build))).toBe(willBreak(recorded));
  });
});

/** `build` captured inside a recording (`recorded`) or on the stream. */
function capture0(recorded: boolean, build: () => void): Part {
  let p: Part | undefined;
  if (recorded) record(() => (p = capture(build)));
  else p = capture(build);
  return p as Part;
}
