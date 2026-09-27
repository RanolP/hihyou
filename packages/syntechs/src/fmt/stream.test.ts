import { describe, expect, it } from "vitest";
import {
  type Doc,
  align,
  dedent,
  fill,
  group,
  hardline,
  indent,
  line,
  lineSuffix,
  lineSuffixBoundary,
  literalToken,
  text,
} from "./doc.js";
import { print } from "./printer.js";
import {
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  INDENT,
  LINE_SUFFIX,
  open,
  openAlign,
  openReservedSuffix,
  printStream,
  resetStream,
  sHardline,
  sLine,
  sLineSuffixBoundary,
  sLiteral,
  sText,
} from "./stream.js";

const layout = (lineWidth: number) => ({
  lineWidth,
  indentWidth: 2,
  useTabs: false,
});

/** Prints the stream `build` appends and the equivalent `doc`, which must agree. */
function both(lineWidth: number, doc: Doc, build: () => void) {
  resetStream();
  build();
  const stream = printStream(layout(lineWidth)).text;
  expect(stream).toBe(print(doc, layout(lineWidth)).text);
  return stream;
}

describe("printStream matches printer.ts", () => {
  it("counts a run of flat lines as one space when measuring, as prettier's fits does", () => {
    const out = both(3, group([text("a"), line, line, text("b")]), () => {
      open(GROUP);
      sText("a");
      sLine(0);
      sLine(0);
      sText("b");
      close();
    });
    expect(out).toBe("a  b");
  });

  it("counts the leading space of a group opened in the middle of a run of lines", () => {
    const out = both(
      1,
      [text("a"), line, group([line, text("b")])],
      () => {
        sText("a");
        sLine(0);
        open(GROUP);
        sLine(0);
        sText("b");
        close();
      },
    );
    expect(out).toBe("a\n\nb");
  });

  it("measures the fill parts after the next separator in the fill's own mode, not the separator's", () => {
    const out = both(
      10,
      fill([
        [text("x"), hardline, group([text("a"), line, text("b")])],
        line,
        text("c"),
        line,
        text("dddddddddddd"),
      ]),
      () => {
        open(FILL);
        open(FILL_ITEM);
        sText("x");
        sHardline();
        open(GROUP);
        sText("a");
        sLine(0);
        sText("b");
        close();
        close();
        sLine(0);
        open(FILL_ITEM);
        sText("c");
        close();
        sLine(0);
        open(FILL_ITEM);
        sText("dddddddddddd");
        close();
        close();
      },
    );
    expect(out).toBe("x\na b c\ndddddddddddd");
  });

  it("measures a group inside a flushed line suffix against the queued suffixes, not the text already printed", () => {
    const out = both(
      12,
      [
        text("a"),
        lineSuffix([text(" //"), group([text("b"), line, text("c")])]),
        lineSuffix(text(" 12345")),
        text("zz"),
        hardline,
      ],
      () => {
        sText("a");
        open(LINE_SUFFIX);
        sText(" //");
        open(GROUP);
        sText("b");
        sLine(0);
        sText("c");
        close();
        close();
        open(LINE_SUFFIX);
        sText(" 12345");
        close();
        sText("zz");
        sHardline();
      },
    );
    expect(out).toBe("azz //b\nc 12345\n");
  });

  it("prints a trailing fill separator in its item's mode, not the previous separator's", () => {
    const out = both(5, fill([text("aaaa"), line, text("b"), line]), () => {
      open(FILL);
      open(FILL_ITEM);
      sText("aaaa");
      close();
      sLine(0);
      open(FILL_ITEM);
      sText("b");
      close();
      sLine(0);
      close();
    });
    expect(out).toBe("aaaa\nb ");
  });

  it("prints a line suffix queued inside a line suffix before the line break", () => {
    const out = both(
      80,
      [
        text("a"),
        lineSuffix([text(" x"), lineSuffix(text(" y"))]),
        hardline,
        text("b"),
      ],
      () => {
        sText("a");
        open(LINE_SUFFIX);
        sText(" x");
        open(LINE_SUFFIX);
        sText(" y");
        close();
        close();
        sHardline();
        sText("b");
      },
    );
    expect(out).toBe("a x y\nb");
  });

  it("breaks a group whose flat measure passes a line suffix and then reaches a boundary after it, as prettier's hasLineSuffix", () => {
    const out = both(
      80,
      [
        group([text("a"), line, text("b"), lineSuffix(text(" //"))]),
        lineSuffixBoundary,
        text("c"),
      ],
      () => {
        open(GROUP);
        sText("a");
        sLine(0);
        sText("b");
        open(LINE_SUFFIX);
        sText(" //");
        close();
        close();
        sLineSuffixBoundary();
        sText("c");
      },
    );
    expect(out).toBe("a\nb //\nc");
  });

  it("breaks a group holding a boundary while a suffix is pending, and prints nothing for a boundary with none", () => {
    const out = both(
      80,
      [
        text("x"),
        lineSuffixBoundary,
        lineSuffix(text(" //")),
        group([text("a"), line, lineSuffixBoundary, text("b")]),
      ],
      () => {
        sText("x");
        sLineSuffixBoundary();
        open(LINE_SUFFIX);
        sText(" //");
        close();
        open(GROUP);
        sText("a");
        sLine(0);
        sLineSuffixBoundary();
        sText("b");
        close();
      },
    );
    expect(out).toBe("xa //\nb");
  });

  it("aligns past the enclosing indent and dedents back out of it, as prettier's align and dedent", () => {
    const out = both(
      80,
      indent([
        hardline,
        align(3, [text("a"), hardline, text("b")]),
        dedent([hardline, text("c")]),
      ]),
      () => {
        open(INDENT);
        sHardline();
        openAlign(3);
        sText("a");
        sHardline();
        sText("b");
        close();
        openAlign(-1);
        sHardline();
        sText("c");
        close();
        close();
      },
    );
    expect(out).toBe("\n  a\n     b\nc");
  });
});

