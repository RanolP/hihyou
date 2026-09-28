# What hihyou is for

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
