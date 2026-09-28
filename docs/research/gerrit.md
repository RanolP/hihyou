# Gerrit Code Review: model, rebase carry, and why people like or leave it

Research for hihyou (platform-agnostic diff-set viewer). The problem, in the user's words: "just seeing sequence of diffs without any intention makes user 피로 (fatigue). reviewing on github makes us 피로. seeing pr on vs code is a way better. but not enough." This document goes deeper than the Gerrit notes in `stacked-diffs.md` (relation chains, rebase tint, magic commit-message file, topics) and does not repeat them. Claims are tagged **[fact]** (read in a doc, in Gerrit's source, or in a first-hand post) or **[inference]** (my reasoning from those facts).

## Short answer

- **Model.** The unit of review is one commit (a *change*) that is revised as numbered *patch sets* tied together by a client-generated `Change-Id` footer; stacks are git ancestry ("relation chain"), cross-repo grouping is a free-text *topic*, mergeability is a set of query-language *submit requirements* over *labels*, and "whose move is it" is an explicit per-change *attention set*.
- **Rebase carry.** Gerrit carries four different things by four different keys, none of them an edit: votes by a whole-commit `changekind` against the previous patch set; the per-file "reviewed" checkmark by byte-identical blob at the same path; unresolved comments by a line-diff shift of (path, line range); and "edit due to rebase" is display-only tint with no verdict attached. Nothing crosses a change boundary, so split, squash, and moving an edit to another change lose history, and nothing flags "re-check" when an identical edit's surrounding code changed upstream.
- **Experience.** People who like Gerrit name patch-set diffing, commit-as-unit, stacking, ported comments, draft-then-publish batching, the reviewed checkmark, and turn-taking; those are tool mechanisms. People who leave it name UX, the amend workflow, and distance from "where the developers are"; those are mostly culture and familiarity, with a real tool component in the UI.
- **For hihyou.** Gerrit proves verdict carry is valued ("you now will only have to re-review patches when the code actually changes") but shows its coarse keys are the weak point. hihyou's per-edit key `(anchor, before hash, after hash)` is strictly finer than anything Gerrit or Reviewable ship.

## 1. Model

### Change, patch set, Change-Id

