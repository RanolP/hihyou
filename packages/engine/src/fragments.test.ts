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
  expect(diffs.flatMap((d) => [d.before.moves, d.after.moves])).toEqual([
    undefined,
    undefined,
  ]);
});

// Syntax colour replacing the diff emphasis would hide the change, and emphasis dropping the colour would
// leave changed code uncoloured; an added keyword must carry both, and unchanged code its own scopes.
test("an added keyword keeps both its syntax scope and its diff emphasis", async () => {
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
  const spans = (file?.fragments ?? []).flatMap((f) =>
    f.kind === "unchanged"
      ? f.spans
      : f.kind === "diff"
        ? [...f.before.spans, ...f.after.spans]
        : [],
  );
  const innermost = (s?: { scope?: string }) => s?.scope?.split(" ").at(-1);
  expect(innermost(spans.find((s) => s.text === "if" && s.changed))).toBe(
    "keyword.control.js",
  );
  expect(innermost(spans.find((s) => s.text === "Shop"))).toBe(
    "entity.name.type.class.js",
  );
});

// Painting each inserted token on its own leaves `,` and `b + 1` as islands with an unpainted gap, and painting
// across a line break paints the next line's indentation: an added argument must read as one range.
test("an added call argument is one changed range, and an added block skips each line's indentation", async () => {
  const blobs: Record<string, string> = {
    b: "function g() {\n  f(a);\n}\n",
    a: "function g() {\n  f(a, b + 1);\n  if (a) {\n    f(b);\n  }\n}\n",
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "g.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  const ranges: string[] = [];
  for (const f of file?.fragments ?? []) {
    if (f.kind !== "diff") continue;
    let run = "";
    for (const s of f.after.spans) {
      if (s.changed) run += s.text;
      else if (run) {
        ranges.push(run);
        run = "";
      }
    }
    if (run) ranges.push(run);
  }
  expect(ranges).toEqual([", b + 1", "if (a) {", "f(b);", "}"]);
});

// Emphasizing each replaced token on its own around a kept `.` interleaves the two names in the unified view, so
// `basicColor.DARKGRAY400` → `themedColor.foreground3` read as `basicColorthemedColor.DARKGRAY400foreground3`.
test("a fully-replaced member expression renders as one del and one ins, not interleaved", async () => {
  const blobs: Record<string, string> = {
    b: "const style = {\n  color: basicColor.DARKGRAY400,\n  border: theme.colors.a,\n};\n",
    a: "const style = {\n  color: themedColor.foreground3,\n  border: theme.colors.b,\n};\n",
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [{ path: "s.ts", before: "b", after: "a" }],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const [file] = await (await engine.diffset("pr")).diff();
  const runs = (side: "before" | "after") =>
    (file?.fragments ?? []).flatMap((f) =>
      f.kind === "diff"
        ? f[side].spans
            .map((s) => (s.changed ? s.text : "\0"))
            .join("")
            .split("\0")
            .filter((r) => r !== "")
        : [],
    );
  expect(runs("before")).toEqual(["basicColor.DARKGRAY400", "a"]);
  expect(runs("after")).toEqual(["themedColor.foreground3", "b"]);
});

// Unchanged fragments carried no outline, so a viewer could neither select context code nor anchor a comment there.
test("an unchanged fragment outlines the nodes wholly inside it, by line and column into its text", async () => {
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
  const texts = (file?.fragments ?? []).flatMap((f) => {
    if (f.kind !== "unchanged") return [];
    const lines = f.spans
      .map((s) => s.text)
      .join("")
      .split("\n");
    return (f.nodes ?? []).map((n) => {
      expect(n.changed).toBe(false);
      return n.start.line === n.end.line
        ? lines[n.start.line]?.slice(n.start.column, n.end.column)
        : undefined;
    });
  });
  expect(texts).toContain("let sum = 0;");
});
