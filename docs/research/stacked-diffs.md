# Stacked-diff review tools as a starting point for hihyou

Research date 2026-09-29. Scope: what stacked-diff tools (Graphite first; then Sapling + ReviewStack, ghstack, spr, git-branchless, git-machete, Gerrit relation chains, Aviator, jj-based stacking, and GitHub's own native stacks) give a reviewer, judged against hihyou's goal of a "platform-agnostic diff-set viewer" and its problem statement: "just seeing sequence of diffs without any intention makes user 피로". Phabricator is covered in `phabricator.md` and appears here only for contrast. Every statement tagged **[fact]** carries its source link; **[inference]** is this document's own reasoning.

## Short answer

**[fact]** Every tool here cuts one change into an ordered chain of small review units and shows the reviewer one unit's own diff against the unit below it. Graphite ([PR page](https://graphite.com/docs/pr-page-overview)), GitHub's native stacks ([about](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)), ReviewStack ([docs](https://sapling-scm.com/docs/addons/reviewstack/)) and Gerrit ([review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)) add a stack navigator on top. The strongest reading aid beyond that is version comparison inside one unit: Graphite's `v1..vN` compare dropdown and "hide reviewed changes" ([versions](https://graphite.com/docs/pull-request-versions)), Gerrit's patch-set diff with rebase edits coloured separately, ReviewStack's rebase-aware `diffVersions` ([source](https://github.com/facebook/sapling/blob/main/eden/contrib/reviewstack/src/github/diffVersions.ts)) and Tangled's per-round interdiff ([blog](https://blog.tangled.org/stacking/)).

**[inference]** Stacking carries intention in only two ways: the author's choice of cut points and order, and one title plus description per layer. None of the tools has a first-class stack-level description, and none explains why the layers come in this order. Within a layer, file order is still alphabetical or tree order. So stacking turns one flat diff into a sequence of smaller flat diffs, each with a label. The reviewer still reconstructs the narrative inside each layer.

## 1. Unit of review and how the stack reaches the reviewer

| Tool | Unit of review | How the stack is represented | Source |
|---|---|---|---|
| GitHub PR (plain) | One PR = one branch against its base, all commits squashed into one "Files changed" view | No stack; a PR can target another PR's branch by hand | [review docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request) |
| GitHub native stacks (public preview) | One PR per layer; "each one shows only the diff for its layer" | Stack icon with layer number at the top of the PR; a "stack map" in the merge box lists all layers with status, one click to switch | [about](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs) |
| Graphite | One GitHub PR per branch; "Each diff in the stack corresponds to a PR, which is reviewed independently" | Stack view (key `S`) shows where the PR sits and lets you click titles to jump; the stack is stored locally as JSON blobs under `.git/refs/branch-metadata` | [PR page](https://graphite.com/docs/pr-page-overview), [review](https://graphite.com/docs/review-pull-requests), [git key-value](https://graphite.com/blog/git-key-value) |
| Sapling `sl pr submit` + ReviewStack | One PR per commit, but each GitHub PR contains the commit "as well as all commits below it", so it "will not 'look right' on GitHub" | ReviewStack shows only the intended commit and adds a stack dropdown plus `shift+N` / `shift+P`; it recovers the stack by parsing a footer list in the PR body | [Sapling stack](https://sapling-scm.com/docs/git/sapling-stack/), [ReviewStack](https://sapling-scm.com/docs/addons/reviewstack/), [saplingStack.ts](https://github.com/facebook/sapling/blob/main/eden/contrib/reviewstack/src/saplingStack.ts) |
| ghstack | One PR per commit, from synthetic `gh/<user>/N/head` into `gh/<user>/N/base` | A "stack list" in each PR body | [README](https://github.com/ezyang/ghstack) |
| spr (ejoffe) | One PR per commit; commit subject becomes the PR title, the commit body becomes the description | Ordered PRs; `git spr status` shows the stack in the terminal | [README](https://github.com/ejoffe/spr) |
| spr (spacedentist, formerly getcord) | One PR per commit; a stacked PR "targets a synthetic base branch" | Base-branch chain | [stack docs](https://spacedentist.github.io/spr/user/stack.html) |
| git-machete | One PR per branch, with the base taken from the `.git/machete` tree file | "the entire chain of PRs/MRs will be posted in the PR/MR description" | [README](https://github.com/VirtusLab/git-machete) |
| git-branchless | Branches pushed by `git submit`; creates reviews only for Phabricator (via `arc diff`), otherwise it just pushes | Nothing reviewer-facing on GitHub | [git submit](https://github.com/arxanas/git-branchless/wiki/Command:-git-submit) |
| Gerrit | One change per commit, identified by a `Change-Id` footer; each amended upload is a new patch set | "Relation chain": ancestors and descendants in git-log order, with an arrow at the current change | [concepts](https://gerrit-review.googlesource.com/Documentation/concept-changes.html), [review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html) |
| Aviator `av` | One PR per branch; the CLI sets the GitHub base to the parent branch so the diff excludes the parent's changes | Base-branch chain, plus "correct metadata in the pull request description" | [av CLI](https://docs.aviator.co/aviator-cli), [av pr](https://docs.aviator.co/aviator-cli/manpages/av-pr-1) |
| jj-stack (Jujutsu) | "one `jj` change becomes one PR", on GitHub's native stack | GitHub stack map | [announcement, 2026-09-14](https://www.serpentine.com/posts/2026/announcing-jj-stack/) |
| Tangled (jj-native forge) | "each change as an individual pull request", tracked by jj change-id across rewrites | Its own forge UI | [blog](https://blog.tangled.org/stacking/) |

**[inference]** Only two identities appear. One is branch-per-layer (Graphite, GitHub native, git-machete, Aviator). The other is commit-per-layer with a stable change identity that survives rewrites: Gerrit's `Change-Id`, jj's change-id, and ghstack's and Sapling's PR-number bookkeeping. For a viewer that consumes `{base, head}`, both reduce to the same shape: layer *i* is `{base: head[i-1], head: head[i]}`.

## 2. How a reviewer walks the stack

**Navigation. [fact]** Graphite's `S` panel lets you "navigate to any of the other PRs in a stack", which "enables reviewing large stacks of PRs at once" ([review](https://graphite.com/docs/review-pull-requests)). ReviewStack has a dropdown and `shift+N` / `shift+P` ([docs](https://sapling-scm.com/docs/addons/reviewstack/)). GitHub native stacks show a layer number and a stack map in the merge box ([about](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)). Gerrit lists the relation chain on the change screen ([review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)). The CLI-only tools (ghstack, spr, git-machete, Aviator) leave navigation to a markdown list of links in the PR body ([ghstack](https://github.com/ezyang/ghstack), [git-machete](https://github.com/VirtusLab/git-machete)).

**Per-layer versus cumulative diff. [fact]** Per-layer is the default everywhere: GitHub native "shows only the diff for its layer" ([about](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)), and Aviator sets the base branch so GitHub does not show "all parent branch changes" ([av CLI](https://docs.aviator.co/aviator-cli)). Sapling's plain GitHub PRs are the exception: they are cumulative, and ReviewStack exists partly to undo that ([Sapling stack](https://sapling-scm.com/docs/git/sapling-stack/)). **[inference]** None of the tools documents a one-click "whole stack as one cumulative diff" view for the reviewer. You get it only by opening a range comparison by hand.

**Reviewing a layer after the layer below changed. [fact]**

- Graphite gives each `gt submit` a new version (`v1`, `v2`, ...). The PR page defaults to v1 versus latest; `V` or the "Compare" dropdown picks the left and right versions. After you review, "hide reviewed changes" switches to "a comparison between the last reviewed version and the latest version" ([versions](https://graphite.com/docs/pull-request-versions)). The CLI restacks descendants automatically: `gt modify` amends "then automatically restack[s] descendants", and `gt sync` rebases "all your open PRs on top of the new changes in main" ([command reference](https://graphite.com/docs/command-reference), [quick start](https://graphite.com/docs/cli-quick-start)). Graphite's docs do not say whether a version diff subtracts the rebase noise.
- Gerrit compares any two patch sets. When their parents differ, "Gerrit also identifies parts of the diff that were modified due to rebase", and these "rebase edits" are "highlighted with different colors" ([review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)).
- ReviewStack models a version as `{headCommit, baseParent, commits}` ([PullRequestVersionSelector.tsx](https://github.com/facebook/sapling/blob/main/eden/contrib/reviewstack/src/PullRequestVersionSelector.tsx)). `diffVersions(beforeDiff, afterDiff)` expects "each `Diff` is the result of diffing the commit with its base parent" and derives a diff-of-diffs, with branches that reason about whether "V2 must have been rebased" ([diffVersions.ts](https://github.com/facebook/sapling/blob/main/eden/contrib/reviewstack/src/github/diffVersions.ts)). In other words it compares two layer diffs, not two trees, so rebase changes in the base fall out.
- ghstack never force-pushes `head` or `base`: "whenever you rebase your local stack, we add merge commits on top of base from the true upstream main" ([README](https://github.com/ezyang/ghstack)). GitHub's own commit history then records each update as a new commit. spr (spacedentist) does the same: "each update becomes an additional commit, so reviewers can see what changed" ([docs](https://spacedentist.github.io/spr/)).
- GitHub native stacks: "A stack can lose its linear history when changes are pushed to a lower branch", and the merge box offers "Rebase stack" ([reference](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests)). jj-stack's author reports that GitHub's "Changes since your last review" stays empty for native stacks, so jj-stack posts compare links in a PR history comment instead ([announcement](https://www.serpentine.com/posts/2026/announcing-jj-stack/)).
- Tangled keeps every submission as a round ("The initial submission is still visible under `round #0`") and has an interdiff button between rounds ([blog](https://blog.tangled.org/stacking/)).

## 3. Intention carriers

| Carrier | Where it exists | Source |
|---|---|---|
| Per-layer title and description | Everywhere. ejoffe/spr maps commit subject to title and commit body to description; Graphite prompts for new PRs (`--edit`) | [spr](https://github.com/ejoffe/spr), [gt submit](https://graphite.com/docs/command-reference) |
| Commit message reviewed as part of the diff | Gerrit's commit message is a "magic file", "always listed first" | [review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html) |
| AI-written layer description | Graphite's PR page "Generate" button ("Graphite Agent automatically generate[s] a PR description") and `gt submit --ai` ("Only works when creating new PRs") | [PR page](https://graphite.com/docs/pr-page-overview), [command reference](https://graphite.com/docs/command-reference) |
| AI review overview | Graphite claims "a generated overview highlighting key changes, potential risks, and suggested improvements", plus Graphite Chat in the PR page | [features/pr-page](https://graphite.com/features/pr-page), [Graphite Agent](https://graphite.com/blog/introducing-graphite-agent-and-pricing) |
| AI-written update message (what changed in this version) | ghstack `automsg = claude \| codex`: summarizes "the specific update"; for an existing PR the input is "an interdiff against the previously submitted PR patch" | [ghstack](https://github.com/ezyang/ghstack) |
| Human-written update message | spacedentist/spr asks "for a short message to describe the update" on every `spr diff` | [README](https://github.com/spacedentist/spr) |
| Stack-level description | Not found in any tool. GitHub's native-stack docs do not mention one ([about](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)); ghstack, git-machete and Sapling post only a list of links | as cited |
| Ordering signal | Only the stack order itself. Graphite's guidance names five ways to cut: by component, iterative, refactor-then-change, version bumps / generated code, and riskiness ([five methods](https://graphite.com/blog/five-methods-for-stacking)). No tool records *which* strategy a stack used | as cited |
| Grouping of related stacks | Gerrit topics ("Changes can be grouped by topics") | [concepts](https://gerrit-review.googlesource.com/Documentation/concept-changes.html) |

**[inference]** ghstack's `automsg` stands out. It is the only carrier found that explains a *revision* ("what changed since you last looked, and why") rather than the whole change. It is also the only one generated from an interdiff, which is exactly the diff-of-diffs a stacked viewer already computes.

## 4. Reading aids beyond GitHub's

- **Generated files. [fact]** Graphite and GitHub both rely on `.gitattributes` `linguist-generated`, which is "hidden by default in diffs" ([Graphite](https://graphite.com/docs/pr-page-overview), [GitHub](https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github)). The structural fix is Graphite's advice to isolate "version bumps/generated code" in their own layer ([five methods](https://graphite.com/blog/five-methods-for-stacking)).
- **File order. [fact]** Graphite puts the file tree left of the diff, with comments to the right, for "a streamlined, uninterrupted diff you can read straight through" ([changelog 2025-11-20](https://graphite.com/blog/changelog-nov-20)). Gerrit lists magic files (the commit message) first ([review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)). No tool documents an intent- or dependency-based file order. ReviewStack sorts changes depth-first by path ([diffVersions.ts](https://github.com/facebook/sapling/blob/main/eden/contrib/reviewstack/src/github/diffVersions.ts)).
- **Progress. [fact]** GitHub's viewed checkbox is cleared when "the file changes after you view the file" ([GitHub](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)). Graphite's "hide reviewed changes" does the same at version granularity ([versions](https://graphite.com/docs/pull-request-versions)).
- **Comments across versions. [fact]** Gerrit keeps comments visible across patch sets ([review UI](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)). jj-stack keeps each PR "attached to its logical change" and "preserves its reviews and discussion" across reorders ([announcement](https://www.serpentine.com/posts/2026/announcing-jj-stack/)). ReviewStack lets the author add commits on top "without interfering with the existing conversation around the commits on the bottom of the stack" ([docs](https://sapling-scm.com/docs/addons/reviewstack/)). Graphite's docs do not describe how line comments re-anchor across versions.
- **Landing safety as a review guarantee. [fact]** spacedentist/spr's `spr land` checks that the merge and an upstream cherry-pick "produce _exactly the same tree_", so no unreviewed change lands ([stack docs](https://spacedentist.github.io/spr/user/stack.html)). Aviator validates a queued stack "as if they were a single PR" ([merging stacks](https://docs.aviator.co/mergequeue/how-to-guides/merging-stacked-prs)).

## 5. Where each tool lives, and what that means for hihyou

| Tool | Lives where | Source |
|---|---|---|
| Graphite | Hosted web app over GitHub PRs, plus the `gt` CLI and a VS Code extension; joined Cursor in December 2025, with "both products ... operating independently in the near term" | [PR page](https://graphite.com/docs/pr-page-overview), [Cursor blog](https://cursor.com/blog/graphite), [DevOps.com](https://devops.com/cursor-acquires-graphite-to-streamline-ai-powered-development/) |
| GitHub native stacks | Inside github.com plus the `gh stack` CLI; `gh stack link` builds a stack from branches made by jj, Sapling or git-town | [about](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs), [other tools](https://docs.github.com/en/pull-requests/reference/use-other-tools-with-stacked-pull-requests) |
| ReviewStack | Static web client over the GitHub API ("change the domain to reviewstack.dev"); ships in the Sapling repo | [docs](https://sapling-scm.com/docs/addons/reviewstack/) |
| ghstack, spr, git-machete, Aviator `av`, jj-stack | CLI that writes branches and PR bodies on GitHub; review happens in GitHub's UI | as cited in §1 |
| git-branchless | CLI; review only via Phabricator | [git submit](https://github.com/arxanas/git-branchless/wiki/Command:-git-submit) |
| Gerrit, Tangled | Their own servers and forges | [Gerrit](https://gerrit-review.googlesource.com/Documentation/concept-changes.html), [Tangled](https://blog.tangled.org/stacking/) |

**[inference]** ReviewStack is the closest precedent for hihyou's constraints: a browser-only client that reads a host API and derives stack structure and version diffs on the client. Its weak spot is also instructive. Stack membership comes from parsing tool-specific PR-body footers (`saplingStack.ts`, `ghstackUtils.ts`), so every producer needs its own adapter. hihyou can avoid that by accepting the stack as data, an ordered list of revisions, from any source: `git log base..head` commits, jj changes, a Graphite or GitHub native stack, or Gerrit relation chains. It can then compute layers and interdiffs itself through the existing `Vcs` interface (`parents`, `mergeBase`, `changes`).

## 6. Capability comparison

Legend: Y = documented, P = partial or by convention, N = not found, ? = not documented either way.

| Capability | GitHub PR | GitHub native stack | Graphite | ReviewStack | ghstack | spr (ejoffe / spacedentist) | git-machete | git-branchless | Gerrit | Aviator | jj-stack / Tangled |
|---|---|---|---|---|---|---|---|---|---|---|---|
| One review unit per layer | N | Y | Y | Y | Y | Y | Y | P (Phabricator only) | Y | Y | Y |
| Per-layer diff (not cumulative) | N | Y | Y | Y | Y | Y | Y | ? | Y | Y | Y |
| Stack navigator in the review UI | N | Y (stack map) | Y (`S`) | Y (dropdown, `shift+N/P`) | P (PR-body list) | N | P (PR-body list) | N | Y (relation chain) | P | Y (GitHub map) / Y |
| Versions of one layer, compare any two | P (commits tab) | ? | Y (`V`) | Y | P (non-force-push history) | P (update commits) | N | N | Y (patch sets) | ? | P (compare links) / Y (rounds) |
| Rebase noise separated from real edits | N | N | ? | Y (`diffVersions`) | P (merge commits on base) | P | N | N | Y (rebase edits coloured) | ? | ? / ? |
| "Since my last review" view | Y | N (per jj-stack) | Y (hide reviewed changes) | ? | Y (via GitHub) | Y (via GitHub) | Y (via GitHub) | N | Y | Y (via GitHub) | N / ? |
| Per-layer title and description | Y | Y | Y | Y | Y (from commit) | Y (from commit) | Y | ? | Y (commit message as a file) | Y | Y |
| Stack-level description | N | N | N | N | N | N | N | N | P (topic name) | N | N |
| AI description or summary | N | N | Y | N | Y (per update, from interdiff) | N | N | N | N | N | N |
| Update message per revision | N | N | N | N | Y (automsg or `-m`) | Y (spacedentist) | N | N | P (patch set message) | N | ? |
| Generated files hidden | Y (`linguist-generated`) | Y | Y (same attribute) | ? | via GitHub | via GitHub | via GitHub | ? | ? | via GitHub | ? |
| Intent-based file order | N | N | N | N | N | N | N | N | P (commit message first) | N | N |
| Comments follow the logical change across rewrites | P | ? | ? | Y | Y (PR per commit) | Y | Y | ? | Y | Y | Y |
| Runs without a vendor server | n/a | n/a | N | Y (static client, GitHub API) | Y | Y | Y | Y | N (own server) | N | Y / N |

## 7. Synthesis for hihyou

**Data model. [inference]** A stack turns the unit from one `Diffset = {base, head}` into an ordered chain of revisions `r0 (base), r1, ..., rn`. Layer *i* is the Diffset `{r(i-1), r(i)}`, and the cumulative view is `{r0, rn}`. A second axis is time: each layer has versions `v1..vm`, and each version is itself a Diffset. Graphite's version and ReviewStack's `{headCommit, baseParent, commits}` both have this shape. Reviewing "what changed since I looked" is then an interdiff between two Diffsets, not between two trees. So the natural shape is `Stack = Layer[]`, `Layer = { id (stable change identity), versions: Diffset[], note? }`. The existing `diffsetFromCommit`, `diffsetFromRange` and `diffsetFromPr` each already produce a one-layer, one-version stack, so no current source breaks.

**Ideas that address "diffs without intention".** [inference, grounded in the facts above]

- Author-chosen cut points and order, with one title and description per layer (all tools). This carries intention, but only at layer granularity, and only if the author writes it.
- Gerrit's commit message as the first "file" of the diff. The intention sits inside the reading path, not in a separate tab.
- Update messages per revision, human-written (spacedentist/spr) or AI-written from the interdiff (ghstack `automsg`). These explain *why this version differs*, the question a re-reviewer actually has.
- Isolating generated code and version bumps into their own layer (Graphite's guidance). Noise becomes a labelled, skippable unit rather than a hidden file.

**Ideas that only reorganize the same flat diffs.** [inference]

- Per-layer diffs, stack navigators, the `S` panel, stack maps and PR-body link lists. The reviewer sees smaller slices of the same flat hunk list, still in path order.
- Version compare and "hide reviewed changes". These reduce re-reading, but what they show is still a flat diff.
- File trees on the left, and hiding generated files by attribute.

**The gap that remains even in Graphite.** [inference, from what its docs state and omit]

- There is no stack-level narrative: nothing says why the change is cut this way or what the reader should hold in mind before layer 1.
- Inside a layer, files and hunks come in path order. No tool orders them by dependency (definition before use, API before caller) or groups hunks by purpose.
- The AI outputs (description, overview, chat) are prose next to the diff. They are not anchored to hunks, so they do not change the reading order or annotate what a hunk is for.
- Rebase-aware interdiff is documented only in Gerrit and ReviewStack. Graphite documents version compare but not how it treats rebase noise.
- Every web tool is tied to GitHub PRs or to its own server. None takes an arbitrary `{base, head}` from a local range or a jj stack.

## Sources not reachable or thin

- Graphite's docs do not say whether version diffs strip rebase changes, or how line comments move across versions.
- For GitHub's native stacks, only the docs cited above were read. Whether "changes since last review" works rests on the jj-stack author's report.
- Aviator's PR-description stack metadata is mentioned in [av pr](https://docs.aviator.co/aviator-cli/manpages/av-pr-1) without a format.
- `facebook/sapling#1433`, which touches ReviewStack's version comparison, was closed unmerged on 2026-09-16 ([PR](https://github.com/facebook/sapling/pull/1433)). The version behaviour above comes from `main` source, not from a live run of reviewstack.dev.
