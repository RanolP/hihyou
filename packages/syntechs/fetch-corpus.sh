#!/usr/bin/env bash
# Downloads the extra parity and benchmark inputs (pinned versions) into ./corpus.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)/corpus"
mkdir -p "$dir"
get() { curl -fsSL "$1" -o "$dir/$2" || { echo "download failed ($?): $1" >&2; exit 1; }; }
get https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.css bootstrap.css
get https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css normalize.css
get https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.css animate.css
get https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.js lodash.js
get https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.js jquery.js
get https://raw.githubusercontent.com/excalidraw/excalidraw/v0.17.0/src/components/App.tsx App.tsx
get https://raw.githubusercontent.com/excalidraw/excalidraw/v0.17.0/src/components/LayerUI.tsx LayerUI.tsx
get https://raw.githubusercontent.com/python/cpython/v3.13.0/Lib/typing.py typing.py
get https://raw.githubusercontent.com/python/cpython/v3.13.0/Lib/dataclasses.py dataclasses.py
get https://raw.githubusercontent.com/python/cpython/v3.13.0/Lib/asyncio/base_events.py base_events.py

# The reference formatters' own test suites, for the conformance matrix (src/fmt/conformance.node.ts): prettier's
# fixtures with their committed __snapshots__, ruff's formatter fixtures with their insta snapshots.
tree() { # <archive url> <dest dir> <path inside the archive>...
  local url="$1" dest="$dir/$2"
  shift 2
  rm -rf "$dest"
  mkdir -p "$dest"
  curl -fsSL "$url" | tar -xz -C "$dest" --strip-components=1 "$@" ||
    { echo "download or extract failed: $url" >&2; exit 1; }
}
tree https://codeload.github.com/prettier/prettier/tar.gz/refs/tags/3.9.9 prettier-3.9.9 \
  prettier-3.9.9/tests/format/json prettier-3.9.9/tests/format/css prettier-3.9.9/tests/format/js \
  prettier-3.9.9/tests/format/jsx prettier-3.9.9/tests/format/typescript
tree https://codeload.github.com/astral-sh/ruff/tar.gz/refs/tags/0.16.8 ruff-0.16.8 \
  ruff-0.16.8/crates/ruff_python_formatter/resources/test/fixtures \
  ruff-0.16.8/crates/ruff_python_formatter/tests/snapshots
ls -l "$dir"
