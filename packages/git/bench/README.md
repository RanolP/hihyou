# @hihyou/git benchmark

Times this reader against the git CLI and against libgit2 through `git2` 0.20, the binding git-branchless and git-absorb both depend on.

```sh
cargo build --release --manifest-path packages/git/bench/rust/Cargo.toml   # optional: the libgit2 column
pnpm --filter @hihyou/git bench                                            # this repository, 30 iterations
node packages/git/bench/run.mjs <repo> <iterations>                        # after `pnpm typecheck`
```

Without the Rust build the libgit2 rows are skipped. Warm reuses one open repository; cold opens a fresh one each iteration, in the same process, so the OS page cache stays warm either way. Every git CLI run pays for a process spawn, measured separately as `git --version`; the "net" column subtracts it.

## Operations

- worktree: HEAD against the working tree, tracked files only (`git diff --raw --no-renames HEAD`; `git status --porcelain=v2 --untracked-files=no` shown too; libgit2 `diff_tree_to_workdir_with_index`).
- treediff: `HEAD~50` to `HEAD`, renames off on all three.
- blobs: 200 deltified packed blobs spread over the object list (`git cat-file --batch`; libgit2 `find_blob`).
- revparse: `HEAD~20`.

## Results

This repository (about 12.5k packed objects in 3 packs), Apple Silicon, Node 24.18, git 2.55.0, libgit2 through git2 0.20.4, load average around 7. Milliseconds, median / p95.

| operation | ours warm   | ours cold   | git CLI                           | git CLI net of spawn | libgit2 warm | libgit2 cold |
| --------- | ----------- | ----------- | --------------------------------- | -------------------- | ------------ | ------------ |
| worktree  | 4.17 / 5.46 | 4.00 / 5.32 | 8.00 / 10.64 (status 8.43 / 9.99) | 4.21 (status 4.63)   | 3.01 / 3.28  | 4.89 / 9.68  |
| treediff  | 1.23 / 2.21 | 2.56 / 3.41 | 12.05 / 26.46                     | 8.25                 | 0.32 / 0.50  | 1.74 / 1.94  |
| blobs     | 138 / 183   | 373 / 454   | 204 / 221                         | 200                  | 219 / 237    | 221 / 252    |
| revparse  | 0.03 / 0.05 | 1.08 / 1.81 | 5.37 / 6.24                       | 1.58                 | 0.01 / 0.02  | 0.78 / 0.93  |

In-process, this reader beats the git CLI on every operation except cold blob reads, even with spawn time subtracted. libgit2 is 2–4x faster on tree diffs and rev-parse, which take about a millisecond either way, and about equal on the worktree diff.

Cold blob reads are the one loss: 373 ms against 200 ms for git and 221 ms for libgit2. A CPU profile puts about two thirds of the time in `applyDelta` and the rest in zlib's inflate. The 200 blobs sit on chains averaging 3.4 deltas deep, which comes to 14 million copy and insert ops and 446 MB of output, and a JavaScript loop over that many ops of a few bytes each costs more than C's `memcpy`. Warm reads come in under both (138 ms) because the per-pack cache of resolved delta bases holds the shared chain roots. Raising that cache from 32 MB to git's 96 MB and making it LRU changed nothing measurable, so both were left out.