/** As `both`, measuring as ruff does. */
function ruffBoth(lineWidth: number, doc: Doc, build: () => void) {
  const l = { ...layout(lineWidth), ruff: true };
  resetStream(true);
  build();
  const stream = printStream(l).text;
  expect(stream).toBe(print(doc, l).text);
  return stream;
}

describe("printStream matches printer.ts under ruff's measure", () => {
  it("counts every flat space where it stands, a run of lines included", () => {
    const out = ruffBoth(3, group([text("a"), line, line, text("b")]), () => {
      open(GROUP);
      sText("a");
      sLine(0);
      sLine(0);
      sText("b");
      close();
    });
    expect(out).toBe("a\n\nb");
  });

  it("measures a literal token to its first line break and restarts the column after its last", () => {
    const doc = [
      group([text("a"), line, literalToken(0, "bb\n  cccc"), line, text("d")]),
      group([line, text("ee")]),
    ];
    const out = ruffBoth(8, doc, () => {
      open(GROUP);
      sText("a");
      sLine(0);
      sLiteral(0, "bb\n  cccc");
      sLine(0);
      sText("d");
      close();
      open(GROUP);
      sLine(0);
      sText("ee");
      close();
    });
    expect(out).toBe("a bb\n  cccc d\nee");
  });

  it("counts a line suffix's reserved columns against the line it is queued on", () => {
    const doc = [
      group([text("a"), line, text("b")]),
      lineSuffix(text(" # c"), 4),
      group([line, text("d")]),
      hardline,
    ];
    const out = ruffBoth(6, doc, () => {
      open(GROUP);
      sText("a");
      sLine(0);
      sText("b");
      close();
      openReservedSuffix(4);
      sText(" # c");
      close();
      open(GROUP);
      sLine(0);
      sText("d");
      close();
      sHardline();
    });
    expect(out).toBe("a\nb # c\nd\n");
  });
});
