// A minimal command-line entry so the bench can time syntechs the same way it times every other formatter: a
// single process invocation over a directory. Formats every recognized-extension file in `dir`, in place, by
// its extension; unrecognized extensions and inputs `format` refuses are left untouched. No correctness check
// here — the bench checks syntechs separately, in process; this exists only to be timed.
//
//   node packages/syntechs/dist/fmt/cli.node.js <dir>

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseTree } from "../core/index.js";
import type { Language as Grammar } from "../core/language.js";
import { format } from "./format.js";
import type { Language } from "./rules.js";

interface Spec {
  grammar: string;
  fmtDir: string;
  export: string;
}

const EXT: Record<string, Spec> = {
  ".json": { grammar: "json", fmtDir: "json", export: "json" },
  ".css": { grammar: "css", fmtDir: "css", export: "css" },
  ".js": { grammar: "javascript", fmtDir: "javascript", export: "javascript" },
  ".jsx": {
    grammar: "javascript",
    fmtDir: "javascript",
    export: "javascript",
  },
  ".ts": { grammar: "typescript", fmtDir: "typescript", export: "typescript" },
  ".tsx": { grammar: "tsx", fmtDir: "typescript", export: "tsx" },
  ".py": { grammar: "python", fmtDir: "python", export: "python" },
};

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: cli.node.js <dir>");
  const grammars = new Map<string, Grammar>();
  const langs = new Map<string, Language<unknown> | undefined>();
  for (const name of readdirSync(dir)) {
    const spec = EXT[extname(name)];
    if (!spec) continue;
    let grammar = grammars.get(spec.grammar);
    if (!grammar) {
      grammar = (
        (await import(
          new URL(`../grammars/${spec.grammar}/index.js`, import.meta.url)
            .href
        )) as { language: Grammar }
      ).language;
      grammars.set(spec.grammar, grammar);
    }
    const langKey = `${spec.fmtDir}#${spec.export}`;
    let lang = langs.get(langKey);
    if (!lang) {
      lang = (
        (await import(
          new URL(`../grammars/${spec.fmtDir}/fmt.js`, import.meta.url).href
        )) as Record<string, Language<unknown>>
      )[spec.export];
      langs.set(langKey, lang);
    }
    if (!lang) continue;
    const path = join(dir, name);
    const text = readFileSync(path, "utf8");
    const out = format(parseTree(grammar, text), lang);
    if (out.ok) writeFileSync(path, out.text);
  }
}

await main();
