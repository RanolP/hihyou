#!/usr/bin/env bash
# Run once, first, in a fresh worktree, before `pnpm install`. Links the shared corpus and benchmark-input
# directories to the main checkout instead of re-downloading them per worktree, and reuses the main checkout's
# built output (grammar bundles, dist/, tsbuildinfo) so `pnpm install` skips regenerating the bundles and
# `pnpm run build` is incremental instead of building from scratch.
set -euo pipefail

worktree_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$worktree_root"

common_dir="$(git rev-parse --git-common-dir)"
main_root="$(dirname "$common_dir")"

if [ "$main_root" = "$worktree_root" ]; then
  echo "worktree-setup: already the main checkout ($main_root), nothing to link" >&2
  exit 0
fi

# Link a directory the main checkout already has (a big, gitignored download) into this worktree, instead of
# every worktree re-fetching its own copy. Windows needs a directory junction (no admin rights required, unlike
# a symlink); skip silently if the link -- or a real directory from a previous run -- is already there.
link_shared_dir() {
  local rel="$1" wt="$worktree_root/$1" main="$main_root/$1"
  if [ -e "$wt" ]; then
    echo "worktree-setup: $rel already present, skipping link"
    return
  fi
  if [ ! -d "$main" ]; then
    echo "worktree-setup: main checkout is missing $rel (expected at $main) -- fetch it there first" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$wt")"
  cmd //c mklink //J "$(cygpath -w "$wt")" "$(cygpath -w "$main")" >/dev/null
  echo "worktree-setup: linked $rel -> $main"
}

link_shared_dir packages/syntechs/corpus
link_shared_dir research/parser-bench/inputs

# Reuse the main checkout's fetched and generated grammars: packages/syntechs/grammars/build.mjs keys each by its
# pinned sources and patch, so a grammar this worktree changes is regenerated rather than taken from the copy.
grammar_cache=packages/syntechs/grammars/.cache
if [ -d "$main_root/$grammar_cache" ] && [ ! -e "$worktree_root/$grammar_cache" ]; then
  mkdir -p "$(dirname "$worktree_root/$grammar_cache")"
  cp -Rp "$main_root/$grammar_cache" "$worktree_root/$grammar_cache"
  echo "worktree-setup: copied $grammar_cache from the main checkout"
fi

# Reuse the main checkout's grammar bundles and TypeScript build output so `pnpm install`'s postinstall and
# `pnpm run build` don't redo work every worktree already has, as long as the two checkouts agree on
# pnpm-lock.yaml and the grammar packages' manifests and patches (any difference can mean different grammar
# sources, so bundles built from them are regenerated instead of copied).
copied_bundles=0
shopt -s nullglob
for bundle in "$main_root"/packages/syntechs/src/grammars/*/bundle.js; do
  rel="${bundle#"$main_root"/}"
  mkdir -p "$worktree_root/$(dirname "$rel")"
  cp -p "$bundle" "$worktree_root/$rel"
  copied_bundles=1
done

for pkg_dir in "$main_root"/packages/*/; do
  name="$(basename "$pkg_dir")"
  if [ -d "${pkg_dir}dist" ]; then
    mkdir -p "$worktree_root/packages/$name"
    cp -rp "${pkg_dir}dist" "$worktree_root/packages/$name/"
  fi
  for buildinfo in "$pkg_dir"*.tsbuildinfo; do
    cp -p "$buildinfo" "$worktree_root/packages/$name/"
  done
done
shopt -u nullglob

# What the bundles are built from: the lockfile, then each grammar package's manifest and patch.
grammar_inputs() {
  (
    cd "$1"
    shopt -s nullglob
    cat pnpm-lock.yaml packages/syntechs/grammars/*/package.json packages/syntechs/grammars/*/grammar.patch
  ) | sha256sum
}

skip_generate=0
if [ "$copied_bundles" = 1 ] && [ -f "$main_root/pnpm-lock.yaml" ] &&
  [ "$(grammar_inputs "$main_root")" = "$(grammar_inputs "$worktree_root")" ]; then
  skip_generate=1
fi

if [ "$skip_generate" = 1 ]; then
  echo "worktree-setup: pnpm-lock.yaml and the grammar patches match the main checkout, reusing its copied grammar bundles"
  HIHYOU_SKIP_GRAMMAR_GENERATE=1 pnpm install --frozen-lockfile
else
  echo "worktree-setup: pnpm-lock.yaml or a grammar patch differs from the main checkout (or no bundles to reuse), regenerating"
  pnpm install --frozen-lockfile
fi

echo "worktree-setup: done -- run 'pnpm run build' next; it will be incremental against the copied dist/tsbuildinfo"
