# Diff model: Diffset, VCS neutrality, and whitespace

## A Diffset is a struct, not a trait

The unit hihyou reviews is a `Diffset`: a `{ base, head }` pair of opaque revision ids. "Diffset isn't trait. Diffset is struct. commit, range, pr shall be 'converted to Diffset'." A commit, a revision range and a pull request are only ways of naming one; `diffsetFromCommit`, `diffsetFromRange` and `diffsetFromPr` (`packages/engine/src/source/vcs.ts`) convert each into a Diffset, and the engine only ever sees the Diffset.

The reason is that review scope is a set of changes, independent of how it was named. A new input, such as a GitHub PR opened from the browser extension, produces a Diffset as well. A Diffset never grows a `kind` field recording where it came from.

## One thin VCS interface, git as the only implementation

hihyou should eventually support jj and similar version-control systems, but the MVP uses git only. Version-control commands therefore run behind the VCS-neutral `Vcs` interface in `packages/engine/src/source/vcs.ts`, with git (`gitVcs`, exported from `@hihyou/engine/node`) as the sole implementation. A second adapter is not written until it is needed; the interface exists so adding one stays cheap.

## Whitespace: the engine is syntax-aware, the viewer reformats

The engine neither deletes whitespace nor tracks it for its own sake: "not delete. not be aware of whitespace itself, be aware of syntax." Whitespace is never content and is never stripped. It matters exactly as far as syntax makes it matter, such as separating tokens or Python's indentation. A whitespace-only change that leaves the syntax unchanged is zero edits.

Viewers (CLI, GUI, extension) show code re-formatted properly rather than the author's original layout: "doing proper formatting is my answer". The engine still diffs syntax; formatting is a display concern. The goal is that a review tool never hides a real change, while layout noise, such as an agent's inconsistent formatting, never reaches the reviewer.

Because edits carry original line and column ranges, every viewer needs a shared formatting step plus a mapping from original ranges to formatted positions, so an edit can still be tied back to an anchor such as a GitHub line. How the formatter itself is built, and whose style settings it uses, is in `docs/design/formatter.md`.
