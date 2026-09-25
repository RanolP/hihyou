#!/usr/bin/env bash
# Builds bulk.wasm: tree-sitter runtime + ts/python/json grammars + bulk.c, via zig cc (from PyPI `ziglang`).
# Usage: TS_SRC=<tree-sitter checkout at v0.27.0> ./build.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
nm="$here/../node_modules"
: "${TS_SRC:?set TS_SRC to a tree-sitter checkout (git clone --depth 1 --branch v0.27.0 https://github.com/tree-sitter/tree-sitter)}"
# OPT="-Os -s" gives a 1.9 MB (233 KB gzip) module at ~6-18% slower parse than the -O2 default.
zigcc=(uvx --from ziglang python -m ziglang cc)
"${zigcc[@]}" -target wasm32-wasi ${OPT:--O2} -mexec-model=reactor -Wl,--no-entry \
  -I "$TS_SRC/lib/include" -I "$TS_SRC/lib/src" \
  "$TS_SRC/lib/src/lib.c" \
  -I "$nm/tree-sitter-typescript/typescript/src" "$nm/tree-sitter-typescript/typescript/src/parser.c" "$nm/tree-sitter-typescript/typescript/src/scanner.c" \
  -I "$nm/tree-sitter-python/src" "$nm/tree-sitter-python/src/parser.c" "$nm/tree-sitter-python/src/scanner.c" \
  -I "$nm/tree-sitter-json/src" "$nm/tree-sitter-json/src/parser.c" \
  "$here/bulk.c" -o "$here/bulk.wasm"
ls -l "$here/bulk.wasm"
