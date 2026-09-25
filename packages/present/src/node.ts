// Node-only entry (`@hihyou/present/node`), kept apart so a browser bundle never pulls in node: modules.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Reads ruff's WASM from the npm package installed next to this one; pass it as `ruffWasm`. */
export const nodeRuffWasm = () =>
  readFile(require.resolve("@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm"));
