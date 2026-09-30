// Run once, first, in a fresh worktree, before `pnpm install`: `node scripts/worktree-setup.js`. Links the shared
// corpus and benchmark-input directories to the main checkout instead of re-downloading them per worktree, and
// reuses the main checkout's built output (grammar bundles, dist/, tsbuildinfo) so `pnpm install` skips
// regenerating the bundles and `pnpm run build` is incremental instead of building from scratch.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const worktreeRoot = realpathSync(join(import.meta.dirname, ".."));

const run = (command, args, options) => {
  const result = spawnSync(command, args, {
    cwd: worktreeRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    console.error(
      `worktree-setup: \`${[command, ...(args ?? [])].join(" ")}\` failed with exit status ${result.status}` +
        (result.error ? ` (${result.error.message})` : ""),
    );
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(1);
  }
  return result;
};

const commonDir = run("git", ["rev-parse", "--git-common-dir"]).stdout.trim();
const mainRoot = realpathSync(dirname(resolve(worktreeRoot, commonDir)));

if (mainRoot === worktreeRoot) {
  console.error(
    `worktree-setup: already the main checkout (${mainRoot}), nothing to link`,
  );
  process.exit(0);
}

// Link a directory the main checkout already has (a big, gitignored download) into this worktree, instead of
// every worktree re-fetching its own copy. On Windows it is a directory junction, which needs no admin rights
// unlike a symlink; skip silently if the link -- or a real directory from a previous run -- is already there.
const linkSharedDir = (rel) => {
  const wt = join(worktreeRoot, rel);
  const main = join(mainRoot, rel);
  if (existsSync(wt)) {
    console.log(`worktree-setup: ${rel} already present, skipping link`);
    return;
  }
  if (!existsSync(main)) {
    console.error(
      `worktree-setup: main checkout is missing ${rel} (expected at ${main}) -- fetch it there first`,
    );
    process.exit(1);
  }
  mkdirSync(dirname(wt), { recursive: true });
  symlinkSync(main, wt, "junction");
  console.log(`worktree-setup: linked ${rel} -> ${main}`);
};

linkSharedDir("packages/syntechs/corpus");
linkSharedDir("research/parser-bench/inputs");

const copy = (rel) =>
  cpSync(join(mainRoot, rel), join(worktreeRoot, rel), {
    recursive: true,
    preserveTimestamps: true,
  });
const subdirs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

// Reuse the main checkout's fetched and generated grammars: packages/syntechs/grammars/build.mjs keys each by its
// pinned sources and patch, so a grammar this worktree changes is regenerated rather than taken from the copy.
const grammarCache = "packages/syntechs/grammars/.cache";
if (
  existsSync(join(mainRoot, grammarCache)) &&
  !existsSync(join(worktreeRoot, grammarCache))
) {
  copy(grammarCache);
  console.log(`worktree-setup: copied ${grammarCache} from the main checkout`);
}

// Reuse the main checkout's grammar bundles and TypeScript build output so `pnpm install`'s postinstall and
// `pnpm run build` don't redo work every worktree already has, as long as the two checkouts agree on
// pnpm-lock.yaml and the grammar packages' manifests and patches (any difference can mean different grammar
// sources, so bundles built from them are regenerated instead of copied).
for (const name of subdirs(join(mainRoot, "packages"))) {
  const pkg = `packages/${name}`;
  if (existsSync(join(mainRoot, pkg, "dist"))) copy(`${pkg}/dist`);
  for (const file of readdirSync(join(mainRoot, pkg))) {
    if (file.endsWith(".tsbuildinfo")) copy(`${pkg}/${file}`);
  }
}

// What the bundles are built from: the lockfile, then each grammar package's manifest and patch.
const grammarInputs = (root) => {
  const hash = createHash("sha256");
  const grammars = subdirs(join(root, "packages/syntechs/grammars"));
  const files = [
    "pnpm-lock.yaml",
    ...grammars.map(
      (name) => `packages/syntechs/grammars/${name}/package.json`,
    ),
    ...grammars.map(
      (name) => `packages/syntechs/grammars/${name}/grammar.patch`,
    ),
  ];
  for (const file of files) {
    if (existsSync(join(root, file)))
      hash.update(readFileSync(join(root, file)));
  }
  return hash.digest("hex");
};

const bundles = subdirs(join(mainRoot, "packages/syntechs/src/grammars"))
  .map((name) => `packages/syntechs/src/grammars/${name}/bundle.js`)
  .filter((rel) => existsSync(join(mainRoot, rel)));
// Copy the bundles only on a match: a rerun's `pnpm install` finds node_modules current and skips the
// postinstall, so bundles copied from a differing checkout would never be regenerated.
const skipGenerate =
  bundles.length > 0 &&
  existsSync(join(mainRoot, "pnpm-lock.yaml")) &&
  grammarInputs(mainRoot) === grammarInputs(worktreeRoot);

if (skipGenerate) {
  bundles.forEach(copy);
  console.log(
    "worktree-setup: pnpm-lock.yaml and the grammar patches match the main checkout, reusing its copied grammar bundles",
  );
} else {
  console.log(
    "worktree-setup: pnpm-lock.yaml or a grammar patch differs from the main checkout (or no bundles to reuse), regenerating",
  );
}
// One command string with `shell: true`, since on Windows pnpm is a .cmd shim that only a shell resolves.
run("pnpm install --frozen-lockfile", undefined, {
  stdio: "inherit",
  shell: true,
  env: skipGenerate
    ? { ...process.env, HIHYOU_SKIP_GRAMMAR_GENERATE: "1" }
    : process.env,
});

console.log(
  "worktree-setup: done -- run 'pnpm run build' next; it will be incremental against the copied dist/tsbuildinfo",
);
