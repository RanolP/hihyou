import {
  buildReviewDoc,
  createSyntaxParser,
  type FileDiff,
  memorySource,
} from "@hihyou/engine";
import { nodeGrammarLocator } from "@hihyou/engine/node";
import { describe, expect, it } from "vitest";
import { align } from "./align.js";
import { createFormatter } from "./format.js";
import { nodeRuffWasm } from "./node.js";
import { presentFile, type SideView } from "./view.js";

const parser = createSyntaxParser({ locateGrammar: nodeGrammarLocator });
const formatter = createFormatter({ ruffWasm: nodeRuffWasm });

async function present(path: string, before: string, after: string) {
  const doc = await buildReviewDoc(
    memorySource({ [path]: before }, { [path]: after }),
    { parser },
  );
  const file = doc.files[0] as FileDiff;
  return {
    file,
    view: await presentFile(file, { old: before, new: after }, formatter),
  };
}

/** Every highlighted slice of one side, with the line it sits on. */
function highlighted(side: SideView) {
  return side.lines.flatMap((line) =>
    line.highlights.map((h) => ({
      kind: h.kind,
      text: line.text.slice(h.from, h.to),
      line: line.text,
      originalLine: line.originalLine,
    })),
  );
}

describe("presentFile", () => {
  it("an edit on a line the formatter breaks apart still highlights the edited token on its new line", async () => {
    const before = `export const config = { name: "hihyou", retries: 3, timeoutMs: 1000, verbose: false, label: "a long label" };\n`;
    const after = before.replace("retries: 3", "retries: 5");
    const { view } = await present("config.ts", before, after);

    expect(view.new.formatted).toBe(true);
    expect(view.new.lines.length).toBeGreaterThan(1);
    expect(highlighted(view.new)).toEqual([
      { kind: "update", text: "5", line: "  retries: 5,", originalLine: 1 },
    ]);
    expect(highlighted(view.old)).toEqual([
      { kind: "update", text: "3", line: "  retries: 3,", originalLine: 1 },
    ]);
  });

  it("a renamed parameter the formatter wraps in added parentheses highlights only the name, not the parenthesis", async () => {
    const { view } = await present(
      "f.ts",
      "const f = a => a + 1\n",
      "const f = b => b + 1\n",
    );
    expect(view.new.lines.map((l) => l.text)).toEqual([
      "const f = (b) => b + 1;",
    ]);
    expect(highlighted(view.new).map((h) => h.text)).toEqual(["b", "b"]);
  });

  it("a move keeps a pointer to the other side's original line so the viewer can link it", async () => {
    const before = "def a():\n    return 1\n\n\ndef b():\n    return 2\n";
    const after = "def b():\n    return 2\n\n\ndef a():\n    return 1\n";
    const { file, view } = await present("m.py", before, after);
    const move = file.edits.find((e) => e.kind === "move");
    if (move?.kind !== "move") throw new Error("expected a move edit");
    const pointers = (v: SideView) =>
      v.lines.flatMap((l) => l.highlights.flatMap((h) => h.peerLine ?? []));
    expect(pointers(view.new)).toContain(move.old.start.line);
    expect(pointers(view.old)).toContain(move.new.start.line);
  });

  it("when only one side formats, both are shown as committed so the formatter's rewrites do not appear as changes", async () => {
    const before = "const x = {a:1}\nconst y = 2\n";
    const after = "const x = {a:1}\nconst y = (\n";
    const { view } = await present("p.ts", before, after);
    expect(view.new).toMatchObject({
      formatted: false,
      reason: "formatter-error",
    });
    expect(view.old).toMatchObject({
      formatted: false,
      reason: "other-side-unformatted",
    });
    expect(view.unified[0]).toEqual({ old: 0, new: 0, changed: false });
  });
});

describe("align", () => {
  it("a span whose parentheses the formatter dropped maps onto the surviving token instead of collapsing", () => {
    const alignment = align("x = (1)\n", "x = 1\n");
    expect(alignment?.range(4, 7)).toEqual([4, 5]);
  });

  it("a whitespace-only span becomes a point before the next token rather than an inverted range", () => {
    const alignment = align("a  b\n", "a b\n");
    expect(alignment?.range(1, 3)).toEqual([2, 2]);
  });

  it("a line holding only characters the formatter inserted has no original line, rather than borrowing a neighbour's", () => {
    const alignment = align("a\nb\n", "a\n(\nb\n)\n");
    expect(alignment?.original(2, 4)).toBeUndefined();
    expect(alignment?.original(6, 8)).toBeUndefined();
    expect(alignment?.original(4, 6)).toBe(2);
  });
});
