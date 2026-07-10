# hihyou (批評)

An alternative GitHub code review experience — a WXT + Solid Chrome extension
that takes over the PR "changes" view in place.

## Features

- **Viewer takeover** — hihyou renders every file's diff itself from GitHub's
  React route payload (PR header/tabs stay native); floating 批評 pill toggles
  back to the native viewer. Large PRs lazy-load per-file diffs via GitHub's
  `page_data/diff_entries` endpoint.
- **Inline review threads** — existing line-anchored comment threads render
  under their lines (resolved ones collapsed). Writing comments still happens
  in the native view (write-path discovery pending a sandbox repo).
- **Hunk-level seen state** — drag across lines, press `s`; seen hunks anchor
  as `{side, lineRange, contentHash}` and dim. A later commit touching the
  range invalidates it. File checkboxes, per-file and per-PR progress.
  With the AST backend, `s` snaps to whole enclosing declarations.
- **File tree** — VS Code style: compacted folder chains, type badges,
  tri-state seen checkboxes, click-to-scroll.
- **Commit timeline + stacked PRs** — commit strip with prev/next; PRs based
  on non-default branches chain to their base PR and flatten into one
  sequence with `#number` boundaries.
- **shiki-magic-move** — commit navigation morphs visible files' blobs
  between commits (shiki JS engine, no WASM).
- **AST core** — web-tree-sitter in the background service worker
  (github.com CSP blocks WASM in content scripts): scopes, imports, doc
  comments, injections, structural diff, declaration hashes.
- **Sticky scope headers**, **import folding** ("N import lines hidden"),
  **moved-code detection** (normalized subtree hashes; linked ⇄ blocks;
  moved code inherits seen state).
- **Rich markdown diff** — .md files render as prose with word-level
  ins/del tracked changes; toggle to source.
- **Literal injection** — css/html tagged templates (and heuristic untagged
  ones) re-highlight with the nested language.
- **Twoslash TS hover** — the service worker resolves exact dep versions
  from `pnpm-lock.yaml` at the reviewed commit, pulls `.d.ts` from npm
  tarballs into a virtual TS environment, and serves quick-info popovers.

## Applying hunks locally

`a` really applies the selection/pick as a git diff — entirely in the
browser. On first apply per repo, pick your local checkout folder (File
System Access API); the grant is remembered. Select rows (or click to pick
a node — repeated clicks expand outward through the AST) and press `a`:
the change is verified against the file and written to your working tree,
and the rows get the green applied mark. If anything mismatches, the
unified diff lands on your clipboard instead. Whitespace-only changes are
marked applied automatically.

## Development

```sh
pnpm install        # also copies tree-sitter wasm into public/ts-wasm
pnpm dev            # or: pnpm build && load .output/chrome-mv3 unpacked
pnpm compile        # typecheck
pnpm check          # node self-checks for all pure logic modules
```

Dev self-reload: with the unpacked extension loaded, run
`window.postMessage({ type: 'hihyou:reload' }, '*')` on any github.com page —
the background worker reloads the extension from disk.

All GitHub coupling (payload shapes, endpoints, DOM anchors) lives in
`utils/github-changes.ts` + `utils/takeover.ts`.
