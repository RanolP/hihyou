import { describe, expect, it } from "vitest";
import { printStream, resetStream } from "../../fmt/stream.js";
import {
  BROKEN,
  capture,
  close,
  closeChoice,
  closeState,
  FILL,
  FILL_ITEM,
  GROUP,
  HARD,
  IF_BROKEN,
  INDENT,
  LINE_SUFFIX,
  open,
  openAlign,
  openChoice,
  openIndentIfBreak,
  openState,
  place,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sLineSuffixBoundary,
  sLiteral,
  sText,
  sToken,
} from "./sink.js";

// A part a rule queries before placing it is a span built where nothing prints it, which `place` jumps to. Placed,
// it must print as the same writes made in place at every width, or a rule that captures a part to decide a hug or
// a break moves what it prints.

const widths = [4, 8, 12, 20, 40, 80];

function placedAsInPlace(script: () => void): void {
  for (const lineWidth of widths) {
    const layout = { lineWidth, indentWidth: 2, useTabs: false };
    const around = (body: () => void) => {
      open(GROUP);
      sText("<");
      body();
      sText(">");
      close();
    };
    resetStream(false);
    around(script);
    const want = printStream(layout).text;
    resetStream(false);
    const part = capture(script);
    around(() => place(part));
    expect(printStream(layout).text, `width ${lineWidth}: ${script}`).toBe(want);
  }
}

const words = (n: number, from = 0) => {
  for (let i = 0; i < n; i++) {
    if (i > 0) sLine(0);
    sToken(from + i, `w${from + i}`);
  }
};

const scripts: Record<string, () => void> = {
  "group, indent, soft lines": () => {
    open(GROUP);
    sText("(");
    open(INDENT);
    sLine(SOFT);
    words(5);
    close();
    sLine(SOFT);
    sText(")");
    close();
  },
  "a broken group and a hard line": () => {
    open(GROUP, -1, BROKEN);
    words(2);
    sHardline();
    words(2, 2);
    close();
  },
  "a hard line without a break parent": () => {
    words(1);
    sLine(HARD);
    words(1, 1);
  },
  "indentIfBreak and its negation": () => {
    const g = open(GROUP);
    sText("=");
    sLine(0);
    close();
    openIndentIfBreak(g);
    words(4);
    close();
    openIndentIfBreak(g, true);
    words(2, 4);
    close();
  },
  // The concise array's trailing comma: an ifBroken in a fill item that follows the group still open around it.
  "ifBroken on its own open group, inside a fill": () => {
    const g = open(GROUP);
    sText("[");
    open(INDENT);
    sLine(SOFT);
    open(FILL);
    for (let i = 0; i < 6; i++) {
      if (i > 0) sLine(0);
      open(FILL_ITEM);
      sToken(i, `item${i}`);
      if (i < 5) sText(",");
      else {
        open(IF_BROKEN, g);
        sText(",");
        close();
      }
      close();
    }
    close();
    close();
    sLine(SOFT);
    sText("]");
    close();
  },
  "align by width and by string": () => {
    open(GROUP);
    openAlign(3);
    words(4);
    close();
    openAlign("> ");
    sLine(SOFT);
    words(3, 4);
    close();
    close();
  },
  "choice of states": () => {
    openChoice(false);
    openState();
    words(6);
    closeState();
    openState();
    open(GROUP);
    open(INDENT);
    sLine(SOFT);
    words(6);
    close();
    close();
    closeState();
    closeChoice();
  },
  "line suffix, boundary, break parent, literal": () => {
    open(GROUP);
    words(2);
    open(LINE_SUFFIX);
    sText(" // c");
    close();
    sLineSuffixBoundary();
    sLiteral(9, "`a\nb`");
    sBreakParent();
    sLine(HARD);
    words(1, 3);
    close();
  },
};

// Well-formed op sequences: groups, indents, aligns and fills nested at random, with ifBroken on groups closed
// before them.
function random(seed: number): () => void {
  let s = seed;
  const next = (n: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
  const ops: (() => void)[] = [];
  const trace: string[] = [];
  const op = (what: string, f: () => void) => {
    ops.push(f);
    trace.push(what);
  };
  const closed: number[] = [];
  // A group's id is what `open` returns on this run.
  const ids: number[] = [];
  let slots = 0;
  let token = 0;
  const body = (depth: number) => {
    const count = 1 + next(4);
    for (let i = 0; i < count; i++) {
      let pick = depth > 3 ? 0 : next(7);
      // An ifBroken needs a group closed before it; with none, a token.
      if (pick === 2 && closed.length === 0) pick = 0;
      if (pick <= 1) {
        const k = token++;
        if (i > 0) {
          const flags = [0, SOFT, 0, HARD][next(4)] as number;
          op(`line${flags}`, () => sLine(flags));
        }
        op(`t${k}`, () => sToken(k, `t${k}`));
      } else if (pick === 2) {
        const at = closed[next(closed.length)] as number;
        op(`ifBroken(g${at}) { ! }`, () => {
          open(IF_BROKEN, ids[at] as number);
          sText("!");
          close();
        });
      } else if (pick === 3) {
        op("indent {", () => open(INDENT));
        body(depth + 1);
        op("}", close);
      } else if (pick === 4) {
        const n = 1 + next(3);
        op(`align${n} {`, () => openAlign(n));
        body(depth + 1);
        op("}", close);
      } else if (pick === 5) {
        const items = 1 + next(4);
        op("fill {", () => open(FILL));
        for (let j = 0; j < items; j++) {
          if (j > 0) op("line0", () => sLine(0));
          op("item {", () => open(FILL_ITEM));
          body(depth + 1);
          op("}", close);
        }
        op("}", close);
      } else {
        const slot = slots++;
        const broken = next(5) === 0 ? BROKEN : 0;
        op(`g${slot}${broken ? " broken" : ""} {`, () => void (ids[slot] = open(GROUP, -1, broken)));
        body(depth + 1);
        op("}", close);
        closed.push(slot);
      }
    }
  };
  op("group {", () => open(GROUP));
  body(0);
  op("}", close);
  const run = () => {
    for (const f of ops) f();
  };
  run.toString = () => trace.join(" ");
  return run;
}

describe("js sink: a captured part prints where it is placed as the same writes made there", () => {
  for (const [name, script] of Object.entries(scripts)) it(name, () => placedAsInPlace(script));
  it("100 random well-formed scripts", () => {
    for (let seed = 1; seed <= 100; seed++) placedAsInPlace(random(seed));
  });
  it("drops what a capture that throws wrote, as a bailed-out hug", () => {
    resetStream(false);
    sText("a");
    expect(() =>
      capture(() => {
        open(GROUP);
        sText("x");
        throw new Error("bail");
      }),
    ).toThrow("bail");
    sText("b");
    expect(printStream({ lineWidth: 80, indentWidth: 2, useTabs: false }).text).toBe("ab");
  });
});
