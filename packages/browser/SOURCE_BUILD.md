# Build the Firefox extension from source

This source archive lets Mozilla Add-ons reviewers reproduce the submitted Firefox extension.

## Requirements

- Operating system: macOS or Linux, x86_64 or arm64. The submitted build was made on macOS 26.4 (arm64).
- Network access to the npm registry for `pnpm install`.
- Node.js 24.18.0 and pnpm 12.6.0. No other program is needed.

## Install Node.js and pnpm

With [mise](https://mise.jdx.dev/) (`curl https://mise.run | sh`), run from the extracted archive root:

```sh
mise trust
mise install node pnpm
```

`mise.toml` pins both versions. Without mise, install Node.js 24.18.0 from https://nodejs.org/ and then run `npm install -g pnpm@12.6.0`.

## Build

From the extracted archive root, run the build script:

```sh
sh packages/browser/build-firefox.sh
```

It runs three steps:

1. `pnpm install --frozen-lockfile` installs the locked dependencies. Its postinstall step, `node packages/syntechs/generate.mjs`, generates each grammar's `bundle.js`, `fmt.gen.ts` and `highlight.gen.ts` from the tree-sitter grammar packages under `packages/syntechs/grammars`. Those generated files are not in this archive.
2. `pnpm exec tsc -b packages/browser` builds the workspace packages the extension imports.
3. `pnpm --filter @hihyou/browser zip:firefox` bundles and minifies the extension with WXT (Vite).

The extension is written to `packages/browser/.output/firefox-mv3/` and zipped as `packages/browser/.output/hihyoubrowser-0.2.0-firefox.zip`.
