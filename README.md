# hihyou

hihyou is a platform-agnostic diff-set viewer that diffs syntax trees, so a reviewer reads a change node by node instead of as a flat sequence of lines. Its first shell is a browser extension that replaces GitHub's PR "Files changed" view. [docs/design/product.md](docs/design/product.md) explains what it is for.

## Respect

hihyou stands on the shoulders of two projects that showed GitHub PR review can be calmer, and we use both as references for the review experience.

- [geld.sh](https://geld.sh) by Brandon McConnell ([source](https://github.com/brandonmcconnell/geld)): a browser extension that strips noise from GitHub PR review inside the github.com page, folding tests, generated files, lockfiles and docs and keeping the numbers honest.
- [pulls.review](https://pulls.review) by Anthony Fu ([source](https://github.com/antfu/pulls.review)): reviews a PR in grouped scopes, one at a time, rather than one flat file list, on its own site or as a drawer on github.com.

Thank you both.
