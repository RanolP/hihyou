# Why Phabricator review felt good

Companion to `docs/research/phabricator.md`, which lists what Differential and `arc` *do*. This note asks a different question: why people who used Phabricator describe reviewing there as a better *experience* than reviewing on GitHub, and what they disliked. It serves hihyou's problem statement, in the user's words: "just seeing sequence of diffs without any intention makes user 피로 (fatigue). reviewing on github makes us 피로. seeing pr on vs code is a way better. but not enough."

Convention: a quoted sentence with a link is **evidence** (a first-hand account). **Inference** marks my own reasoning. Each reason says whether it comes from the **tool**, the **culture**, or **both**, and what GitHub does differently. Features are named only as the mechanism behind a feeling; their specs live in `phabricator.md`.

A caveat on the evidence: several of the warmest accounts come from Facebook/Meta, whose internal tool "advanced significantly even further beyond open source Phabricator" (williewillus, [lobste.rs](https://lobste.rs/c/lbvuyw)) and was backed by a big team: "Sapling and Phabricator much much better (when supported by a massive internal team)" (forrestthewoods, [HN](https://news.ycombinator.com/item?id=47758481)). Where an experience is Meta-internal rather than open-source Phabricator, I say so.

## The one-line summary

The strongest single framing comes from MaskRay, who ran LLVM's migration away from Phabricator: "GitHub is more contributor-friendly but perhaps not as reviewer-friendly. Within the LLVM community, reviewer resources are extremely limited. Consequently, being reviewer-friendly is likely of critical importance." ([MaskRay](https://maskray.me/blog/2023-09-09-reflections-on-llvm-switch-to-github-pull-requests)). depoll, who moved a startup from GitHub PRs to Phabricator, says the same from the reviewer's chair: Phabricator is "built for a code reviewer's workflow", and going back to GitHub "felt like pulling teeth in comparison" ([HN](https://news.ycombinator.com/item?id=7697380)). Nearly every reason below is a way the tool spent the author's effort to save the reviewer's attention.

## Reasons

### 1. Every review is about one thing

**Experience.** The reviewer faces a single thesis at a time, and the boring changes stop diluting the interesting ones. Jackson Gabbard (ex-Facebook engineer): each commit "can have a single thesis. This matters *so* much more than most engineering teams realize", and small units mean "the dozens of uninteresting changes that come along with any significant work approved effortlessly. The changes that are actually controversial can be easily separated from the hum-drum, iterative code that we all write every day" ([jg.gg](https://jg.gg/2018/09/29/stacked-diffs-versus-pull-requests/)). williewillus: "the unit of review is one commit. Not a patchset ... not an entire branch", which "has the great effect of 'right-sizing' the unit of review" ([lobste.rs](https://lobste.rs/c/lbvuyw)). adamwk: it "encourages smaller PRs or diffs so that reviews are quick and easy to do in between builds (whereas long pull requests take a big chunk of time)" ([HN](https://news.ycombinator.com/item?id=47757695)).

**Mechanism.** One commit maps 1:1 to one revision; a stack links revisions in order; `arc diff` makes a new unit cheap. The cheapness is the point. Gabbard: "People choose whatever is easiest. Defaults matter. So much." With stacked diffs "the default behaviour is to be able to create a unit of code review for any change, no matter how minor" ([jg.gg](https://jg.gg/2018/09/29/stacked-diffs-versus-pull-requests/)).

**Tool or culture: both.** The tool makes the small unit cheap; the culture forbids the big one. Nick Yan (ex-Meta): "one of my managers literally said 'I'm not accepting this unless you split this up'. Small, stacked PR's were the cultural norm" ([Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/stacked-diffs)). Aryaman Naik: "pretty much 100% of engineers used stacking all the time" (same source). Upstream Phabricator states the norm as house style, "One idea is one commit" (see `phabricator.md` §1).

**What GitHub does instead.** A PR is a branch, and a PR costs enough that people skip it: "PRs are expensive. So when you think 'this is a self contained change, but I need it to continue development' you are unlikely to send a PR" (codesuki, [HN](https://news.ycombinator.com/item?id=26922633)). "The easiest behaviour is shoehorning in a bunch of shit under one PR" (Gabbard). When authors do craft commits, "all the feedback for the discrete units of change gets lumped together into one massive pile of feedback for the pull request as a whole" (Gregory Szorc, [blog](https://gregoryszorc.com/blog/2020/01/07/problems-with-pull-requests-and-how-to-fix-them/)). GitHub Stacked PRs (public preview 2026-07-30) closes part of this; mh2266 notes it "does seem a bit like gluing on an additional feature" because Phabricator's "commits to diffs are a 1:1 relationship" ([HN](https://news.ycombinator.com/item?id=47759933)).

### 2. The author is never stuck waiting, so nobody bundles and nobody nags

**Experience.** Authors keep working while a review is pending, so they have no reason to pile more into the change under review, and the reviewer gets small units at a steady pace. Gabbard calls it "Coding as a queue": "If you're a productive engineer, you'll pretty much always have five or more changes out for review ... With Stacked Diffs, the queue is obvious — it's a stack of commits ahead of master" ([jg.gg](https://jg.gg/2018/09/29/stacked-diffs-versus-pull-requests/)). Jacob Gold (ex-Meta): "you can continue to add to your stack while waiting on specific stakeholders to review your changes — since there might be different reviewers on different parts of the stack who review at different times" ([Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/stacked-diffs)). pertymcpert on LLVM: "some reviewers only need to see some parts of it and not the rest. Stacked diffs were a godsend and the LLVM community's number one complaint about moving to GitHub was losing this feature" ([HN](https://news.ycombinator.com/item?id=47768277)).

**Mechanism.** Revisions float as patches, not branches anchored to a base; each lands on its own. FrenchyJiby: diffs are "floating" patches, while "PRs are ... 'anchored' to the place they branched off of", so N dependent PRs lead to "rebase/forcepush cascades, which sucks" ([HN](https://news.ycombinator.com/item?id=26922633)).

**Tool or culture: both.** The floating patch is tooling; routing each layer to a different reviewer is team practice.

**What GitHub does instead.** "With Pull Requests, the work queue is hidden behind the cruft of juggling branches" (Gabbard). Dependent PRs must be rebased by hand when the one below changes.

### 3. The reviewer can tell whether their concerns were addressed

**Experience.** Coming back to round 2, the reviewer checks their own earlier comments against the new code instead of re-reading the change. depoll names this as the reason his team switched: "checkpointed diffs (so that you can see what changed since the last round of review and whether/how your comments were addressed) are handled very poorly by GitHub" ([HN](https://news.ycombinator.com/item?id=7697380)). sophiebits (Khan Academy): on GitHub, "When someone updates a PR, it's hard to see what's changed since the last version you saw" ([HN](https://news.ycombinator.com/item?id=8654897)). The loss shows most clearly at migration: Aaron Ballman on moving a long LLVM review to GitHub, "it's basically impossible to tell 'have you addressed all my concerns' from a code review perspective" (quoted in [LLVM Discourse #132](https://discourse.llvm.org/t/update-on-github-pull-requests/71540/132)). adityaathalye: "Who the hell loses code review history? A record of the very thing that made my code better?" ([HN](https://news.ycombinator.com/item?id=47761599)).

**Mechanism.** Every update is a new diff on the same revision, so any two rounds compare cleanly, rebase noise is tinted, and inline comments are ported forward as "ghost" inlines with a Done checkbox (`phabricator.md` §3). Epriestley's design intent: carrying Done comments forward "makes it a lot easier for me to verify that they're really done" ([T7447](https://secure.phabricator.com/T7447)). MaskRay: "review comments are confidently associated with the source line" ([MaskRay](https://maskray.me/blog/2023-09-09-reflections-on-llvm-switch-to-github-pull-requests)).

**Tool or culture: tool.**

**What GitHub does instead.** Amend-and-force-push is the natural way to keep one idea per commit, and GitHub handles it worst. "The fidelity of preserving inline comments after a force push has always been a weakness. The comments may be presented as 'outdated'" (MaskRay). Szorc: "GitHub's review comments can lose context when force pushes occur", and for years comments on individual commits "would flat out be deleted". David Gomes (Phabricator 2019-2023): GitHub "does let you see the 'deltas' between updates ... However, it's not easy to find and not something they've really optimized the experience around" ([davidgomes.com](https://davidgomes.com/phabricator-code-review/)). Counterpoint: stormbrew preferred GitHub here, because comments on unchanged lines "stick around" across force pushes ([HN](https://news.ycombinator.com/item?id=8655060)); WhyNotHugo points out GitHub links "changes since you last viewed" ([HN](https://news.ycombinator.com/item?id=17248142)).

### 4. The why and the code are one continuous read

**Experience.** The reviewer glances up at the summary and test plan and back down at the hunk without leaving the page. Gomes: "A single vertical web page with the PR title/summary/test plan as well as the code changes. In GitHub, you have to switch tabs (which is slow and distracting) to go between the PR summary and the code ... it makes a huge difference in my ability to go back between a PR's summary and the diff" ([davidgomes.com](https://davidgomes.com/phabricator-code-review/)). tveita co-signed that quote on [HN](https://news.ycombinator.com/item?id=47111325).

**Mechanism.** The revision page renders title, summary, test plan, reviewers, timeline and changeset top to bottom (`phabricator.md` §2). The fields are filled from a commit-message template, so the why is written once, at commit time.

**Tool or culture: both.** The layout is tooling. Whether the summary says anything is culture: Gabbard notes that in a PR "You don't have a test plan for every commit. You don't bother with good documentation on each individual commit", and `phabricator.md` §2 found Mozilla's Test Plan empty on 31 of 31 sampled revisions.

**What GitHub does instead.** "Conversation" and "Files changed" are separate tabs.

### 5. A review is one composed act, not a stream of pings

**Experience.** The reviewer reads everything, leaves comments as drafts, then sends one coherent verdict; the author gets one notification instead of twenty. Gomes: "everything is a draft by default, and you have to submit at the end ... 99% of the time I don't want to submit a single comment immediately, I want to do a proper review with potentially multiple comments" ([davidgomes.com](https://davidgomes.com/phabricator-code-review/)). The social side, from sophiebits: "GitHub's emails are incredibly noisy to the point that I'm reluctant to make inline comments for fear of spamming people's inboxes" ([HN](https://news.ycombinator.com/item?id=8654897)). So the batching mechanism freed reviewers to comment more.

**Mechanism.** Inline comments stay unpublished until the reviewer submits the review with an action (Accept, Request Changes, Comment). The old submit button was famously labeled "Clowncopterize".

**Tool or culture: tool.**

**What GitHub does instead.** Both paths exist, but the default keystroke posts a single comment; batching needs "Start a review" or Cmd-Enter, and Gomes says "Even after years of using GitHub, I still haven't been able to build the muscle memory".

### 6. The diff shows what the author thought, not what the text did

**Experience.** Moved code does not look like new code, so the reviewer does not re-review what merely moved. Gomes' first reason: "Green for additions, Red for deletions, Light yellow for pure moves, Dark yellow for moves with modified formatting ... If a piece of code was simply moved from one place to another, I want it to be shown in a different way from new code being added" ([davidgomes.com](https://davidgomes.com/phabricator-code-review/)).

**Mechanism.** Copy/move detection plus normalized whitespace with indent markers (`phabricator.md` §4).

**Tool or culture: tool.**

**What GitHub does instead.** "GitHub only has green and red" (Gomes).

### 7. The tool tells you what needs you now, and only that

**Experience.** The reviewer opens one page and sees the reviews waiting on them, separate from the reviews waiting on someone else, and gets told only about changes they care about. sophiebits: GitHub lacks a way "to see the code reviews that you need to take action on (meaning code you need to review or reviews you authored that need updating, without showing reviews that you're waiting for another person on) on a single repo, let alone across all repos" ([HN](https://news.ycombinator.com/item?id=8654897)). joshdance: "getting an email with a link, clicking the link and immediately seeing the diff is super easy. Reduces friction to increase use" ([HN](https://news.ycombinator.com/item?id=7700086)). At Meta the queue became a flow: "Next Reviewable Diff" queues the next review when one finishes, "to encourage a diff review flow state", and users of it "perform 44 percent more review actions than the average reviewer" with no drop in eyeball time ([Meta Engineering](https://engineering.fb.com/2022/11/16/culture/meta-code-review-time-improving/)); that one is Meta-internal, not open-source Phabricator.

**Mechanism.** Dashboard buckets "Action Required" versus "Waiting on Others", Plan Changes to pull a revision out of queues, and Herald rules for path-based subscription (`phabricator.md` §5).

**Tool or culture: tool**, with Meta's ML queue on top.

**What GitHub does instead.** Watching is coarse. After LLVM moved, MaskRay rebuilt his Herald rules as `pr-subscribers-*` teams, labeling bots and "a curated list of Gmail filters" ([MaskRay](https://maskray.me/blog/2023-09-09-reflections-on-llvm-switch-to-github-pull-requests)). Some of sophiebits' 2014 complaints are dated: GitHub has since added review requests and a review-requested filter.

### 8. Authors write for the reviewer because each unit is judged on its own

**Experience.** Because every commit is reviewed and lands alone, authors feel responsible for each one, and the reviewer receives changes that were shaped to be read. Gabbard: "people just don't feel the same burden of quality per-commit in a PR", whereas with stacked diffs "every single commit is like the top commit from a Pull Request. Every commit has a link to the code review that allowed the commit to land" ([jg.gg](https://jg.gg/2018/09/29/stacked-diffs-versus-pull-requests/)). williewillus: the result is "a very, very neatly groomed log of commits that form a cohesive story about the code", and "about 25% of the reason why I still work at Facebook is because the code review and submission tools are just that good" ([lobste.rs](https://lobste.rs/c/lbvuyw)). Epriestley's stated design intent for pre-push review: "Authors have a strong incentive to craft small, well-formed changes that will be readily understood" and "to fix problems and respond to feedback received during review because it blocks them" ([Review vs. Audit, archived](https://web.archive.org/web/2023/https://secure.phabricator.com/book/phabricator/article/reviews_vs_audit/)).

**Mechanism.** Pre-push review is blocking, amend-based updates erase "fix typo" commits, and the commit message template asks for summary and test plan per commit.

**Tool or culture: both.** The template and the blocking gate are tooling; a norm that writing for the reviewer is the author's job is culture. Epriestley's own guide puts the burden on the author: the summary "should explain *why* you're making the change", because "This information can not be extracted from the change itself" ([Writing Reviewable Code, archived](https://web.archive.org/web/2023/https://secure.phabricator.com/book/phabflavor/article/writing_reviewable_code/)).

**What GitHub does instead.** PRs fill up with "'fix typo'-like micro commits", and the committer either keeps them or "is going to blindly squash them all into one, even if the changes would have been clearer in two or three thoughtfully structured commits" (williewillus).

### 9. It was fast

**Experience.** The page is there when you click. Gomes: "Graphite and Phabricator are both much snappier than GitHub"; he could watch YouTube on plane Wi-Fi but "couldn't browse or create PRs in GitHub", and GitHub's collapsing of large files "is a really bad experience because it's very hard to tell that a file was collapsed, particularly if you're trying to Cmd-F for something" ([davidgomes.com](https://davidgomes.com/phabricator-code-review/)).

**Mechanism.** Server-rendered pages; large changesets load on demand with a visible "Load Changes" control rather than silent collapse (`phabricator.md` §4).

**Tool or culture: tool.**

**What GitHub does instead.** Heavy client pages; auto-collapsed large files that break in-page search.

### 10. It had personality

**Experience.** Some users felt the tool was warm, which lowers the sting of criticism. A Blender developer at the migration: "I've really enjoyed using Phabricator, it has personality" ([devtalk.blender.org](https://devtalk.blender.org/t/phabricator-is-no-longer-being-actively-maintained-what-does-this-mean-for-developer-blender-org/19793)). At Wikimedia, a defender of image macros spoke of "the opportunity for having fun while interacting with collaborators/co-workers in a light-hearted way" ([T99345](https://phabricator.wikimedia.org/T99345)).

**Mechanism.** Image macros, tokens, jokey labels like "Clowncopterize".

**Tool or culture: culture**, and contested (see Dislikes).

**What GitHub does instead.** Reactions only; a neutral tone. Inference: this is the weakest reason and the one least worth copying.

## What people disliked

- **`arc` was a tax.** "When using arc, it has to be setup in every new computer, and it becomes messy if you want to use Client Certs. We had a big Wiki page for newcomers on how to setup arcanist" (xtracto, [HN](https://news.ycombinator.com/item?id=17251576)). gpanders on LLVM: "my experience with Phabricator was a bit painful (in particular, the arcanist tool)" ([lobste.rs](https://lobste.rs/c/a1h04m)).
- **It rewrote your history.** eru: "I hated that tool with a passion. It always destroyed my carefully curated PR branch history" ([HN](https://news.ycombinator.com/item?id=47760826)). stormbrew: "the way phabricator manipulates your commit messages in rather elaborate ways that are often confusing or frustrating" ([HN](https://news.ycombinator.com/item?id=8655060)).
- **Stacks were fragile outside Facebook.** "Dependent changes are a nightmare in phabricator ... they basically said 'yeah, just don't use dependent reviews'" (drewg123, [HN](https://news.ycombinator.com/item?id=17246895)). "Phabricator makes multi commit reviews possible but a total pain" (nh2, [HN](https://news.ycombinator.com/item?id=17246326)). Stacks "still suffer from rebase hell" (vlovich123, [HN](https://news.ycombinator.com/item?id=26925235)). Szorc: "commit series aren't featured prominently in the web UI" ([blog](https://gregoryszorc.com/blog/2020/01/07/problems-with-pull-requests-and-how-to-fix-them/)).
- **A workflow you have to learn, which raises the bar for newcomers.** "every newcomer needs to learn 'the Phab way', which gets people grumpy, and is only realistically feasible in a workplace, not really in a FOSS project as it increases the bar to contribution" (FrenchyJiby, [HN](https://news.ycombinator.com/item?id=26925893)). At Blender: "As a young developer who's been wanting to contribute to the Blender project, Gitea feels more familiar and welcoming" ([code.blender.org](https://code.blender.org/2023/02/gitea-test-drive/)). "anything outside of the workflow that they intended was not supported" (sjburt, [HN](https://news.ycombinator.com/item?id=26926406)).
- **Context switching between terminal and browser.** strken would "choose the PR workflow over the Phabricator workflow, based on not switching to the browser and not needing to copy-paste things into an interactive rebase" ([HN](https://news.ycombinator.com/item?id=26924693)).
- **Forced batching.** "I don't like that it makes you *always* batch them. Sometimes I really only have one thing to say and it's way too easy to forget to submit" (stormbrew, [HN](https://news.ycombinator.com/item?id=8655060)).
- **UX and tone.** "horrendous user experience, lack of integrations, and overall difficulty of use" and "Clowncopterize" as "a great demonstration of the professionalism of those who hack on Phabricator" (chralieboy, [HN](https://news.ycombinator.com/item?id=8654857), [HN](https://news.ycombinator.com/item?id=8654952)). Memes judged "not appropriate on our public bug tracker" at Wikimedia ([T99345](https://phabricator.wikimedia.org/T99345)).
- **Multiple reviewers were ambiguous.** "when you have multiple reviewers only one has to accept ... Oftentimes it is _more_ confusing to have multiple reviewers because you don't know who should have the final say" (chralieboy, [HN](https://news.ycombinator.com/item?id=8654952)); blocking reviewers were the fix (jtsnow, [HN](https://news.ycombinator.com/item?id=8655448)).
- **A two-person vendor.** "limited in some weird ways, mainly because the company behind it was made up of just two engineers. So, especially in terms of administration and integrations, it was a bit lacking" (Gomes, [davidgomes.com](https://davidgomes.com/phabricator-code-review/)). LLVM's self-hosted instance ended in a suspected compromise and an incomplete static archive ([LLVM Discourse](https://discourse.llvm.org/t/update-on-github-pull-requests/71540/175)).

## Implications for hihyou

Inference throughout; each item cites the reason it comes from.

1. **Make the unit of reading smaller than the PR, derived from what already exists.** Reason 1 is the core of the fatigue answer, and its cost in Phabricator was a new submission workflow (Dislikes: `arc`, "the Phab way"). hihyou can present a Diffset's commits as individually readable units, each with its message on top, without asking authors to change how they push. The culture half (authors who actually split) cannot be shipped by a viewer; the viewer can only make well-split history pleasant to read, which Gabbard's "Defaults matter" suggests is still worth doing.
2. **Treat "were my concerns addressed" as the primary question of round 2.** Reason 3 is the most consistently cited GitHub loss. A viewer that owns `{base, head}` per round can compare any two rounds, tint rebase noise, and carry the reader's own notes forward with a visible Done state.
3. **Keep the why and the diff on one scroll.** Reason 4: summary and commit message sit above the hunks they explain, with no tab switch.
4. **Show moves as moves.** Reason 6 fits hihyou's syntax-aware engine: distinguish pure moves and moves with reformatting from real additions.
5. **Draft by default.** Reason 5: annotations stay local until the reader chooses to publish them, which suits a browser-only runtime; allow a single immediate comment too, since forced batching was disliked.
6. **Speed and never-silent collapse.** Reason 9: a collapsed file must be visibly collapsed and searchable.
7. **Leave the queue, notifications and personality to the host.** Reasons 7 and 10 belong to a review platform, not a diff-set viewer; YAGNI until hihyou grows a queue.
8. **Require no CLI and no workflow change.** Most dislikes are about `arc`, history rewriting and newcomer friction, not about the reading experience. A viewer that works on existing commits, ranges and PRs keeps the good half and skips the bad half.

## Unverified

- Wikimedia, Uber, Dropbox and FreeBSD first-hand accounts: not found in this pass. Wikimedia's 2020 consultation was Gerrit-to-GitLab, not about Differential.
- Blender developers' views on Differential review specifically: the migration threads I read discuss the activity feed, code search and layout width, not review.
- Epriestley's Phame posts: `secure.phabricator.com` returned HTTP 503 on 2026-09-29; Review vs. Audit and Writing Reviewable Code were read from web.archive.org snapshots.
- Tomas Reimers' Graphite origin post on Medium returned 403; his view is taken only from the Pragmatic Engineer article.
- Which of the Meta accounts (reasons 1, 2, 7, 8) describe open-source Phabricator versus Meta's later internal fork is not separable from the sources.
- GitHub's current single-comment versus batch default was taken from Gomes (2026-02), not checked in the live UI.
