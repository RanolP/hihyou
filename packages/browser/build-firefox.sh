#!/bin/sh
# Builds the Firefox extension from the source archive root; SOURCE_BUILD.md lists the tools it needs.
set -eu
cd "$(dirname "$0")/../.."
pnpm install --frozen-lockfile
pnpm exec tsc -b packages/browser
pnpm --filter @hihyou/browser zip:firefox
