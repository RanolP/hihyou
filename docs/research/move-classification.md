# Moved and edited, or deleted and new

## The question

A matched AST node can sit under a different parent in head than in base: a move. The viewer can show it two ways. "Moved and edited" shows one "moved from X" line and only the edits inside it. "Deleted + new code" shows the base copy as deleted and the head copy as inserted. The question is how much the inside may change before the second reading is the honest one, and which metric and threshold decide that.

The roadmap already names the three outcomes: "sort what is left into moved, moved and edited, or changed" (`docs/roadmap.md`, "Classify each remaining edit"). This document picks the boundary between the last two.

## GumTree

Sources: the ASE 2014 paper ([PDF](https://www.labri.fr/perso/xblanc/data/papers/ASE14.pdf)), the reference implementation at [GumTreeDiff/gumtree](https://github.com/GumTreeDiff/gumtree) commit `2b39184e032ea16c23846e0a9e3bc99d190b1bf1` (2026-09-28), and the DAT hyperparameter paper ([arXiv 2011.10268](https://arxiv.org/abs/2011.10268), IEEE TSE).

- **Paper values.** Section 5.2.3 "Replication information" gives the evaluation thresholds: `minHeight = 2`, `minDice = 0.5`, `maxSize = 100`. Algorithm 2 pairs two containers when `dice(t1, t2, M) > minDice`. Section 4.2's worked example uses `minDice = 0.2` for illustration only.
- **Similarity, as defined.** Dice over descendants already in the mapping: `2 * |mapped descendants of t1 whose partner is a descendant of t2| / (|desc(t1)| + |desc(t2)|)`. The code is `SimilarityMetrics.diceSimilarity` and `diceCoefficient` (`core/src/main/java/com/github/gumtreediff/matchers/SimilarityMetrics.java:40-52`). The same file also defines Chawathe similarity, `mapped / max(|desc(t1)|, |desc(t2)|)` (lines 30-33), plus overlap and Jaccard.
- **Classic bottom-up (`gumtree-classic`).** `DEFAULT_SIM_THRESHOLD = 0.5` and `DEFAULT_SIZE_THRESHOLD = 1000` (`heuristic/gt/GreedyBottomUpMatcher.java:42-43`). The test is `sim >= simThreshold` on `diceSimilarity` (line 67-68). The implementation uses `>=`; the paper uses `>`.
- **Top-down.** `DEFAULT_MIN_PRIORITY = 1`, with height as the priority (`heuristic/gt/AbstractSubtreeMatcher.java:32-36`), exposed as `st_minprio`. The DAT paper's Table I lists the default as `STM_MPTH = 1`, priority calculator `Height`.
- **The default matcher today is not the classic one.** `gumtree-simple` is registered with `Priority.MAXIMUM` (`CompositeMatchers.java:81-85`): a greedy subtree matcher followed by `SimpleBottomUpMatcher`. That matcher and `HybridBottomUpMatcher` default `bu_minsim` to `NaN`, which switches to a per-pair auto-threshold `1 / (1 + ln(|desc(candidate)| + |desc(t)|))`, tested against **Chawathe** similarity, not dice (`SimpleBottomUpMatcher.java:37,64-67`; `HybridBottomUpMatcher.java:37,61-64`; Hybrid's size threshold is 20, line 34). The auto-threshold works out to about 0.21 for 20+20 descendants, 0.15 for 150+150, and 0.13 for 500+500. Modern GumTree therefore pairs containers that share far less than half their content.
- **Grid auto-tuning.** `AutoMatchers.java` ("gumtree-simple-auto") tries `minSim ∈ {0.1, 0.3, 0.5, 0.7, 0.9}` × `minPrio ∈ {5..1}` (lines 71-82) and keeps whichever yields the shortest edit script.
- **DAT tuning (Martinez, Falleri, Monperrus).** The objective is the shortest edit script. Table I gives the defaults as bottom-up `Classic`, `STM_PC = Height`, `STM_MPTH = 1`, `BUM_SMT = 0.5`, `BUM_SZT = 1000`. Table III lists the best global configurations. For JDT: `Hybrid`, `Size`, `STM_MPTH = 1`, `BUM_SMT` not used (auto-threshold), `BUM_SZT = 400`. For Spoon: `Classic`, `Size`, `STM_MPTH = 1`, `BUM_SMT = 0.2`, `BUM_SZT = 600`. Tuning shortened the edit script in 21.8% of JDT and 16.1% of Spoon cases (Section VI, Table IV). The Table III column alignment was read from a `pdftotext -layout` extraction that garbled the table layout; the value-to-column assignment is my reading of it (**unverified** against the rendered PDF).
- **ICSE 2024** (Falleri and Martinez, "Fine-grained, accurate and scalable source differencing", [DOI 10.1145/3597503.3639148](https://dl.acm.org/doi/10.1145/3597503.3639148)): not read (**unverified**). Whether it introduced the simple matcher's auto-threshold is unknown.

What this means for the question: every GumTree threshold is a **matching** threshold. It is tuned to minimize the edit script, and the tuning moves it down (0.2 for Spoon, about 0.13-0.21 by auto-threshold). Nothing in GumTree decides how a move should be *displayed*.

## SemanticDiff

What could be seen: the VS Code extension `semanticdiff.semanticdiff` v0.10.0, downloaded from the marketplace `vspackage` endpoint, and its docs and blog.

- **Documented rule.** "For a code block to be detected as moved, it must cover at least one complete line" ([docs: moved code](https://semanticdiff.com/docs/understand-diff/moved-code/)). The docs describe a pure move and a move with changes ("Compare With Original"). Code with no match falls back to delete plus insert. No similarity percentage or token threshold is published. The home page says it "detects moved code, even if it contains additional changes" ([home](https://semanticdiff.com/)).
- **Blog.** The [0.8.5 post](https://semanticdiff.com/blog/semanticdiff-0.8.5/) says the matcher "now takes more information into account when matching the old and new code". It gives no parameters.
- **Bundle.** The JS wrapper `extension/out/extension/main.js` holds only UI settings, e.g. `compareMovedCode` (default `false`) and `contextLines: 3`. The diff engine is a stripped native binary, `extension/bin/semanticdiff` (the marketplace served the `alpine-arm64` build), with one stripped binary per language. It is not wasm. String extraction found Rust-style field names `static_match`, `dynamic_match`, `spurious_match` and `editscript`. That suggests a tree matcher that discards "spurious" matches, but this is an inference (**unverified**).
- **Not visible:** any numeric threshold. A compiled float constant does not show up as a string, so its absence says nothing either way.

## hihyou today

- **Matcher defaults.** `defaultMatchOptions = { minHeight: 2, minDice: 0.5 }` (`packages/syntechs/src/diff/matcher.ts:11`), the paper's values. Dice is `2 * common / (xs + ys - 2)`, where `xs` and `ys` are subtree sizes including the root, so the formula counts descendants only (`matcher.ts:68-82`). The bottom-up test is strict: `s > bestDice`, seeded with `opts.minDice` (`matcher.ts:264-272`). This follows the paper's `>` and differs from GumTree's `>=`. `maxSize` and the optimal recovery pass are not implemented. Recovery is a sequence-alignment heuristic (`matcher.ts:189-248`).
- **In-file move.** `editScript` emits `move` for every matched **named** node whose parent's partner is not its new parent (`packages/syntechs/src/diff/edit-script.ts:98-101`), and for named children outside the longest in-order run under an unchanged parent (lines 103-126). There is no size or similarity condition on displaying a move: once the matcher pairs a node, the viewer shows it as moved.
- **Cross-file move** (`packages/engine/src/match/cross-file.ts`). Candidates are unmatched named subtrees of at least `minMoveSize = 8` nodes (line 32, used at line 81), excluding imports (line 38). Two passes follow:
  - **Identical subtrees**, found by isomorphism id (lines 129-148): a pure move.
  - **Same kind and same name**, one candidate on each side (lines 151-195). The only guard is size: the smaller must be at least half the larger (`Math.min(x.size, y.size) < Math.max(x.size, y.size) / 2` rejects, line 173). The inner `match` then runs with no similarity threshold on the pair itself (line 180). A same-name declaration rewritten from scratch is still shown as "moved + inner edits".
- **Folding.** Only in-file moves count toward the `moved` fold; cross-file moves never fold, "so only moves inside the file fold" (`packages/engine/src/doc/fold.ts:55-61`).

### Probe (throwaway, not committed)

I ran the engine on a synthetic TypeScript case: a method `f` with 8 statements (150 nodes) moves from `class A` to `class B`, and `k` of its statements change. "dice" is the matcher's own formula applied to the **final** mapping; "leaf dice" is `2 * unchanged leaf tokens / (leaves in base + leaves in head)`.

| edit to `k` of 8 statements | k | `f` matched (shown as move) | dice (final mapping) | leaf dice |
|---|---|---|---|---|
| replaced by an unrelated statement | 1 | yes | 0.89 | 0.89 |
| | 2 | yes | 0.78 | 0.78 |
| | 3 | yes | 0.66 | 0.66 |
| | 4 | yes | 0.55 | 0.55 |
| | 5 | no: delete + insert | 0.41 | 0.40 |
| | 6 | no | 0.29 | 0.29 |
| two tokens tweaked per statement (`x`→`y`, `*`→`+`) | 1-4 | yes | 1.00 | 0.98-0.92 |
| | 5 | **no: delete + insert** | 0.40 | 0.39 |

Two findings:

1. **For wholesale replacement, the matcher's 0.5 already sits where a reader would draw the line.** At 4 of 8 statements replaced, `f` is still a move. At 5 of 8 it becomes delete + insert.
2. **For many small edits, the matcher falls off a cliff.** It gives up on `f` although about 90% of its tokens are unchanged (leaf dice before the flip is 0.92). The bottom-up decision for `f` is made while its tweaked statements are still unmapped: they have no isomorphic twin, and recovery only runs *after* a container is paired. The dice it sees is 3/8, not the final 0.9+. After the flip, the edit list is also fragmented: the untouched statements show as moves out of a deleted method into an inserted one. So "dice at match time" is not a reliable measure of how much the inside changed.

A second probe checked the cross-file path. A same-named `load` moved from `a.ts` to `b.ts` with its body entirely rewritten (new parameters, one `fetch` call in place of four statements) came out as `move` plus inner update, delete and insert edits, not as delete + new. This confirms the missing similarity bound at `cross-file.ts:173-180`.

## Comparison tools

- **Phabricator** (`src/applications/differential/engine/DifferentialChangesetEngine.php`, [phacility/phabricator](https://github.com/phacility/phabricator) commit `5720a38c`). `detectCopiedCode` (line 162) is purely line-based. A line is a candidate only if its trimmed text is at least `$min_width = 30` characters (lines 177, 198). A block counts as moved or copied only if at least `$min_lines = 3` consecutive **identical** trimmed lines match (lines 178, 315). A line with more than 16 identical copies is skipped (line 236), and detection is off above 65535 changed lines (line 166). There is no similarity score: a moved-and-edited block shows as runs of 3+ unchanged lines marked moved, with the edited lines as plain add/delete.
- **git `--color-moved`.** Exact-line matching, optionally ignoring whitespace via `--color-moved-ws` ([git-diff docs](https://git-scm.com/docs/git-diff)). A block is kept as moved only if it holds at least `COLOR_MOVED_MIN_ALNUM_COUNT = 20` alphanumeric characters (`diff.c:404`, used in `adjust_last_block` near line 1204; [git/git](https://github.com/git/git) commit `a0189536`). There is no "moved with edits"; an edited line breaks the block.
- **`contrib/diff-highlight`:** not checked (**unverified**). As far as known, it highlights within lines and does not detect moves.
- **difftastic:** no documented move detection or threshold. A `moves` page on its manual does not exist. Stating flatly that it never detects moves is **unverified**.
- **IntelliJ / JetBrains.** The diff viewer documents no moved-block detection ([differences viewer help](https://www.jetbrains.com/help/idea/differences-viewer.html)). Open requests IJPL-109361 ("Diff views: detect and display moved blocks of code"), IJPL-101150 and IJPL-103255 ask for it. Only Git Blame has "Detect Movements Within File / Across Files" toggles, with no documented threshold.

Across all of these, only SemanticDiff and GumTree-based tools attempt "moved with edits" at all, and neither publishes a display threshold. The line tools (Phabricator, git) require exact equality and set only a minimum size: 3 lines of at least 30 characters, or 20 alphanumeric characters.

## Recommendation

**Metric: leaf-token dice of the moved pair, computed on the final mapping.** For a moved node pair `(x, y)`:

`s(x, y) = 2 * U / (L(x) + L(y))`

Here `L(n)` counts the leaf tokens in `n`'s subtree. `U` counts the leaves of `x` whose partner is a leaf of `y` with the same text. Measure it **after** matching, recovery, normalization and approved rules (M3). A leaf that differs only by an approved rename then counts as unchanged, which matches the roadmap's "A block that was moved and only renamed then reads as a pure move."

- It measures what the reader sees: the share of text that carries over. The probe shows it agrees with the matcher's own dice for wholesale edits and stays truthful (0.92) in the tweak case, where the match-time dice said 0.40.
- It is cheap. One pass over `x`'s subtree using `src` and `size`, the same loop shape as `matcher.ts:77-80`.

**Threshold: show "moved and edited" when `s ≥ 0.5`, otherwise "deleted + new code".** Keep the existing size floor, `minMoveSize = 8` nodes, for cross-file moves.

- 0.5 is the only value with support from more than one source: GumTree's paper (`minDice = 0.5`, Section 5.2.3), GumTree's classic default (`GreedyBottomUpMatcher.java:43`), hihyou's matcher (`matcher.ts:11`), and hihyou's cross-file size guard, which already rejects a pair when one side is under half the other (`cross-file.ts:173`).
- It has a plain reading: at least half of the combined text is unchanged, so the inner diff shows no more changed text than unchanged text. Below that, the "moved from X" line claims more continuity than the code has.
- In the probe it reproduces the matcher's own flip point for wholesale replacement (4/8 → 0.55 stays a move, 5/8 → 0.40 does not), so turning it on does not reclassify the ordinary case.

**Use a separate display threshold. Do not reuse the matcher's threshold or its match-time score.** Three reasons:

1. **The matcher's score is taken on a partial mapping.** The probe measured 0.40 at decision time against more than 0.9 of tokens unchanged. It judges whether to pair, not how much changed.
2. **Matching thresholds are tuned for the shortest edit script, and tuning pushes them down.** DAT's best Spoon configuration uses 0.2; GumTree's default auto-threshold is about 0.13-0.21. If hihyou ever lowers `minDice` to get better edit scripts, the display must not start calling heavy rewrites "moved". Keeping the two apart lets the matcher pair aggressively, which is useful for inner diffs and rename detection, while the display stays conservative.
3. **The cross-file same-name path has no similarity check at all** (`cross-file.ts:173-180`, confirmed by the probe). One display threshold applied to every `move` edit, in-file and cross-file (`whole`), closes that gap in one place.

What falls below 0.5 still keeps the pairing in the engine. The view shows delete + insert and may add a one-line "similar to X" hint. That hint is optional and not part of this recommendation.

## Open questions

- **The tweak cliff is a matcher problem, not a display one.** A moved method with small edits in most statements is not paired at all (probe row "two tokens tweaked", k=5), so no display threshold can call it moved. Candidates to fix it: re-score after recovery, or let the bottom-up phase count same-kind-and-label leaves. Neither has been measured.
- **Which tokens count.** Punctuation and keywords inflate `s`: two unrelated function bodies still share `(`, `)`, `{`, `return`. git's rule (count only alphanumeric characters) suggests weighting by alphanumeric tokens or text length. That is untested, and 0.5 might need to shift with it.
- **Validation.** 0.5 rests on the sources above and one synthetic probe, not on a real corpus. Before it hardens, measure `s` over the moves in a sample of real PRs and check the borderline band (roughly 0.4-0.6) by eye. SemanticDiff's own threshold stays unknown, so it cannot serve as a comparison.
- **Nested moves.** When a moved method holds a statement that moved again inside it, should `s` be computed per move edit independently? The assumption here is yes.
- **Hysteresis or a label for the middle band** (e.g. "heavily edited move" for 0.5-0.6) is not proposed; add it only if the corpus check shows readers stumbling there.
