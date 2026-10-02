import { builtinModules } from "node:module";
import type { Plugin } from "vite";

const builtins = new Set(builtinModules);
// The plugin's resolveId sees only what Vite resolves; this reads the emitted text, so a require the bundler
// passed through is caught too.
const nodeRef = new RegExp(
  String.raw`\b(?:require|import)\s*\(\s*["'](?:node:[^"']*|${[...builtins].map((m) => m.replaceAll("/", "\\/")).join("|")})["']\s*\)|\bfrom\s*["']node:`,
);
// Chrome refuses to inject a script holding a Unicode noncharacter ("isn't UTF-8 encoded"), and the bundler
// keeps regex literals as written; one dependency's identifier regex spells a range up to U+FFFF literally.
const nonCharacter = /[﷐-﷯￾￿]/g;

/** Resolve conditions for both builds: workspace packages resolve to their TypeScript sources, as tsc and vitest
 * do. Setting conditions replaces Vite's defaults, so they are listed again. */
export const conditions = [
  "@hihyou/source",
  "module",
  "browser",
  "development|production",
];

/** Fails the build on a Node import and escapes Unicode noncharacters, for the extension and the userscript alike. */
export function browserSafe(): Plugin {
  return {
    name: "hihyou:browser-safe",
    enforce: "pre",
    // Neither the extension nor a userscript has Node, so a Node import that sneaks into the shared code must fail
    // the build, not the page at run time.
    resolveId(source, importer) {
      if (source.startsWith("node:") || builtins.has(source))
        throw new Error(
          `browser build imports Node built-in "${source}" (from ${importer})`,
        );
      return null;
    },
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        const hit = nodeRef.exec(chunk.code);
        if (hit)
          throw new Error(`${chunk.fileName} references Node: ${hit[0]}`);
        chunk.code = chunk.code.replace(
          nonCharacter,
          (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase()}`,
        );
      }
    },
  };
}
