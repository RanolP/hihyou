import { type Language, parseTree, type Tree } from "syntechs/core";
import type { ScopeRules } from "syntechs/diff";
import {
  format,
  type Formatted,
  type Language as FormatLanguage,
} from "syntechs/fmt";
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
  | "go"
  | "rust"
  | "ruby"
  | "bash"
  | "dockerfile"
  | "sql"
  | "kotlin"
  | "html"
  | "swift"
  | "yaml"
  | "graphql"
  | "markdown"
  // Read and formatted as HTML: oxfmt takes no `.svg`, and prints one given the name `.html` as its HTML.
  | "svg";

const extensions: Record<LanguageId, readonly string[]> = {
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  json: [".json"],
  python: [".py", ".pyi"],
  css: [".css"],
  go: [".go"],
  rust: [".rs"],
  ruby: [".rb", ".rake", ".gemspec", ".ru"],
  bash: [".sh", ".bash"],
  dockerfile: [".dockerfile"],
  sql: [".sql"],
  kotlin: [".kt", ".kts"],
  html: [".html", ".htm"],
  swift: [".swift"],
  yaml: [".yml", ".yaml"],
  graphql: [".graphql", ".gql"],
  markdown: [".md", ".markdown"],
  svg: [".svg"],
};

const filenames: Record<string, LanguageId> = {
  Gemfile: "ruby",
  Rakefile: "ruby",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".bash_login": "bash",
  ".bash_logout": "bash",
  ".profile": "bash",
  Dockerfile: "dockerfile",
  Containerfile: "dockerfile",
  README: "markdown",
};

export function languageForPath(path: string): LanguageId | undefined {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  if (Object.hasOwn(filenames, filename)) return filenames[filename];
  // A variant per target or stage: Dockerfile.dev, Dockerfile.alpine.
  if (filename.startsWith("Dockerfile.")) return "dockerfile";
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
  go: () => import("syntechs/grammars/go"),
  rust: () => import("syntechs/grammars/rust"),
  ruby: () => import("syntechs/grammars/ruby"),
  bash: () => import("syntechs/grammars/bash"),
  dockerfile: () => import("syntechs/grammars/dockerfile"),
  sql: () => import("syntechs/grammars/sql"),
  kotlin: () => import("syntechs/grammars/kotlin"),
  html: () => import("syntechs/grammars/html"),
  swift: () => import("syntechs/grammars/swift"),
  yaml: () => import("syntechs/grammars/yaml"),
  graphql: () => import("syntechs/grammars/graphql"),
  markdown: () => import("syntechs/grammars/markdown"),
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
  go: () => import("syntechs/grammars/go/highlight"),
  rust: () => import("syntechs/grammars/rust/highlight"),
  ruby: () => import("syntechs/grammars/ruby/highlight"),
  bash: () => import("syntechs/grammars/bash/highlight"),
  dockerfile: () => import("syntechs/grammars/dockerfile/highlight"),
  sql: () => import("syntechs/grammars/sql/highlight"),
  kotlin: () => import("syntechs/grammars/kotlin/highlight"),
  html: () => import("syntechs/grammars/html/highlight"),
  swift: () => import("syntechs/grammars/swift/highlight"),
  yaml: () => import("syntechs/grammars/yaml/highlight"),
  graphql: () => import("syntechs/grammars/graphql/highlight"),
  markdown: async () => ({
    highlight: withFences(
      (await import("syntechs/grammars/markdown/highlight")).highlight,
    ),
  }),
  svg: () => import("syntechs/grammars/html/highlight"),
};

/** Info-string names that are neither a language id nor one of its file extensions. */
const fenceAliases: Record<string, LanguageId> = {
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  jsonc: "json",
  json5: "json",
  docker: "dockerfile",
};

/** The language a fence's info string names: `rust`, `rs`, `shell`; Markdown itself is left plain. */
function fenceLanguage(name: string): LanguageId | undefined {
  const lower = name.toLowerCase();
  const id = Object.hasOwn(parsers, lower)
    ? (lower as LanguageId)
    : (fenceAliases[lower] ?? languageForPath(`fence.${lower}`));
  return id === "markdown" ? undefined : id;
}

