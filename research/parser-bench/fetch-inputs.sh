#!/usr/bin/env bash
# Downloads the benchmark inputs (pinned tags) and generates big.json / edge.json into ./inputs.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)/inputs"
mkdir -p "$dir"
get() { curl -fsSL "$1" -o "$dir/$2" || { echo "download failed ($?): $1" >&2; exit 1; }; }
get https://raw.githubusercontent.com/microsoft/TypeScript/v5.8.3/src/compiler/scanner.ts scanner.ts
get https://raw.githubusercontent.com/microsoft/TypeScript/v5.8.3/src/compiler/checker.ts checker.ts
get https://raw.githubusercontent.com/microsoft/TypeScript/v5.8.3/package-lock.json package-lock.json
get https://raw.githubusercontent.com/python/cpython/v3.13.0/Lib/argparse.py argparse.py
node -e '
const fs = require("fs"), d = process.argv[1];
const lock = fs.readFileSync(d + "/package-lock.json", "utf8");
fs.writeFileSync(d + "/big.json", "[" + Array(9).fill(lock).join(",") + "]\n");
// tree-sitter-json edge cases: comments, raw newline in a string, non-BMP char, empty containers.
fs.writeFileSync(d + "/edge.json", "// c\n{\"aé\n\": [1, -2.5e3, true, false, null, \"\u{1F600}x\", {}, []], /* block */ \"b\": {\"c\": \"\"}}\n");
' "$dir"
ls -l "$dir"
