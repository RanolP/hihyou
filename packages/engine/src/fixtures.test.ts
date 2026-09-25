import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReviewDoc } from "./doc/build.js";
import { type FileDiff, ReviewDoc } from "./doc/schema.js";
import { nodeGrammarLocator } from "./parse/grammars.node.js";
import { createSyntaxParser } from "./parse/parser.js";
import { memorySource } from "./source/memory.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");
const parser = createSyntaxParser({ locateGrammar: nodeGrammarLocator });

function tree(dir: string): Record<string, string> {
  const files = readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  }).filter((e) => e.isFile());
  return Object.fromEntries(
    files.map((e) => {
      const path = join(e.parentPath, e.name);
      return [
        relative(dir, path).replaceAll("\\", "/"),
        readFileSync(path, "utf8"),
      ];
    }),
  );
}

async function fixture(name: string) {
  const dir = join(fixtures, name);
  return buildReviewDoc(
    memorySource(tree(join(dir, "before")), tree(join(dir, "after"))),
    { parser },
  );
}

async function onlyFile(name: string): Promise<FileDiff> {
  const doc = await fixture(name);
  expect(doc.files).toHaveLength(1);
  return doc.files[0] as FileDiff;
}

describe("fixtures", () => {
  it("reformat-only: whitespace and line-break changes yield zero edits, not content changes", async () => {
    const file = await onlyFile("reformat-only");
    expect(file).toMatchObject({
      status: "modified",
      diffMode: "ast",
      fold: "format-only",
    });
    expect(file.edits).toEqual([]);
  });

  it("leaf-update: a changed literal is one update, not a delete plus an insert", async () => {
    const file = await onlyFile("leaf-update");
    expect(file.diffMode).toBe("ast");
    expect(file.fold).toBeUndefined();
    expect(file.edits).toEqual([
      {
        kind: "update",
        node: "number",
        old: { start: { line: 2, column: 19 }, end: { line: 2, column: 20 } },
        new: { start: { line: 2, column: 19 }, end: { line: 2, column: 20 } },
      },
    ]);
  });

  it("file-rename: a file moved to another directory unchanged is one rename with no edits, not a delete plus an add", async () => {
    const file = await onlyFile("file-rename");
    expect(file).toMatchObject({
      status: "renamed",
      path: "src/text/slug.ts",
      oldPath: "src/slug.ts",
      edits: [],
      fold: "renamed",
    });
  });

  it("operator-change: `<` to `<=` is one update of the operator, not a delete plus an insert", async () => {
    const file = await onlyFile("operator-change");
    expect(file.edits).toEqual([
      expect.objectContaining({
        kind: "update",
        node: "<",
        old: { start: { line: 2, column: 30 }, end: { line: 2, column: 31 } },
        new: { start: { line: 2, column: 30 }, end: { line: 2, column: 32 } },
      }),
    ]);
  });

  it("jsx-text-reflow: re-wrapping JSX text across lines and collapsing its spaces yields zero edits, not a jsx_text update", async () => {
    const file = await onlyFile("jsx-text-reflow");
    expect(file).toMatchObject({ language: "tsx", diffMode: "ast" });
    expect(file.edits).toEqual([]);
  });

  it("reorder-functions: swapping two functions is a move, not delete+insert of whole bodies, and folds as moved", async () => {
    const file = await onlyFile("reorder-functions");
    expect(file.fold).toBe("moved");
    expect(file.edits).toEqual([
      expect.objectContaining({ kind: "move", node: "function_declaration" }),
    ]);
  });

  it("unsupported-language-fallback: a .md file gets whitespace-insensitive line-mode hunks", async () => {
    const file = await onlyFile("unsupported-language-fallback");
    expect(file).toMatchObject({
      language: null,
      diffMode: "line",
      fallbackReason: "unsupported-language",
    });
    expect(file.edits).toEqual([
      {
        kind: "delete",
        old: { start: { line: 4, column: 1 }, end: { line: 4, column: 21 } },
      },
      {
        kind: "insert",
        new: { start: { line: 4, column: 1 }, end: { line: 4, column: 25 } },
      },
    ]);
  });

  it("json-key-change: a renamed key is one update of the key string, leaving its value matched", async () => {
    const file = await onlyFile("json-key-change");
    expect(file).toMatchObject({ language: "json", diffMode: "ast" });
    expect(file.edits).toEqual([
      expect.objectContaining({
        kind: "update",
        node: "string_content",
        old: { start: { line: 4, column: 17 }, end: { line: 4, column: 21 } },
      }),
    ]);
  });

  it("python-edit: an added guard is one insert and a changed default is one update; untouched lines stay matched", async () => {
    const file = await onlyFile("python-edit");
    expect(file).toMatchObject({ language: "python", diffMode: "ast" });
    expect(file.edits).toEqual([
      expect.objectContaining({ kind: "update", node: "integer" }),
      expect.objectContaining({
        kind: "insert",
        node: "if_statement",
        new: { start: { line: 2, column: 5 }, end: { line: 3, column: 19 } },
      }),
    ]);
  });

  it("insert-sibling: an inserted key is one insert plus its comma; the keys after it are not reported as moved", async () => {
    const file = await onlyFile("insert-sibling");
    expect(file.edits).toEqual([
      expect.objectContaining({
        kind: "insert",
        node: "pair",
        new: { start: { line: 3, column: 3 }, end: { line: 3, column: 21 } },
      }),
      expect.objectContaining({ kind: "insert", node: "," }),
    ]);
  });

  it("remove-duplicate-sibling: deleting one of several identical statements is one delete of a copy, not a move across b() plus a delete of the last copy", async () => {
    const file = await onlyFile("remove-duplicate-sibling");
    expect(file.edits).toHaveLength(1);
    expect(file.edits[0]).toMatchObject({
      kind: "delete",
      node: "expression_statement",
    });
    expect(
      file.edits[0]?.kind === "delete" && file.edits[0].old.start.line,
    ).toBeLessThanOrEqual(2);
  });

  it("swap-arguments: swapping two arguments moves one argument and never reports the comma as moved", async () => {
    const file = await onlyFile("swap-arguments");
    expect(file.edits).toEqual([
      expect.objectContaining({ kind: "move", node: "identifier" }),
    ]);
  });

  it("ReviewDoc round-trips through its zod schema without losing or rejecting any field", async () => {
    const docs = await Promise.all(readdirSync(fixtures).map(fixture));
    for (const doc of docs) {
      expect(ReviewDoc.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    }
  });
});
