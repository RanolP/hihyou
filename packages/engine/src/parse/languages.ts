import { z } from "zod";

/** `wasm` is a module specifier into the npm package that ships the grammar, for the host to resolve. */
const registry = {
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
} as const;

export const LanguageId = z.enum(
  Object.keys(registry) as [keyof typeof registry],
);
export type LanguageId = z.infer<typeof LanguageId>;

export function languageForPath(path: string): LanguageId | undefined {
  const dot = path.lastIndexOf(".");
  if (dot <= path.lastIndexOf("/")) return undefined;
  const ext = path.slice(dot).toLowerCase();
  for (const [id, { extensions }] of Object.entries(registry)) {
    if ((extensions as readonly string[]).includes(ext))
      return id as LanguageId;
  }
  return undefined;
}

export function grammarWasm(lang: LanguageId): string {
  return registry[lang].wasm;
}
