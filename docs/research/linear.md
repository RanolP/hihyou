# Linear as a vertically integrated coding platform

Research date 2026-09-29. Scope: what Linear (linear.app) does across the issue-to-release chain, whether it reviews code itself, and how an issue's intention reaches the reviewer. Phabricator and stacked-diff tools are covered in `phabricator.md` and `stacked-diffs.md`. Every statement tagged **[fact]** carries its source link; **[inference]** is this document's own reasoning.

## Short answer

Linear now has its own code review UI. **[fact]** "Linear Diffs" launched 2026-05-28 on all plans as "a new way to review pull requests inside Linear" ([changelog](https://linear.app/changelog/2026-05-27-linear-diffs)), after an alpha "Pull Request reviews" inbox of 2025-01-23 ([changelog](https://linear.app/changelog/2025-01-23-pull-request-reviews)). Its AI "Guided Reviews" went GA on 2026-07-30 for Business and Enterprise ([changelog](https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile)). The git host is still GitHub: Diffs reads and writes a GitHub PR and syncs both ways ([docs](https://linear.app/docs/diffs)).

## 1. The chain and who owns each link

| Link | Owner | Evidence |
|---|---|---|
| Issue, project, initiative, customer signal | Linear | core product |
| Spec / context assembly | Linear | Linear Agent public beta 2026-03-24 "understands your roadmap, issues, and code" ([changelog](https://linear.app/changelog/2026-03-24-introducing-linear-agent)); Code Intelligence 2026-05-14 ([changelog](https://linear.app/changelog/2026-05-14-code-intelligence)) |
| Implementation by Linear's agent | Linear orchestrates, model vendor executes | Coding sessions 2026-06-11: Linear Agent "can now write code using Claude Code and Codex" in a managed sandbox ([changelog](https://linear.app/changelog/2026-06-11-coding-sessions), [docs](https://linear.app/docs/coding-sessions)); environments and browser testing 2026-08-20 ([changelog](https://linear.app/changelog/2026-08-20-coding-environments)); more controls 2026-09-24 ([changelog](https://linear.app/changelog)) |
| Implementation by third-party agents | Delegated | "Linear for Agents": agents are workspace members; Cursor, Codex, Devin, Factory and others listed ([agents](https://linear.app/agents)); deeplink to local coding tools with a prefilled prompt 2026-02-26 ([changelog](https://linear.app/changelog/2026-02-26-deeplink-to-ai-coding-tools)) |
| Implementation by humans | Delegated to the editor; Linear supplies the branch name | "Copy git branch name" ([docs](https://linear.app/docs/github)) |
| Branch, commits, PR storage | GitHub / GitLab | the PR lives on GitHub; Linear links it ([docs](https://linear.app/docs/github)) |
| Review UI | Linear (GitHub only), mirrored to GitHub | Diffs ([docs](https://linear.app/docs/diffs)); GitLab integration shows linked MRs and up to three reviewer avatars only ([docs](https://linear.app/docs/gitlab)) |
| CI checks | GitHub; Linear shows overall status | "doesn't currently sync or display rich check-run annotations" ([docs](https://linear.app/docs/diffs)) |
| Merge | GitHub; Linear moves issue status | magic words and PR state automations ([docs](https://linear.app/docs/github)) |
| Release / deploy | Linear tracks, CI executes | Releases 2026-04-30: pipelines, "Issue statuses automatically update when their associated code changes land in production", generated release notes ([changelog](https://linear.app/changelog/2026-04-30-releases), [docs](https://linear.app/docs/releases)) |

**[inference]** Linear owns every link except the one that stores code: repository, branch, merge and CI remain GitHub's. "Vertical integration" here means owning the context and the UI at each step while leaving the source of truth for code outside.

## 2. What the Diffs reviewer sees

All **[fact]** from the [Reviews docs](https://linear.app/docs/diffs) unless noted.

- A Reviews sidebar with "For me" and "Created" tabs, groupable by status, author or repository; review requests land in the Inbox. The launch post says the inbox is sorted by how close the work is to shipping ([changelog](https://linear.app/changelog/2026-05-27-linear-diffs)).
- PR details, changed files, checks and comments, kept "in sync with GitHub".
- Unified or Split view (Ctrl/⌘+B).
- **Structural highlighting**: "syntax-aware highlighting to better understand the structure of the code and highlight the specific parts of a line that changed"; the landing page says it strips "formatting-only edits" ([diffs](https://linear.app/diffs)).
- **File-type grouping** driven by `.gitattributes` categories such as `review-implementation`, `review-test` and `review-documentation`.
- **Commit-by-commit filter**: "selecting individual commits to filter on in the diff."
- Inline comment threads with replies and reactions, synced both ways; draft reviews started in GitHub do not sync, and some inline comments cannot be shown or created the same way.
- **Risk level** (Low / Typical / High / Very high) supplied by a connected tool.
- **Agent attribution**: a comment "made by an AI coding agent on behalf of a person" is marked (Claude Code, Codex, Linear, Pi, OpenCode).
- **Guided Reviews**: "related changes into structured sections with explanations of their purpose and impact"; "Guides surface the core parts of an implementation first while grouping supporting or lower-signal changes separately." It sits in a Guide tab beside the diff. The launch essay describes it as "chapters that follow the order the work was reasoned through", putting "the core of the change first, then walks you through the consequences" ([Now post, Tuomas Artman, 2026-05-28](https://linear.app/now/code-review-should-be-fast)). The GA note says the sections explain "what changed and why" ([changelog](https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile)).
- **Iterate with agents**: request a change from a diff line, and a background coding agent updates the PR with no local checkout ([changelog](https://linear.app/changelog/2026-05-27-linear-diffs)); on mobile, tapping a line adds it to the message to the agent ([changelog](https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile)).

How intention attaches: **[fact]** "Each Diff is attached to the issue and project that produced it" ([docs](https://linear.app/docs/diffs)); "Each diff is tied directly to the issue it resolves. No tab or tool switching required" ([diffs](https://linear.app/diffs)); the review "sits right beside the issue and the discussion that caused the change" ([Now post, Karri Saarinen, 2026-06-11](https://linear.app/now/coding-sessions-for-linear-agent)); the issue sidebar pins Diffs since 2026-07-23 ([changelog](https://linear.app/changelog)). The attachment is by location, meaning the diff lives on the issue page. **[unverified]** Whether the Guided Review generator reads the issue text, or only the diff, is not stated in any source found.

## 3. How intention flows to the reviewer

**[fact]** Linear-originated work carries its intention forward through several stores:

- **Prompt context.** An agent session receives `promptContext`, "a formatted string containing the session's relevant context, such as issue details, comments, and guidance" ([agent API](https://linear.app/developers/agent-interaction)). Coding sessions draw on "the original request, customer signal, product decisions, related work, and discussion" ([Now post](https://linear.app/now/coding-sessions-for-linear-agent)). The deeplink to local tools includes "description, comments, updates, linked references, and images" ([changelog](https://linear.app/changelog/2026-02-26-deeplink-to-ai-coding-tools)).
- **Agent activity log.** Each session records typed `AgentActivity` entries: `thought`, `elicitation`, `action` (tool, parameter, result), `response`, `error`. Sessions move through `pending`, `active`, `awaitingInput`, `error`, `complete` and `stale` ([agent API](https://linear.app/developers/agent-interaction)). The product promise is "Understand every change they make at a glance, or inspect the underlying reasoning" ([agents](https://linear.app/agents)).
- **Agent plan.** Each session has a checklist of steps (`pending`, `inProgress`, `completed`, `canceled`) that the agent replaces whole on each update ([agent API](https://linear.app/developers/agent-interaction)).
- **PR link.** The agent reports its PR through the session's `externalUrls` ([agent API](https://linear.app/developers/agent-interaction)); Linear's own coding session "drafts a PR and adds a diff to the issue" ([docs](https://linear.app/docs/coding-sessions)).
- **Verification.** Before-and-after browser screenshots are captured alongside the code change ([changelog](https://linear.app/changelog/2026-08-20-coding-environments)).
- **Human PRs.** Intention travels only through the issue key in the branch name, PR title or a magic word ("Fixes ENG-123") in the PR body or commit messages; one PR may close several issues and one issue may have several PRs ([docs](https://linear.app/docs/github)).

**[inference]** The reviewer reaches intention by navigation: the diff is shown on the issue page, and the plan and activity log sit in the same issue. No source shows the plan steps or the issue's acceptance criteria mapped onto individual hunks. Guided Reviews is the one feature that says *why* per section, and it is generated after the fact rather than carried over from the plan.

## 4. What vertical integration buys, and what an outside viewer can still read

Vertical integration buys the following. **[inference]** unless noted.

- **A guaranteed join.** An issue, its agent session and its PR are created in one system, so the link exists without relying on anyone typing an issue key.
- **Context the diff never sees.** Customer requests, project goals, comment threads and the agent's reasoning trace live in Linear's store. The launch essay sells exactly this: reviewers can judge whether the change "solves the problem the customer actually reported" ([Now post](https://linear.app/now/code-review-should-be-fast)) **[fact]**.
- **A closed loop.** A review comment goes straight to the agent that wrote the code, and the update appears inline ([changelog](https://linear.app/changelog/2026-05-27-linear-diffs)) **[fact]**.
- **Prioritisation.** Reviews are ranked against the rest of the roadmap.

What a platform-agnostic viewer can still get by reading sources:

- **[fact]** The issue↔PR join is exposed by the Attachments API. Attachments are keyed by URL, and `attachmentsForURL` returns "an attachment, and the associated issue, by its URL" ([attachments](https://linear.app/developers/attachments)). Starting from a PR URL, a viewer can fetch the issue, then its description, comments, project and the agent session's activities and plan through the GraphQL API.
- **[fact]** Without Linear at all, the same join is recoverable from the conventions Linear itself parses: the issue key in the branch name, the PR title and magic words in the PR body and commit messages ([docs](https://linear.app/docs/github)).
- **[inference]** Structural highlighting, commit filtering, file-type grouping from `.gitattributes` and "core first, glue later" ordering all work on the diff alone and need no platform.
- **[unverified]** Whether Diffs' Guided Review sections, risk scores or review threads are readable through the public API. No developer documentation for them was found.

## 5. Synthesis for hihyou

The problem in the user's words: "just seeing sequence of diffs without any intention makes user 피로." Linear's answer to it, ranked by how directly each idea addresses intention:

| Idea | Addresses intention | Source |
|---|---|---|
| Show the originating issue, project and discussion beside the diff | yes | [docs](https://linear.app/docs/diffs), [Now](https://linear.app/now/coding-sessions-for-linear-agent) |
| Guided Review chapters in reasoning order, each with a "why" | yes | [Now](https://linear.app/now/code-review-should-be-fast), [changelog](https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile) |
| Agent plan checklist and typed activity log (thought/action/response) kept on the issue | yes | [agent API](https://linear.app/developers/agent-interaction) |
| Core changes first, glue and supporting changes set apart | partly | [docs](https://linear.app/docs/diffs) |
| Structural highlighting that hides formatting-only edits | partly (removes noise, adds no why) | [diffs](https://linear.app/diffs) |
| File-type grouping via `.gitattributes` `review-*` | partly | [docs](https://linear.app/docs/diffs) |
| Commit-by-commit filtering | partly (commit message as local intention) | [docs](https://linear.app/docs/diffs) |
| Before/after screenshots from agent browser testing | partly (evidence of effect) | [changelog](https://linear.app/changelog/2026-08-20-coding-environments) |
| Review comment → agent edits the diff in place | no (iteration, not intention) | [changelog](https://linear.app/changelog/2026-05-27-linear-diffs) |
| Risk score, review inbox ranked by ship proximity | no | [docs](https://linear.app/docs/diffs) |

**[inference]** What a Diffset would need to carry to do the same platform-agnostically. Today a Diffset is `{base, head}`. To reproduce Linear's intention view, it would also carry an *intention record*, a list of sourced statements of why the change exists, each tagged with where it came from:

- `origin`: the issue or ticket (Linear, GitHub Issues, Jira and others): its title, description, acceptance criteria and URL, resolved from branch name, PR title and magic words by the same rules Linear uses, or from Linear's `attachmentsForURL`;
- `pr`: the PR or MR title and body;
- `commits`: per-commit messages, so commit filtering doubles as intention per slice;
- `plan`: an agent plan with steps and statuses and the activity log, when one exists (Linear agent session, or a plan file an agent left in the branch);
- `evidence`: optional artifacts such as screenshots and check status.

The viewer then needs one more structure: a *grouping of the diff into sections*, with each section linked to the intention entries it serves. That grouping is what Guided Reviews provides.

**[inference]** The remaining gap:

- Linear attaches intention to the diff *by page*, and Guided Reviews generate the "why" per section *after the fact*. Neither maps plan steps or acceptance criteria to specific hunks. Hunk-level linking is open ground for hihyou, and also the hardest part to source without an LLM.
- The richest intention (agent reasoning, customer signal) sits behind Linear's API and auth. A browser-only viewer needs a user token and CORS-permitted calls. Whether the Linear GraphQL API allows browser-origin requests with a personal key was not checked.
- For human PRs with no issue key and a thin PR body, even Linear has nothing to show. Intention there must come from commits or be inferred.
- Linear Diffs covers GitHub only. GitLab, local git ranges and non-GitHub stacks get no review UI from Linear. That gap is exactly where a platform-agnostic Diffset fits.
