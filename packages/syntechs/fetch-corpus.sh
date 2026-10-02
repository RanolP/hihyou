#!/usr/bin/env bash
# Downloads the extra parity and benchmark inputs (pinned versions) into ./corpus.
# `fetch-corpus.sh swift` instead regenerates the committed swift conformance set (see swift_corpus below).
set -euo pipefail

# The swift@swift-format conformance inputs: swift-format 603.0.0's Sources/SwiftFormat, each with the output of
# swift-format 6.3.0 (Xcode's, `xcrun swift-format`) under its default configuration beside it as `.expected`,
# written only when it differs from the input. An input swift-format rejects or does not format idempotently is
# left out. Committed under src/grammars/swift/corpus/swift-format, because swift-format runs only on a Mac.
swift_corpus() {
  local out tmp config f
  out="$(cd "$(dirname "$0")" && pwd)/src/grammars/swift/corpus/swift-format"
  [ "$(xcrun swift-format --version)" = 6.3.0 ] || { echo "needs swift-format 6.3.0 (xcrun swift-format)" >&2; exit 1; }
  tmp="$(mktemp -d)"
  config="$tmp/default.json"
  xcrun swift-format dump-configuration > "$config"
  curl -fsSL https://codeload.github.com/swiftlang/swift-format/tar.gz/refs/tags/603.0.0 |
    tar -xz -C "$tmp" --strip-components=1 swift-format-603.0.0/Sources/SwiftFormat swift-format-603.0.0/LICENSE.txt ||
    { echo "download or extract failed: swift-format 603.0.0" >&2; exit 1; }
  rm -rf "$out"
  mkdir -p "$out"
  cp "$tmp/LICENSE.txt" "$out/LICENSE.txt"
  (cd "$tmp/Sources/SwiftFormat" && find . -name '*.swift' | sort) | while read -r f; do
    f="${f#./}"
    local src="$tmp/Sources/SwiftFormat/$f" once twice
    once="$(xcrun swift-format format --configuration "$config" < "$src" 2>/dev/null && echo x)" || { echo "skip (swift-format error): $f" >&2; continue; }
    twice="$(printf '%s' "${once%x}" | xcrun swift-format format --configuration "$config" 2>/dev/null && echo x)" || twice=""
    [ "$once" = "$twice" ] || { echo "skip (not idempotent): $f" >&2; continue; }
    mkdir -p "$out/$(dirname "$f")"
    cp "$src" "$out/$f"
    printf '%s' "${once%x}" | cmp -s - "$src" || printf '%s' "${once%x}" > "$out/$f.expected"
  done
  rm -rf "$tmp"
}
if [ "${1:-}" = swift ]; then swift_corpus; exit 0; fi

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
  prettier-3.9.9/tests/format/jsx prettier-3.9.9/tests/format/typescript prettier-3.9.9/tests/format/html \
  prettier-3.9.9/tests/format/yaml
tree https://codeload.github.com/astral-sh/ruff/tar.gz/refs/tags/0.16.8 ruff-0.16.8 \
  ruff-0.16.8/crates/ruff_python_formatter/resources/test/fixtures \
  ruff-0.16.8/crates/ruff_python_formatter/tests/snapshots
# Real SVG files for the svg@oxfmt target: svgo's plugin tests and logo, feather's icons.
tree https://codeload.github.com/svg/svgo/tar.gz/refs/tags/v3.3.2 svgo-3.3.2 svgo-3.3.2/test svgo-3.3.2/logo
tree https://codeload.github.com/feathericons/feather/tar.gz/refs/tags/v4.29.2 feather-4.29.2 feather-4.29.2/icons
ls -l "$dir"
