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

const extensions: Record<LanguageId, readonly string[]> = {
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  json: [".json"],
  python: [".py", ".pyi"],
  css: [".css"],
};

export function languageForPath(path: string): LanguageId | undefined {
  const dot = path.lastIndexOf(".");
  if (dot <= path.lastIndexOf("/")) return undefined;
  const ext = path.slice(dot).toLowerCase();
  return LanguageId.options.find((id) => extensions[id].includes(ext));
}
