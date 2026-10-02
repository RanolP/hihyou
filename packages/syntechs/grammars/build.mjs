// Assembles the tree-sitter grammar packages from upstream grammar sources, instead of installing them from npm.
// Each directory here is a workspace package whose postinstall runs this for itself:
//   1. fetch the files its package.json's `grammar.sources` lists, from raw.githubusercontent.com at the pinned
//      commit, each checked against its sha256 (cached in .cache/sources/, so a repeat install stays offline);
//   2. apply its grammar.patch, which touches only those source files (grammar.js, src/scanner.c, ...);
//   3. run `tree-sitter generate` (the version mise.toml pins) in each `grammar.generate` directory;
//   4. copy the result into the package directory, where compile.node.ts and corpus.node.ts read src/parser.c.
// The result of 1-3 is cached in .cache/build/ under a key of the sources, the patch and the CLI version, and
// the package directory is only rewritten when that key changes (.stamp holds it).
//
// To change a grammar: edit its patched sources in place (packages/syntechs/grammars/tree-sitter-css/grammar.js,
// src/scanner.c), then
//   node packages/syntechs/grammars/build.mjs --save-patch tree-sitter-css
// which rewrites grammar.patch as the diff from upstream (keeping the notes above its first file) and
// regenerates the package. Then `node packages/syntechs/generate.mjs css` rebuilds the bundle. A scanner.c change
// needs its port in packages/syntechs/src/grammars/<name>/scanner.ts too.
//
//   node packages/syntechs/grammars/build.mjs [--save-patch] [tree-sitter-<name>...]
// With no names it builds the package it runs in (the postinstall), or else every package.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, createTwoFilesPatch, parsePatch } from "diff";

const here = import.meta.dirname;
const cache = join(here, ".cache");
const PATCH = "grammar.patch";
/** What a package directory keeps across rebuilds: everything else there is assembled. */
const TRACKED = new Set(["package.json", PATCH, "node_modules"]);