type Fenced = { language: Language; highlight: HighlightModule };

/**
 * Markdown's highlighter, with each fenced code block's content also coloured as the language its info string
 * names. Which languages a file fences is known only once it is parsed, and `highlight` is synchronous, so
 * `load` brings in every language a fence can name.
 */
function withFences(markdown: HighlightModule): HighlightModule {
  const fenced = new Map<LanguageId, Fenced>();
  return {
    async load() {
      await markdown.load?.();
      const ids = (Object.keys(parsers) as LanguageId[]).filter(
        (id) => id !== "markdown" && id !== "svg",
      );
      await Promise.all(
        ids.map(async (id) => {
          const highlighter = highlighters[id];
          if (!highlighter) return;
          const [{ language }, { highlight }] = await Promise.all([
            parsers[id](),
            highlighter(),
          ]);
          await highlight.load?.();
          fenced.set(id, { language, highlight });
        }),
      );
    },
    highlight(tree, paint) {
      markdown.highlight(tree, paint);
      const visit = (n: number): void => {
        const kind = tree.kindName(n);
        if (kind === "inline") return;
        if (kind === "fenced_code_block") {
          paintFence(tree, n, paint, fenced);
          return;
        }
        for (let i = 0, count = tree.count(n); i < count; i++)
          visit(tree.child(n, i));
      };
      visit(tree.root);
    },
  };
}

/**
 * Parses a fence's content, less the quote or list prefixes (`block_continuation`) inside it, as its info
 * string's language and paints those scopes back onto the content node.
 */
function paintFence(
  tree: Tree,
  fence: number,
  paint: Parameters<HighlightModule["highlight"]>[1],
  fenced: Map<LanguageId, Fenced>,
): void {
  let content: number | undefined;
  let name: string | undefined;
  for (let i = 0, count = tree.count(fence); i < count; i++) {
    const c = tree.child(fence, i);
    const kind = tree.kindName(c);
    if (kind === "code_fence_content") content = c;
    else if (kind === "info_string")
      for (let j = 0, k = tree.count(c); j < k; j++) {
        const l = tree.child(c, j);
        if (tree.kindName(l) === "language") name = tree.text(l);
      }
  }
  const id = name === undefined ? undefined : fenceLanguage(name);
  const lang = id === undefined ? undefined : fenced.get(id);
  if (content === undefined || !lang) return;
  const start = tree.start(content);
  const length = tree.end(content) - start;
  const whole = tree.text(content);
  // `[from, to)` stretches of the content node, and where each begins in the text parsed.
  const pieces: { from: number; to: number; at: number }[] = [];
  let text = "";
  let at = 0;
  const take = (to: number) => {
    if (to > at) {
      pieces.push({ from: at, to, at: text.length });
      text += whole.slice(at, to);
    }
  };
  for (let i = 0, count = tree.count(content); i < count; i++) {
    const c = tree.child(content, i);
    if (tree.kindName(c) !== "block_continuation") continue;
    take(tree.start(c) - start);
    at = Math.max(at, tree.end(c) - start);
  }
  take(length);
  const inner = parseTree(lang.language, text);
  lang.highlight.highlight(inner, (m, scope, from, to) => {
    const s = inner.start(m) + (from ?? 0);
    const e = to === undefined ? inner.end(m) : inner.start(m) + to;
    for (const p of pieces) {
      const a = Math.max(s, p.at);
      const b = Math.min(e, p.at + p.to - p.from);
      if (a < b) paint(content, scope, p.from + a - p.at, p.from + b - p.at);
    }
  });
}

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
  go: ["function_declaration", "method_declaration", "type_spec"],
  rust: [
    "function_item",
    "impl_item",
    "trait_item",
    "struct_item",
    "enum_item",
    "mod_item",
  ],
  ruby: ["method", "singleton_method", "class", "singleton_class", "module"],
  bash: ["function_definition"],
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
  <O>(
    rules: FormatLanguage<O> & {
      format?: (tree: Tree, options: Partial<O>) => Formatted;
    },
    infer?: (tree: Tree) => Partial<O>,
  ) =>
  (options: object): FormatModule => ({
    format: (tree) => {
      const resolved = {
        ...infer?.(tree),
        ...(options as Partial<O>),
      };
      return rules.format?.(tree, resolved) ?? format(tree, rules, resolved);
    },
  });

