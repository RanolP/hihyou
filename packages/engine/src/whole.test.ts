import { expect, test } from "vitest";
import type { FileDiff, NodeOutline } from "./fragments.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";

/** `null` on a side is the file absent there: added when `before` is null, deleted when `after` is. */
async function diff(
  files: { path: string; before: string | null; after: string | null }[],
): Promise<FileDiff[]> {
  const blobs: Record<string, string> = {};
  const id = (text: string | null, key: string) => {
    if (text === null) return null;
    blobs[key] = text;
    return key;
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: files.map((f, i) => ({
        path: f.path,
        before: id(f.before, `b${i}`),
        after: id(f.after, `a${i}`),
      })),
    }),
    readBlob: (key) => new TextEncoder().encode(blobs[key] ?? ""),
  });
  return (await engine.diffset("pr")).diff();
}

const nodes = (file: FileDiff | undefined, which: "before" | "after"): NodeOutline[] =>
  (file?.fragments ?? []).flatMap((f) => (f.kind === "diff" ? (f[which].nodes ?? []) : []));

const atomsOf = (file: FileDiff | undefined, which: "before" | "after") =>
  new Set(nodes(file, which).flatMap((n) => (n.changed && n.atom ? [n.atom] : [])));

const emphasized = (file: FileDiff | undefined) =>
  (file?.fragments ?? []).flatMap((f) =>
    f.kind === "diff" ? [...f.before.spans, ...f.after.spans].filter((s) => s.changed) : [],
  );

const fn = (name: string, body: string) => `function ${name}(xs: number[]) {
  let total = 0;
  for (const x of xs) total += x * 2;
  ${body}
}
`;

const source = `import { join } from "node:path";

export const root = join("a", "b");

${fn("sum", "return total;")}
export class Shop {
  open(): boolean {
    return true;
  }
}
`;

// Emphasizing every token of a new file paints the whole file green and says nothing the "added" status does not.
test("an added file carries its status and no diff emphasis, but keeps its syntax scopes", async () => {
  const [file] = await diff([{ path: "shop.ts", before: null, after: source }]);
  expect(file?.status).toBe("added");
  expect(emphasized(file)).toEqual([]);
  const spans = (file?.fragments ?? []).flatMap((f) => (f.kind === "diff" ? f.after.spans : []));
  expect(spans.some((s) => s.text === "Shop" && s.scope)).toBe(true);
});

// Without `whole` on the top nodes a viewer cannot say "added class Shop"; with fewer atoms than the leaves a
// reviewer can no longer mark part of a new file viewed.
test("an added file outlines its top nodes whole and keeps the leaf atoms it would have anyway", async () => {
  const [added, fromEmpty] = await diff([
    { path: "shop.ts", before: null, after: source },
    { path: "shop.ts", before: "", after: source },
  ]);
  const tops = nodes(added, "after").filter((n) => n.parent === -1);
  expect(tops.length).toBeGreaterThan(0);
  expect(tops.every((n) => n.whole === "added")).toBe(true);
  expect(tops.map((n) => n.label)).toContain("class Shop");
  expect(atomsOf(added, "after").size).toBeGreaterThan(tops.length);
  expect(atomsOf(added, "after")).toEqual(atomsOf(fromEmpty, "after"));
});

// A deleted file emphasized token by token, or collapsed below its leaves, is the added-file regression mirrored.
test("a deleted file carries its status, no diff emphasis, whole top nodes and its leaf atoms", async () => {
  const [file] = await diff([{ path: "shop.ts", before: source, after: null }]);
  expect(file?.status).toBe("deleted");
  expect(emphasized(file)).toEqual([]);
  const tops = nodes(file, "before").filter((n) => n.parent === -1);
  expect(tops.every((n) => n.whole === "deleted")).toBe(true);
  expect(atomsOf(file, "before").size).toBeGreaterThan(tops.length);
});

// Folding moved code into the new file's atom would drop its move box and leave the source file's half
// unpaired, so a function extracted into a new file would read as deleted there and silently re-added here.
test("code moved into an added file keeps its move and the atom it shares with the source file", async () => {
  const moving = fn("checksum", "return total >>> 0;");
  const files = await diff([
    { path: "a.ts", before: `export const name = "a";\n\n${moving}`, after: `export const name = "a";\n` },
    { path: "b.ts", before: null, after: `export const name = "b";\n\n${moving}` },
  ]);
  const [a, b] = files;
  const moved = nodes(b, "after").find((n) => n.kind === "function_declaration");
  expect(moved?.atom).toBeDefined();
  expect(moved?.whole).toBeUndefined();
  expect(atomsOf(a, "before").has(moved?.atom ?? "")).toBe(true);
  expect(nodes(b, "after").find((n) => n.kind === "export_statement")?.whole).toBe("added");
  const counterparts = (b?.fragments ?? []).flatMap((f) =>
    f.kind === "diff" ? (f.after.moves ?? []).map((m) => m.counterpart.path) : [],
  );
  expect(counterparts).toContain("a.ts");
});

// A new function emphasized token by token is a wall of green that hides the one thing to say: it was added.
test("a function added to an unchanged file is outlined whole with its label, unemphasized, its leaves still atoms", async () => {
  const [file] = await diff([
    { path: "x.ts", before: source, after: `${source}\n${fn("extra", "return -total;")}` },
  ]);
  expect(file?.status).toBeUndefined();
  expect(emphasized(file)).toEqual([]);
  const wholes = nodes(file, "after").filter((n) => n.whole);
  expect(wholes.map((n) => [n.kind, n.whole, n.label, n.parent])).toEqual([
    ["function_declaration", "added", "function extra", -1],
  ]);
  expect(atomsOf(file, "after").size).toBeGreaterThan(1);
});

// Reading any node with a `name` field as a declaration made an added JSX element or import name a silent
// "added Foo" with no emphasis, though neither declares anything.
test("an added multi-line JSX element and an added import specifier keep their emphasis", async () => {
  const view = (extra: string, child: string) => `import {
  a,${extra}
} from "./a";

export function View() {
  return (
    <div>
      <span>{a}</span>${child}
    </div>
  );
}
`;
  const [file] = await diff([
    {
      path: "view.tsx",
      before: view("", ""),
      after: view("\n  b,", '\n      <Item\n        id={b}\n        kind="row"\n      />'),
    },
  ]);
  const text = emphasized(file).map((s) => s.text).join("");
  expect(text).toContain("b");
  expect(text).toContain("Item");
  expect(nodes(file, "after").filter((n) => n.whole)).toEqual([]);
});

// Treating any insert as a whole unit would hide an added statement's emphasis inside a function that otherwise stayed.
test("a statement added inside an existing function keeps its leaf atoms and its emphasis", async () => {
  const [file] = await diff([
    { path: "x.ts", before: fn("f", "return total;"), after: fn("f", "log(total);\n  return total;") },
  ]);
  expect(emphasized(file).map((s) => s.text).join("")).toContain("log(total);");
  const changed = nodes(file, "after").filter((n) => n.changed);
  expect(changed.length).toBeGreaterThan(1);
  expect(changed.every((n) => n.whole === undefined)).toBe(true);
});