const miseToml = join(here, "../../../mise.toml");
const cliVersion = /^tree-sitter\s*=\s*"([^"]+)"/m.exec(
  readFileSync(miseToml, "utf8"),
)?.[1];
class Failure extends Error {}
function fail(message) {
  throw new Failure(message);
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** A package's `grammar` config: its sources (the first is its own) and the directories to generate in. */
function config(name) {
  const file = join(here, name, "package.json");
  if (!existsSync(file)) fail(`no grammar package ${name} (expected ${file})`);
  const { grammar } = JSON.parse(readFileSync(file, "utf8"));
  if (!grammar?.sources?.length) fail(`${file} has no grammar.sources`);
  return { sources: grammar.sources, generate: grammar.generate ?? ["."] };
}

/** One upstream file, from the cache or the network, verified against its pinned hash. */
async function fetchFile(source, file) {
  const expected = source.files[file];
  const cached = join(
    cache,
    "sources",
    `${source.repo.replace("/", "__")}@${source.commit}`,
    file,
  );
  if (existsSync(cached)) {
    const data = readFileSync(cached);
    if (sha256(data) === expected) return data;
  }
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${file}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    fail(`fetching ${url} failed: ${e.cause?.message ?? e.message}`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (!res.ok)
    fail(
      `fetching ${url} failed: HTTP ${res.status}\n${data.toString("utf8").slice(0, 500)}`,
    );
  const actual = sha256(data);
  if (actual !== expected)
    fail(
      `${url} does not match its pin\n  expected sha256 ${expected}\n  actual   sha256 ${actual}`,
    );
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(`${cached}.${process.pid}`, data);
  renameSync(`${cached}.${process.pid}`, cached);
  return data;
}

function run(cmd, args, cwd, hint = "") {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    fail(
      `\`${cmd} ${args.join(" ")}\` in ${cwd} failed (status ${r.status}${r.error ? `, ${r.error.message}` : ""})${hint}\n${r.stderr ?? ""}${(r.stdout ?? "").slice(0, 2000)}`,
    );
  return r.stdout;
}

let cliChecked = false;
function checkCli() {
  if (cliChecked) return;
  const version = run(
    "tree-sitter",
    ["--version"],
    here,
    `: mise.toml pins tree-sitter ${cliVersion}, so run \`mise install\` at the repo root`,
  );
  if (!version.includes(cliVersion))
    fail(
      `mise.toml pins tree-sitter ${cliVersion}, but PATH has ${version.trim()}: run \`mise install\` at the repo root`,
    );
  cliChecked = true;
}

/** The patch's file sections, each with the upstream-relative path it edits. */
function patchFiles(text) {
  // An empty patch, or its notes alone, parses as one section without hunks.
  return parsePatch(text)
    .filter((p) => p.hunks.length > 0)
    .map((p) => ({ path: p.oldFileName.replace(/^a\//, ""), patch: p }));
}

async function build(name) {
  const { sources, generate } = config(name);
  const pkg = join(here, name);
  const patchFile = join(pkg, PATCH);
  const patch = existsSync(patchFile) ? readFileSync(patchFile, "utf8") : "";
  const key = sha256(
    JSON.stringify({ sources, generate, patch, cliVersion }),
  ).slice(0, 16);
  const stamp = join(pkg, ".stamp");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === key) {
    console.log(`grammars/build.mjs: ${name} is up to date (${key})`);
    return;
  }

  const out = join(cache, "build", `${name}-${key}`);
  if (!existsSync(out)) {
    const stage = `${out}.${process.pid}`;
    try {
      const own = new Set();
      for (const source of sources) {
        for (const file of Object.keys(source.files)) {
          const path = join(source.into ?? "", file);
          if (!source.into) own.add(path.split(sep).join("/"));
          mkdirSync(dirname(join(stage, path)), { recursive: true });
          writeFileSync(join(stage, path), await fetchFile(source, file));
        }
      }
      for (const { path, patch: p } of patchFiles(patch)) {
        if (!own.has(path))
          fail(
            `${patchFile} edits ${path}, which is not one of ${name}'s fetched files (${[...own].join(", ")})`,
          );
        const target = join(stage, path);
        const patched = applyPatch(readFileSync(target, "utf8"), p);
        if (patched === false)
          fail(
            `${patchFile} does not apply to ${path} at ${sources[0].repo}@${sources[0].commit}`,
          );
        writeFileSync(target, patched);
      }
      checkCli();
      const started = Date.now();
      for (const dir of generate)
        run("tree-sitter", ["generate"], join(stage, dir));
      console.log(
        `grammars/build.mjs: generated ${name} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      rmSync(out, { recursive: true, force: true });
      renameSync(stage, out);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  for (const entry of readdirSync(pkg))
    if (!TRACKED.has(entry))
      rmSync(join(pkg, entry), { recursive: true, force: true });
  // Only the package's own sources and what generate wrote: a source fetched `into` a directory (typescript's
  // javascript grammar) is there for generate alone.
  const skip = new Set(sources.filter((s) => s.into).map((s) => s.into.split("/")[0]));
  cpSync(out, pkg, {
    recursive: true,
    filter: (src) => !skip.has(relative(out, src).split(sep)[0]),
  });
  writeFileSync(stamp, key);
  console.log(`grammars/build.mjs: assembled ${name} (${key})`);
}

/** The notes header above a patch's first diff section, or the whole text when it holds only notes. */
export function patchNotes(text) {
  const headerStart = text.search(/^(=+|--- .*)$/m);
  return headerStart === -1 ? text : text.slice(0, headerStart);
}

/** What grammar.patch should hold next, or null to delete it: the notes header must survive even
 * when there's no diff to go with it (notes-only, nothing edited yet). */
export function nextPatch(notes, diff) {
  if (diff) return notes + diff;
  if (notes) return notes;
  return null;
}

/** Rewrites grammar.patch as the diff from upstream to the package's edited sources. */
async function savePatch(name) {
  const { sources } = config(name);
  const pkg = join(here, name);
  const patchFile = join(pkg, PATCH);
  const old = existsSync(patchFile) ? readFileSync(patchFile, "utf8") : "";
  const notes = patchNotes(old);
  let diff = "";
  for (const source of sources.filter((s) => !s.into)) {
    for (const file of Object.keys(source.files)) {
      const upstream = (await fetchFile(source, file)).toString("utf8");
      const edited = readFileSync(join(pkg, file), "utf8");
      if (upstream !== edited)
        diff += createTwoFilesPatch(
          `a/${file}`,
          `b/${file}`,
          upstream,
          edited,
          "",
          "",
        ).replace(/^=+\n/, "");
    }
  }
  const next = nextPatch(notes, diff);
  if (next !== null) writeFileSync(patchFile, next);
  else rmSync(patchFile, { force: true });
  console.log(
    `grammars/build.mjs: wrote ${diff ? patchFile : `no patch for ${name}`}`,
  );
}

// Guarded so a test can import this module's functions (e.g. patchNotes) without running the CLI below.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const save = args[0] === "--save-patch";
  let names = save ? args.slice(1) : args;
  if (names.length === 0)
    names =
      dirname(process.cwd()) === here
        ? [basename(process.cwd())]
        : readdirSync(here).filter((d) => existsSync(join(here, d, "package.json")));
  try {
    if (!cliVersion)
      fail(`no \`tree-sitter = "<version>"\` line in ${miseToml}`);
    // grammar.js is CommonJS in some grammars and an ES module in others. With no `type` in the nearest
    // package.json (syntechs' says "module"), node tells them apart by their syntax, as it does upstream.
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "package.json"), "{}\n");
    for (const name of names) {
      if (save) await savePatch(name);
      await build(name);
    }
  } catch (e) {
    if (!(e instanceof Failure)) throw e;
    console.error(`grammars/build.mjs: ${e.message}`);
    process.exit(1);
  }
}
