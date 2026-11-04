# Build the Firefox extension from source

This source archive lets Mozilla Add-ons reviewers reproduce the submitted Firefox extension.

## Prerequisites

Install [mise](https://mise.jdx.dev/), then let mise install Node.js 24.18.0 and pnpm 12.6.0 from `mise.toml`.

## Build

Run these commands from the extracted archive root:

```sh
mise trust
mise install
pnpm install --frozen-lockfile
pnpm exec tsc -b packages/browser
pnpm --filter @hihyou/browser zip:firefox
```

The extension archive is written to `packages/browser/.output/hihyoubrowser-0.1.0-firefox.zip` and the reviewer source archive is written beside it as `packages/browser/.output/hihyoubrowser-0.1.0-sources.zip`.
