# Why Upsource review felt good

Companion to `docs/research/upsource.md`, which covers what JetBrains Upsource *did*: reviews over revision sets, the new-revisions-only diff, server-side IntelliJ code intelligence, the IDE plugin, and the 2022 end of sales. This note asks why people who used it describe reviewing there as better than on GitHub or its successors, and what they disliked. It is the Upsource counterpart of `gerrit-experience.md` and serves the same problem statement, in the user's words: "just seeing sequence of diffs without any intention makes user 피로 (fatigue). reviewing on github makes us 피로. seeing pr on vs code is a way better. but not enough."

Convention: a quoted sentence with a link is **evidence** (a first-hand account). **Inference** marks my own reasoning. Each reason says whether it comes from the **tool**, the **culture**, or **both**, and what GitHub does differently. Features are named only as the mechanism behind a feeling; their specs live in `upsource.md`.

A caveat on the evidence: the corpus is small and lopsided. Upsource was an on-premises commercial product used mostly by JetBrains-centric, JVM-heavy teams, so most first-hand accounts come from people already fond of JetBrains tools, and many of the warmest were written *after* the discontinuation, as reactions to losing it. One recurring voice (sebazzz) supplies five of the HN comments. Several code-intelligence claims come from the vendor: JetBrains' blog, its help pages, its support staff, and an HN user who introduced himself as an "Upsource team member" (leonya2). Reddit threads, JetBrains' YouTrack project for Upsource and the comments under the end-of-sales post could not be read, so the forum voice here is JetBrains' support community (archived) and Hacker News.

## The one-line summary

