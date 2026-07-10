# AGENTS.md

hihyou (批評) — an alternative GitHub code review experience. A pnpm monorepo:
a WXT + SolidJS Chrome extension (Manifest V3) that takes over GitHub's PR
"changes" view in place, plus a promo website that reuses the same viewer.

## Package map

```
apps/
  extension/     @hihyou/extension  — WXT app: entrypoints, takeover glue,
                                      RPC-backed ports (src/), wasm assets
  website/       @hihyou/website    — Astro + Solid islands promo site;
                                      demo mounts the viewer on a fixture
packages/
  diff-engine/   @hihyou/diff-engine — pure analysis logic (AST hunks, seen
                                       math, moved code, prose diff, shiki,
                                       TS hover env). No browser-extension APIs.
  diff-viewer/   @hihyou/diff-viewer — the Solid viewer UI. All I/O enters
                                       via ViewerPorts (src/ports.ts).
  github/        @hihyou/github      — THE one sanctioned GitHub-coupling
                                       place: payload shapes, endpoints,
                                       fetchers, PR location/stack.
```

**Dependency direction** (never violate): `github` and `diff-engine` are
leaves; `diff-viewer` → `diff-engine` + `github` (types/pure parsing only —
runtime I/O comes in through ports); apps → everything. Packages ship TS
source directly via `exports` (no build step); consumers compile from source
with `moduleResolution: bundler`.

## Commands

```sh
pnpm install     # extension postinstall: wxt prepare + copy wasm to public/ts-wasm
pnpm dev         # extension dev server (pnpm --filter @hihyou/website dev for the site)
pnpm build       # all packages: wxt build + ascii-escape, astro build
pnpm compile     # typecheck every package (pnpm -r compile)
pnpm test        # vitest where defined (diff-engine)
pnpm check       # node self-checks for all pure logic modules
```

Dev self-reload: with the unpacked extension loaded, run
`window.postMessage({ type: 'hihyou:reload' }, '*')` on any github.com page.
Handled by `apps/extension/entrypoints/reload-hook.content.ts` (deliberately
its own tiny content script so a crash in the main script can't strand a
broken build).

Toolchain is pinned via mise (`mise.toml`: pnpm). Prefer `pnpm exec` for
project binaries.

## Architecture

Three extension contexts, split by what github.com's CSP allows:

- `apps/extension/entrypoints/content.tsx` — content script on
  `https://github.com/*`. Parses the URL (`@hihyou/github/pr-location`),
  grabs the changes-route payload, mounts the Solid `DiffViewer` (from
  `@hihyou/diff-viewer`, wired to `src/viewer-ports.ts`) beside GitHub's
  React content, and re-runs on WXT `wxt:locationchange` soft navigations.
  A 1s interval remounts if React hydration drops the root (the script runs
  at document_idle, often mid-hydration).
- `apps/extension/entrypoints/background.ts` — service worker; the
  WASM/compute host. Runs web-tree-sitter (parse, structural diff, decl
  hashes) and the virtual TS environment for hover (npm tarball `.d.ts` +
  `@typescript/vfs`). Talks to the content script via typed RPC
  (`src/ast-rpc.ts`, @webext-core/messaging); everything crossing must be
  plain serializable data.
- `apps/extension/entrypoints/popup/` — boilerplate popup, not meaningful.

Data source is GitHub's own React route payload, not the REST/GraphQL API:
embedded JSON on hard load, re-fetched with `Accept: application/json` on soft
navigation, `page_data/diff_entries` for lazy per-file diffs on large PRs.

### Ports (how the viewer stays reusable)

`@hihyou/diff-viewer` never fetches, stores, or messages on its own. The
`DiffViewer` component takes a `ports: ViewerPorts` prop
(`packages/diff-viewer/src/ports.ts`): `ast` (AstClient: analyzeFile /
analyzeBlob / declHashesBlob / structuralDiff / tsHover), `seenStore`
(load/save per PR), `setFileViewed`, `fetchRawBlob`, `fetchDiffEntries`,
`resolveStack`.

- Extension impl: `apps/extension/src/viewer-ports.ts` (RPC to the service
  worker, extension storage, page-session fetches).
- Website demo impl: `seededAstClient()` + `memorySeenStore()` from ports.ts
  with no-op fetchers, over a captured payload fixture
  (`apps/website/src/fixtures/changes-payload.json`).

New viewer features that need I/O add a port method, not an import.

## Hard constraints (violating these breaks the extension)

- **No WASM in content scripts** — github.com's page CSP blocks it. All
  tree-sitter/TypeScript work stays in the background service worker; shiki
  uses the JavaScript regex engine (`diff-engine/src/highlight.ts`).
