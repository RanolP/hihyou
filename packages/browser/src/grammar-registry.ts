/** Classic scripts injected before app.js, in dependency-sized groups that stay below AMO's per-file limit. */
export const grammarChunkFiles = [
  "/grammars-web.js",
  "/grammars-other.js",
  "/grammars-kotlin.js",
  "/grammars-swift.js",
] as const;

type GrammarModule = Record<string, unknown>;

declare global {
  var hihyouGrammarModules: Record<string, GrammarModule> | undefined;
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
  Object.assign(registry, modules);
}
