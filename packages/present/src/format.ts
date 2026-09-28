import { parseTree, type Tree } from "syntechs/core";
import { format, type Language } from "syntechs/fmt";
import {
  type FormatConfigResolver,
  mergeOptions,
  type PrettierOptions,
  type RuffOptions,
} from "./format-config.js";

export type Unformatted =
  | "unsupported-language"
  | "formatter-error"
  /** The formatter changed too many tokens to map edits onto its output. */
  | "unalignable";

export type FormatResult =
  | { ok: true; text: string }
  | { ok: false; reason: Unformatted; message?: string };

export interface Formatter {
  /**
   * Never rejects: a file the formatter cannot handle comes back as a reason to show it unformatted.
   * `revision` is what `FormatterOptions.config` reads the repo's settings at; `presentFile` passes the
   * side, `base` or `head`.
   */
  format(path: string, text: string, revision: string): Promise<FormatResult>;
}

export interface FormatterOptions {
  /** Finds the repo's formatter config for each file; without it every file gets the formatter's defaults. */
  config?: FormatConfigResolver;
  /** The reviewer's own settings, applied over the repo's key by key. */
  reviewer?: {
    prettier?: Partial<PrettierOptions>;
    ruff?: Partial<RuffOptions>;
  };
}

/** Whose config a language reads, so a repo's `.prettierrc` or `[tool.ruff.format]` applies to it. */
type Tool = "prettier" | "ruff";

type Run = (path: string, text: string, options: object) => FormatResult;

interface Entry {
  tool: Tool;
  load(): Promise<Run>;
}

/** A language syntechs formats; `load` resolves the language for a path on first use. */
function syntechs<O>(
  tool: Tool,
  load: () => Promise<(path: string) => Language<O>>,
): Entry {
  return {
    tool,
    load: async () => {
      const languageFor = await load();
      return (path, text, options) =>
        run(languageFor(path), text, options as Partial<O>);
    },
  };
}

const json = syntechs(
  "prettier",
  async () => (await import("syntechs/grammars/json/fmt")).jsonLanguageFor,
);

/** By extension; a language syntechs learns to format is one entry here. */
const languages = new Map<string, Entry>([
  [".json", json],
  [".jsonc", json],
  [
    ".css",
    syntechs("prettier", async () => {
      const { css } = await import("syntechs/grammars/css/fmt");
      return () => css;
    }),
  ],
]);

function hasMissing(tree: Tree): boolean {
  for (let o = 0; o < tree.nodeCount; o++)
    if (tree.missing(tree.at(o))) return true;
  return false;
}

function run<O>(
  language: Language<O>,
  text: string,
  options: Partial<O>,
): FormatResult {
  const tree = parseTree(language.parser, text);
  // syntechs keeps a broken node's text as is, but a half-formatted file would show its layout as the author's.
  if (tree.errorChars > 0 || hasMissing(tree))
    return {
      ok: false,
      reason: "formatter-error",
      message: "the file has a syntax error",
    };
  // Always: an import the formatter dropped as unused or duplicate would hide an import the change adds or removes.
  const out = format(tree, language, { ...options, keepImports: true } as Partial<O>);
  return out.ok
    ? { ok: true, text: out.text }
    : { ok: false, reason: out.reason, message: out.detail };
}

/** Ruff's `[format]` keys, flattened to `format.<key>` by discovery, are top-level in syntechs' options. */
const ruffNames = (options: Partial<RuffOptions>) =>
  Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key.replace(/^format\./, ""),
      value,
    ]),
  );

export function createFormatter({
  config,
  reviewer = {},
}: FormatterOptions = {}): Formatter {
  const loaded = new Map<Entry, Promise<Run>>();

  const optionsFor = async (
    tool: Tool,
    revision: string,
    path: string,
  ): Promise<object> => {
    if (tool === "prettier")
      return mergeOptions(
        (await config?.prettier(revision, path))?.options ?? {},
        reviewer.prettier ?? {},
      );
    return ruffNames(
      mergeOptions(
        (await config?.ruff(revision, path))?.options ?? {},
        reviewer.ruff ?? {},
      ),
    );
  };

  return {
    async format(path, text, revision) {
      const ext = extension(path);
      const entry = languages.get(ext);
      if (!entry)
        return {
          ok: false,
          reason: "unsupported-language",
          message: `syntechs has no formatter for ${ext || "this file"} yet`,
        };
      try {
        let formatter = loaded.get(entry);
        if (!formatter) {
          formatter = entry.load();
          loaded.set(entry, formatter);
          // A failed load is retried on the next file of the language instead of failing every later one.
          formatter.catch(() => loaded.delete(entry));
        }
        const options = await optionsFor(entry.tool, revision, path);
        return (await formatter)(path, text, options);
      } catch (error) {
        return {
          ok: false,
          reason: "formatter-error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot <= path.lastIndexOf("/") ? "" : path.slice(dot).toLowerCase();
}
