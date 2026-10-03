import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { CodeFragment, FileDiff, SideMove } from "./fragments.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";

async function diff(
  changes: { path: string; before: string | null; after: string }[],
  blobs: Record<string, string>,
) {
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({ id: data, changes }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  return (await engine.diffset("pr")).diff();
}

/** The extract halves on `side` of `file`, its ordinary moves aside. */
const halves = (file: FileDiff | undefined, side: "before" | "after") =>
  (file?.fragments ?? []).flatMap((f: CodeFragment) =>
    f.kind === "diff"
      ? (f[side].moves ?? []).filter((m) => m.extract !== undefined)
      : [],
  );

/** RanolP/hihyou#380: `generate.node.ts` at its base and head, and the `kinds.node.ts` it added. */
const fixture = (path: string) =>
  readFileSync(new URL(`../fixtures/extract/${path}`, import.meta.url), "utf8");
const pr380 = () =>
  diff(
    [
      { path: "generate.node.ts", before: "g0", after: "g1" },
      { path: "kinds.node.ts", before: null, after: "k1" },
    ],
    {
      g0: fixture("before/generate.node.ts"),
      g1: fixture("after/generate.node.ts"),
      k1: fixture("after/kinds.node.ts"),
    },
  );

/** Each display line of `file`'s after sides, with the text of its emphasized spans. */
function afterLines(file: FileDiff | undefined) {
  const lines: { line: number; text: string; emphasized: string[] }[] = [];
  for (const f of file?.fragments ?? []) {
    if (f.kind !== "diff") continue;
    let line = {
      line: f.after.startLine,
      text: "",
      emphasized: [] as string[],
    };
    lines.push(line);
    for (const s of f.after.spans)
      s.text.split("\n").forEach((part, i) => {
        if (i > 0) {
          line = { line: line.line + 1, text: "", emphasized: [] };
          lines.push(line);
        }
        line.text += part;
        if (s.changed && part.trim()) line.emphasized.push(part);
      });
  }
  return lines;
}

// Without extract pairing, PR #380 read as code deleted from generate.node.ts plus two unrelated functions added in kinds.node.ts.
test("code extracted into kindIndex and kindError points at each new function, and each function back at it", async () => {
  const [generate, kinds] = await pr380();

  const out = halves(generate, "before");
  expect(
    out.map((m: SideMove) => [m.extract, m.counterpart.path, m.first, m.last]),
  ).toEqual([
    ["kindIndex", "kinds.node.ts", 400, 400],
    ["kindError", "kinds.node.ts", 426, 427],
  ]);

  const into = halves(kinds, "after");
  expect(into.map((m: SideMove) => [m.extract, m.counterpart.path])).toEqual([
    ["kindIndex", "generate.node.ts"],
    ["kindError", "generate.node.ts"],
  ]);
  const starts = afterLines(kinds);
  expect(into.map((m) => starts.find((l) => l.line === m.first)?.text)).toEqual(
    [
      expect.stringMatching(/^export function kindIndex\(/),
      expect.stringMatching(/^export function kindError\(/),
    ],
  );
});

// Without comparing the new body against the code it took over, the whole function reads as new and the reviewer re-reads the kept message.
test("the extracted kindError emphasizes only what generalized the removed check and message", async () => {
  const [, kinds] = await pr380();
  const at = (start: string) =>
    afterLines(kinds).find((l) => l.text.trimStart().startsWith(start))
      ?.emphasized;
  // The named-or-anonymous display and the message came over from generate.node.ts; the names it now takes are new.
  expect(at("const shown")).toEqual(["shown"]);
  expect(at("if (!entry) return")).toEqual(["entry", "shown", "languageName"]);
});

// Without the shared-words gate, any new helper called where code was removed would claim that code as extracted.
test("a new function called where unrelated code was removed stays an addition", async () => {
  const before = `function load(path: string): string {
  const text = readFileSync(path, "utf8").trimEnd();
  return text;
}
`;
  const after = `function load(path: string): string {
  const text = fetchCached(path);
  return text;
}

export function fetchCached(url: string): string {
  return cache.get(url) ?? download(url);
}
`;
  const [file] = await diff([{ path: "load.ts", before: "a", after: "b" }], {
    a: before,
    b: after,
  });
  expect([...halves(file, "before"), ...halves(file, "after")]).toEqual([]);
  const wholes = (file?.fragments ?? []).flatMap((f) =>
    f.kind === "diff"
      ? (f.after.nodes ?? [])
          .filter((n) => n.whole === "added")
          .map((n) => n.label)
      : [],
  );
  expect(wholes).toEqual(["function fetchCached"]);
});