**[fact]** A change is one commit under review; each re-upload with the same `Change-Id` footer becomes a new patch set of that change, and only the latest patch set is submitted ([concept-changes](https://gerrit-review.googlesource.com/Documentation/concept-changes.html), [concept-patch-sets](https://gerrit-review.googlesource.com/Documentation/concept-patch-sets.html)). A `Link:` footer is accepted in place of `Change-Id` ([concept-changes](https://gerrit-review.googlesource.com/Documentation/concept-changes.html)).

**[fact]** The `Change-Id` is generated on the client by the `commit-msg` hook. It is not globally unique: Gerrit matches on (Change-Id, repository, branch), so a cherry-pick to another branch keeps the id and becomes a separate change. To squash, the docs say to keep one Change-Id and manually abandon the other changes ([user-changeid](https://gerrit-review.googlesource.com/Documentation/user-changeid.html)).

**[fact]** An uploader may attach a patch set description (the docs' example: "Added more unit tests.") that is not part of git history ([concept-patch-sets](https://gerrit-review.googlesource.com/Documentation/concept-patch-sets.html)). This is the only place Gerrit records *why* a revision exists.

**[fact]** Submit strategies are Fast Forward Only, Merge If Necessary (default), Always Merge, Cherry Pick, Rebase If Necessary and Rebase Always ([concept-changes](https://gerrit-review.googlesource.com/Documentation/concept-changes.html)).

### Relation chain and topic

**[fact]** The change screen's Related Changes area has four lists: Relation Chain (git parent/child), Merge Conflicts, Submitted Together, and Cherry-Picks (same Change-Id elsewhere). Chain entries carry states such as "Not current" (depends on an outdated patch set of its parent, needs rebase) and "Indirect descendant" ([user-review-ui](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)).

**[fact]** A topic is a free-text tag grouping changes, including across repositories; submitting a topic atomically requires `change.submitWholeTopic` ([cross-repository-changes](https://gerrit-review.googlesource.com/Documentation/cross-repository-changes.html)).

**[inference]** Relation chain is derived from git; topic is the only human-declared grouping, and it is flat. Neither expresses "these three commits together implement intent X".

### Labels and submit requirements

**[fact]** `Code-Review` ranges -2..+2. AOSP defined +2 as "looks good to me, approved" and -2 as a veto that "is valid across all patch sets" until the reviewer removes it. `Verified` ranges -1..+1 ("compiles, passes basic unit tests") ([config-labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).

**[fact]** A submit requirement has `applicableIf`, `submittableIf` and `overrideIf`, each a change query, e.g. `submittableIf = label:Code-Review=MAX,user=non_uploader AND -label:Code-Review=MIN`. Labels not referenced by any requirement are "trigger votes" (e.g. to start CI) ([config-submit-requirements](https://gerrit-review.googlesource.com/Documentation/config-submit-requirements.html)). The older mechanism was Prolog rules ([HN, q3k](https://news.ycombinator.com/item?id=20499901)).

### Attention set

**[fact]** Rationale, verbatim: "Code Review is a turn-based workflow." Adding a reviewer adds them to the set; replying removes the replier and adds the other participants of threads they replied to; a vote that becomes outdated on a new patch set adds its voter; uploading a new patch set alone does not change the set; service-user bots are never added; WIP changes get no automatic additions. The dashboard's "Your turn" section shows how long each change has waited, and the doc says "you can strictly ignore everyone else's changes" ([user-attention-set](https://gerrit-review.googlesource.com/Documentation/user-attention-set.html)).

**[fact]** Other change-screen mechanisms reviewers cite: the commit message is shown as a reviewable "magic file" first in the file list; a Comments tab and a Checks tab; comments resolve with "Done" or "Ack"; drafts are batched and published together with the vote; voting is allowed only on the current patch set; any two patch sets (or base) can be compared ([user-review-ui](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)).

## 2. Rebase handling: what carries, keyed on what

### 2.1 Votes: `copyCondition` and `changekind`

**[fact]** Each label has a `copyCondition` query. When a new patch set is uploaded and the query matches, the vote is copied; otherwise the vote becomes outdated and its voter joins the attention set ([config-labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)). Predicates include `changekind:`, `is:{MIN,MAX,POSITIVE,NEGATIVE,ANY,<value>}`, `approverin:`, `uploaderin:`, and `has:unchanged-files` (the set of modified files is the same; fails on a rename or a file reverted to base) ([config-labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).

| `changekind` | Meaning (per [config-labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)) |
|---|---|
| `NO_CHANGE` | Same parent tree, same diff, same message; only the SHA differs |
| `NO_CODE_CHANGE` | Same parent tree and diff; only the commit message changed |
| `MERGE_FIRST_PARENT_UPDATE` | A merge commit whose only difference is its first parent |
| `TRIVIAL_REBASE` | Same message and same diff including context; a rebase with no conflict resolution |
| `TRIVIAL_REBASE_WITH_MESSAGE_UPDATE` | A trivial rebase that also edited the message |
| `REWORK` | Anything else |

**[fact]** The default `Code-Review` copyCondition written by `AllProjectsInput.java` is `changekind:NO_CHANGE OR changekind:TRIVIAL_REBASE OR is:MIN` ([source](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/schema/AllProjectsInput.java)). **[inference]** So by default a commit-message-only edit drops +2, but a -2 always sticks.

**[fact]** `ChangeKindCacheImpl.java` decides TRIVIAL_REBASE by three-way merging (cherry-picking) the previous patch set onto the new patch set's first parent and checking the result tree equals the new tree; it compares only with the immediately previous patch set; if an object is too large to merge it assumes REWORK ([source](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/change/ChangeKindCacheImpl.java)).

**[inference]** Vote carry is one boolean per commit. One hand-edited hunk anywhere, including an unrelated conflict resolution, makes the whole change REWORK and drops every vote. Conversely a clean rebase keeps +2 even when the upstream change silently altered code that the reviewed edit depends on (a renamed callee, a changed invariant); git merged cleanly, so Gerrit calls it trivial.

**[fact]** Sites tune this into culture. Chromium copies Code-Review on trivial rebase, on message-only change, or when "The author is a committer and the list of modified files has not changed"; for non-committers any code change drops approval; Code-Owners approvals are always copied ([chromium contributing.md](https://github.com/chromium/chromium/blob/main/docs/contributing.md)). OpenStack lets a core approve alone when an earlier +2 patch set "only changed in trivial ways" ([review the OpenStack way](https://docs.openstack.org/project-team-guide/review-the-openstack-way.html)). When ChromeOS turned on sticky votes for trivial rebases, the announcement said "you now will only have to re-review patches when the code actually changes" and a reply was "I would be sooooooooo happy" ([chromium-os-dev, 2014-05-09](https://groups.google.com/a/chromium.org/g/chromium-os-dev/c/gZ70ap-zoK0/m/a_o-N6fJ_TQJ)).

### 2.2 "Edit due to rebase" tint

**[fact]** When the two compared patch sets have different parents, Gerrit also diffs the parents; edits between the patch sets that are explained by the parent diff are marked as rebase edits and coloured differently, and a file whose edits all come from the rebase is dropped from the file list ([user-review-ui](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)). It shipped in 2.15 ("Mark Changes Due to Rebase") and is not counted in the diff size ([2.15 release notes](https://www.gerritcodereview.com/2.15.html)).

**[fact]** `EditTransformer.java` maps edits through the parent transformation, and "Edits which can't be transformed due to conflicts with the transformation are omitted" ([source](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/patch/filediff/EditTransformer.java)).

**[fact]** The docs name a failure they call a hazardous rebase: squash a two-change stack and upload it as patch set 2 of the child; the parent diff exactly explains the added content, so PS1..PS2 shows empty. It "is a correct diff but it's hiding the fact that new content got implicitly merged into this change from the parent change" ([user-review-ui](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)).

**[inference]** The tint is presentation only. It separates rebase noise from author edits visually, but carries no verdict: the reviewer still decides, per patch-set pair, what to re-read.

### 2.3 The per-file "reviewed" checkmark

**[fact]** The checkmark is stored per (account, change, patch set, file) via `PUT /changes/{id}/revisions/{rev}/files/{file}/reviewed`; a diff preference can set it automatically on view ([rest-api-changes](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html)).

**[fact]** `Files.java` carries it forward: when listing reviewed files for a patch set with no marks yet, it takes the latest earlier patch set that has marks and copies a mark only if the file's blob at the same path is byte-identical in both patch sets (or the file is deleted in both with identical ancestor blobs), then persists the copied marks ([source](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/restapi/change/Files.java)).

**[inference]** So the checkmark survives a new patch set only for files whose final content is unchanged. On a trivial rebase where upstream touched the same file, the vote survives but the checkmark is lost; on a rebase where the file's content is identical but its dependencies changed, the checkmark survives. It is keyed on content, not on the edit, and never on context.

### 2.4 Comments ported to later patch sets

**[fact]** `GET /changes/{id}/revisions/{rev}/ported_comments` returns comments from earlier patch sets mapped onto this one ([rest-api-changes](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html)). `ListPortedComments.java` filters to unresolved threads and excludes drafts ([source](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/restapi/change/ListPortedComments.java)).

**[fact]** `CommentPorter.java` and `GitPositionTransformer.java` diff the old patch set commit against the new one (rebase edits included), shift each (path, line range); if the range overlaps an edit the comment degrades to a file-level comment, and if the file is gone to a patchset-level comment ([CommentPorter](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/restapi/change/CommentPorter.java), [GitPositionTransformer](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/patch/GitPositionTransformer.java)).

**[inference]** Resolved threads are not ported, so a verdict ("I checked this, fine") expressed as a resolved comment does not follow the code. Anchors are line ranges, so a reformat or an edit touching the line detaches the thread to file level.

### 2.5 Against the rerere-like idea

The idea (from `docs/roadmap.md` M4): a verdict per edit keyed on `(anchor, before hash, after hash)`; same edit + same context carries the verdict; same edit + changed context flags "re-check"; changed edit shows only its interdiff.

| hihyou case | Gerrit today |
|---|---|
| Same edit, same context, carry verdict | Whole-commit TRIVIAL_REBASE carries votes; identical blob carries the file checkmark. Granularity is commit or file, not edit. **[inference]** |
| Same edit, changed context, "re-check" | Not flagged. A clean git merge is TRIVIAL_REBASE and keeps the vote; rebase tint shows upstream edits only if they land in the same file and diff. **[inference]** from [ChangeKindCacheImpl](https://github.com/GerritCodeReview/gerrit/blob/master/java/com/google/gerrit/server/change/ChangeKindCacheImpl.java) |
| Changed edit, show only interdiff | Patch-set-vs-patch-set diff with rebase tint, per file. Closest match, but a single changed hunk still drops all votes (REWORK). **[fact]** [user-review-ui](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html) |

**Where it breaks** (all **[inference]** from [user-changeid](https://gerrit-review.googlesource.com/Documentation/user-changeid.html) and the source above):

- **Split.** The new commit needs a new Change-Id; it starts with no votes, no checkmarks, no comments.
- **Squash.** Keep one Change-Id and abandon the rest; the absorbed changes' history stays on abandoned changes, and the survivor may show an empty or misleading interdiff (the hazardous rebase).
- **Reorder.** Non-overlapping commits reorder as trivial rebases and keep votes; overlapping ones become REWORK and lose them, even though no author edit happened.
- **Edit moved between changes.** Every carry key includes the change, so a hunk moved from change A to change B arrives in B unreviewed and leaves A looking reworked.
- **Rename or reformat.** Checkmarks key on path + blob; comments key on path + line; both detach.

### 2.6 Reviewable.io as a second data point

**[fact]** Reviewable stores review marks per file, per revision, per reviewer; the file matrix shows virtual columns for "last reviewed by you" and "last reviewed by anyone"; it uses "heuristics to match rebased commits to their ancestors using commit messages" to pick a minimum-delta pair even after reordering; each cell has an inner swatch (action against the matched prior rebased revision) and an outer one (against the preceding revision); base-change states are "Base changes only", "Base updated and modified" and "Base changes not reflected"; base-only changes collapse in the diff ([files docs](https://docs.reviewable.io/files)).

**[fact]** Review completion requires every file marked reviewed at the latest revision by a non-author plus all discussions resolved; files are auto-grouped (renamed-only, vendored, reverted) and can be marked by group; "Compact revisions" is lossy, keeping only each reviewer's latest mark ([reviews docs](https://docs.reviewable.io/reviews), [files docs](https://docs.reviewable.io/files)).

**[inference]** Reviewable goes further than Gerrit on cross-rebase matching (message heuristics survive reorder, and the "base changes only" state is a primitive "context changed" signal) but is still file-granular and does not survive split, squash, or moving an edit.

## 3. Experience: why people like or dislike Gerrit versus GitHub

| Experience | Mechanism | Tool or culture | Source |
|---|---|---|---|
| "Easy diffing between states of the CR (patch sets)" | Immutable patch sets, any-pair compare, rebase tint | tool | [HN 24919707, q3k](https://news.ycombinator.com/item?id=24919707) |
| GitHub makes it hard to see what changed since last review; "forget[s] about everything but the two most recent uploads"; no patchsets "cripplingly bad" | Force-push overwrites; Gerrit keeps every patch set | tool | [HN 36607799](https://news.ycombinator.com/item?id=36607799) |
| "Clear mapping of change request == commit"; stack while parent is under review | Change-Id per commit; relation chain | tool | [HN 24919707, q3k](https://news.ycombinator.com/item?id=24919707), [HN 20499901](https://news.ycombinator.com/item?id=20499901) |
| "Inline comments aren't lost on rebases and will be ported"; "Smaller units of review result in better code" | ported_comments; commit-sized units | both | [HN 26847429, lima](https://news.ycombinator.com/item?id=26847429) |
| "High contrast, fast keyboard navigation, marking of files as reviewed" | Keyboard nav; per-file reviewed flag | tool | [HN 20499901, q3k](https://news.ycombinator.com/item?id=20499901) |
| Draft comments sent as one batch; GitHub lacked draft-then-send | Drafts published with the vote | tool | [HN 36607799, tylerhou](https://news.ycombinator.com/item?id=36607799), [HN 12487695, asb](https://news.ycombinator.com/item?id=12487695) |
| Comments on sub-line ranges and on expanded context; +2 "I reviewed", +1 Verified "I ran it" | Range comments; separate labels for separate claims | both | [HN 20499901, jrockway](https://news.ycombinator.com/item?id=20499901) |
| Only re-review "when the code actually changes" | copyCondition on TRIVIAL_REBASE | both (tool + per-site policy) | [chromium-os-dev](https://groups.google.com/a/chromium.org/g/chromium-os-dev/c/gZ70ap-zoK0/m/a_o-N6fJ_TQJ), [Chromium contributing.md](https://github.com/chromium/chromium/blob/main/docs/contributing.md) |
| Know whose turn it is; ignore others' changes | Attention set, "Your turn" with wait time | tool, with a ~24h-per-turn expectation that is culture | [user-attention-set](https://gerrit-review.googlesource.com/Documentation/user-attention-set.html) |
| Fast reviewer response | "aim to provide actionable feedback 3 times per work day"; add another reviewer after 2 working days | culture | [Chromium code_reviews.md](https://github.com/chromium/chromium/blob/main/docs/code_reviews.md) |
| "Think of each review comment like a ticket"; reply Done to every one | Unresolved/resolved threads gate submit | both | [Go contribute](https://go.dev/doc/contribute) |
| Review comments "can be ordered as the reviewer desires"; Gerrit is a "firewall" that raises the bar | Commit-level units, reviewer-controlled flow | both | [golang/go #61182](https://github.com/golang/go/discussions/61182) |
| Review history is permanent, unlike GitHub | Every patch set and comment is kept | tool | [Haiku blog](https://www.haiku-os.org/blog/pulkomandy/2025-11-24-the_gerrit_pending_review_iceberg/), [lobste.rs](https://lobste.rs/s/4tvzih) |
| Review at commit level; one contribution becomes several changes | Change per commit | both | [Qt wiki](https://wiki.qt.io/Gerrit_Introduction) |
| Avoid thousands of forks for AOSP | Server-side refs/for/, no fork-and-PR | tool | [GerritForge 2013](https://gitenterprise.me/2013/10/17/gerrit-code-review-or-githubs-fork-and-pull-take-both/) |
| A -1 is "obstructing someone else's work"; busy reviewers skip -1'd changes; a +1 helps "re-review any subsequent patch set more quickly" | Label semantics plus dashboards filtering by votes | culture | [review the OpenStack way](https://docs.openstack.org/project-team-guide/review-the-openstack-way.html) |

### Dislikes

- "interface written by developers with little knowledge of user experience" ([HN 24919707, huskyr](https://news.ycombinator.com/item?id=24919707)); "UX is abysmal" (okhan, same thread); designers found it impossible (llimllib, same thread).
- "so off-putting to new users", from a Wikimedia developer (20after4, [HN 24919707](https://news.ycombinator.com/item?id=24919707)); Wikimedia's own consultation: "Gerrit's workflow is in many respects best-in-class, its interface suffers from usability deficits, and its workflow differs from mainstream industry practices", with dissatisfaction "particularly evident for our volunteer communities" ([MediaWiki GitLab consultation](https://www.mediawiki.org/wiki/GitLab/2020_consultation)).
- Amend-per-change workflow disliked (dionian, [HN 24919707](https://news.ycombinator.com/item?id=24919707); djsumdog, [HN 11429915](https://news.ycombinator.com/item?id=11429915)); "learning curve is much steeper" (q3k, [HN 20499901](https://news.ycombinator.com/item?id=20499901)).
- Browser shortcut override (Ctrl-F) and UX bugs (bawolff, [HN 24919707](https://news.ycombinator.com/item?id=24919707)).
- Contributors are elsewhere: Eclipse moved off Gerrit because GitHub/GitLab is "where the developers are" ([Denis Roy](https://blogs.eclipse.org/post/denis-roy/moving-eclipse-projects-github-and-gitlab), [Eclipse migration plan](https://gitlab.eclipse.org/eclipsefdn/helpdesk/-/wikis/Gerrit/Gerrit-and-Bugzilla-deprecation-and-migration-plan)); Go's GitHub-PR import path "is not working well", GitHub PRs merged at 34% (438 of 1277), and Gerrit pages are not indexed by Google search ([golang/go #61182](https://github.com/golang/go/discussions/61182)).
- Painful server upgrades (Gerrit 2 to 3) ([MediaWiki GitLab consultation](https://www.mediawiki.org/wiki/GitLab/2020_consultation)).

**[inference]** The split is consistent: the *mechanisms* (patch sets, commit unit, carry, turn-taking) are praised even by leavers ("best-in-class" workflow), and the *surface* (UI, amend-based git workflow, separate site) drives people away. hihyou being a viewer, not a forge, can take the mechanisms without imposing the workflow.

## 4. Gaps against hihyou's four pillars

1. **Review by AST node.** Gerrit anchors everything on path + line range (comments) or path + blob (checkmarks) or whole commit (votes). No syntax awareness; a reformat or rename detaches review state. **[inference]** from §2.3–2.4.
2. **Verified grouping and hiding.** Gerrit hides one class by proof: files whose edits are all rebase edits ([user-review-ui](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)). It has no grouping of mechanical edits (renames, formatting, codemods) and the hazardous rebase shows its hiding can conceal content. Reviewable groups renamed-only, vendored and reverted files, file-level only ([files docs](https://docs.reviewable.io/files)).
3. **Organization by intention.** Intent lives in commit messages (magic file), optional patch set descriptions, and flat topics ([concept-patch-sets](https://gerrit-review.googlesource.com/Documentation/concept-patch-sets.html), [cross-repository-changes](https://gerrit-review.googlesource.com/Documentation/cross-repository-changes.html)). Nothing groups edits inside a commit by intent or reorders the file list by it. **[inference]**
4. **Review-only editor.** Gerrit has an in-browser edit mode and Suggest Fix, but review happens in a web diff table, not an editor with navigation, go-to-definition, or folding by structure ([user-review-ui](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html)). The praised keyboard navigation is the closest piece ([HN 20499901](https://news.ycombinator.com/item?id=20499901)).

## 5. Implications for hihyou

- **Adopt the patch-set model as `Diffset` history.** Keep every revision immutable and comparable pairwise; this is the single most-praised Gerrit trait and GitHub's biggest complaint. **[inference]** from §3.
- **Key verdicts on the edit, not the commit.** Gerrit's REWORK-drops-everything and identical-blob checkmark are the two failure modes to beat: one conflict hunk should invalidate only the edits it touches. **[inference]** from §2.1, §2.3.
- **Implement the "re-check" state Gerrit lacks.** Detect a context change for an unchanged edit (upstream changed code the anchor depends on) instead of trusting a clean merge; Reviewable's "Base updated and modified" is the nearest precedent. **[inference]**
- **Match edits across changes, not just across revisions.** Carry by `(anchor, before hash, after hash)` independent of Change-Id so split, squash, reorder and move keep verdicts; Reviewable's message heuristics show matching is feasible, but content hashes are sturdier. **[inference]**
- **Guard against the hazardous rebase.** When hiding by proof (rebase-only, mechanical-only), show what was hidden and why, since Gerrit's own docs admit an empty diff can hide merged content. **[inference]** from §2.2.
- **Separate claims, like Code-Review vs Verified.** A verdict should say what was checked ("read", "ran", "owner-approved"); jrockway's +2/+1 distinction and Chromium's always-copied Code-Owners label show different claims deserve different carry rules. **[inference]** from §1 and §3.
- **Port resolved verdicts, not only open threads.** Gerrit ports only unresolved comments; hihyou's carried verdicts are exactly the resolved state. **[inference]** from §2.4.
- **Turn-taking is cheap and loved.** An attention-set-like "your turn" view fits a viewer even without a forge, if the adapter can read it. **[inference]**
- **Browser-only access.** Gerrit's REST API denies cross-origin requests unless the admin sets `site.allowOriginRegex` ([config-gerrit](https://gerrit-review.googlesource.com/Documentation/config-gerrit.html)); a live request to `chromium-review.googlesource.com` with an `Origin` header returned no `Access-Control-Allow-Origin`. **[fact]** A browser-only hihyou Gerrit adapter therefore cannot call public Gerrit hosts directly and must read via git (patch-set refs `refs/changes/*`) or a user-supplied proxy. **[inference]**

## Unverified

- Critique (Google-internal) as the origin of the attention set; only the claim that Gerrit "looks almost completely like Critique" was seen ([HN 26847429](https://news.ycombinator.com/item?id=26847429)).
- Content of Compass's "From Gerrit to GitHub" post ([Medium](https://medium.com/compass-true-north/from-gerrit-to-github-cebc463ec01b)); the page returned 403, only a search snippet was read.
- A search snippet saying Chromium and Google-internal LGTMs are sticky unless retracted, with authors trusted; not read in a primary source beyond Chromium's copyCondition list.
- The term "rebase-proof review" appears in no source found; treated as the user's own concept.
- Exactly how Reviewable carries a mark for a file unchanged across revisions (the docs describe display, not the carry rule).
- AOSP-specific first-hand reviewer accounts were not gathered; AOSP evidence here is the origin story and label semantics.
- Chromium's move from Rietveld to Gerrit in July 2016 is from a search snippet of the [announcement](https://groups.google.com/a/chromium.org/g/chromium-dev/c/1DwH8-pPimk/m/EeNpmh21BwAJ).
