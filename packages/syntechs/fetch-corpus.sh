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
ls -l "$dir"
