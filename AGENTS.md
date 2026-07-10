# AGENTS.md

hihyou (批評) — a WXT + SolidJS Chrome extension (Manifest V3) that takes over
GitHub's PR "changes" view in place and renders its own review experience.

## Commands

```sh
pnpm install        # postinstall: wxt prepare + copies tree-sitter wasm to public/ts-wasm
pnpm dev            # WXT dev server
pnpm build          # wxt build + scripts/ascii-escape.mjs → .output/chrome-mv3
pnpm compile        # typecheck (tsc --noEmit)
pnpm test           # vitest (currently only utils/patch.test.ts)
pnpm check          # node self-checks for all pure logic modules
```

Dev self-reload: with the unpacked extension loaded, run
`window.postMessage({ type: 'hihyou:reload' }, '*')` on any github.com page.
Handled by `entrypoints/reload-hook.content.ts` (deliberately its own tiny
content script so a crash in the main script can't strand a broken build).

Toolchain is pinned via mise (`mise.toml`: pnpm). Prefer `pnpm exec` for
project binaries.

## Architecture

Three extension contexts, split by what github.com's CSP allows:

- `entrypoints/content.tsx` — content script on `https://github.com/*`.
  Parses the URL (`utils/pr-location.ts`), grabs the changes-route payload,
  mounts the Solid `DiffViewer` beside GitHub's React content, and re-runs on
  WXT `wxt:locationchange` soft navigations. A 1s interval remounts if React
  hydration drops the root (the script runs at document_idle, often
  mid-hydration).
- `entrypoints/background.ts` — service worker; the WASM/compute host. Runs
  web-tree-sitter (parse, structural diff, decl hashes) and the virtual TS
  environment for hover (npm tarball `.d.ts` + `@typescript/vfs`). Talks to
  the content script via typed RPC (`utils/ast-rpc.ts`, @webext-core/messaging);
  everything crossing must be plain serializable data.
- `entrypoints/popup/` — boilerplate popup, not meaningful.

Data source is GitHub's own React route payload, not the REST/GraphQL API:
embedded JSON on hard load, re-fetched with `Accept: application/json` on soft
navigation, `page_data/diff_entries` for lazy per-file diffs on large PRs.

## Hard constraints (violating these breaks the extension)

- **No WASM in content scripts** — github.com's page CSP blocks it. All
  tree-sitter/TypeScript work stays in the background service worker; shiki
  uses the JavaScript regex engine (`utils/highlight.ts`).
- **Emitted JS must be pure ASCII** — Chrome refuses content scripts it
  considers non-UTF-8, and Syncthing partial syncs can corrupt multibyte
  sequences. Enforced by `esbuild.charset: 'ascii'` in `wxt.config.ts` plus
  `scripts/ascii-escape.mjs` post-build. Never remove either.
- **Never touch React's own children** — the takeover appends a foreign
  sibling under `#diff-comparison-viewer-container` (React leaves unknown
  siblings alone) and flips visibility via a `data-hihyou` attribute + CSS.
  All of this lives in `utils/takeover.ts`.
- **Only trust the embedded payload on the initial hard load** — GitHub's SPA
  leaves it stale after soft navigation; fetch afterwards.
- **Isolated worlds have `customElements === null`** — import
  `utils/custom-elements-shim.ts` BEFORE `@pierre/trees`.

## Conventions

- **All GitHub coupling lives in `utils/github-changes.ts` (payload shapes,
  endpoints) + `utils/takeover.ts` (DOM anchors).** New GitHub-specific
  selectors, URLs, or payload fields go there, nowhere else.
- **Pure logic gets a node self-check.** Every algorithmic module in `utils/`
  is pure (no browser APIs) and has a sibling `<name>.check.ts` runnable with
  plain `node` (assert-based, no framework), wired into the `check` script in
  package.json. Follow this pattern for new logic; keep browser glue out of
  the pure modules so they run in node.
- Path alias `@/` → repo root (WXT default). Solid JSX, not React.
- Styling is a single `components/diff-viewer.css`; class names are
  `hihyou-*`-prefixed to avoid colliding with GitHub's.
- Comments state constraints/discoveries (CSP behavior, GitHub quirks,
  headers like `GitHub-Verified-Fetch`), not what the code does. Preserve
  them — they encode live-discovered GitHub behavior that is not documented
  anywhere else.

## File map

- `components/DiffViewer.tsx` — top-level viewer: toolbar, file tree + panels,
  keyboard handling (`s` = mark seen, `a` = apply locally), lazy diff loading.
- `components/FilePanel.tsx` — one file's diff: rows, selection/AST picking,
  seen dimming, import folding, sticky scope headers, threads, injections.
- `components/FileTree.tsx` — wraps `@pierre/trees`; tri-state seen checkboxes.
- `components/CommitStrip.tsx` / `utils/pr-stack.ts` — commit timeline;
  stacked PRs resolved by base-branch chasing.
- `components/MagicMovePanel.tsx` — shiki-magic-move morphs between commits.
- `components/RichMarkdownPanel.tsx` / `utils/prose-diff.ts` — .md prose diff.
- `components/ts-hover.ts` / `utils/ts-env.ts`, `utils/pnpm-lock.ts`,
  `utils/tarball.ts` — twoslash-style TS hover against exact locked dep versions.
- `utils/ast-service.ts` — tree-sitter analysis core (pure; runs in SW and node).
- `utils/seen-hunks.ts` / `utils/seen-store.ts` — hunk seen-state
  (`{side, lineRange, contentHash}` anchors; hash mismatch invalidates).
- `utils/patch.ts` — applied-view helpers; local apply uses the File System
  Access API from the browser (no daemon).
- `utils/moved-code.ts`, `utils/import-fold.ts`,
  `utils/injection-heuristic.ts` — pure analyses per their doc comments.
