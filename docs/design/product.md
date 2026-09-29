# What hihyou is for, and its diff model

hihyou is a platform-agnostic diff-set viewer. Everything else in the repo, syntechs (parse, format, highlight) and its speed targets included, is a means toward that viewer, not a goal of its own. Scope is judged by what a change adds to viewing a diff set.

## The problem

A flat sequence of diffs that carries no intention is what makes reviewing tiring. In the maintainer's words: "just seeing sequence of diffs without any intention makes user 피로 (fatigue). so reviewing on github makes us 피로. seeing pr on vs code is a way better. but not enough." GitHub's PR view is the tiring baseline; viewing a PR in VS Code is better, but still not enough.

## Platform-agnostic means functionality first

"Platform" is left open on purpose. Candidate shells include a desktop app in the style of GitHub Desktop or GitKraken, a browser extension that replaces GitHub's PR review UI, and a hosted viewer like Pierre's diffs. None is committed. The maintainer's rule: "we shall not rely on its form. we shall follow its functionality." Every capability therefore lives in form-agnostic core packages, so each shell stays thin and choosing one later costs little.

## The four pillars

1. **Review by AST node.** Understanding a whole file is hard, especially a big one. The unit a reviewer understands should be smaller: a hunk, and better still an AST node. This is why the engine diffs syntax trees the way difftastic does, and why it targets the web, so it is easy to use.
2. **Verified hiding by pattern.** Refactoring moves and standard migrations are rarely important and "shall not be noticed after seeing it once". A move across many files should compress to one `mv a b`, including the import edits git's rename detection does not cover. Patterns (an ast-grep or GritQL port running on syntechs, with queries an AI can help write) select what to hide. A match alone can over-match, so a hidden hunk must be proven: apply the rule as a rewrite to base and require that the residual against head is empty.
3. **Carrying review intention across versions.** Inspired by git's rerere: a review verdict is stored per AST-node edit, keyed by (anchor, before hash, after hash) rather than by commit or SHA, so it survives split, squash, reorder and force-push. On a new version, an identical edit in an identical context carries its verdict; an identical edit whose referenced context changed upstream is flagged for re-check; a changed edit surfaces only its interdiff. "Base moved" and "patch changed" are kept apart. This is what "show only what changed since last review" means.
4. **An editor just for review.** "near-full experience of vscode, just for review": go-to-definition, trying a refactor such as De Morgan in a local scratchpad to confirm a rewritten boolean expression keeps its meaning, sticky headers on definitions. "but too much feature makes us heavy. balance is king." Each editor feature earns its place by helping review, not by imitating an IDE.

## Out of scope for now

AI splitting of commits or PRs into intent units is parked for the far future. Keeping one topic per commit is the author's job; hihyou supports that culture by reading commit by commit and by carrying verdicts across force-pushes, not by splitting.

## Diff model

### A Diffset is a struct, not a trait

The unit hihyou reviews is a `Diffset`: a `{ base, head }` pair of opaque revision ids. "Diffset isn't trait. Diffset is struct. commit, range, pr shall be 'converted to Diffset'." A commit, a revision range and a pull request are only ways of naming one; `diffsetFromCommit`, `diffsetFromRange` and `diffsetFromPr` (`packages/engine/src/source/vcs.ts`) convert each into a Diffset, and the engine only ever sees the Diffset.

The reason is that review scope is a set of changes, independent of how it was named. A new input, such as a GitHub PR opened from the browser extension, produces a Diffset as well. A Diffset never grows a `kind` field recording where it came from.

### One thin VCS interface, git as the only implementation

hihyou should eventually support jj and similar version-control systems, but the MVP uses git only. Version-control commands therefore run behind the VCS-neutral `Vcs` interface in `packages/engine/src/source/vcs.ts`, with git (`gitVcs`, exported from `@hihyou/engine/node`) as the sole implementation. A second adapter is not written until it is needed; the interface exists so adding one stays cheap.

### Whitespace: the engine is syntax-aware, the viewer reformats

The engine neither deletes whitespace nor tracks it for its own sake: "not delete. not be aware of whitespace itself, be aware of syntax." Whitespace is never content and is never stripped. It matters exactly as far as syntax makes it matter, such as separating tokens or Python's indentation. A whitespace-only change that leaves the syntax unchanged is zero edits.

Viewers (CLI, GUI, extension) show code re-formatted properly rather than the author's original layout: "doing proper formatting is my answer". The engine still diffs syntax; formatting is a display concern. The goal is that a review tool never hides a real change, while layout noise, such as an agent's inconsistent formatting, never reaches the reviewer.

Because edits carry original line and column ranges, every viewer needs a shared formatting step plus a mapping from original ranges to formatted positions, so an edit can still be tied back to an anchor such as a GitHub line. How the formatter itself is built, and whose style settings it uses, is in `docs/design/formatter.md`.
