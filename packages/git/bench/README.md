# @hihyou/git benchmark

Times this reader against the git CLI and against libgit2 through `git2` 0.20, the binding git-branchless and git-absorb both depend on.

```sh
cargo build --release --manifest-path packages/git/bench/rust/Cargo.toml   # optional: the libgit2 column
pnpm --filter @hihyou/git bench                                            # this repository, 30 iterations
node packages/git/bench/run.mjs <repo> <iterations>                        # after `pnpm typecheck`
```

Without the Rust build the libgit2 rows are skipped. Warm reuses one open repository; cold opens a fresh one each iteration, in the same process, so the OS page cache stays warm either way. Every git CLI run pays for a process spawn, measured separately as `git --version`; the "net" column subtracts it.

Our reader runs twice. The node adapter reads through `node:fs`, `node:zlib` and `node:crypto`. The web adapter runs the same core on `DecompressionStream`, `crypto.subtle` and `src/vscode-like-fs.ts`, a file system shaped like `vscode.workspace.fs`: whole-file reads only, millisecond mtimes and sizes, no inode or mode bits.

## Operations

- worktree: HEAD against the working tree, tracked files only (`git diff --raw --no-renames HEAD`; `git status --porcelain=v2 --untracked-files=no` shown too; libgit2 `diff_tree_to_workdir_with_index`).
- treediff: `HEAD~50` to `HEAD`, renames off on all three.
- blobs: 200 deltified packed blobs spread over the object list, read one after another (`git cat-file --batch`; libgit2 `find_blob`).
- revparse: `HEAD~20`.

## Results

This repository, Apple Silicon, Node 24.18, git 2.55.0, libgit2 through git2 0.20.4, load average around 5. Milliseconds, median, warm / cold. "Sync" is the synchronous reader this package shipped before the I/O moved behind async ports, measured in the same run.

| operation | sync        | node        | web          | git CLI (net of spawn)          | libgit2     |
| --------- | ----------- | ----------- | ------------ | ------------------------------- | ----------- |
| worktree  | 3.87 / 4.02 | 3.18 / 3.88 | 6.97 / 13.97 | 6.50 (3.43); status 6.83 (3.76) | 3.41 / 5.02 |
| treediff  | 1.12 / 2.32 | 1.21 / 2.64 | 7.35 / 16.96 | 6.72 (3.65)                     | 0.32 / 1.61 |
| blobs     | 365 / 494   | 368 / 493   | 579 / 735    | 334 (331)                       | 392 / 391   |
| revparse  | 0.03 / 1.05 | 0.03 / 0.95 | 0.13 / 6.54  | 5.16 (2.09)                     | 0.02 / 0.75 |

Going async cost the node adapter at most about 14%, on the cold tree diff; the other operations are within noise of the sync reader. Two fixes got it there, both about V8 strings: `path.join` skips normalizing a path that has no `.`, `..` or empty segment, and object ids and entry names are decoded as flat strings rather than built a character at a time, which past 12 characters makes a rope that every `Map` lookup must flatten.

The node adapter wraps the synchronous `node:fs` calls in its async ports. Backing them with `fs/promises` instead was 1.5–1.8x slower on every operation (cold worktree 7.97 against 5.16 ms, tree diff 5.73 against 2.96, blobs 13.65 against 7.75 on a smaller run), since each call then pays a thread-pool round trip for work that takes microseconds.

The web adapter is 1.5–7x slower than the node one. Each object inflates through a `DecompressionStream`, whose setup outweighs a small tree's inflate, and each id hashes through `crypto.subtle`, a promise per call. Cold opens also read every pack and index whole, since the file system has no ranged reads.

Cold blob reads remain the one loss against git and libgit2. A CPU profile puts about two thirds of the time in `applyDelta` and the rest in inflating: the 200 blobs sit on chains several deltas deep, which comes to millions of copy and insert ops of a few bytes each, and a JavaScript loop over them costs more than C's `memcpy`. Raising the per-pack delta base cache from 32 MB to git's 96 MB and making it LRU changed nothing measurable, so both were left out.
