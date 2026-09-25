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

async function fixture() {
  const before = {
    "a.ts": `export const a = 1;\n${"export const pad = 0;\n".repeat(30)}export const z = "x";\n`,
    "b.ts": "export const b = 2;\n",
    "logo.png": new Uint8Array([0, 1, 2]),
  };
  const after = {
    "a.ts": before["a.ts"].replace("a = 1", "a = 10").replace('"x"', '"y"'),
    "b.ts": "export const b = 3;\n",
    "logo.png": new Uint8Array([0, 1, 3]),
  };
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
  const app = await fixture();
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
