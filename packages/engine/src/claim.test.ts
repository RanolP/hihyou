import { parseTree, type Tree } from "syntechs/core";
import { expect, test } from "vitest";
// @ts-expect-error: a plain script of the UI package, read here for its change set.
import { changes, readBlob } from "../../ui/fixture/changes.mjs";
import { nodeAt } from "./anchor.js";
import { checkClaim, createClaimContext } from "./claim.js";
import type { ChangedFileRef } from "./host.js";
import type { FileDiff, SideMove } from "./fragments.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";

const diffOf = async (
  changes: ChangedFileRef[],
  read: (id: string) => Uint8Array,
) => {
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({ id: data, changes }),
    readBlob: read,
  });
  return (await engine.diffset("pr")).diff();
};

const halves = (file: FileDiff, side: "before" | "after"): SideMove[] =>
  file.fragments.flatMap((f) =>
    f.kind === "diff" ? (f[side].moves ?? []) : [],
  );

// classifyMove's dice counted `if ( ) { return ( ) ; }` as carried over, so a block whose every word changed read
// "Moved and edited".
test("a moved block that kept only its punctuation reads as a delete plus an insert, not a move", async () => {
  const blobs: Record<string, string> = {
    a: `export function run(a: boolean, b: boolean) {
  if (a) { return f(x, y); }
  keep(1, 2, 3);
}
`,
    b: `export function run(a: boolean, b: boolean) {
  keep(1, 2, 3);
  if (b) { return g(z, w); }
}
`,
  };
  const [file] = await diffOf(
    [{ path: "run.ts", before: "a", after: "b" }],
    (id) => new TextEncoder().encode(blobs[id] ?? ""),
  );
  if (!file) throw new Error("no diff");
  expect([...halves(file, "before"), ...halves(file, "after")]).toEqual([]);
  // A pure move of the same shape is still claimed, so the gate did not just drop every move.
  const pure: Record<string, string> = {
    a: `export function run(a: boolean) {
  if (a) { return f(x, y); }
  keep(1, 2, 3);
}
`,
    b: `export function run(a: boolean) {
  keep(1, 2, 3);
  if (a) { return f(x, y); }
}
`,
  };
  const [moved] = await diffOf(
    [{ path: "run.ts", before: "a", after: "b" }],
    (id) => new TextEncoder().encode(pure[id] ?? ""),
  );
  if (!moved) throw new Error("no diff");
  expect(halves(moved, "after").length).toBeGreaterThan(0);
});

// A classifier or a new emission path that shows a move without passing the checker: every move box the UI fixture
// renders must name a pair that checkClaim, recomputed here from freshly parsed trees, accepts.
test("every move the UI fixture shows passes checkClaim", async () => {
  const refs = changes as ChangedFileRef[];
  const files = await diffOf(refs, readBlob);
  const grammars = syntechsGrammars();
  const decode = (id: string | null) =>
    id === null ? undefined : new TextDecoder().decode(readBlob(id));
  const trees = await Promise.all(
    refs.map(async (ref, i) => {
      const grammar = files[i]?.grammar
        ? await grammars.forPath(ref.path)
        : undefined;
      if (!grammar) return undefined;
      const parse = (text: string | undefined) =>
        parseTree(grammar.language, text ?? "");
      return {
        before: parse(decode(ref.before)),
        after: parse(decode(ref.after)),
        ...(grammar.declarations && { declarations: grammar.declarations }),
        ...(grammar.scope && { scope: grammar.scope }),
      };
    }),
  );
  const ctx = createClaimContext(trees);
  const index = (path: string, old: boolean) =>
    refs.findIndex((r) => (old ? (r.oldPath ?? r.path) : r.path) === path);
  // Before nodes named by the after halves, after nodes named by the before halves.
  const xs: [number, number][] = [];
  const ys: [number, number][] = [];
  const resolve = (
    file: number,
    tree: Tree | undefined,
    m: SideMove,
    out: [number, number][],
  ) => {
    for (const steps of m.counterpart.at) {
      const n = tree && nodeAt(tree, steps);
      if (n === undefined)
        throw new Error(`no node at ${steps} in ${m.counterpart.path}`);
      out.push([file, n]);
    }
  };
  for (const file of files) {
    for (const m of halves(file, "after")) {
      if (m.extract !== undefined) continue;
      const i = index(m.counterpart.path, true);
      resolve(i, trees[i]?.before, m, xs);
    }
    for (const m of halves(file, "before")) {
      if (m.extract !== undefined) continue;
      const i = index(m.counterpart.path, false);
      resolve(i, trees[i]?.after, m, ys);
    }
  }
  expect(xs.length).toBeGreaterThan(0);
  const failing = xs.filter(
    ([from, x]) =>
      !ys.some(([to, y]) =>
        [false, true].some(
          (edited) =>
            checkClaim(ctx, { kind: "move", from, to, x, y, edited }) ===
            undefined,
        ),
      ),
  );
  expect(failing).toEqual([]);
});

// A move box that leaves out the locals its check renamed, or lists one it never verified: the fixture's `total`
// moved with items -> lines, s -> sum, i -> l must carry exactly that map on both halves.
test("a moved and edited declaration carries the local renames its check verified", async () => {
  const files = await diffOf(changes as ChangedFileRef[], readBlob);
  const ledger = files.find((f) => f.path === "src/moved/ledger.ts");
  if (!ledger) throw new Error("no ledger diff");
  const renamed = (side: "before" | "after") =>
    halves(ledger, side).flatMap((m) => (m.renames ? [m.renames] : []));
  const rho = [
    { before: "items", after: "lines" },
    { before: "s", after: "sum" },
    { before: "i", after: "l" },
  ];
  expect(renamed("before")).toEqual([rho]);
  expect(renamed("after")).toEqual([rho]);
});
