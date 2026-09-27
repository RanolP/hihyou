import { describe, expect, it } from "vitest";
import {
  type Doc,
  align,
  bestFitParenthesize,
  bestFitting,
  breakParent,
  conditionalGroup,
  dedent,
  fill,
  fitsExpanded,
  group,
  groupIfBreak,
  hardline,
  ifBreak,
  indent,
  indentIfBreak,
  line,
  lineOf,
  lineSuffix,
  lineSuffixBoundary,
  literalToken,
  softline,
  text,
  token,
  willBreak as docWillBreak,
} from "./doc.js";
import { removeLines } from "../grammars/javascript/print/util.js";
import { print } from "./printer.js";
import {
  BLANK,
  BROKEN,
  CHOICE,
  COLLAPSE,
  canBreak,
  close,
  flatText,
  sBreakParent,
  shape,
  willBreak,
  closeBestFitParenthesize,
  closeChoice,
  closeState,
  closeVariant,
  FILL,
  FILL_ITEM,
  GROUP,
  GROUP_IF_BROKEN,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  HARD,
  LINE_SUFFIX,
  open,
  openAlign,
  openBestFitParenthesize,
  openBestFitting,
  openChoice,
  openSpan,
  closeSpan,
  openFlat,
  closeFlat,
  sJump,
  openFitsExpanded,
  openState,
  openIndentIfBreak,
  openReservedSuffix,
  openVariant,
  printStream,
  resetStream,
  sHardline,
  sLine,
  sLineSuffixBoundary,
  sLiteral,
  sRuffLine,
  SOFT,
  sText,
  sToken,
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

  it("leaves the group around an empty fill in the mode it decided, not the empty item's separator mode", () => {
    const out = both(4, group([fill([[]]), text("t0"), line, text("t1")]), () => {
      open(GROUP);
      open(FILL);
      open(FILL_ITEM);
      close();
      close();
      sText("t0");
      sLine(0);
      sText("t1");
      close();
    });
    expect(out).toBe("t0\nt1");
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

describe("printStream matches printer.ts for conditional groups", () => {
  const choice = (states: (() => void)[], broken = false) => {
    openChoice(broken);
    for (const s of states) {
      openState();
      s();
      closeState();
    }
    closeChoice();
  };

  it("takes the first later state that fits flat, else the last one broken", () => {
    const doc = (w: number) =>
      both(
        w,
        conditionalGroup([
          text("aaaaaaaaaaaa"),
          text("bb"),
          group([text("c"), line, text("d")]),
        ]),
        () =>
          choice([
            () => sText("aaaaaaaaaaaa"),
            () => sText("bb"),
            () => {
              open(GROUP);
              sText("c");
              sLine(0);
              sText("d");
              close();
            },
          ]),
      );
    expect(doc(10)).toBe("bb");
    expect(doc(1)).toBe("c\nd");
  });

  it("measures only the first state for the enclosing group, and a break inside a state leaves it flat", () => {
    const out = both(
      6,
      group([
        conditionalGroup([
          [text("a"), hardline, text("b")],
          text("a state too long to fit"),
        ]),
        line,
        text("c"),
      ]),
      () => {
        open(GROUP);
        choice([
          () => {
            sText("a");
            sHardline();
            sText("b");
          },
          () => sText("a state too long to fit"),
        ]);
        sLine(0);
        sText("c");
        close();
      },
    );
    expect(out).toBe("a\nb c");
  });

  // Propagated past the choice, a later state's break would break every call holding an expandable argument.
  it("leaves the groups around flat for a break parent in a later state", () => {
    const out = both(
      80,
      group([text("x"), line, conditionalGroup([text("a"), [text("b"), breakParent]])]),
      () => {
        open(GROUP);
        sText("x");
        sLine(0);
        choice([
          () => sText("a"),
          () => {
            sText("b");
            sBreakParent();
          },
        ]);
        close();
      },
    );
    expect(out).toBe("x a");
  });

  it("finds a fill's next item past a separator holding an ifBreak", () => {
    const out = both(
      8,
      fill([text("aaaa"), ifBreak(text("-"), text(" ")), text("bbbb")]),
      () => {
        open(FILL);
        open(FILL_ITEM);
        sText("aaaa");
        close();
        open(IF_BROKEN);
        sText("-");
        close();
        open(IF_FLAT);
        sText(" ");
        close();
        open(FILL_ITEM);
        sText("bbbb");
        close();
        close();
      },
    );
    expect(out).toBe("aaaa-bbbb");
  });
});

describe("printStream matches printer.ts for a shared part printed through a jump", () => {
  // A part built once as a span; `jump` prints it again.
  const span = (build: () => void): number => {
    const t = openSpan();
    build();
    closeSpan();
    return t;
  };

  it("decides a jumped group by what follows the jump, not what follows the span", () => {
    const s = group([text("aa"), line, text("bb")]);
    const out = both(6, [s, hardline, s, text("zzz")], () => {
      const t = span(() => {
        open(GROUP);
        sText("aa");
        sLine(0);
        sText("bb");
        close();
      });
      sHardline();
      sJump(t);
      sText("zzz");
    });
    expect(out).toBe("aa bb\naa\nbbzzz");
  });

  it("counts a jump's width in the group around it", () => {
    const s = group(text("dddd"));
    const out = both(6, [s, hardline, group([text("cc"), line, s])], () => {
      const t = span(() => {
        open(GROUP);
        sText("dddd");
        close();
      });
      sHardline();
      open(GROUP);
      sText("cc");
      sLine(0);
      sJump(t);
      close();
    });
    expect(out).toBe("dddd\ncc\ndddd");
  });

  it("counts a jumped part's leading line as one space with the run of lines before it", () => {
    const s = group([line, text("b")]);
    const out = both(3, [s, hardline, group([text("a"), line, s])], () => {
      const t = span(() => {
        open(GROUP);
        sLine(0);
        sText("b");
        close();
      });
      sHardline();
      open(GROUP);
      sText("a");
      sLine(0);
      sJump(t);
      close();
    });
    expect(out).toBe(" b\na  b");
  });

  it("measures through a jump and on past it", () => {
    const s = group(text("dd"));
    const out = both(5, [s, hardline, group([text("cc"), line]), s, text("e")], () => {
      const t = span(() => {
        open(GROUP);
        sText("dd");
        close();
      });
      sHardline();
      open(GROUP);
      sText("cc");
      sLine(0);
      close();
      sJump(t);
      sText("e");
    });
    expect(out).toBe("dd\ncc\ndde");
  });
});

describe("printStream matches printer.ts for a part printed flat as removeLines rebuilds it", () => {
  const flat = (build: () => void) => {
    openFlat();
    build();
    closeFlat();
  };

  it("prints a flat part's lines flat and its ifBreak's flat branch where its own group would break", () => {
    const inner = group([text("bbbb"), line, ifBreak(text(","), text(";")), softline, text("c")]);
    const out = both(4, removeLines(inner), () =>
      flat(() => {
        open(GROUP);
        sText("bbbb");
        sLine(0);
        open(IF_BROKEN);
        sText(",");
        close();
        open(IF_FLAT);
        sText(";");
        close();
        sLine(SOFT);
        sText("c");
        close();
      }),
    );
    expect(out).toBe("bbbb ;c");
  });

  it("drops a group's own shouldBreak inside a flat part, so the groups around stay flat", () => {
    const out = both(80, group([text("a"), line, removeLines(group(text("b"), true))]), () => {
      open(GROUP);
      sText("a");
      sLine(0);
      flat(() => {
        open(GROUP, -1, BROKEN);
        sText("b");
        close();
      });
      close();
    });
    expect(out).toBe("a b");
  });

  it("keeps a hard line's break parent inside a flat part, so the groups around break", () => {
    const out = both(80, group([text("a"), line, removeLines([text("b"), hardline, text("c")])]), () => {
      open(GROUP);
      sText("a");
      sLine(0);
      flat(() => {
        sText("b");
        sHardline();
        sText("c");
      });
      close();
    });
    expect(out).toBe("a\nb\nc");
  });

  it("measures a flat part's conditional group by its last state, the one it prints", () => {
    const cg = conditionalGroup([text("s"), text("longstate")]);
    const out = both(8, group([text("x"), line, removeLines(cg)]), () => {
      open(GROUP);
      sText("x");
      sLine(0);
      flat(() => {
        openChoice(false);
        openState();
        sText("s");
        closeState();
        openState();
        sText("longstate");
        closeState();
        closeChoice();
      });
      close();
    });
    expect(out).toBe("x\nlongstate");
  });

  it("prints a span flat through a jump in a flat part, and decided where it is jumped to outside one", () => {
    const s = group([text("aa"), line, text("bb")]);
    const out = both(3, [s, hardline, removeLines(s)], () => {
      const t = openSpan();
      open(GROUP);
      sText("aa");
      sLine(0);
      sText("bb");
      close();
      closeSpan();
      sHardline();
      flat(() => sJump(t));
    });
    expect(out).toBe("aa\nbb\naa bb");
  });
});

describe("the range queries answer what doc.ts's and the JS printer's Doc queries answer", () => {
  const choice = (states: (() => void)[]) => {
    const k = openChoice(false);
    for (const s of states) {
      openState();
      s();
      closeState();
    }
    closeChoice();
    return k;
  };
  const span = (build: () => void): number => {
    const t = openSpan();
    build();
    closeSpan();
    return t;
  };
  const wrapped = (kind: number, build: () => void) => {
    const k = open(kind);
    build();
    close();
    return k;
  };

  // A choice's state breaks reach no flag around it, so a willBreak reading only flags would call a hugged
  // argument holding a call's expanded arguments unbreaking.
  it("willBreak sees a break in a choice's first state, through a jump too, and none in a later state", () => {
    const firstBreaks = [[text("a"), hardline], text("b")];
    const laterBreaks = [text("a"), [text("b"), hardline]];
    expect(docWillBreak(conditionalGroup(firstBreaks))).toBe(true);
    expect(docWillBreak(conditionalGroup(laterBreaks))).toBe(false);
    resetStream();
    const t = span(() =>
      choice([
        () => {
          sText("a");
          sHardline();
        },
        () => sText("b"),
      ]),
    );
    const u = span(() =>
      choice([
        () => sText("a"),
        () => {
          sText("b");
          sHardline();
        },
      ]),
    );
    const g = wrapped(INDENT, () => sJump(t));
    const h = wrapped(INDENT, () => sJump(u));
    expect([willBreak(t), willBreak(u), willBreak(g), willBreak(h)]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("canBreak sees a line in any state and through a jump, and no line in a boundary", () => {
    resetStream();
    const later = choice([() => sText("a"), () => sLine(SOFT)]);
    const t = span(() => sLine(0));
    const viaJump = wrapped(INDENT, () => sJump(t));
    const boundary = wrapped(INDENT, () => sLineSuffixBoundary());
    const textOnly = wrapped(GROUP, () => sText("a"));
    expect([canBreak(later), canBreak(viaJump), canBreak(boundary), canBreak(textOnly)]).toEqual(
      [true, true, false, false],
    );
  });

  it("flatText reads text through unbroken groups and jumps, and gives up at a line or a break parent", () => {
    resetStream();
    const t = span(() => sText("c"));
    const textual = wrapped(GROUP, () => {
      sText("a");
      wrapped(GROUP, () => sToken(0, "b"));
      sJump(t);
    });
    const lined = wrapped(GROUP, () => {
      sText("a");
      sLine(SOFT);
    });
    const breaking = span(() => {
      sText("a");
      sBreakParent();
    });
    const indented = wrapped(INDENT, () => sText("a"));
    expect([flatText(textual), flatText(lined), flatText(breaking), flatText(indented)]).toEqual([
      "abc",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("shape lists a choice's states and a fill's items, not its separators", () => {
    resetStream();
    const k = choice([() => sText("a"), () => sText("b")]);
    const f = open(FILL);
    const a = wrapped(FILL_ITEM, () => sText("a"));
    wrapped(IF_BROKEN, () => sText("-"));
    const b = wrapped(FILL_ITEM, () => sText("b"));
    close();
    expect(shape(k)).toEqual({ kind: CHOICE, parts: [k + 1, k + 2] });
    expect(shape(f)).toEqual({ kind: FILL, parts: [a, b] });
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

  it("collapses a broken line on an empty line and adds one empty line for a blank line", () => {
    const collapse = lineOf(HARD | COLLAPSE);
    const blank = lineOf(HARD | COLLAPSE | BLANK);
    const doc = [
      collapse,
      text("a"),
      blank,
      collapse,
      group([text("b"), collapse, text("c")]),
    ];
    const out = ruffBoth(80, doc, () => {
      sRuffLine(HARD | COLLAPSE);
      sText("a");
      sRuffLine(HARD | COLLAPSE | BLANK);
      sRuffLine(HARD | COLLAPSE);
      open(GROUP);
      sText("b");
      sRuffLine(HARD | COLLAPSE);
      sText("c");
      close();
    });
    expect(out).toBe("a\n\nb\nc");
  });

  it("indents an indentIfBreak's contents, built once, by its group's printed mode", () => {
    const g = group([text("aaaa"), line, text("b")]);
    const contents = group([text("c"), hardline, text("d")]);
    const doc = [g, indentIfBreak(contents, g), indentIfBreak(contents, g, true)];
    const out = ruffBoth(4, doc, () => {
      const k = open(GROUP);
      sText("aaaa");
      sLine(0);
      sText("b");
      close();
      for (const negate of [false, true]) {
        openIndentIfBreak(k, negate);
        open(GROUP);
        sText("c");
        sHardline();
        sText("d");
        close();
        close();
      }
    });
    expect(out).toBe("aaaa\nbc\n  dc\nd");
  });

  it("measures a groupIfBreak as a group only while its condition prints broken", () => {
    const g = group([text("aaaa"), line, text("b")]);
    const flat = group(text("x"));
    const doc = [
      g,
      groupIfBreak([text("cc"), line, text("dd")], g),
      hardline,
      flat,
      groupIfBreak([text("y"), line, text("z")], flat),
    ];
    const out = ruffBoth(4, doc, () => {
      const k = open(GROUP);
      sText("aaaa");
      sLine(0);
      sText("b");
      close();
      open(GROUP_IF_BROKEN, k);
      sText("cc");
      sLine(0);
      sText("dd");
      close();
      sHardline();
      const f = open(GROUP);
      sText("x");
      close();
      open(GROUP_IF_BROKEN, f);
      sText("y");
      sLine(0);
      sText("z");
      close();
    });
    expect(out).toBe("aaaa\nbcc\ndd\nxy\nz");
  });

  it("measures a fitsExpanded broken over lines of any width, counting only the text around it", () => {
    const list = group([
      text("["),
      indent([softline, text("aaaaaaaaaaaa")]),
      softline,
      text("]"),
    ]);
    const doc = indent([
      hardline,
      group([text("f("), fitsExpanded(list), text(")"), line, text("x")]),
    ]);
    const out = ruffBoth(10, doc, () => {
      open(INDENT);
      sHardline();
      open(GROUP);
      sText("f(");
      openFitsExpanded(-1);
      open(GROUP);
      sText("[");
      open(INDENT);
      sLine(SOFT);
      sText("aaaaaaaaaaaa");
      close();
      sLine(SOFT);
      sText("]");
      close();
      close();
      sText(")");
      sLine(0);
      sText("x");
      close();
      close();
    });
    expect(out).toBe("\n  f([\n    aaaaaaaaaaaa\n  ]) x");
  });

  it("prints a bestFitParenthesize flat, else parenthesized when every line fits, else bare with its groups remeasured", () => {
    const cases: [Doc, () => void][] = [
      [[text("aa"), line, text("bb")], () => {
        sText("aa");
        sLine(0);
        sText("bb");
      }],
      [group([text("aaaa"), line, text("bbbb")]), () => {
        open(GROUP);
        sText("aaaa");
        sLine(0);
        sText("bbbb");
        close();
      }],
      [[text("cccccccccccc"), group([line, text("d")])], () => {
        sText("cccccccccccc");
        open(GROUP);
        sLine(0);
        sText("d");
        close();
      }],
    ];
    const doc = cases.map(([contents]) => [
      text("x = "),
      bestFitParenthesize(token(0, "("), contents, token(0, ")")),
      hardline,
    ]);
    const out = ruffBoth(10, doc, () => {
      for (const [, build] of cases) {
        sText("x = ");
        const k = openBestFitParenthesize(() => sToken(0, "("));
        build();
        closeBestFitParenthesize(k, () => sToken(0, ")"));
        sHardline();
      }
    });
    expect(out).toBe("x = aa bb\nx = (\n  aaaa\n  bbbb\n)\nx = cccccccccccc\nd\n");
  });

  it("prints a bestFitting's first variant that fits flat, on every line when it asks, else its last broken", () => {
    const cases: [boolean, Doc[], (() => void)[]][] = [
      [false, [text("aaaaaaaaaa"), text("bbbb"), [text("c"), line, text("d")]], [
        () => sText("aaaaaaaaaa"),
        () => sText("bbbb"),
        () => {
          sText("c");
          sLine(0);
          sText("d");
        },
      ]],
      [false, [text("aaaaaaaaaa"), [text("cc"), line, text("dd")]], [
        () => sText("aaaaaaaaaa"),
        () => {
          sText("cc");
          sLine(0);
          sText("dd");
        },
      ]],
      [true, [group([text("a"), hardline, text("123456789")], true), text("e")], [
        () => {
          open(GROUP, -1, BROKEN);
          sText("a");
          sHardline();
          sText("123456789");
          close();
        },
        () => sText("e"),
      ]],
    ];
    const doc = cases.map(([allLines, variants]) => [
      text("x="),
      bestFitting(variants, allLines),
      hardline,
    ]);
    const out = ruffBoth(8, doc, () => {
      for (const [allLines, , builds] of cases) {
        sText("x=");
        const k = openBestFitting(allLines);
        for (const build of builds) {
          const v = openVariant(k);
          build();
          closeVariant(v);
        }
        close();
        sHardline();
      }
    });
    expect(out).toBe("x=bbbb\nx=cc\ndd\nx=e\n");
  });
});
