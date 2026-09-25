import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
// The browser entry, with the WASM bytes injected the way an extension or web page would supply them.
import { createFormatter } from "./index.js";

const wasmPath = createRequire(import.meta.url).resolve(
  "@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm",
);
const formatter = createFormatter({ ruffWasm: () => readFile(wasmPath) });

describe("createFormatter", () => {
  it("formats Python through ruff from host-supplied WASM bytes, with no Node-only loader", async () => {
    expect(await formatter.format("a.py", "x = {  'a':1 }\n")).toEqual({
      ok: true,
      text: 'x = {"a": 1}\n',
    });
  });

  it("broken code comes back as a formatter error instead of rejecting the whole view", async () => {
    const result = await formatter.format("broken.ts", "const = ;\n");
    expect(result).toMatchObject({ ok: false, reason: "formatter-error" });
  });

  it("a language with no formatter is reported as unsupported rather than as a formatter error", async () => {
    expect(await formatter.format("main.rs", "fn main(){}\n")).toEqual({
      ok: false,
      reason: "unsupported-language",
    });
  });
});
