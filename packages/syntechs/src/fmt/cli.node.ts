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

// Each import is a literal specifier, so a bundler can follow it (the bench runs this entry bundled).
type Load<T> = () => Promise<T>;
interface Spec {
  grammar: Load<{ language: Grammar }>;
  fmt: Load<Record<string, unknown>>;
  export: string;
}

const javascript: Spec = {
  grammar: () => import("../grammars/javascript/index.js"),
  fmt: () => import("../grammars/javascript/fmt.js"),
  export: "javascript",
};
const kotlin: Spec = {
  grammar: () => import("../grammars/kotlin/index.js"),
  fmt: () => import("../grammars/kotlin/fmt.js"),
  export: "kotlin",
};
const yaml: Spec = {
  grammar: () => import("../grammars/yaml/index.js"),
  fmt: () => import("../grammars/yaml/fmt.js"),
  export: "yaml",
};
const html: Spec = {
  grammar: () => import("../grammars/html/index.js"),
  fmt: () => import("../grammars/html/fmt.js"),
  export: "html",
};
const typescript = () => import("../grammars/typescript/fmt.js");
const EXT: Record<string, Spec> = {
  ".json": {
    grammar: () => import("../grammars/javascript/index.js"),
    fmt: () => import("../grammars/json/fmt.js"),
    export: "json",
  },
  ".css": {
    grammar: () => import("../grammars/css/index.js"),
    fmt: () => import("../grammars/css/fmt.js"),
    export: "css",
  },
  ".html": html,
  ".htm": html,
  ".svg": html,
  ".js": javascript,
  ".jsx": javascript,
  ".ts": {
    grammar: () => import("../grammars/typescript/index.js"),
    fmt: typescript,
    export: "typescript",
  },
  ".tsx": {
    grammar: () => import("../grammars/tsx/index.js"),
    fmt: typescript,
    export: "tsx",
  },
  ".py": {
    grammar: () => import("../grammars/python/index.js"),
    fmt: () => import("../grammars/python/fmt.js"),
    export: "python",
  },
  ".kt": kotlin,
  ".kts": kotlin,
  ".yaml": yaml,
  ".yml": yaml,
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

const loaded = new Map<
  Spec,
  { grammar: Grammar; lang: Language<unknown> | undefined }
>();
const writes: Promise<void>[] = [];
for (const { spec, path, text: pending } of files) {
  let entry = loaded.get(spec);
  if (!entry) {
    entry = {
      grammar: (await spec.grammar()).language,
      lang: (await spec.fmt())[spec.export] as Language<unknown> | undefined,
    };
    loaded.set(spec, entry);
  }
  const { grammar, lang } = entry;
  if (!lang) continue;
  const text = await pending;
  const out = format(parseTree(grammar, text), lang);
  if (out.ok && out.text !== text) writes.push(writeFile(path, out.text));
}
await Promise.all(writes);