function inferJavascriptOptions(tree: Tree) {
  const source = tree.text(tree.root);
  let semicolonLines = 0;
  let semicolonlessLines = 0;
  let tabIndented = 0;
  let spaceIndented = 0;
  // An indent of two spaces anywhere means a two-space step; files indented only in fours step by four.
  let twoSpaceStep = false;
  const lines = source.split(/\r\n?|\n/);
  for (const line of lines) {
    const code = line.replace(/\s+\/\/.*$/, "").trim();
    if (
      code === "" ||
      code.startsWith("//") ||
      code.startsWith("/*") ||
      code.startsWith("*")
    )
      continue;
    if (line.startsWith("\t")) tabIndented++;
    else if (line.startsWith(" ")) {
      spaceIndented++;
      if ((line.length - line.trimStart().length) % 4 === 2) twoSpaceStep = true;
    }
    if (code.endsWith(";")) semicolonLines++;
    // Count only endings that commonly finish an expression or declaration; block braces and continuation
    // punctuation would otherwise make semicolon-using files look semicolonless.
    else if (/[^\s{};,.:=+*/%&|!?<>-](?:\+\+|--)?$/.test(code))
      semicolonlessLines++;
  }
  const singleQuotes = source.match(/'(?:\\.|[^'\\\r\n])*'/g)?.length ?? 0;
  const doubleQuotes = source.match(/"(?:\\.|[^"\\\r\n])*"/g)?.length ?? 0;
  const useTabs = tabIndented > spaceIndented;
  const tabWidth = useTabs || !twoSpaceStep ? 4 : 2;
  // The printer counts a tab as tabWidth columns.
  const widths = lines.map(
    (line) => line.length + (line.match(/^\t*/)?.[0].length ?? 0) * (tabWidth - 1),
  );
  // The repo's width is the narrowest common one that nearly every line fits: the longest line is usually a string
  // or comment the printer can't break, and widening to it would join calls the author's printer had split.
  const printWidth =
    [80, 100, 120, 140, 160].find(
      (width) =>
        widths.filter((w) => w > width).length <= lines.length / 100,
    ) ?? 200;
  return {
    semi: semicolonlessLines <= semicolonLines,
    singleQuote: singleQuotes > doubleQuotes,
    printWidth,
    useTabs,
    tabWidth,
  };
}

const formatters: Partial<
  Record<LanguageId, () => Promise<(options: object) => FormatModule>>
> = {
  // syntechs' JSON printer runs on the JavaScript grammar's tree, so .json parsed with the JSON grammar is shown as written.
  typescript: async () =>
    bind(
      (await import("syntechs/grammars/typescript/fmt")).typescript,
      inferJavascriptOptions,
    ),
  tsx: async () =>
    bind(
      (await import("syntechs/grammars/typescript/fmt")).tsx,
      inferJavascriptOptions,
    ),
  javascript: async () =>
    bind(
      (await import("syntechs/grammars/javascript/fmt")).javascript,
      inferJavascriptOptions,
    ),
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
   * YAML stays as written unless given an options object. An object overrides that formatter's options
   * (oxfmt/prettier's for JS/TS/CSS/HTML/YAML/GraphQL, ruff's for Python, ktfmt's for Kotlin, and swift-format's
   * for Swift).
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
    if (
      formatOptions !== false &&
      (id !== "yaml" || formatOptions !== undefined) &&
      bindFormatter
    )
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
