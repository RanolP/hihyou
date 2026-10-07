import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const cacheDir = resolve(
  import.meta.dirname,
  "../../node_modules/.cache/tree-sitter-query",
);

/**
 * The stdout of `tree-sitter query -p grammarDir query ...files`, the reference the highlight parity tests compare
 * against. The CLI spends seconds per run recompiling the query (7 s for Swift's corpus), so the output is kept on
 * disk under a hash of everything it reads: the CLI's version, the grammar's sources, the query's text, and each
 * file's path and text. Any change to one of them runs the CLI again.
 */
export function treeSitterQuery(
  grammarDir: string,
  query: string,
  files: readonly string[],
): string {
  const hash = createHash("sha256");
  const version = spawnSync("tree-sitter", ["--version"], { encoding: "utf8" });
  hash.update(`${version.stdout}\0${grammarDir}\0`);
  const src = join(grammarDir, "src");
  for (const f of readdirSync(src, {
    recursive: true,
    encoding: "utf8",
  }).sort()) {
    const path = join(src, f);
    if (/\.(c|h|json)$/.test(f))
      hash.update(`${f}\0`).update(readFileSync(path));
  }
  const config = join(grammarDir, "tree-sitter.json");
  if (existsSync(config)) hash.update(readFileSync(config));
  hash.update("\0query\0").update(readFileSync(query));
  for (const f of files) hash.update(`\0${f}\0`).update(readFileSync(f));
  const cached = join(cacheDir, `${hash.digest("hex")}.txt`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");

  const r = spawnSync(
    "tree-sitter",
    ["query", "-p", grammarDir, query, ...files],
    {
      encoding: "utf8",
      maxBuffer: 1 << 30,
    },
  );
  if (r.status !== 0)
    throw new Error(
      `tree-sitter query failed (status ${r.status}):\n${r.stderr}`,
    );
  mkdirSync(cacheDir, { recursive: true });
  // Written aside and renamed, so a parallel or killed run never leaves a half-written reference behind.
  const tmp = `${cached}.${process.pid}`;
  writeFileSync(tmp, r.stdout);
  renameSync(tmp, cached);
  return r.stdout;
}
