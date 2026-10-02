import { expect, test } from "vitest";
import type { FileDiff, NodeOutline, Side } from "./fragments.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";

async function diff(
  files: { path: string; before: string; after: string }[],
): Promise<FileDiff[]> {
  const blobs: Record<string, string> = {};
  files.forEach((f, i) => {
    blobs[`b${i}`] = f.before;
    blobs[`a${i}`] = f.after;
  });
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: files.map((f, i) => ({
        path: f.path,
        before: `b${i}`,
        after: `a${i}`,
      })),
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  return (await engine.diffset("pr")).diff();
}

const sides = (file: FileDiff | undefined, which: "before" | "after"): Side[] =>
  (file?.fragments ?? []).flatMap((f) => (f.kind === "diff" ? [f[which]] : []));

const atoms = (file: FileDiff | undefined, which: "before" | "after") =>
  sides(file, which).flatMap((s) => (s.nodes ?? []).filter((n) => n.changed));

const fn = (name: string, body: string) => `function ${name}(xs: number[]) {
  let total = 0;
  for (const x of xs) total += x * 2;
  ${body}
}
`;

// A key carrying a line number or AstSteps resets every "viewed" mark below an edit whenever code above it grows.
test("an edit keeps its atom when lines are inserted above it", async () => {
  const before = fn("f", "return total + 1;");
  const after = fn("f", "return total + 2;");
  const pad = "const p = 1;\nconst q = 2;\n\n";
  const [plain] = await diff([{ path: "x.ts", before, after }]);
  const [shifted] = await diff([
    { path: "x.ts", before: pad + before, after: pad + after },
  ]);
  const keys = (f: FileDiff | undefined) =>
    atoms(f, "after").map((n) => n.atom);
  expect(keys(plain).length).toBeGreaterThan(0);
  expect(keys(shifted)).toEqual(keys(plain));
});

// Halves keyed apart leave an update or move half-viewed: marking one side never clears the other.
test("both halves of an update carry one atom", async () => {
  const [file] = await diff([
    {
      path: "x.ts",
      before: fn("f", "return total + 1;"),
      after: fn("f", "return total + 2;"),
    },
  ]);
  const before = atoms(file, "before");
  const after = atoms(file, "after");
  expect(before.map((n) => n.kind)).toEqual(["number"]);
  expect(after.map((n) => n.atom)).toEqual(before.map((n) => n.atom));
});

test("both halves of a move inside one file carry one atom", async () => {
  const [file] = await diff([
    {
      path: "x.ts",
      before: `${fn("f", "return total;")}\n${fn("g", "return -total;")}`,
      after: `${fn("g", "return -total;")}\n${fn("f", "return total;")}`,
    },
  ]);
  const moved = (which: "before" | "after") =>
    atoms(file, which).filter((n) => n.kind === "function_declaration");
  const [a] = moved("before");
  const [b] = moved("after");
  expect(a?.atom).toBeDefined();
  expect(b?.atom).toBe(a?.atom);
});

test("both halves of a move across files carry one atom", async () => {
  const moving = fn("checksum", "return total >>> 0;");
  const files = await diff([
    {
      path: "a.ts",
      before: `export const name = "a";\n\n${moving}`,
      after: `export const name = "a";\n`,
    },
    {
      path: "b.ts",
      before: `export const name = "b";\n`,
      after: `export const name = "b";\n\n${moving}`,
    },
  ]);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const [from] = atoms(byPath.get("a.ts"), "before").filter(
    (n) => n.kind === "function_declaration",
  );
  const [to] = atoms(byPath.get("b.ts"), "after").filter(
    (n) => n.kind === "function_declaration",
  );
  expect(from?.atom).toBeDefined();
  expect(to?.atom).toBe(from?.atom);
});

// A wrong `parent` nests a viewed node under a node it is not inside, so marking the parent marks the wrong code.
test("outline lists parents before children, each parent its nearest outlined ancestor", async () => {
  const [file] = await diff([
    {
      path: "x.ts",
      before: "const a = 1;\n",
      after: "const a = 1;\nconst y = { p: [1, 2], q: f(3) };\n",
    },
  ]);
  const [side] = sides(file, "after");
  const nodes: NodeOutline[] = side?.nodes ?? [];
  expect(nodes.length).toBeGreaterThan(3);
  const isPrefix = (p: number[], q: number[]) =>
    p.length < q.length && p.every((s, i) => q[i] === s);
  nodes.forEach((n, i) => {
    expect(n.parent).toBeLessThan(i);
    let nearest = -1;
    nodes.forEach((m, j) => {
      if (
        isPrefix(m.steps, n.steps) &&
        (nearest === -1 || m.steps.length > (nodes[nearest]?.steps.length ?? 0))
      )
        nearest = j;
    });
    expect(n.parent).toBe(nearest);
  });
});

// An inserted or deleted declaration kept as one atom can only be marked viewed whole, never piece by piece.
test("an inserted or deleted subtree is outlined down to its named leaves", async () => {
  const [file] = await diff([
    {
      path: "x.ts",
      before: "const a = 1;\nconst z = [7, 8];\n",
      after: "const a = 1;\nconst y = { p: [1, 2] };\n",
    },
  ]);
  const kinds = (which: "before" | "after") =>
    atoms(file, which).map((n) => n.kind);
  expect(kinds("after")).toEqual([
    "identifier",
    "property_identifier",
    "number",
    "number",
  ]);
  expect(kinds("before")).toEqual(["identifier", "number", "number"]);
  const all = sides(file, "after").flatMap((s) => s.nodes ?? []);
  expect(all.find((n) => n.kind === "lexical_declaration")?.changed).toBe(
    false,
  );
});
