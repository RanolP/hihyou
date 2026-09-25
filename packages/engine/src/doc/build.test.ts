import { describe, expect, it } from "vitest";
import { nodeGrammarLocator } from "../parse/grammars.node.js";
import { createSyntaxParser } from "../parse/parser.js";
import type { FileSource } from "../source/file-source.js";
import { memorySource } from "../source/memory.js";
import { buildReviewDoc } from "./build.js";
import type { FileDiff } from "./schema.js";

const parser = createSyntaxParser({ locateGrammar: nodeGrammarLocator });

async function diff(
  path: string,
  before: string | Uint8Array,
  after: string | Uint8Array,
): Promise<FileDiff> {
  const doc = await buildReviewDoc(
    memorySource({ [path]: before }, { [path]: after }),
    { parser },
  );
  expect(doc.files).toHaveLength(1);
  const [file] = doc.files;
  if (!file) throw new Error("no file diff");
  return file;
}

describe("decoding", () => {
  it("changed Latin-1 bytes are binary/undecodable, not zero edits from both sides decoding to U+FFFD", async () => {
    const file = await diff(
      "menu.txt",
      new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]),
      new Uint8Array([0x63, 0x61, 0x66, 0xe8, 0x0a]),
    );
    expect(file).toMatchObject({
      diffMode: "binary",
      fallbackReason: "undecodable",
      edits: [],
    });
  });
});

describe("matcher budget", () => {
  it("an 800-link method chain falls back to line mode as too-large within 1 s instead of stalling in cubic matching", async () => {
    const calls = Array.from({ length: 800 }, (_, i) => `.m${i}()`).join("");
    const started = performance.now();
    const file = await diff("chain.js", `q${calls};\n`, `z${calls};\n`);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(file).toMatchObject({
      diffMode: "line",
      fallbackReason: "too-large",
    });
    expect(file.edits).not.toEqual([]);
  });
});

describe("line mode compares tokens, so whitespace counts only where syntax gives it meaning", () => {
  it("dedenting a YAML key is an edit, since it moves the key to another mapping", async () => {
    const file = await diff(
      "a.yaml",
      "a:\n  b: 1\n  c: 2\n",
      "a:\n  b: 1\nc: 2\n",
    );
    expect(file.diffMode).toBe("line");
    expect(file.edits).toEqual([
      expect.objectContaining({ kind: "delete" }),
      expect.objectContaining({ kind: "insert" }),
    ]);
  });

  it("a Python file on the parse-error fallback still reports a statement dedented out of its loop", async () => {
    const file = await diff(
      "a.py",
      "for x in y:\n    a(\n    b()\nreturn 1\n",
      "for x in y:\n    a(\nb()\nreturn 1\n",
    );
    expect(file).toMatchObject({
      diffMode: "line",
      fallbackReason: "parse-error",
    });
    expect(file.edits).toEqual([
      expect.objectContaining({
        kind: "delete",
        old: { start: { line: 3, column: 1 }, end: { line: 3, column: 8 } },
      }),
      expect.objectContaining({
        kind: "insert",
        new: { start: { line: 3, column: 1 }, end: { line: 3, column: 4 } },
      }),
    ]);
  });

  it("joining two words (`is not` to `isnot`) is an edit, not erased by stripping whitespace", async () => {
    const file = await diff("a.md", "this is not ok\n", "this isnot ok\n");
    expect(file.edits).toHaveLength(2);
  });

  it("collapsing a run of spaces between the same words is zero edits", async () => {
    const file = await diff(
      "a.md",
      "this is  not ok\n  indented\n",
      "this is not ok\nindented\n",
    );
    expect(file.edits).toEqual([]);
  });
});

describe("failures", () => {
  it("one unreadable file becomes an error entry carrying the cause, and the other files still get their edits", async () => {
    const inner = memorySource(
      { "ok.ts": "1;\n", "broken.ts": "1;\n" },
      { "ok.ts": "2;\n", "broken.ts": "2;\n" },
    );
    const source: FileSource = {
      ...inner,
      read: (side, path) =>
        path === "broken.ts"
          ? Promise.reject(new Error("object missing"))
          : inner.read(side, path),
    };
    const doc = await buildReviewDoc(source, { parser });
    expect(doc.files).toEqual([
      {
        path: "broken.ts",
        status: "modified",
        language: "typescript",
        diffMode: "error",
        error: "object missing",
        edits: [],
      },
      expect.objectContaining({
        path: "ok.ts",
        diffMode: "ast",
        edits: [expect.objectContaining({ kind: "update" })],
      }),
    ]);
  });
});
