import { z } from "zod";

export const LanguageId = z.enum([
  "typescript",
  "tsx",
  "javascript",
  "json",
  "python",
  "css",
]);
export type LanguageId = z.infer<typeof LanguageId>;

/** `wasm` is a module specifier into the npm package that ships the grammar, for the host to resolve. */
const registry: Record<
  LanguageId,
  { extensions: readonly string[]; wasm: string }
> = {
  typescript: {
    extensions: [".ts", ".mts", ".cts"],
    wasm: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  },
  tsx: {
    extensions: [".tsx"],
    wasm: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  },
  javascript: {
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
    wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  },
  json: {
    extensions: [".json"],
    wasm: "tree-sitter-json/tree-sitter-json.wasm",
  },
  python: {
    extensions: [".py", ".pyi"],
    wasm: "tree-sitter-python/tree-sitter-python.wasm",
  },
  css: { extensions: [".css"], wasm: "tree-sitter-css/tree-sitter-css.wasm" },
};

export function languageForPath(path: string): LanguageId | undefined {
  const dot = path.lastIndexOf(".");
  if (dot <= path.lastIndexOf("/")) return undefined;
  const ext = path.slice(dot).toLowerCase();
  return LanguageId.options.find((id) => registry[id].extensions.includes(ext));
}

export function grammarWasm(lang: LanguageId): string {
  return registry[lang].wasm;
}
