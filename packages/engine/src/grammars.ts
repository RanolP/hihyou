import type { Language } from "syntechs/core";
import type { ScopeRules } from "syntechs/diff";
import { format, type Language as FormatLanguage } from "syntechs/fmt";
import type {
  FormatModule,
  Grammar,
  GrammarLoader,
  HighlightModule,
} from "./host.js";

export type LanguageId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "json"
  | "python"
  | "css"
  | "kotlin"
  | "html"
  | "swift"
  | "yaml"
  | "graphql"
  // Read and formatted as HTML: oxfmt takes no `.svg`, and prints one given the name `.html` as its HTML.
  | "svg";

const extensions: Record<LanguageId, readonly string[]> = {
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  json: [".json"],
  python: [".py", ".pyi"],
  css: [".css"],
  kotlin: [".kt", ".kts"],
  html: [".html", ".htm"],
  swift: [".swift"],
  yaml: [".yml", ".yaml"],
  graphql: [".graphql", ".gql"],
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
const parsers: Record<
  LanguageId,
  () => Promise<{ language: Language; scope?: ScopeRules }>
> = {
  typescript: () => import("syntechs/grammars/typescript"),
  tsx: () => import("syntechs/grammars/tsx"),
  javascript: () => import("syntechs/grammars/javascript"),
  json: () => import("syntechs/grammars/json"),
  python: () => import("syntechs/grammars/python"),
  css: () => import("syntechs/grammars/css"),
  kotlin: () => import("syntechs/grammars/kotlin"),
  html: () => import("syntechs/grammars/html"),
  swift: () => import("syntechs/grammars/swift"),
  yaml: () => import("syntechs/grammars/yaml"),
  graphql: () => import("syntechs/grammars/graphql"),
  svg: () => import("syntechs/grammars/html"),
};

// `load` brings in the languages a highlighter injects (JSDoc, regular expressions), each its own lazy chunk,
// so that the synchronous `highlight` can paint them.
const highlighters: Partial<
  Record<LanguageId, () => Promise<{ highlight: HighlightModule }>>
> = {
  typescript: () => import("syntechs/grammars/typescript/highlight"),
  tsx: () => import("syntechs/grammars/tsx/highlight"),
  javascript: () => import("syntechs/grammars/javascript/highlight"),
  json: () => import("syntechs/grammars/json/highlight"),
  python: () => import("syntechs/grammars/python/highlight"),
  css: () => import("syntechs/grammars/css/highlight"),
  kotlin: () => import("syntechs/grammars/kotlin/highlight"),
  html: () => import("syntechs/grammars/html/highlight"),
  swift: () => import("syntechs/grammars/swift/highlight"),
  yaml: () => import("syntechs/grammars/yaml/highlight"),
  graphql: () => import("syntechs/grammars/graphql/highlight"),
  svg: () => import("syntechs/grammars/html/highlight"),
};

const typescriptDeclarations = [
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "internal_module",
  "module",
  "lexical_declaration",
  "variable_declaration",
];

// The node kinds an inserted or deleted node reads as one added or deleted declaration as, each checked
// against its grammar's node-types.json.
const declarations: Partial<Record<LanguageId, readonly string[]>> = {
  typescript: typescriptDeclarations,
  tsx: typescriptDeclarations,
  javascript: [
    "function_declaration",
    "generator_function_declaration",
    "class_declaration",
    "method_definition",
    "lexical_declaration",
    "variable_declaration",
  ],
  kotlin: [
    "function_declaration",
    "class_declaration",
    "object_declaration",
    "property_declaration",
    "type_alias",
    "secondary_constructor",
    "companion_object",
  ],
};

// The node kinds whose body holds members that read as whole units the way top-level declarations do: a class
// and its kin, never a function, whose body's declarations are statements of code that stayed.
const typescriptContainers = [
  "class_declaration",
  "abstract_class_declaration",
  "internal_module",
  "module",
];
const containers: Partial<Record<LanguageId, readonly string[]>> = {
  typescript: typescriptContainers,
  tsx: typescriptContainers,
  javascript: ["class_declaration"],
  kotlin: ["class_declaration", "object_declaration", "companion_object"],
};

/** A formatter bound to options the host passed as a plain object, checked by syntechs at format time. */
const bind =
  <O>(rules: FormatLanguage<O>) =>
  (options: object): FormatModule => ({
    format: (tree) => format(tree, rules, options as Partial<O>),
  });

const formatters: Partial<
  Record<LanguageId, () => Promise<(options: object) => FormatModule>>
> = {
  // syntechs' JSON printer runs on the JavaScript grammar's tree, so .json parsed with the JSON grammar is shown as written.
  typescript: async () =>
    bind((await import("syntechs/grammars/typescript/fmt")).typescript),
  tsx: async () => bind((await import("syntechs/grammars/typescript/fmt")).tsx),
  javascript: async () =>
    bind((await import("syntechs/grammars/javascript/fmt")).javascript),
  python: async () =>
    bind((await import("syntechs/grammars/python/fmt")).python),
  css: async () => bind((await import("syntechs/grammars/css/fmt")).css),
  kotlin: async () =>
    bind((await import("syntechs/grammars/kotlin/fmt")).kotlin),
  html: async () => bind((await import("syntechs/grammars/html/fmt")).html),
  swift: async () => bind((await import("syntechs/grammars/swift/fmt")).swift),
  yaml: async () => bind((await import("syntechs/grammars/yaml/fmt")).yaml),
  graphql: async () =>
    bind((await import("syntechs/grammars/graphql/fmt")).graphql),
  svg: async () => bind((await import("syntechs/grammars/html/fmt")).html),
};

export interface SyntechsGrammarOptions {
  /**
   * Formatter options by language. Languages with a formatter are formatted with its defaults unless set to false;
   * an object overrides that formatter's options (oxfmt/prettier's for JS/TS/CSS/HTML/YAML/GraphQL, ruff's for
   * Python, ktfmt's for Kotlin, and swift-format's for Swift).
   */
  format?: Partial<Record<LanguageId, object | false>>;
}

/** The grammars syntechs ships, found by file extension. */
export function syntechsGrammars(
  options: SyntechsGrammarOptions = {},
): GrammarLoader {
  const loaded = new Map<LanguageId, Promise<Grammar>>();
  const load = async (id: LanguageId): Promise<Grammar> => {
    const [{ language, scope }, highlighter] = await Promise.all([
      parsers[id](),
      highlighters[id]?.().then(async (m) => {
        await m.highlight.load?.();
        return m;
      }),
    ]);
    const formatOptions = options.format?.[id];
    const bindFormatter = formatters[id];
    let formatter: FormatModule | undefined;
    if (formatOptions !== false && bindFormatter)
      formatter = (await bindFormatter())(formatOptions ?? {});
    return {
      id: `${id}@${tablesHash(language)}`,
      language,
      ...(formatter && { format: formatter }),
      ...(highlighter && { highlight: highlighter.highlight }),
      ...(declarations[id] && { declarations: new Set(declarations[id]) }),
      ...(containers[id] && { containers: new Set(containers[id]) }),
      ...(scope && { scope }),
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
