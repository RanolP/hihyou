import type { Language } from "syntechs/core";
import { format, type Language as FormatLanguage } from "syntechs/fmt";
import type { FormatModule, Grammar, GrammarLoader } from "./host.js";

export type LanguageId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "json"
  | "python"
  | "css"
  // Read and formatted as HTML: oxfmt takes no `.svg`, and prints one given the name `.html` as its HTML.
  | "svg";

const extensions: Record<LanguageId, readonly string[]> = {
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  json: [".json"],
  python: [".py", ".pyi"],
  css: [".css"],
  svg: [".svg"],
};

export function languageForPath(path: string): LanguageId | undefined {
  const dot = path.lastIndexOf(".");
  if (dot <= path.lastIndexOf("/")) return undefined;
  const ext = path.slice(dot).toLowerCase();
  return (Object.keys(extensions) as LanguageId[]).find((id) =>
    extensions[id].includes(ext),
  );
}

// Loaded on first use: a grammar bundle is hundreds of KiB, and most diffs touch one or two languages.
const parsers: Record<LanguageId, () => Promise<{ language: Language }>> = {
  typescript: () => import("syntechs/grammars/typescript"),
  tsx: () => import("syntechs/grammars/tsx"),
  javascript: () => import("syntechs/grammars/javascript"),
  json: () => import("syntechs/grammars/json"),
  python: () => import("syntechs/grammars/python"),
  css: () => import("syntechs/grammars/css"),
  svg: () => import("syntechs/grammars/html"),
};

/** A formatter bound to options the host passed as a plain object, checked by syntechs at format time. */
const bind =
  <O>(rules: FormatLanguage<O>) =>
  (options: object): FormatModule => ({
    format: (tree) => format(tree, rules, options as Partial<O>),
  });

const formatters: Record<
  LanguageId,
  () => Promise<(options: object) => FormatModule>
> = {
  typescript: async () =>
    bind((await import("syntechs/grammars/typescript/fmt")).typescript),
  tsx: async () => bind((await import("syntechs/grammars/typescript/fmt")).tsx),
  javascript: async () =>
    bind((await import("syntechs/grammars/javascript/fmt")).javascript),
  json: async () => bind((await import("syntechs/grammars/json/fmt")).json),
  python: async () =>
    bind((await import("syntechs/grammars/python/fmt")).python),
  css: async () => bind((await import("syntechs/grammars/css/fmt")).css),
  svg: async () => bind((await import("syntechs/grammars/html/fmt")).html),
};

export interface SyntechsGrammarOptions {
  /**
   * Languages to format before diffing, each with the options of the tool it follows (prettier's for
   * JS/TS/JSON/CSS, ruff's for Python). A language left out is shown as written.
   */
  format?: Partial<Record<LanguageId, object>>;
}

/** The grammars syntechs ships, found by file extension. */
export function syntechsGrammars(
  options: SyntechsGrammarOptions = {},
): GrammarLoader {
  const loaded = new Map<LanguageId, Promise<Grammar>>();
  const load = async (id: LanguageId): Promise<Grammar> => {
    const { language } = await parsers[id]();
    const formatOptions = options.format?.[id];
    let formatter: FormatModule | undefined;
    if (formatOptions !== undefined)
      formatter = (await formatters[id]())(formatOptions);
    return {
      id: `${id}@${tablesHash(language)}`,
      language,
      ...(formatter && { format: formatter }),
    };
  };
  return {
    forPath(path) {
      const id = languageForPath(path);
      if (id === undefined) return Promise.resolve(undefined);
      let grammar = loaded.get(id);
      if (!grammar) {
        grammar = load(id);
        loaded.set(id, grammar);
      }
      return grammar;
    },
  };
}

const hashes = new WeakMap<Language, string>();

/**
 * A hash of the parse tables a `Language` was decoded from. A grammar carries no runtime version, and
 * the tables are what decide the tree shape a stored `AstSteps` depends on.
 */
function tablesHash(language: Language): string {
  const known = hashes.get(language);
  if (known !== undefined) return known;
  // Two 32-bit FNV-1a-style streams with different multipliers, for 64 bits.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0xdeadbeef;
  const byte = (b: number) => {
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul(h2 ^ b, 0x5bd1e995);
  };
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      byte(c & 0xff);
      byte(c >>> 8);
    }
    byte(0);
  };
  for (const key of Object.keys(language).sort()) {
    const value: unknown = language[key as keyof Language];
    text(key);
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      for (let i = 0; i < bytes.length; i++) byte(bytes[i] as number);
    } else if (Array.isArray(value)) {
      for (const item of value) text(String(item));
    } else if (typeof value === "number" || typeof value === "string") {
      text(String(value));
    }
  }
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, "0");
  const out = hex(h1) + hex(h2);
  hashes.set(language, out);
  return out;
}
