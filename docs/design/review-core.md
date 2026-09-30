# Review core: one engine under three front ends

Design date 2026-09-30. Status: contract agreed with the maintainer type by type; nothing here is implemented. The product goals are in `docs/design/product.md` and the hard runtime constraints in `docs/design/runtime.md`; this document builds on both and does not restate them.

## What the engine is for

hihyou plans three front ends next to today's CLI: a standalone app, a web extension that takes over a forge's PR page, and a VS Code extension. `docs/design/product.md` already puts every capability in form-agnostic core packages so each shell stays thin. The review engine is that shared core for reviewing: given a way to name a set of changes, it computes the diff every front end shows, and it computes where review threads sit on that diff and on the next iteration of it. Each front end supplies an environment (how to resolve a change set, read a file's bytes, find a grammar, persist threads) and draws pixels; everything that decides what a reviewer sees, or where a thread lands on a new version, lives in the engine once.

## Givens

- **syntechs.** The engine parses, diffs and formats only through syntechs (`syntechs/core`, `syntechs/diff`, `syntechs/fmt`), per `docs/design/runtime.md`.
- **No wasm.** Also from `docs/design/runtime.md`: the parser runtime is a pure-TypeScript port.
- **No worker.** The engine runs in the host's own thread. This follows from the previous given rather than from taste: in the maintainer's words, "워커에서 안 돌리려고 쌩고생하면서 wasm을 다 없앤 거잖아" (we went through all that trouble removing wasm precisely so it would not have to run in a worker). Nothing crosses a worker boundary, so nothing is serialized except the two stored values named below.

The current engine's `Vcs`, `FileSource`, `ReviewDoc` and `buildReviewDoc`, and present's `FileView`, are discarded. The contract is a clean slate over syntechs.

## The contract

```ts
/** The execution environment. CLI, VS Code, browser extension each implement one. */
interface Host {
  grammars: GrammarLoader;
  /** Same data -> same result, always. */
  resolveDiffset(
    data: SerializedDiffsetId<this>,
  ):
    | { id: string; changes: ChangedFileRef[] }
    | Promise<{ id: string; changes: ChangedFileRef[] }>;
  readBlob(id: BlobId): Uint8Array | Promise<Uint8Array>;
  preferences?: HostPreferences;
}
interface HostPreferences {
  cacheBytes?: number;
} // LRU cap; engine default when absent

interface GrammarLoader {
  forPath(path: string): Promise<Grammar | undefined>;
}
interface Grammar {
  id: string;
  language: Language; // syntechs/core
  format?: FormatModule;
  highlight?: HighlightModule;
}
interface HighlightModule {
  /** TextMate scope for one node (e.g. "keyword.control.ts"), undefined for none. Renamer lives inside. */
  scopeOf(tree: Tree, node: NodeId): string | undefined;
}
// No text argument: a syntechs Tree holds its source. The engine carries scopes onto formatted output
// through syntechs `Formatted.anchors` (FormatModule-aware).

/** Host-issued opaque string; same content -> same id (e.g. git blob SHA). */
type BlobId = string;
interface ChangedFileRef {
  path: string;
  oldPath?: string;
  before: BlobId | null; // null = added
  after: BlobId | null; // null = deleted
  /** Content the engine must not read or parse; set by the host when it knows. */
  kind?: "binary" | "submodule";
}

function createEngine<H extends Host>(host: H): Engine<H>;
interface Engine<H extends Host> {
  diffset(data: SerializedDiffsetId<H>): Promise<Diffset<H>>;
}

/** Engine object; captures the engine. Not serialized. */
interface Diffset<H extends Host> {
  /** Host-issued opaque key, format undecided. Same data -> same id. Unique within one host only. */
  id: string;
  changes: ChangedFileRef[];
  diff(): Promise<FileDiff[]>;
  interdiff(to: Diffset<H>): InterDiffset<H>;
  anchor(data: AnchorData): Anchor;
}

/** Two iterations of one change. Matches before-vs-before AND after-vs-after; equal BlobIds skip matching. */
interface InterDiffset<H extends Host> {
  from: Diffset<H>;
  to: Diffset<H>;
  diff(): Promise<FileDiff[]>; // after vs after
  port(threads: ReviewThreads<H>): Promise<PortResult<H>>; // via syntechs diff matcher
}
interface PortResult<H extends Host> {
  ported: ReviewThreads<H>;
  lost: ReviewThread<H>[]; // no match found; shown to the user, never dropped
}

// ---- output ----
interface FileDiff {
  path: string;
  grammar?: string; // absent -> line-diff fallback
  fragments: CodeFragment[]; // SSoT; no separate Edit[]; begin/end always balanced
  /** The engine judges the whole file should be shown folded, and says why. */
  collapsed?: {
    reason:
      | "generated"
      | "lockfile"
      | "binary"
      | "submodule"
      | "too-large"
      | "parse-error"
      | "format-only"
      | "moved";
  };
}
type CodeFragment =
  | { kind: "begin"; label: string; at: AstSteps } // label e.g. "class AA"
  | { kind: "end"; label: string }
  | { kind: "unchanged"; spans: Span[]; at: AstSteps[]; lines: LinePair }
  | { kind: "diff"; before: Side; after: Side } // one side empty = added / deleted
  | { kind: "elided"; lines: LinePair }; // engine decides what to collapse
interface Side {
  spans: Span[];
  at: AstSteps[];
  startLine: number;
  /** This change is one half of a move; points at the other half, possibly in another file. */
  move?: { counterpart: { path: string; at: AstSteps[] } };
}
interface Span {
  text: string;
  scope?: string; // syntax colour, TextMate scope
  changed?: boolean; // diff emphasis, kept separate from syntax colour
}
interface LinePair {
  before: number;
  after: number;
}

// ---- review (stored by the host) ----
/** From the file root, indices over NAMED children only. Named AstSteps by the user. */
type AstSteps = number[];
interface AnchorData {
  side: "before" | "after";
  path: string;
  nodes: AstSteps[]; // non-empty; normalized: document order, descendants of an included ancestor dropped
}
/** Engine object from diffset.anchor(data). */
interface Anchor extends AnchorData {
  intoLineRanges(): Promise<LineRange[]>; // disjoint nodes give several ranges
}

interface ReviewThreads<H extends Host> {
  diffsetId: string; // joins Diffset.id, 1:1
  grammars: Record<string, string>; // grammar id -> version used while reviewing
  ran: Author<H>[]; // who ran/tested this whole Diffset (Gerrit's "Verified")
  threads: ReviewThread<H>[];
}
interface ReviewThread<H extends Host> {
  id: string;
  anchor: AnchorData;
  comments: ReviewComment<H>[]; // oldest first
}
interface ReviewComment<H extends Host> {
  author: Author<H>;
  draft: boolean; // publishing flips draft -> false
  verdict?: Verdict; // verdict lives on the anchored comment only
  // body: still unspecified, but a comment may have no body
}
type RequestAxis = "necessity" | "clarity" | "consistency";
interface Verdict {
  rubric: string; // id@version of the axis set, e.g. "hihyou-taste@1"
  claims: { read?: true; owner?: true };
  requests: RequestAxis[]; // axis present = -1 (change requested on that axis)
  design?: -2 | -1 | 0 | 1 | 2; // optional axis
}
/** Host-defined opaque type (room for display name, avatar). The only constraint: an id. */
type Author<H extends Host> = { id: string } & HostAuthor<H>;
```

### Names the contract uses but does not define

Five names above have no definition yet. What each is meant to be, as far as it was agreed:

- `SerializedDiffsetId<H>`: the host's own serialized way of naming a change set (a commit, a range, a PR), which only that host reads back, in `resolveDiffset`. It is one of the two things that are ever serialized. Its shape per host, and how `H` determines it, are undecided.
- `HostAuthor<H>`: the host-specific part of `Author`, with room for a display name or an avatar. Its shape per host, and how `H` determines it, are undecided.
- `LineRange`: the line span one group of anchored nodes covers, returned by `Anchor.intoLineRanges`. Its fields (inclusive or exclusive end, 0- or 1-based) are undecided.
- `NodeId`: one node of a syntechs `Tree`. syntechs exports no type by that name; its `Tree` (`packages/syntechs/src/core/arena.ts`) identifies a node by a plain number, which is presumably what `NodeId` names. Not confirmed.
- `FormatModule`: the per-language formatter that syntechs provides. syntechs exports nothing under that name, and its exact type is not yet pinned.

`Language`, `Tree` and `Formatted` are existing syntechs types (`packages/syntechs/src/core/index.ts`, `packages/syntechs/src/fmt/format.ts`).

## Why each type is shaped this way

**`Host`** is the execution environment itself, described by what it can do: resolve a change set, read a blob, find a grammar, state a cache budget. It has no `kind` name, so the engine never branches per host. `resolveDiffset` and `readBlob` may answer synchronously or with a Promise, so a host that already holds the bytes need not wrap them.

**`resolveDiffset` must be deterministic.** Same data, same `id` and same `changes`, always. The engine's cache relies on that.

**`BlobId`** is host-issued and content-addressed (a git blob SHA is the model), so equal ids mean equal bytes. That lets the engine cache blobs and trees by id, and lets `InterDiffset` skip matching for a file whose blob did not change between iterations.

**`Grammar`** bundles what one language offers: the syntechs parser `Language`, and optionally a formatter and a highlighter. A missing grammar sends the file to the line-diff fallback (`FileDiff.grammar` absent).

**`HighlightModule.scopeOf`** answers in TextMate scopes, so shiki and VS Code themes apply directly. The renaming from tree-sitter capture names to TextMate scopes lives inside the module, not in the engine or the host. It takes no text because a syntechs `Tree` holds its source. The engine carries scopes onto formatted output through syntechs `Formatted.anchors`.

**`Engine.diffset`** computes the whole Diffset at once. There is no lazy per-file query (the maintainer: "지연조회하지 말자", let's not query lazily), so cross-file moves come out of one deterministic computation rather than depending on which files a viewer opened first.

**`Diffset`** is an engine object that captures the engine; it is never serialized. A review attaches to it one to one: a `ReviewThreads` joins a `Diffset` on `Diffset.id`. The id is host-issued, opaque, and unique within one host only.

**`InterDiffset`** is two iterations of one change. It matches before against before and after against after, so "base moved" and "patch changed" stay apart (pillar 3 of `docs/design/product.md`). `diff()` shows after against after; `port()` moves threads onto the new iteration through the syntechs diff matcher. A thread with no match goes to `lost`, which the front end shows; it is never dropped silently.

**`FileDiff.fragments`** is the single source of truth for a file's diff; there is no separate edit list. `begin`/`end` pairs are always balanced and carry a label (such as "class AA"), so every front end gets AST-node grouping and headers from the same data. `elided` is the engine's call on what to collapse, so every front end collapses the same things.

**`FileDiff.collapsed`** is the engine's judgment that the whole file should be shown folded, with the reason; the renderer shows one line in place of the body and may still expand it. `fragments` stays complete for every reason except `binary` and `submodule`, whose `fragments` is empty: the engine never parses them. A host that knows a file is binary or a submodule says so in `ChangedFileRef.kind`, and the engine then does not call `readBlob` for it (a submodule's id names a commit of another repository, not a blob). A host that does not know leaves `kind` absent; the engine then reads the blob and treats it as `binary` when it holds a NUL byte in its first 8000 bytes or is not valid UTF-8.

**`Side`** carries a `move` counterpart when a change is one half of a move, possibly in another file.

**`Span`** keeps syntax colour (`scope`) and diff emphasis (`changed`) as separate fields, so a renderer can draw both.

**`AstSteps`** (named by the maintainer) is a path from the file root, indexing named children only. It is the single source of truth for where a thread sits. Line ranges are derived from it deterministically (`Anchor.intoLineRanges`) and never stored.

**`AnchorData`** is the stored half of an anchor: a side, a path, and a normalized, non-empty set of node paths. `Anchor` is the engine object built from it by `diffset.anchor(data)`. Several disjoint nodes give several line ranges.

**`ReviewThreads.grammars`** records the grammar version used while reviewing. A parser change can shift `AstSteps`; storing the version lets the engine detect that and warn on a mismatch.

**`ReviewThreads.ran`** is Gerrit's Code-Review/Verified split (`docs/research/gerrit.md`) applied to this contract: what was done (ran, read, own) is a claim about the reviewer's own activity, kept apart from what was concluded (a `Verdict`, a taste judgment). Running or testing a Diffset is a fact about the whole change, not about one code span, so it sits on `ReviewThreads` rather than on a comment.

**`ReviewComment.draft`** marks an unpublished comment; publishing flips it to `false`.

**`ReviewComment.verdict`** is per-axis so a review can later serve as training data for a reviewer's taste: a model needs "this code span -> this judgment", which is exactly what an anchored comment gives it that a Diffset-wide field cannot.

**`Verdict`** separates claims about activity (`claims.read`, `claims.owner`) from judgments about the code (`requests`, `design`), following the same Code-Review/Verified split as `ran`. `rubric` versions the axis set as `id@version` (e.g. `hihyou-taste@1`) so the set of axes can grow without breaking stored verdicts. `requests` lists only the axes on which a change was requested; a listed axis reads as -1, and every unlisted axis among `RequestAxis` is +1 by derivation, never stored, so no verdict pays for approvals nobody voiced. That default +1 applies only where a comment carrying `claims.read` covers the node, so code nobody read is never silently counted as approved. `design` is optional and scored on a -2..2 scale because, unlike the request axes, it is not a binary approve/request-change signal. `correctness` is deliberately not an axis: runtime correctness is what `ran` already covers, correctness is not taste, and a bug a reviewer finds is an ordinary comment, not a verdict.

**A body-less comment** carrying only `claims.read` with empty `requests` is allowed, and is the +1 record itself ("read, fine"). A front end should render it as a check mark, not open it as a thread.

**`Author`** is host-defined and opaque except for an `id`.

## Rules and invariants

1. **No worker.** The engine runs in the host's thread. Removing wasm was done so that it could.
2. **Serialize as little as possible.** Only `SerializedDiffsetId` and `ReviewThreads` (which holds `AnchorData`) are ever serialized. The host owns serializing, deserializing and persisting `ReviewThreads`; the engine only computes on values passed in. `Diffset`, `InterDiffset`, `Anchor` and `FileDiff` are in-memory values.
3. **The engine owns all caching**, so hosts do not each re-implement it. It is one LRU sized by `host.preferences.cacheBytes` (an engine default when absent), re-read on every insert and evicted down to it. Keys: `resolveDiffset` by its serialized data, `readBlob` by `BlobId`, a parsed tree by (`BlobId`, grammar id), a `FileDiff` by `Diffset.id`. Losing the cache costs only time.
4. **Room for concurrent parsing later.** Every engine method returns a Promise, and one blob's parse shares no mutable state with another's. Nothing parses concurrently today; the rule keeps that option open without a contract change.
5. **No `Host.yield`, no `onProgress`**, until a measurement shows a large PR stalling the UI. `checker.ts` (53,016 lines) is a benchmark worst case, not a review case.
6. **Module hygiene.** No runtime `eval`, no import side effects, no top-level `await`. Module-level state exists only as a cache whose loss costs time.
7. **Line ranges are derived, never stored.** The anchor's `AstSteps` is the single source of truth for a thread's location.
8. **A lost thread is shown, never dropped.**

## Open questions

All undecided; recorded here, not decided.

1. **`ReviewComment` body and timestamp.** Neither field is specified yet.
2. **Id formats.** The format of `Diffset.id` and of `BlobId` is undecided beyond "opaque, same content gives the same id".
3. **Sending drafts to a forge.** Publishing a draft as a GitHub review comment would need line numbers (through `intoLineRanges`) and multi-author sync. Not designed.
4. **Where verdicts live.** Options: local per user, a file committed to the repo, or synced through the forge. Recommendation: local per user first, since it is the only option that asks nothing of the team, per "Require no workflow change" (`docs/research/gerrit-experience.md`, item 9 of its implications; `docs/research/phabricator-experience.md` makes the same point as item 8). A committed file needs the team to agree on a new file; forge sync needs item 3.
5. **Standalone shell: Tauri or Electron.** Undecided. The engine needs only a `Host`, so the choice changes no engine code.
6. **Whether to recreate `docs/roadmap.md`.** `docs/research/gerrit.md` cites it as the source of the rerere-like idea, but the file exists on no branch. Pillar 3 of `docs/design/product.md` already states the idea.
7. **Syntax highlighting does not exist yet.** `HighlightModule` has nothing to wrap today: there is no `highlights.scm` under any `packages/syntechs/src/grammars/*` directory; present's `Highlight` (`packages/present/src/view.ts`) carries only a diff kind, not a syntax scope; and whether syntechs can run tree-sitter queries at all is unverified.
8. **If a large PR visibly stalls the UI.** Add `Host.yield`; invariant 4 leaves room for it.
9. **`Verdict.rubric`'s axis set.** `RequestAxis` and `design` are only `hihyou-taste@1`; what a later version adds or changes is undecided.
10. **`claims.owner`.** Kept in the shape but not yet discussed: what it means for a reviewer to claim ownership, and how it affects anything downstream.
11. **Per-edit verdict carry across iterations.** `docs/design/product.md`'s `(anchor, before hash, after hash)` idea for surviving a rerere-like carry is not yet mapped onto this `Verdict`/`ReviewComment` shape.
12. **Groups and risk are out of scope.** The previous engine grouped edits across files and scored each file's risk; this contract carries neither, and whether either comes back, and in what shape, is undecided.
