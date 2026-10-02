# Reviewing Small Diffs Easily

## How to make review easy

We stand for reviewers, not code fabricators, especially in the age of AI.

It starts from one statement: make self-contained small commits with a clear intention.

Small commits lead to small reviews, and small reviews keep the work agile. Each review round only checks whether the feedback was applied; nobody reads the whole diff again.

We read the why, not the changed lines. That takes a tool, but a hosted review tool is too heavy for a small team. That is why hihyou exists.

Phabricator, Gerrit, Upsource, Graphite and others are great tools, but they are hard to bring into a team. hihyou is a small extension of a person, by a person, for a person.

## Navigating a Sequence of Diffs

A pull request, a commit, a commit range, a force push after a rebase: each is only a way to name a set of diffs.

- A commit is the diff against its parent.
- A commit range is the diffs of the commits inside it, or one diff from its base to its tip.
- A pull request is a commit range with a conversation around it.
- A force push with a rebase replaces the range: the same changes come back as new commits on a new base.

What we review is the diff, not the pull request and not the commit. hihyou calls that unit a Diffset.

So hihyou remembers every diff you have reviewed. We call it rereack, for reuse recorded acknowledgement. Git's rerere records a conflict resolution once and replays it; rereack records your acknowledgement of a diff once. When the same diff comes back in another commit, another pull request, or after a force push, you don't read it again.

## Progressively, from Nodes Smaller than Hunks or Commits

A whole file is hard to understand, and a commit or a hunk is still more than one thought. hihyou reviews by AST node: the unit you read, comment on and approve is a single node of the syntax tree, so you work through a change progressively, one node at a time.

## And Other Goods

- A keyboard-first interface in the style of Kakoune: select an AST node, then act on it. The mouse is a second-class citizen that still reaches every action, with the key shown beside it.
- Structured verdicts in the style of Gerrit's Code-Review scale, given per edit rather than per pull request.
- Auto-verification over MCP: hihyou asks your own agent to verify an edit.
