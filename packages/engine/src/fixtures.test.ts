import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReviewDoc } from "./doc/build.js";
import { type FileDiff, ReviewDoc } from "./doc/schema.js";
import { createSyntaxParser } from "./parse/parser.js";
import { memorySource } from "./source/memory.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");
const parser = createSyntaxParser();

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
        id: 0,
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

  it("cross-file-move: functions moved to another file are moves shared by both files under one id, and one edited on the way adds only its inner update, not a delete here and an insert there", async () => {
    const doc = await fixture("cross-file-move");
    const summary = (f: FileDiff | undefined) =>
      f?.edits.map((e) => ({
        id: e.id,
        kind: e.kind,
        node: e.node,
        other: e.kind === "update" || e.kind === "move" ? (e.from ?? e.to) : "",
      }));
    const [text, util] = doc.files;
    expect(text?.path).toBe("src/text.ts");
    expect(summary(text)).toEqual([
      { id: 0, kind: "move", node: "export_statement", other: "src/util.ts" },
      { id: 1, kind: "move", node: "export_statement", other: "src/util.ts" },
      { id: 2, kind: "update", node: "number", other: "src/util.ts" },
    ]);
    expect(summary(util)).toEqual(
      summary(text)?.map((e) => ({ ...e, other: "src/text.ts" })),
    );
    expect(text?.edits[2]).toMatchObject({
      old: { start: { line: 12, column: 46 } },
      new: { start: { line: 8, column: 46 } },
    });
    expect(doc.groups).toEqual([
      expect.objectContaining({
        kind: "move",
        fromPath: "src/util.ts",
        toPath: "src/text.ts",
        names: ["slugify", "truncate"],
        edits: [0, 1, 2],
      }),
    ]);
  });

  it("identifier-rename: a function renamed at its declaration, import and calls in two files is one rename group, not four unrelated updates", async () => {
    const doc = await fixture("identifier-rename");
    const ids = doc.files.flatMap((f) => f.edits.map((e) => e.id));
    expect(ids).toHaveLength(4);
    expect(doc.groups).toEqual([
      expect.objectContaining({
        kind: "rename-symbol",
        from: "total",
        to: "sumAll",
        path: "src/cart.ts",
        edits: ids.toSorted((p, q) => p - q),
      }),
    ]);
  });

  it("signature-change: a parameter added to an exported function is grouped with the argument added at its call in another file", async () => {
    const doc = await fixture("signature-change");
    const table = doc.files.find((f) => f.path === "src/table.ts");
    const [group] = doc.groups;
    expect(group).toMatchObject({
      kind: "signature",
      name: "padStart",
      path: "src/pad.ts",
    });
    expect(table?.edits.length).toBeGreaterThan(0);
    for (const e of table?.edits ?? []) expect(group?.edits).toContain(e.id);
    expect(group?.risk.reasons[0]?.signal).toBe("exported-api");
  });

  it("file-rename-import: a renamed file is grouped with the import path updated to follow it", async () => {
    const doc = await fixture("file-rename-import");
    const post = doc.files.find((f) => f.path === "src/post.ts");
    expect(doc.groups).toEqual([
      expect.objectContaining({
        kind: "rename-file",
        fromPath: "src/slug.ts",
        toPath: "src/text/slug.ts",
        copy: false,
        edits: post?.edits.map((e) => e.id),
      }),
    ]);
  });

  it("risk-order: a changed comparison in a condition ranks above a renamed local, with both reasons named, whatever the path order", async () => {
    const doc = await fixture("risk-order");
    expect(doc.files.map((f) => f.path)).toEqual([
      "src/guard.ts",
      "src/format.ts",
    ]);
    const [guard, format] = doc.files;
    expect(guard?.risk.reasons.map((r) => r.signal)).toEqual([
      "condition",
      "operator",
    ]);
    expect(format?.risk.reasons.map((r) => r.signal)).toEqual(["renamed"]);
    expect(guard?.risk.score).toBeGreaterThan(format?.risk.score ?? 0);
  });

  it("cross-file-guard-move: an auth guard moved from one endpoint to another is one move, and it leaves both files unfolded, so the endpoint that lost its check is not hidden", async () => {
    const doc = await fixture("cross-file-guard-move");
    expect(doc.groups).toEqual([
      expect.objectContaining({ kind: "move", fromPath: "api/delete.ts" }),
    ]);
    expect(doc.files.map((f) => [f.path, f.fold])).toEqual([
      ["api/delete.ts", undefined],
      ["api/read.ts", undefined],
    ]);
  });

  it("exported-function-move: an exported function moved verbatim to another file is one move, and neither file folds", async () => {
    const doc = await fixture("exported-function-move");
    expect(doc.groups).toEqual([
      expect.objectContaining({
        kind: "move",
        fromPath: "a.ts",
        toPath: "b.ts",
        names: ["clamp"],
      }),
    ]);
    for (const f of doc.files) expect(f.fold).toBeUndefined();
  });

  it("decorated-move: a decorated Python function moved and edited on the way moves whole with its decorator, not as a moved def beside a deleted and an inserted decorator", async () => {
    const doc = await fixture("decorated-move");
    const moves = doc.files.flatMap((f) =>
      f.edits.filter((e) => e.kind === "move"),
    );
    expect(new Set(moves.map((e) => e.node))).toEqual(
      new Set(["decorated_definition"]),
    );
    expect(doc.groups).toEqual([
      expect.objectContaining({ kind: "move", names: ["load"] }),
    ]);
    for (const f of doc.files)
      expect(f.edits.filter((e) => e.kind === "delete")).toEqual([]);
  });

  for (const [name, fLine] of [
    ["signature-overlap", 5],
    ["signature-overlap-swapped", 1],
  ] as const)
    it(`${name}: an argument added to a call in f's parameter default joins f's signature group with f's imported call, never g's too, whichever function is declared first`, async () => {
      const doc = await fixture(name);
      const a = doc.files.find((f) => f.path === "a.ts");
      const b = doc.files.find((f) => f.path === "b.ts");
      const inF = (a?.edits ?? [])
        .filter((e) => "new" in e && e.new.start.line === fLine)
        .map((e) => e.id);
      expect(inF).toHaveLength(2);
      expect(doc.groups).toEqual([
        expect.objectContaining({
          kind: "signature",
          name: "f",
          path: "a.ts",
          edits: [...inF, ...(b?.edits ?? []).map((e) => e.id)],
        }),
      ]);
      const ids = doc.groups.flatMap((g) => g.edits);
      expect(new Set(ids).size).toBe(ids.length);
    });

  for (const name of ["json-pair-move", "import-move"])
    it(`${name}: a JSON pair or an import line moved between files is not reported as a move`, async () => {
      const doc = await fixture(name);
      expect(doc.groups.filter((g) => g.kind === "move")).toEqual([]);
      for (const f of doc.files) expect(f.fold).toBeUndefined();
    });

  for (const [name, dir] of [
    ["signature-foreign-call", ""],
    ["signature-foreign-call-python", "pkg/"],
    ["signature-namespace-import", ""],
  ] as const)
    it(`${name}: a call through an import of the declaring file joins its signature group, and a same-named call imported from a package stays out`, async () => {
      const doc = await fixture(name);
      // Only line 1 of pad is its signature; line 2 is its body.
      const idsOf = (stem: string, line?: number) =>
        doc.files
          .find((f) => f.path.startsWith(`${dir}${stem}.`))
          ?.edits.filter(
            (e) =>
              line === undefined || ("new" in e && e.new.start.line === line),
          )
          .map((e) => e.id) ?? [];
      expect(idsOf("table").length).toBeGreaterThan(0);
      expect(doc.groups).toEqual([
        expect.objectContaining({
          kind: "signature",
          name: "pad",
          edits: [...idsOf("pad", 1), ...idsOf("table")].toSorted(
            (p, q) => p - q,
          ),
        }),
      ]);
    });

  it("unrelated-renames: the same local renamed alike in two unlinked files is two rename groups, not one cross-file rename", async () => {
    const doc = await fixture("unrelated-renames");
    expect(doc.groups.map((g) => g.kind === "rename-symbol" && g.path)).toEqual(
      ["x.ts", "y.ts"],
    );
  });

  it("property-rename: an exported variable renamed in one file does not absorb a same-named property renamed in a file that never imports it", async () => {
    const doc = await fixture("property-rename");
    const x = doc.files.find((f) => f.path === "x.ts");
    expect(doc.groups).toEqual([
      expect.objectContaining({
        kind: "rename-symbol",
        from: "data",
        to: "items",
        edits: x?.edits.map((e) => e.id),
      }),
    ]);
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
        id: 0,
        old: { start: { line: 4, column: 1 }, end: { line: 4, column: 21 } },
      },
      {
        kind: "insert",
        id: 1,
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

  it("swap-arguments: an argument swapped past another is too small to call moved, so it is one delete plus one insert of that argument, never touching the comma", async () => {
    const file = await onlyFile("swap-arguments");
    expect(file.edits).toEqual([
      expect.objectContaining({ kind: "delete", node: "identifier" }),
      expect.objectContaining({ kind: "insert", node: "identifier" }),
    ]);
  });

  it("ReviewDoc round-trips through its zod schema without losing or rejecting any field", async () => {
    const docs = await Promise.all(readdirSync(fixtures).map(fixture));
    for (const doc of docs) {
      expect(ReviewDoc.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    }
  });
});
