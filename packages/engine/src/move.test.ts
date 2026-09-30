import { expect, test } from "vitest";
import type { CodeFragment } from "./fragments.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";

const moved = `export function checksum(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
`;

const blobs: Record<string, string> = {
  a0: `export const name = "a";\n\n${moved}`,
  a1: `export const name = "a";\n`,
  b0: `export const name = "b";\n`,
  b1: `export const name = "b";\n\n${moved}`,
};

const counterparts = (fragments: CodeFragment[]) =>
  fragments.flatMap((f) =>
    f.kind === "diff"
      ? [f.before.move, f.after.move].flatMap((m) =>
          m ? [m.counterpart.path] : [],
        )
      : [],
  );

// Without the counterpart on both sides a moved function reads as one deletion and one unrelated addition.
test("a function moved from a.ts to b.ts points at the other file on both sides", async () => {
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [
        { path: "a.ts", before: "a0", after: "a1" },
        { path: "b.ts", before: "b0", after: "b1" },
      ],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  });
  const files = await (await engine.diffset("pr")).diff();
  const byPath = new Map(files.map((f) => [f.path, f.fragments]));

  expect(counterparts(byPath.get("a.ts") ?? [])).toContain("b.ts");
  expect(counterparts(byPath.get("b.ts") ?? [])).toContain("a.ts");
});
