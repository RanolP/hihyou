import { expect, test } from "vitest";
import { createEngine } from "./host.js";
import { syntechsGrammars } from "./grammars.js";

const enc = (s: string) => new TextEncoder().encode(s);

// A lockfile or binary shown open buries the real change under thousands of unreadable lines.
test("a lockfile and a binary file come out collapsed as lockfile and binary", async () => {
  const blobs: Record<string, Uint8Array> = {
    lock0: enc("lockfileVersion: '9.0'\n"),
    lock1: enc("lockfileVersion: '9.0'\npackages: {}\n"),
    png0: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
    png1: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 3, 4]),
    ts0: enc("export const a = 1;\n"),
    ts1: enc("export const a = 2;\n"),
  };
  const engine = createEngine({
    grammars: syntechsGrammars(),
    resolveDiffset: (data: "pr") => ({
      id: data,
      changes: [
        { path: "pnpm-lock.yaml", before: "lock0", after: "lock1" },
        { path: "logo.png", before: "png0", after: "png1" },
        { path: "a.ts", before: "ts0", after: "ts1" },
      ],
    }),
    readBlob: (id) => blobs[id] ?? new Uint8Array(),
  });
  const files = await (await engine.diffset("pr")).diff();
  const byPath = new Map(files.map((f) => [f.path, f]));

  expect(byPath.get("pnpm-lock.yaml")?.collapsed).toEqual({
    reason: "lockfile",
  });
  expect(byPath.get("logo.png")).toEqual({
    path: "logo.png",
    fragments: [],
    collapsed: { reason: "binary" },
  });
  expect(byPath.get("a.ts")?.collapsed).toBeUndefined();
});
