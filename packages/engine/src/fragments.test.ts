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
