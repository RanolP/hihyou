import type { Tree } from "syntechs/core";
import {
  format,
  type Formatted,
  type Language as FormatLanguage,
} from "syntechs/fmt";

type GrammarModule = Record<string, unknown>;

type ExecutableFormatLanguage = FormatLanguage<unknown> & {
  format(tree: Tree, options: object): Formatted;
};

declare global {
  var hihyouGrammarModules: Record<string, GrammarModule> | undefined;
  /** Injects a grammar chunk on app.js's behalf; set by the content script before app.js loads. */
  var hihyouLoadGrammarChunk: ((file: string) => Promise<void>) | undefined;
}

/** Adds statically imported grammar modules to the isolated world's registry for app.js. */
export function registerGrammarModules(
  modules: Record<string, GrammarModule>,
): void {
  const registry =
    globalThis.hihyouGrammarModules ??
    (globalThis.hihyouGrammarModules = Object.create(null) as Record<
      string,
      GrammarModule
    >);
  for (const [id, module] of Object.entries(modules)) {
    registry[id] = id.endsWith("/fmt")
      ? executableFormatModule(module)
      : module;
  }
}

/** Keeps the formatter's rules and its module-level stream state in the same classic-script bundle. */
function executableFormatModule(module: GrammarModule): GrammarModule {
  return Object.fromEntries(
    Object.entries(module).map(([name, value]) => [
      name,
      isFormatLanguage(value)
        ? ({
            ...value,
            format: (tree, options) => format(tree, value, options),
          } satisfies ExecutableFormatLanguage)
        : value,
    ]),
  );
}

function isFormatLanguage(value: unknown): value is FormatLanguage<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "stream" in value &&
    "defaults" in value &&
    "parser" in value
  );
}
