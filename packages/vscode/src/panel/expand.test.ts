import { createEngine, syntechsGrammars } from "@hihyou/engine";
import type { DiffFile } from "@hihyou/ui";
import { expect, test } from "vitest";
import { engineReview } from "../review.js";
import { expandElided } from "./expand.js";

const lines = (n: number, edit: (i: number) => string | undefined) =>
  Array.from(
    { length: n },
    (_, i) => `${edit(i + 1) ?? `const a${i + 1} = ${i + 1};`}\n`,
  ).join("");

const before = lines(40, () => undefined);
const after = lines(40, (i) => (i === 20 ? "const a20 = 2000;" : undefined));

/** The after side's text as the fragments carry it, `begin`/`end` and the before side left out. */
const afterSide = (file: DiffFile) =>
  file.fragments
    .map((f) =>
      f.kind === "unchanged"
        ? f.spans.map((s) => s.text).join("")
        : f.kind === "diff"
          ? f.after.spans.map((s) => s.text).join("")
          : "",
    )
    .join("");

async function expandAll(path: string) {
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
  let file: DiffFile = loaded;
  const elided = file.fragments.flatMap((f, i) =>
    f.kind === "elided" ? [i] : [],
  );
  expect(elided.length).toBe(2);

  for (const i of elided) {
    const f = file.fragments[i];
    if (f?.kind !== "elided") throw new Error("not elided");
    const next = file.fragments
      .slice(i + 1)
      .find((g) => g.kind === "unchanged" || g.kind === "diff");
    const nextAfter =
      next?.kind === "unchanged"
        ? next.lines.after
        : next?.kind === "diff"
          ? next.after.startLine
          : undefined;
    const ref = {
      fragment: i,
      lines: f.lines,
      ...(nextAfter !== undefined && { count: nextAfter - f.lines.after }),
    };
    const unchanged = await review.expand(path, ref);
    const expanded = unchanged && expandElided(file, ref, unchanged);
    if (!expanded) throw new Error(`fragment ${i} did not expand`);
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
  const first = file.fragments.find((f) => f.kind === "unchanged");
  if (first?.kind !== "unchanged") throw new Error("no unchanged fragment");
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

// Catches expanding a fragment index that a refresh has since given to other content.
test("a stale expand request leaves the file alone", () => {
  const file: DiffFile = {
    path: "a.ts",
    fragments: [{ kind: "elided", lines: { before: 1, after: 1 } }],
  };
  expect(
    expandElided(
      file,
      { fragment: 0, lines: { before: 1, after: 2 } },
      { kind: "unchanged", spans: [], at: [], lines: { before: 1, after: 2 } },
    ),
  ).toBeUndefined();
});