- **Emitted JS must be pure ASCII** — Chrome refuses content scripts it
  considers non-UTF-8, and Syncthing partial syncs can corrupt multibyte
  sequences. Enforced by `esbuild.charset: 'ascii'` in `wxt.config.ts` plus
  `scripts/ascii-escape.mjs` post-build. Never remove either.
- **Never touch React's own children** — the takeover appends a foreign
  sibling under `#diff-comparison-viewer-container` (React leaves unknown
  siblings alone) and flips visibility via a `data-hihyou` attribute + CSS.
  All of this lives in `apps/extension/src/takeover.ts`.
- **Only trust the embedded payload on the initial hard load** — GitHub's SPA
  leaves it stale after soft navigation; fetch afterwards.
- **Isolated worlds have `customElements === null`** — the content
  entrypoint imports `src/custom-elements-shim.ts` BEFORE anything that pulls
  in `@pierre/trees` (i.e. before the `@hihyou/diff-viewer` import). Keep
  that import order.

## Conventions

- **Explicit imports only.** WXT auto-imports are disabled
  (`imports: false` in `wxt.config.ts`) so the dependency graph stays
  greppable. Never re-enable them.
- **All GitHub coupling lives in `@hihyou/github`** (payload shapes,
  endpoints, fetchers) **+ `apps/extension/src/takeover.ts`** (DOM anchors).
  New GitHub-specific selectors, URLs, or payload fields go there, nowhere
  else.
- **Pure logic gets a node self-check.** Every algorithmic module in
  `packages/diff-engine` (and `pr-location` in `packages/github`) is pure
  (no browser APIs) and has a sibling `<name>.check.ts` runnable with plain
  `node` (assert-based, no framework), wired into that package's `check`
  script. Follow this pattern for new logic; keep browser glue out of the
  pure modules so they run in node.
- Path alias `@/` → extension package root (WXT default), extension-only.
  Cross-package imports use `@hihyou/*` specifiers. Solid JSX, not React.
- Styling is a single `packages/diff-viewer/src/diff-viewer.css`; class names
  are `hihyou-*`-prefixed to avoid colliding with GitHub's. The viewer
  consumes GitHub Primer CSS variables; the website defines them itself
  (`apps/website/src/styles/site.css`).
- Comments state constraints/discoveries (CSP behavior, GitHub quirks,
  headers like `GitHub-Verified-Fetch`), not what the code does. Preserve
  them — they encode live-discovered GitHub behavior that is not documented
  anywhere else.

## File map

`packages/diff-viewer/src/`
- `DiffViewer.tsx` — top-level viewer: toolbar, file tree + panels, keyboard
  handling (`s` = mark seen, `a` = apply locally), lazy diff loading.
- `FilePanel.tsx` — one file's diff: rows, selection/AST picking, seen
  dimming, import folding, sticky scope headers, threads, injections.
- `FileTree.tsx` — wraps `@pierre/trees`; tri-state seen checkboxes.
- `CommitStrip.tsx` — commit timeline UI.
- `MagicMovePanel.tsx` — shiki-magic-move morphs between commits.
- `RichMarkdownPanel.tsx` — .md prose diff view.
- `ts-hover.ts` — hover popovers; talks to `ports.ast.tsHover`.
- `ports.ts` — ViewerPorts + fixture impls (seeded AST, memory seen store).

`packages/diff-engine/src/`
- `ast-service.ts` — tree-sitter analysis core (pure; runs in SW and node).
- `seen-hunks.ts` — hunk seen-state (`{side, lineRange, contentHash}`
  anchors; hash mismatch invalidates).
- `patch.ts` — applied-view helpers; local apply uses the File System Access
  API from the browser (no daemon).
- `prose-diff.ts`, `moved-code.ts`, `import-fold.ts`,
  `injection-heuristic.ts` — pure analyses per their doc comments.
- `ts-env.ts`, `pnpm-lock.ts`, `tarball.ts`, `highlight.ts` — TS hover env,
  lockfile resolution, tarball `.d.ts` extraction, shiki setup.

`packages/github/src/`
- `github-changes.ts` — payload types + parsing + fetchers (embedded payload,
  changes JSON, `diff_entries`, raw blobs, `file_review`).
- `pr-location.ts` / `pr-stack.ts` — URL parsing; stacked-PR resolution by
  base-branch chasing.

`apps/extension/src/`
- `takeover.ts` — mount discovery + visibility flip (DOM anchors).
- `ast-rpc.ts` / `ast-client.ts` — typed SW RPC + caching client (also holds
  the `__hihyouSeededAnalyses` dev seam for page-injected builds).
- `seen-store.ts` — extension-storage persistence (localStorage fallback).
- `viewer-ports.ts` — the extension's ViewerPorts implementation.
- `custom-elements-shim.ts` — isolated-world registry shim.
