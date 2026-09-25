import {
  buildReviewDoc,
  createSyntaxParser,
  memorySource,
} from "@hihyou/engine";
import { nodeGrammarLocator } from "@hihyou/engine/node";
import { createFormatter } from "@hihyou/present";
import { nodeRuffWasm } from "@hihyou/present/node";
import { render } from "ink-testing-library";
import { expect, it } from "vitest";
import { viewLoader } from "../review.js";
import { App } from "./app.js";

type Tree = Record<string, string | Uint8Array>;

async function fixture(before: Tree, after: Tree) {
  const source = memorySource(before, after);
  const doc = await buildReviewDoc(source, {
    parser: createSyntaxParser({ locateGrammar: nodeGrammarLocator }),
  });
  const load = viewLoader(
    doc,
    source,
    createFormatter({ ruffWasm: nodeRuffWasm }),
  );
  return render(
    <App doc={doc} load={load} size={{ columns: 100, rows: 16 }} />,
  );
}

/** Lets Ink process input and the loader's promise settle before the next frame is read. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function until(frame: () => string | undefined, text: string) {
  for (let i = 0; i < 100 && !frame()?.includes(text); i++) await settle();
  expect(frame()).toContain(text);
  return frame() ?? "";
}

it("keys drive the review: j selects the next file, tab+n jumps to an edit off screen, s splits, f reveals folded files", async () => {
  const a = `export const a = 1;\n${"export const pad = 0;\n".repeat(30)}export const z = "x";\n`;
  const app = await fixture(
    {
      "a.ts": a,
      "b.ts": "export const b = 2;\n",
      "logo.png": new Uint8Array([0, 1, 2]),
    },
    {
      "a.ts": a.replace("a = 1", "a = 10").replace('"x"', '"y"'),
      "b.ts": "export const b = 3;\n",
      "logo.png": new Uint8Array([0, 1, 3]),
    },
  );
  let frame = await until(app.lastFrame, "a = 10");
  expect(frame).toContain("1 folded (f to show)");
  expect(frame).not.toContain("logo.png");
  expect(frame).not.toContain('"y"');

  app.stdin.write("\t");
  await settle();
  app.stdin.write("n");
  app.stdin.write("n");
  frame = await until(app.lastFrame, '"y"');
  expect(frame).not.toContain("a = 10");

  app.stdin.write("s");
  frame = await until(app.lastFrame, "a = 10");
  expect(frame).toMatch(/a = 1;.*a = 10;/);

  app.stdin.write("\t");
  await settle();
  app.stdin.write("j");
  frame = await until(app.lastFrame, "b = 3");

  app.stdin.write("f");
  frame = await until(app.lastFrame, "(binary)");
  expect(frame).not.toContain("folded (f to show)");
  app.unmount();
});

it("moving past the bottom of the file list scrolls it so the selected file stays visible above the folded row", async () => {
  const names = Array.from(
    { length: 12 },
    (_, i) => `f${String(i).padStart(2, "0")}.ts`,
  );
  const tree = (value: number) => ({
    ...Object.fromEntries(
      names.map((n) => [n, `export const v = ${value};\n`]),
    ),
    "logo.png": new Uint8Array([0, value]),
  });
  const app = await fixture(tree(1), tree(2));
  await until(app.lastFrame, "v = 2");
  // 16 rows leave 10 list rows beside the folded row, so the 11th file is the first one that must scroll in.
  for (let i = 0; i < 10; i++) {
    app.stdin.write("j");
    await settle();
  }
  const frame = await until(app.lastFrame, "M f10.ts");
  expect(frame).not.toContain("M f00.ts");
  expect(frame).toContain("1 folded (f to show)");
  app.unmount();
});
