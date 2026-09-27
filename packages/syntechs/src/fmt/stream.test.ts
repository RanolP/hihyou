import { describe, expect, it } from "vitest";
import {
  BLANK,
  BROKEN,
  CHOICE,
  COLLAPSE,
  canBreak,
  close,
  flatText,
  flattenBreaks,
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
  openDead,
  closeDead,
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

/** Prints the stream `build` appends. */
function printed(lineWidth: number, build: () => void) {
  resetStream();
  build();
  return printStream(layout(lineWidth)).text;
}

describe("printStream", () => {
  it("counts a run of flat lines as one space when measuring, as prettier's fits does", () => {
    const out = printed(3, () => {
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
    const out = printed(1, () => {
      sText("a");
      sLine(0);
      open(GROUP);
      sLine(0);
      sText("b");
      close();
    });
    expect(out).toBe("a\n\nb");
  });

  it("measures the fill parts after the next separator in the fill's own mode, not the separator's", () => {
    const out = printed(10, () => {
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
    });
    expect(out).toBe("x\na b c\ndddddddddddd");
  });

  it("measures a group inside a flushed line suffix against the queued suffixes, not the text already printed", () => {
    const out = printed(12, () => {
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
    });
    expect(out).toBe("azz //b\nc 12345\n");
  });

  it("prints a trailing fill separator in its item's mode, not the previous separator's", () => {
    const out = printed(5, () => {
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
    const out = printed(4, () => {
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
    const out = printed(80, () => {
      sText("a");
      open(LINE_SUFFIX);
      sText(" x");
      open(LINE_SUFFIX);
      sText(" y");
      close();
      close();
      sHardline();
      sText("b");
    });
    expect(out).toBe("a x y\nb");
  });

  it("breaks a group whose flat measure passes a line suffix and then reaches a boundary after it, as prettier's hasLineSuffix", () => {
    const out = printed(80, () => {
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
    });
    expect(out).toBe("a\nb //\nc");
  });

  it("breaks a group holding a boundary while a suffix is pending, and prints nothing for a boundary with none", () => {
    const out = printed(80, () => {
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
    });
    expect(out).toBe("xa //\nb");
  });

  it("aligns past the enclosing indent and dedents back out of it, as prettier's align and dedent", () => {
    const out = printed(80, () => {
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
    });
    expect(out).toBe("\n  a\n     b\nc");
  });
});

describe("printStream for conditional groups", () => {
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
      printed(w, () =>
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
    const out = printed(6, () => {
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
    });
    expect(out).toBe("a\nb c");
  });

  // Propagated past the choice, a later state's break would break every call holding an expandable argument.
  it("leaves the groups around flat for a break parent in a later state", () => {
    const out = printed(80, () => {
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
    });
    expect(out).toBe("x a");
  });

  it("finds a fill's next item past a separator holding an ifBreak", () => {
    const out = printed(8, () => {
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
    });
    expect(out).toBe("aaaa-bbbb");
  });
});

describe("printStream for a shared part printed through a jump", () => {
  // A part built once as a span; `jump` prints it again.
  const span = (build: () => void): number => {
    const t = openSpan();
    build();
    closeSpan();
    return t;
  };

  it("decides a jumped group by what follows the jump, not what follows the span", () => {
    const out = printed(6, () => {
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
    const out = printed(6, () => {
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
    const out = printed(3, () => {
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
    const out = printed(5, () => {
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

describe("printStream for a part printed flat, as prettier's removeLines rebuilds it", () => {
  const flat = (build: () => void) => {
    openFlat();
    build();
    closeFlat();
  };

  it("prints a flat part's lines flat and its ifBreak's flat branch where its own group would break", () => {
    const out = printed(4, () =>
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
    const out = printed(80, () => {
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
    const out = printed(80, () => {
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
    const out = printed(8, () => {
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

  // The JS printer flattens `${a.map((x) => x)}` so: the hugged call's conditional group takes its first state.
  it("prints and measures a flattened substitution's conditional group by its first state", () => {
    const out = printed(5, () => {
      open(GROUP);
      sText("x");
      sLine(0);
      openFlat(true);
      openChoice(false);
      openState();
      open(GROUP);
      sText("s");
      sLine(0);
      sText("t");
      close();
      closeState();
      openState();
      sText("longstate");
      closeState();
      closeChoice();
      closeFlat();
      close();
    });
    expect(out).toBe("x s t");
  });

  it("prints a span flat through a jump in a flat part, and decided where it is jumped to outside one", () => {
    const out = printed(3, () => {
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

describe("printStream with a part abandoned mid-build, as ArgExpansionBailout abandons one", () => {
  it("neither prints nor measures an abandoned part, nor lets its break parents and open intervals reach around", () => {
    let g = -1;
    const out = printed(5, () => {
      g = open(GROUP);
      sText("aa");
      sLine(0);
      const d = openDead();
      open(GROUP);
      sText("a long abandoned text");
      sHardline();
      open(IF_BROKEN);
      sBreakParent();
      sLine(0);
      closeDead(d);
      sText("bb");
      close();
    });
    expect(out).toBe("aa bb");
    expect(willBreak(g)).toBe(false);
    expect(canBreak(g)).toBe(true);
  });

  it("prints a span closed inside an abandoned part through a jump, decided where it is jumped to", () => {
    const build = () => {
      const d = openDead();
      open(GROUP);
      const t = openSpan();
      open(GROUP);
      sText("aa");
      sLine(0);
      sText("bb");
      close();
      closeSpan();
      sHardline();
      closeDead(d);
      open(GROUP);
      sText("cc");
      sLine(0);
      sJump(t);
      close();
    };
    expect(printed(12, build)).toBe("cc aa bb");
    expect(printed(5, build)).toBe("cc\naa bb");
  });
});

describe("the range queries", () => {
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

  // A hard line appended without its break parent breaks nothing around it, so a willBreak reading only flags
  // would call it unbreaking; willBreak sees the hard line.
  it("willBreak sees a hard line without a break parent, where removeLines keeps it, and not in a literal token", () => {
    const cases: (() => number)[] = [
      () =>
        wrapped(GROUP, () => {
          sText("a");
          sLine(HARD);
        }),
      () => wrapped(INDENT, () => wrapped(IF_BROKEN, () => sLine(HARD))),
      () => wrapped(INDENT, () => sLiteral(0, "a\nb")),
      () => {
        const k = openFlat();
        wrapped(IF_BROKEN, () => sLine(HARD));
        wrapped(IF_FLAT, () => sText("a"));
        closeFlat();
        return k;
      },
      () => {
        const k = openFlat();
        choice([
          () => sText("a"),
          () => {
            sText("b");
            sLine(HARD);
          },
        ]);
        closeFlat();
        return k;
      },
      () => {
        const k = openFlat();
        choice([
          () => {
            sText("a");
            sLine(HARD);
          },
          () => sText("b"),
        ]);
        closeFlat();
        return k;
      },
    ];
    resetStream();
    const t = span(() => sLine(HARD));
    const viaJump = wrapped(INDENT, () => sJump(t));
    expect(cases.map((build) => willBreak(build()))).toEqual([
      true,
      true,
      false,
      false,
      true,
      false,
    ]);
    expect(willBreak(viaJump)).toBe(true);
  });

  it("canBreak sees a line in any state and through a jump, and no line in a boundary", () => {
    resetStream();
    const later = choice([() => sText("a"), () => sLine(SOFT)]);
    const t = span(() => sLine(0));
    const viaJump = wrapped(INDENT, () => sJump(t));
    const boundary = wrapped(INDENT, () => sLineSuffixBoundary());
    const textOnly = wrapped(GROUP, () => sText("a"));
    expect([
      canBreak(later),
      canBreak(viaJump),
      canBreak(boundary),
      canBreak(textOnly),
    ]).toEqual([true, true, false, false]);
  });

  // The JS printer's flatten of a template substitution reads a choice's first state, so a query reading the
  // last one, as removeLines does, would flatten (or keep broken) the wrong substitutions.
  it("a flattened substitution's queries read each choice's first state, and flattenBreaks every break in it", () => {
    resetStream();
    const hardFirst = () =>
      choice([
        () => {
          sText("a");
          sHardline();
        },
        () => sText("b"),
      ]);
    const hardLast = () =>
      choice([
        () => sText("a"),
        () => {
          sText("b");
          sHardline();
        },
      ]);
    const flat = (build: () => void) => {
      const k = openFlat(true);
      build();
      closeFlat();
      return k;
    };
    const first = flat(hardFirst);
    const last = flat(hardLast);
    expect([
      willBreak(first),
      willBreak(last),
      canBreak(first),
      canBreak(last),
    ]).toEqual([true, false, true, false]);
    const viaJump = span(hardFirst);
    const shouldBreak = span(() => {
      open(GROUP, -1, BROKEN);
      sText("a");
      close();
    });
    const lined = span(() => sText("a\nb"));
    const ifBroken = span(() => wrapped(IF_BROKEN, () => sHardline()));
    expect(
      [
        span(hardFirst),
        span(hardLast),
        wrapped(INDENT, () => sJump(viaJump)),
        shouldBreak,
        lined,
        ifBroken,
      ].map(flattenBreaks),
    ).toEqual([true, false, true, true, true, false]);
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
    expect([
      flatText(textual),
      flatText(lined),
      flatText(breaking),
      flatText(indented),
    ]).toEqual(["abc", undefined, undefined, undefined]);
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

/** As `printed`, measuring as ruff does. */
function ruffPrinted(lineWidth: number, build: () => void) {
  resetStream(true);
  build();
  return printStream({ ...layout(lineWidth), ruff: true }).text;
}

describe("printStream under ruff's measure", () => {
  it("counts every flat space where it stands, a run of lines included", () => {
    const out = ruffPrinted(3, () => {
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
    const out = ruffPrinted(8, () => {
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
    const out = ruffPrinted(6, () => {
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
    const out = ruffPrinted(80, () => {
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
    const out = ruffPrinted(4, () => {
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
    const out = ruffPrinted(4, () => {
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
    const out = ruffPrinted(10, () => {
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
    const cases: (() => void)[] = [
      () => {
        sText("aa");
        sLine(0);
        sText("bb");
      },
      () => {
        open(GROUP);
        sText("aaaa");
        sLine(0);
        sText("bbbb");
        close();
      },
      () => {
        sText("cccccccccccc");
        open(GROUP);
        sLine(0);
        sText("d");
        close();
      },
    ];
    const out = ruffPrinted(10, () => {
      for (const build of cases) {
        sText("x = ");
        const k = openBestFitParenthesize(() => sToken(0, "("));
        build();
        closeBestFitParenthesize(k, () => sToken(0, ")"));
        sHardline();
      }
    });
    expect(out).toBe(
      "x = aa bb\nx = (\n  aaaa\n  bbbb\n)\nx = cccccccccccc\nd\n",
    );
  });

  it("prints a bestFitting's first variant that fits flat, on every line when it asks, else its last broken", () => {
    const cases: [boolean, (() => void)[]][] = [
      [
        false,
        [
          () => sText("aaaaaaaaaa"),
          () => sText("bbbb"),
          () => {
            sText("c");
            sLine(0);
            sText("d");
          },
        ],
      ],
      [
        false,
        [
          () => sText("aaaaaaaaaa"),
          () => {
            sText("cc");
            sLine(0);
            sText("dd");
          },
        ],
      ],
      [
        true,
        [
          () => {
            open(GROUP, -1, BROKEN);
            sText("a");
            sHardline();
            sText("123456789");
            close();
          },
          () => sText("e"),
        ],
      ],
    ];
    const out = ruffPrinted(8, () => {
      for (const [allLines, builds] of cases) {
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