The shortest statement of Upsource's appeal is tyteen4a03's, on the day sales ended: "Upsource was what made code reviews manageable for our trunk-based repo, since code reviews are created independent of PRs / branches." ([HN](https://news.ycombinator.com/item?id=30161218)). JetBrains' own pitch names the other half: "you're used to all the power of your IDE, yet when you open up a set of changes in your code review tool you can't leverage any of that" (Trisha Gee, [JetBrains blog](https://blog.jetbrains.com/upsource/2015/10/19/what-to-look-for-in-a-code-review-upsource-quick-wins/)). Reviewing the commits you choose, with the IDE's understanding of the code, is what users missed; running a JVM server that indexed every revision is what they paid for it.

## Reasons

### 1. A review is the commits you pick, not a branch

**Experience.** Teams that commit to trunk could still review. tyteen4a03: reviews were "created independent of PRs / branches" ([HN](https://news.ycombinator.com/item?id=30161218)). sebazzz: "It is really sad that almost no modern code review tools support trunk-based development... One tool that was great for _both_ use cases was Jetbrains Upsource, where you could just string a bunch of related commits together in one review." ([HN](https://news.ycombinator.com/item?id=43037667)), and elsewhere "Almost no tool allows adding individual commits to a code review, the only one I know is Upsource" ([HN](https://news.ycombinator.com/item?id=34307266)). skrtskrt: "particularly for trunk development where you often need to be able to cherry-pick randomly-ordered commits into a review." ([HN](https://news.ycombinator.com/item?id=23977261)). mgaw described the parallel-work payoff: "Upsource is nice because it allows opening a review for a set of commits which aren't necessarily continuous. This way, multiple people can work on the same branch at the same time, and open a review for their respective commits afterwards. You don't need to wait for your coworker to have their review approved and their branch merged before you can start building on their work." ([HN](https://news.ycombinator.com/item?id=32702550)).

**Mechanism.** A review is a server-side entity over any set of revisions, or a whole branch (`upsource.md` §1). JetBrains' own 2021 comparison listed only Upsource and Space for per-commit review of random commits (`upsource.md` §8).

**Tool or culture: both.** The tool allows it; trunk-based development is the culture that needs it.

**What GitHub does instead.** A pull request is a branch. mgaw: "the other popular review tools (e.g. Github pull requests) only support reviews for entire branches." sebazzz, after the end: "We actually still use it, even though Jetbrains canned it, because we have found no good alternative." ([HN](https://news.ycombinator.com/item?id=43037667)).

### 2. Commits find their own review

**Experience.** Nobody had to remember to attach fix-ups. sebazzz: "Better yet, it could recognize based on the commit message (like workitem or CR number) that a commit belongs to the same code review and add it." ([HN](https://news.ycombinator.com/item?id=43037667)); in an Ask HN for a replacement: "add individual commits and the tool will keep the code-review up to do with additional commits referencing the same JIRA-ticket/user story number/etc." ([HN](https://news.ycombinator.com/item?id=33306164)).

**Mechanism.** From 2.5, a review or issue ID in the commit message attaches the revision to the open review; workflows later automated review creation and assignment (`upsource.md` §1).

**Tool or culture: both.** It needs the team's habit of putting ticket IDs in commit messages.

**What GitHub does instead.** New commits join a PR because they are on its branch; an issue key in a message only links, it does not group.

### 3. Round two shows only what is new

**Experience.** kgeist, after the switch: "After JetBrains discontinued Upsource, we tried several code review tools and it shocked us that many of the tools (both commercial and open source) don't have built-in tools to review incrementally. It's just just on big soup of code, or you have to create new PR's for each small change. Now we have to use JetBrains SpaceCode, which still lacks many of the niceties of Upsource." ([HN](https://news.ycombinator.com/item?id=41510327)). choeger, replying to sebazzz: "And all these tools struggle with incremental code reviews for some reason." ([HN](https://news.ycombinator.com/item?id=34307266)).

**Mechanism.** When revisions are added, the reviewer sees "only ... the diff of those revisions" and a selector toggles any subset; the IDE plugin's Smart summary diff does the same for multi-commit reviews; unread files are bold (`upsource.md` §2.1, §2.2).

**Tool or culture: tool.**

**What GitHub does instead.** GitHub can show changes since a reviewer's last review, but only along the branch; after a force push the prior state is hard to recover (`gerrit-experience.md` reason 1). Upsource's own version also broke on force push (see Dislikes).

### 4. The review diff behaves like the IDE

**Experience.** leonya2, an Upsource team member: "Since Upsource indexes your code just like any JetBrains IDE does, it gives you code navigation, inspections, etc. in the browser" ([HN](https://news.ycombinator.com/item?id=13023983)). pgwhalen: "It's pretty much exactly what you would expect from a JetBrains-built code review tool." ([HN](https://news.ycombinator.com/item?id=16704279)). Trisha Gee on why it matters: "The cognitive load of having to navigate through the code in an unfamiliar way and losing all the context your IDE provides is one of the things that makes developers less keen to perform code reviews." Find usages matters "because if a method or class has been changed in some way, you as the reviewer want to see what the impact of this change is", and navigation "lets you browse through the code in a way that's natural for you, rather than having some arbitrary order imposed on you" ([JetBrains blog](https://blog.jetbrains.com/upsource/2015/10/19/what-to-look-for-in-a-code-review-upsource-quick-wins/)). An early reviewer of the preview: "I really dig the news feed" and "I do like that you complete reviews, which is better over ReviewBoard which only includes a "ship it" button" ([Roush Tech](https://blog.roushtech.net/2014/08/28/upsource-preview-repository-management-review-jetbrains/)).

**Mechanism.** The server ran the IntelliJ engine per revision: go to declaration, find usages, a usages diff between revisions, hierarchy, and IntelliJ inspections on the diff (`upsource.md` §3).

**Tool or culture: tool.**

**What GitHub does instead.** Code navigation on GitHub is search-based and limited on PR diffs; inspections arrive only as CI annotations. I found no first-hand user account (outside the vendor) praising a specific navigation action by name; users praise the whole ("Anything that jetbrains makes I love", ssijak, [HN](https://news.ycombinator.com/item?id=15723595)).

### 5. Review from inside the IDE

**Experience.** JetBrains' own engineers reviewed this way: "At JetBrains we do code reviews using either Space or Upsource plugin right in IntelliJ IDEA" (Yuriy Artamonov, [dev.to](https://dev.to/jreznot/comment/1l8le)). denalii, on a JetBrains-only stack: "It was super nice having everything natively integrating with each other." ([HN](https://news.ycombinator.com/item?id=29384572)).

**Mechanism.** The IDE plugin listed reviews, toggled revisions, compared a file with the local version, jumped to source, and posted comments (`upsource.md` §5).

**Tool or culture: tool**, available only to JetBrains IDE users.

**What GitHub does instead.** IDE plugins for PRs exist, but the review is still a branch diff; the user's own remark that VS Code is "a way better" is the same wish.

### 6. Better than the host's own review UI

**Experience.** Some teams kept a Git host and put Upsource beside it for review. merb: "it's cheaper to use gitlab free and put upsource behind it, if your dealing with large mr's" ([HN](https://news.ycombinator.com/item?id=27717154)). cosmotic: "Compared to UpSource or GitHub, Bitbucket PRs are very rough." ([HN](https://news.ycombinator.com/item?id=28599642)). CraigJPerry named "upsource (my preference by far) or crucible" ([HN](https://news.ycombinator.com/item?id=25527327)).

**Mechanism.** Upsource read repositories without hosting them and mirrored GitHub PRs as reviews (`upsource.md` §1).

**Tool or culture: tool.**

**What GitHub does instead.** Review is part of the host, so replacing it means replacing the host. **Inference:** this is the shape hihyou takes, a reader beside the host.

## What people disliked

- **Memory and setup.** "Upsource is incredibly resource hungry" (Lazare, [HN](https://news.ycombinator.com/item?id=17244369)); "Also Upsource takes a shitload of memory." (merb, [HN](https://news.ycombinator.com/item?id=9498232)), who elsewhere noted it "needs 8 gb ram" ([HN](https://news.ycombinator.com/item?id=11049385)); "it actually was cool, but holy hell it was a beast to get up and running" (mdaniel, [HN](https://news.ycombinator.com/item?id=32703867)). An early tester "Threw it on a Linux machine with 2GB of memory, watched the entire system crash with out of memory exceptions." ([Roush Tech](https://blog.roushtech.net/2014/08/28/upsource-preview-repository-management-review-jetbrains/)). On JetBrains' forum a new admin found it "terribly slow. Every page takes seconds to load", and support replied "Recommended minimum memory size is 8 Gbs" and "Upsource is pretty greedy for system resources" ([support thread](https://web.archive.org/web/2022/https://upsource-support.jetbrains.com/hc/en-us/community/posts/205793319-Upsource-is-terribly-slow-What-can-I-do-about-it)). Another team found comments "randomly disappear" and traced it to "an OutOfMemory Error with Cassandra" ([support thread](https://web.archive.org/web/2022/https://upsource-support.jetbrains.com/hc/en-us/community/posts/207370425-Comments-randomly-disappear)). Even the team member conceded: "it's not a lightweight tool that's happy with 1 gig of memory. Configuring and waiting for code indexes takes a bit of time" (leonya2, [HN](https://news.ycombinator.com/item?id=13023983)).
- **The analysis that sold it was hard to make useful.** "the static analysis was(is?) indescribably hard to configure correctly to get meaningful results" (mdaniel, [HN](https://news.ycombinator.com/item?id=32703867)). Inference: server-side analysis needs the build model of every revision, which is exactly what `upsource.md` §3 says "may contribute to slow indexing".
- **History rewrites broke it, at least before 2017.** Asked about comments on a rebased branch, support said "Force push is not a best practises scenario and not recommended for usage. Thus it's not supported by Upsource. Branch review and code comments might be lost in such case." ([support thread](https://web.archive.org/web/2022/https://upsource-support.jetbrains.com/hc/en-us/community/posts/206578335-How-are-rebased-branches-handled)). A branch review repeatedly dropped revisions after a merge; support: "Unfortunately it also happens to revisions that were manually added to the review." ([support thread](https://web.archive.org/web/2022/https://upsource-support.jetbrains.com/hc/en-us/community/posts/206577195-Upsource-just-removed-21-revisions-from-a-review-and-I-don-t-know-why)). A WIP-heavy author asked "is there a way such that the reviewers do not see the changes among the WIP commits?" and got only a workaround ([support thread](https://web.archive.org/web/2022/https://upsource-support.jetbrains.com/hc/en-us/community/posts/360000524444-How-to-let-reviewers-see-a-squashed-view-)).
- **One revision, one review.** A team wanting an interim and a proper review of the same commits was told "multiple reviews for a single revision is not something we might implement in the nearest future" ([support thread](https://web.archive.org/web/2022/https://upsource-support.jetbrains.com/hc/en-us/community/posts/207079495-Allowing-revisions-to-be-present-in-multiple-code-reviews)).
- **Gaps in the diff and comments.** A moved-and-edited file "shows up as a file removal and addition" ([support thread](https://web.archive.org/web/2022/https://upsource-support.jetbrains.com/hc/en-us/community/posts/360005568299-File-move-showing-up-as-an-add-and-remove-in-Upsource-Review)); "one feature I do miss from ReviewBoard is being able to make block comments." and "Sadly Upsource doesn't support the code review process I'd need to adopt it" (the preview, [Roush Tech](https://blog.roushtech.net/2014/08/28/upsource-preview-repository-management-review-jetbrains/)).
- **It was good for browsing before it was good for review.** "Upsource is good for browsing. We're still in the process of finding a "good" tool for code review" (structural, [HN](https://news.ycombinator.com/item?id=10285466)).
- **JetBrains' server products in general.** "my experience with their server-side solutions(teamcity, upsource) has been nothing short of explosive diarrhea." (axegon_, [HN](https://news.ycombinator.com/item?id=29380183)); denalii's praise came with "Of course then you deal with the relatively high JB prices ... and vendor lock." ([HN](https://news.ycombinator.com/item?id=29384572)).
- **The discontinuation, and Space as the answer.** "It is unfortunate that they have scuttled Upsource and there is not really an alternative." (sebazzz, [HN](https://news.ycombinator.com/item?id=31438696)); "It is like recommending a Swiss pocket knife as a replacement for a screwdriver." and "they didn't even want to offer a license so we could temporarily extend our Upsource license while searching for an alternative" (sebazzz, [HN](https://news.ycombinator.com/item?id=32702453)); Space was "(1) expensive, (2) tries to do much" ([HN](https://news.ycombinator.com/item?id=33306164)). misterS on the announcement: "users of Upsource very likely already _have_ existing tools for hosting repositories, communicating, issue tracking, etc. It seems strange to me to expect people would abandon their existing toolchain in favour of Space, just to keep using Upsource." ([HN](https://news.ycombinator.com/item?id=30161218)). JetBrains later closed Space for the same reason misterS gave, "many organizations have their own specific needs, processes, and existing systems" ([JetBrains blog](https://blog.jetbrains.com/space/2024/05/27/the-future-of-space/)), and did not ship SpaceCode ([JetBrains blog](https://blog.jetbrains.com/space/2024/11/27/discontinuation-of-the-spacecode-private-preview/)); DevClass quoted Space customers as "deeply disappointed" ([DevClass](https://www.devclass.com/ci-cd/2024/05/28/customers-protest-as-jetbrains-ends-space-collaboration-platform-intros-spacecode-as-partial-alternative/1631438)).

Inference: the split mirrors Gerrit's. The *mechanisms* in reasons 1 to 5 are what people still asked for years later, and the complaints are about the *delivery*: a heavy self-hosted server, analysis that needed per-project build setup, and a vendor that folded the product into a platform people did not want.

## Implications for hihyou

Inference throughout; each item cites the reason it comes from.

1. **Take any commit set as a Diffset.** Reasons 1 and 2 are the most-missed traits, and nothing on GitHub replaces them. hihyou reading arbitrary commits and ranges already fits; grouping by an issue key in commit messages is a cheap adapter feature if a user asks for it.
2. **Make the round-two view survive rewrites.** Reason 3 worked in Upsource only while commits were never rewritten, and force push "might" lose comments. hihyou's per-edit carry keyed on `(anchor, before hash, after hash)` gives the same round-two view after rebase and squash, which is where Upsource and GitHub both fail (`upsource.md` §2.4, `gerrit.md` §2.1).
3. **Bring IDE reading to the diff without a server per revision.** Reason 4 is the remembered feature and the memory complaint is its cost. Language-server or tree-sitter navigation over the two sides of a diff gives go-to-definition and usages without indexing history; the usages diff is worth copying as a re-check signal (`upsource.md` §3, §11).
4. **Leave the IDE path open.** Reason 5 and the user's VS Code remark agree; a viewer whose state is portable (verdicts keyed by content, not by server IDs) can later be read from an editor extension.
5. **Sit beside the host, never replace it.** Reason 6 and every discontinuation complaint point the same way, and JetBrains' own reasons for closing both Upsource and Space are the argument: teams keep their existing systems.
6. **Let the same edit belong to more than one review.** Upsource refused because a revision would carry two statuses; verdicts per reader and per edit remove the conflict.

## Unverified

- Reddit discussion of Upsource and of its discontinuation could not be fetched; any view held mainly there is missing.
- JetBrains' YouTrack project for Upsource (issues such as UP-4188 on comments across rebase) no longer exists, so issue-tracker complaints and their outcomes are absent.
- Comments under the end-of-sales blog post were not visible in the fetched page.
- No first-hand user account of comment anchoring across revisions was found; the only claim is the vendor's "Upsource has sticky comments that survive code changes well." (leonya2, [HN](https://news.ycombinator.com/item?id=13021784)).
- Whether the post-2017.1 squash and rebase support fixed the force-push complaints in practice; no later first-hand account was found either way.
