import { expect, test } from "vitest";
import type { CodeFragment } from "./fragments.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";

const before = `export class Shop {
  items: string[] = [];

  add(item: string) {
    this.items.push(item);
  }

  total() {
    let sum = 0;
    for (const item of this.items) sum += item.length;
    return sum;
  }
}

export class Cart {
  open() {
    return true;
  }
}
`;

const after = `export class Shop {
  items: string[] = [];

  add(item: string) {
    if (item) this.items.push(item);
  }

  total() {
    let sum = 0;
    for (const item of this.items) sum += item.length;
    return sum * 2;
  }
}

export class Cart {
  close() {
    return false;
  }
}
`;

// An unbalanced begin/end makes the front end nest every later fragment inside the wrong container.
test("begin/end stay balanced and each end closes the begin it matches", async () => {
  const blobs: Record<string, string> = { b: before, a: after };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "shop.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  const fragments: CodeFragment[] = file?.fragments ?? [];

  const open: string[] = [];
  let begins = 0;
  for (const f of fragments) {
    if (f.kind === "begin") {
      open.push(f.label);
      begins++;
    } else if (f.kind === "end") {
      expect(open.pop()).toBe(f.label);
    }
  }
  expect(open).toEqual([]);
  expect(begins).toBeGreaterThan(0);
  expect(fragments.some((f) => f.kind === "diff")).toBe(true);
});

const commentedBefore = `/**
 * The lines of \`text\` from line \`first\` on. A final newline starts no
 * line, so an empty text has none and a text without one still ends its
 * last line.
 */
export function slice(text: string, first: number): string[] {
  const starts = lineStarts(text);
  const at = first - 1;
  return starts.slice(at).map((s) => text.slice(s));
}
`;

const commentedAfter = commentedBefore.replace(
  "  const starts = lineStarts(text);\n  const at = first - 1;\n",
  "  const offsets = lineStarts(text);\n  const starts = offsets;\n  const at = Math.max(0, first - 1);\n",
);

// A block comment both sides share once read as removed and re-added, and `first - 1` wrapped in
// `Math.max(0, ...)` in place read as moved onto its own line; `git diff` says -2 +3 with no move.
test("an edit beside an unchanged block comment is -2 +3 and no move", async () => {
  const blobs: Record<string, string> = {
    b: commentedBefore,
    a: commentedAfter,
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "slice.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  const diffs = (file?.fragments ?? []).flatMap((f) =>
    f.kind === "diff" ? [f] : [],
  );
  const lineCount = (s: { spans: { text: string }[] }) =>
    s.spans
      .map((p) => p.text)
      .join("")
      .split("\n").length - 1;

  expect(diffs.map((d) => [lineCount(d.before), lineCount(d.after)])).toEqual([
    [2, 3],
  ]);
  expect(diffs.flatMap((d) => [d.before.move, d.after.move])).toEqual([
    undefined,
    undefined,
  ]);
});
