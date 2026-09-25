import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { GrammarLocator } from "./parser.js";

const require = createRequire(import.meta.url);

/** Reads grammar WASM from the per-grammar npm packages installed next to the engine. */
export const nodeGrammarLocator: GrammarLocator = (_lang, wasm) =>
  readFile(require.resolve(wasm));
