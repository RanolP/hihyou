// A minimal command-line entry so the bench can time syntechs the same way it times every other formatter: a
// single process invocation over a directory. Formats every recognized-extension file in `dir`, in place, by
// its extension; unrecognized extensions and inputs `format` refuses are left untouched, and so is a file
// whose formatted text equals its input (as ruff does). No correctness check here — the bench checks syntechs
// separately, in process; this exists only to be timed.
//
//   node packages/syntechs/dist/fmt/cli.node.js <dir>

import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { enableCompileCache } from "node:module";
import { extname, join } from "node:path";
import type { Language as Grammar } from "../core/language.js";
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

const dir = process.argv[2];
if (!dir) throw new Error("usage: cli.node.js <dir>");

// Every read starts now, on libuv's I/O threads, so the files arrive while the modules below load and the
// formatting loop never waits on a read; writes likewise go out without blocking the next file's format.
const files = readdirSync(dir).flatMap((name) => {
  const spec = EXT[extname(name)];
  if (!spec) return [];
  const path = join(dir, name);
  return [{ spec, path, text: readFile(path, "utf8") }];
});

// V8's code cache for every module this process loads, kept in the OS temp dir across runs, so a repeat run
// skips parsing and compiling them. It covers only modules loaded after this call, hence the dynamic imports.
enableCompileCache();
const { parseTree } = await import("../core/index.js");
const { format } = await import("./format.js");

const grammars = new Map<string, Grammar>();
const langs = new Map<string, Language<unknown> | undefined>();
const writes: Promise<void>[] = [];
for (const { spec, path, text: pending } of files) {
  let grammar = grammars.get(spec.grammar);
  if (!grammar) {
    grammar = (
      (await import(
        new URL(`../grammars/${spec.grammar}/index.js`, import.meta.url).href
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
  const text = await pending;
  const out = format(parseTree(grammar, text), lang);
  if (out.ok && out.text !== text) writes.push(writeFile(path, out.text));
}
await Promise.all(writes);
