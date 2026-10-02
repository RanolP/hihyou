import { createEngine, syntechsGrammars } from "@hihyou/engine";
import { type DiffFile, gapOf } from "./rows.js";
import { expect, test } from "vitest";
import { engineReview } from "./review.js";
import { collapseElided, revealElided } from "./expand.js";

const lines = (n: number, edit: (i: number) => string | undefined) =>
  Array.from(
    { length: n },
    (_, i) => `${edit(i + 1) ?? `const a${i + 1} = ${i + 1};`}\n`,
  ).join("");

// Gaps longer than one expand step on both sides of the edit, so a partial expand is exercised.
const before = lines(100, () => undefined);
const after = lines(100, (i) => (i === 50 ? "const a50 = 5000;" : undefined));

/** The after side's text as the rows show it, `begin`/`end` and the before side left out. */
const afterSide = (file: DiffFile) =>
  file.fragments
    .flatMap((f, i) => {
      if (f.kind === "unchanged") return [f];
      if (f.kind === "diff") return [{ spans: f.after.spans }];
      if (f.kind !== "elided") return [];
      const r = file.revealed?.[i];
      return [...(r?.top ?? []), ...(r?.bottom ?? [])];
    })
    .map((f) => f.spans.map((s) => s.text).join(""))
    .join("");

async function load(path: string) {
  const texts: Record<string, string> = { a: before, b: after };
  const review = engineReview(
    createEngine({
      grammars: syntechsGrammars(),
      resolveDiffset: () => ({
        id: "t",
        changes: [{ path, before: "a", after: "b" }],
      }),
      readBlob: (id) => new TextEncoder().encode(texts[id]),
    }),
    () => "t" as never,
  );
  const [loaded] = await review.load();
  if (!loaded) throw new Error("no file diffed");
  return { review, file: loaded as DiffFile };
}

const elidedRefs = (file: DiffFile) =>
  file.fragments.flatMap((f, i) =>
    f.kind === "elided" ? [{ fragment: i, lines: f.lines }] : [],
  );

async function expandAll(path: string) {
  const { review, file: loaded } = await load(path);
  let file = loaded;
  const refs = elidedRefs(file);
  expect(refs.length).toBe(2);
  for (const ref of refs) {
    const expanded = await revealElided(file, ref, "all", review.expand);
    if (!expanded) throw new Error(`fragment ${ref.fragment} did not expand`);
    file = expanded;
  }
  return file;
}

// Catches an off-by-one in the elided line range: expanded context that repeats, drops or shifts a line
// (including the run that reaches the end of the file, whose count the renderer leaves unset).
test("expanding every elided run rebuilds the after text exactly", async () => {
  expect(afterSide(await expandAll("a.ts"))).toBe(after);
});

// Catches revealed lines coming back as raw text: the first line was elided, and its `const` must carry
// the same keyword scope the engine gives the lines it shows.
test("an expanded line keeps its syntax scope, like every shown line", async () => {
  const file = await expandAll("a.ts");
  const [ref] = elidedRefs(file);
  const first = ref && file.revealed?.[ref.fragment]?.top[0];
  if (!first) throw new Error("no revealed fragment");
  expect(first.lines.after).toBe(1);
  const keyword = first.spans.find((s) => s.text === "const");
  expect(keyword?.scope?.split(" ").at(-1)).toMatch(/^keyword\./);
});

// Catches a file with no grammar failing to expand once expansion goes through the highlighter.
test("a file with no grammar still expands, as plain text", async () => {
  const file = await expandAll("a.txt");
  expect(afterSide(file)).toBe(after);
  for (const f of file.fragments)
    if (f.kind === "unchanged")
      for (const s of f.spans) expect(s.scope).toBeUndefined();
});

// Catches a partial expand that repeats or skips a line at either edge, or a run to the end of the file that
// stays open after its last lines (fewer than a step) were revealed.
test("expanding a step at a time from either edge rebuilds the after text, and collapse restores the gap", async () => {
  const { review, file: loaded } = await load("a.ts");
  let file = loaded;
  for (const ref of elidedRefs(file)) {
    const gap = gapOf(file, ref.fragment);
    for (let step = 0; gapOf(file, ref.fragment)?.count !== 0; step++) {
      const direction = gap?.atStart
        ? "up"
        : gap?.atEnd
          ? "down"
          : step % 2
            ? "up"
            : "down";
      const next = await revealElided(file, ref, direction, review.expand);
      if (!next)
        throw new Error(`fragment ${ref.fragment} stopped at step ${step}`);
      file = next;
    }
  }
  expect(afterSide(file)).toBe(after);
  for (const ref of elidedRefs(file)) file = collapseElided(file, ref);
  expect(file.revealed).toEqual({});
});

// Catches expanding a fragment index that a refresh has since given to other content.
test("a stale expand request leaves the file alone", async () => {
  const file: DiffFile = {
    path: "a.ts",
    fragments: [{ kind: "elided", lines: { before: 1, after: 1 } }],
  };
  expect(
    await revealElided(
      file,
      { fragment: 0, lines: { before: 1, after: 2 } },
      "all",
      async () => ({
        kind: "unchanged",
        spans: [],
        at: [],
        lines: { before: 1, after: 2 },
      }),
    ),
  ).toBeUndefined();
});
