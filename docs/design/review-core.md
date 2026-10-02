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
  /** Same data -> same result, always. A host narrows `data` to its own type: its SerializedDiffsetId. */
  resolveDiffset(
    data: never,
  ):
    | { id: string; changes: ChangedFileRef[] }
    | Promise<{ id: string; changes: ChangedFileRef[] }>;
  readBlob(id: BlobId): Uint8Array | Promise<Uint8Array>;
  preferences?: HostPreferences;
  /** Type-only: the host's part of `Author`. Never read at runtime. */
  readonly authorType?: object;
}
type SerializedDiffsetId<H extends Host> = Parameters<H["resolveDiffset"]>[0];
type HostAuthor<H extends Host> = H extends { readonly authorType?: infer A }
  ? A extends object
    ? A
    : object
  : object;
type NodeId = number; // a syntechs Tree node handle

/** A formatter with the host's options already bound in. */
interface FormatModule {
  format(tree: Tree): Formatted; // syntechs/fmt
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
  // syntechs/highlight. Calls `paint` for each node with a TextMate scope (e.g. "keyword.control.js"),
  // an enclosing node before the nodes inside it; `from`/`to` narrow it to part of a node's text.
  highlight(tree: Tree, paint: (node: NodeId, scope: string, from?: number, to?: number) => void): void;
}
// No text argument: a syntechs Tree holds its source. The engine places each painted node through the
// Version's node offsets, so scopes land on formatted output too.

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
  /** The lines an `elided` fragment hid, `count` of them (absent: to the end of the file). */
  expand(path: string, lines: LinePair, count?: number): Promise<(CodeFragment & { kind: "unchanged" }) | undefined>;
}

/** Two iterations of one change. Matches before-vs-before AND after-vs-after; equal BlobIds skip matching. */
interface InterDiffset<H extends Host> {
  from: Diffset<H>;
  to: Diffset<H>;
  diff(): Promise<FileDiff[]>; // patch vs patch: only hunks the author changed between iterations
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
  /** The file was added or deleted: the file is the change; see "Whole units". */
  status?: "added" | "deleted";
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
  /** The lines of this side that are one half of a move, each pointing at the other half, possibly in another file. */
  moves?: SideMove[];
  /** The edit atoms on this side and their ancestors, for marking single node edits viewed. */
  nodes?: NodeOutline[];
}
interface SideMove {
  first: number; // 1-based, inclusive
  last: number;
  counterpart: { path: string; at: AstSteps[] };
}
interface NodeOutline {
  steps: AstSteps;
  parent: number; // index into the same Side.nodes; -1 = a top node of this side
  kind: string;
  start: { line: number; column: number }; // line 0 = Side.startLine; column in UTF-16 units
  end: { line: number; column: number }; // exclusive
  changed: boolean; // the node is itself an edit atom, not an ancestor kept for structure
  hash: string; // of the node's tokens, whitespace between them ignored
  atom?: string; // iff changed: the atomKey, identical on both halves of an update or a move
  whole?: "added" | "deleted"; // added or deleted as one unit (a declaration, or a top node of an added/deleted file)
  label?: string; // with whole, on a declaration: what it declares, as a begin label reads ("function f")
}
function atomKey(parts: { path: string; ancestors: string[]; before?: string; after?: string }): string;
interface Span {
  text: string;
  scope?: string; // syntax colour: a TextMate scope stack, outermost first, space-separated
  changed?: boolean; // diff emphasis, kept separate from syntax colour
}
/** 1-based line where the fragment's run starts, on each side. */
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
/** 1-based lines of the blob's own (unformatted) text, both ends inclusive. */
interface LineRange {
  start: number;
  end: number;
}
/** Engine object from diffset.anchor(data). */
interface Anchor extends AnchorData {
  intoLineRanges(): Promise<LineRange[]>; // disjoint nodes give several ranges
}

interface ReviewThreads<H extends Host> {
  diffsetId: string; // joins Diffset.id, 1:1
  grammars: Record<string, string>; // language name -> Grammar.id used while reviewing
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

### How the engine pinned the names the first draft left open

- `SerializedDiffsetId<H>` is the parameter type of the host's own `resolveDiffset`. The contract declares `resolveDiffset(data: never)`, so any narrower parameter satisfies it, and the host's choice (a commit range, a PR number) becomes its `SerializedDiffsetId`.
- `HostAuthor<H>` is read off an optional, type-only `Host.authorType` field; a host that declares none gets `object`.
- `LineRange` is 1-based and inclusive at both ends, on the blob's own text rather than the formatted display text, so an editor can jump to it.
- `NodeId` is `number`, a syntechs `Tree` node handle.
- `FormatModule` is `{ format(tree): Formatted }`, the syntechs formatter with the host's options bound in. Matching and `AstSteps` always run on the original tree; `Formatted.anchors` only carries node ranges onto the display text.
- `ReviewThreads.grammars` maps a language name to the `Grammar.id` a thread's `AstSteps` were taken under. `Grammar.id` is `<language>@<hash>`, where the hash covers the decoded parse tables, since a grammar carries no version of its own and the tables decide the tree shape.

`Language`, `Tree` and `Formatted` are existing syntechs types (`packages/syntechs/src/core/index.ts`, `packages/syntechs/src/fmt/format.ts`).

## Why each type is shaped this way

**`Host`** is the execution environment itself, described by what it can do: resolve a change set, read a blob, find a grammar, state a cache budget. It has no `kind` name, so the engine never branches per host. `resolveDiffset` and `readBlob` may answer synchronously or with a Promise, so a host that already holds the bytes need not wrap them.

**`resolveDiffset` must be deterministic.** Same data, same `id` and same `changes`, always. The engine's cache relies on that.

**`BlobId`** is host-issued and content-addressed (a git blob SHA is the model), so equal ids mean equal bytes. That lets the engine cache blobs and trees by id, and lets `InterDiffset` skip matching for a file whose blob did not change between iterations.

**`Grammar`** bundles what one language offers: the syntechs parser `Language`, and optionally a formatter and a highlighter. A missing grammar sends the file to the line-diff fallback (`FileDiff.grammar` absent).

**`HighlightModule.highlight`** answers in TextMate scopes, so shiki and VS Code themes apply directly. It walks the whole tree in one call and paints, rather than answering one node at a time, because the right scope depends on context a single node does not carry (a `:` is an operator in a ternary and punctuation in an object; an identifier is a function name when its value is an arrow function), and because one pass is what keeps highlighting several times cheaper than a TextMate tokenizer. Paints nest: an inner scope stacks onto the scopes enclosing it, as TextMate's scope stack does, so a theme rule for `string` still colours the punctuation inside a template substitution. `from`/`to` let a module scope part of a leaf the tree does not split, such as a JSDoc tag inside a comment or a quantifier inside a regex. The naming lives inside the module, not in the engine or the host; syntechs checks it against shiki's colours (`packages/syntechs/src/highlight/parity.node.ts`). It takes no text because a syntechs `Tree` holds its source. The engine places each painted node through the `Version`'s node offsets, so scopes land on formatted output too; `syntechs/highlight`'s `compileTheme` resolves a scope stack to a colour as vscode-textmate does.

**`Engine.diffset`** computes the whole Diffset at once. There is no lazy per-file query (the maintainer: "지연조회하지 말자", let's not query lazily), so cross-file moves come out of one deterministic computation rather than depending on which files a viewer opened first.

**`Diffset`** is an engine object that captures the engine; it is never serialized. A review attaches to it one to one: a `ReviewThreads` joins a `Diffset` on `Diffset.id`. The id is host-issued, opaque, and unique within one host only.

**`InterDiffset`** is two iterations of one change. It matches before against before and after against after, so "base moved" and "patch changed" stay apart (pillar 3 of `docs/design/product.md`). `diff()` compares the two iterations' patches, as `git range-diff` does, so a rebase onto a moved base does not show upstream changes as the author's edits; `port()` moves threads onto the new iteration through the syntechs diff matcher. A thread with no match goes to `lost`, which the front end shows; it is never dropped silently.

**`InterDiffset.diff()`** needs no file at a base. For a file both iterations list, it pairs the diff fragments of each iteration's own diff (before to after) by their removed and added text, ignoring line numbers and context. A pair is one authored change the rebase only moved, and drops out. What remains is the diff of A1 (iteration 1's after) against A2, in which a `diff` fragment stays only when it touches an unpaired fragment: its A1 lines touch one from iteration 1, or its A2 lines one from iteration 2. Every other `diff` fragment, and any `unchanged` context no longer beside a kept one, becomes `elided`; `begin`/`end` stay as they are, so they still balance. A file with no kept `diff` fragment is left out. Where upstream edited the lines the author changed, the fragments differ and are shown, which is the conflict resolution a reviewer should see. A file only iteration 1 lists shows A1 against B1 (the author dropped that change), and one only iteration 2 lists shows B2 against A2.

**`Diffset.expand`** returns the lines an `elided` fragment hid as the `unchanged` fragment `diff()` would have shown in its place: the same display text (formatted when the file was), the same `Span.scope`s, and `at` filled. A host therefore never reads a blob to fill an elided run, and revealed lines are coloured like every other line. It reads the after side's blob, tree and formatted text from the cache `diff()` filled, so it reparses only what the cache has since dropped.

**`FileDiff.fragments`** is the single source of truth for a file's diff; there is no separate edit list. `begin`/`end` pairs are always balanced and carry a label (such as "class AA"), so every front end gets AST-node grouping and headers from the same data. `elided` is the engine's call on what to collapse, so every front end collapses the same things.

**`FileDiff.collapsed`** is the engine's judgment that the whole file should be shown folded, with the reason; the renderer shows one line in place of the body and may still expand it. `fragments` stays complete for every reason except `binary` and `submodule`, whose `fragments` is empty: the engine never parses them. A host that knows a file is binary or a submodule says so in `ChangedFileRef.kind`, and the engine then does not call `readBlob` for it (a submodule's id names a commit of another repository, not a blob). A host that does not know leaves `kind` absent; the engine then reads the blob and treats it as `binary` when it holds a NUL byte in its first 8000 bytes or is not valid UTF-8.

**`Side.moves`** names the lines that are one half of a move, possibly in another file, per moved node: an expression inlined into a call marks only the expression's lines, and the call around it stays an ordinary edit. When the moved nodes cover every line of the side except blank and bracket-only lines, the side carries one move over all its lines, so a relocated block reads as one moved box. A move whose two halves land in the same `diff` fragment (a ternary's branches swapped, an argument re-wrapped in place) is dropped, because the reader already sees both halves side by side.

**`Side.nodes`** outlines a side finer than a hunk, so a viewer can mark one node edit viewed while the rest of the hunk stays unread. The changed nodes are the edit atoms: a changed leaf of an update, a moved node, and each named leaf of an inserted or deleted subtree (the edit script reports an insertion at its outermost node, which would otherwise be one all-or-nothing atom). The outline adds every ancestor of an atom up to the outermost nodes wholly inside the side, as `changed: false` structure, in document order with parents before children.

**Whole units** (`FileDiff.status`, `NodeOutline.whole`): when a file is added or deleted, or an inserted or deleted node is a whole declaration, the unit itself is the change, so the engine says so instead of emphasizing it piece by piece (the maintainer: "파일 단위로 추가된 경우 개별 하이라이트를 하지 않고 파일이 추가되었다고 하기", when a whole file is added, say the file was added rather than highlighting each piece; and the same "declaration 단위로도", at the declaration level). A whole declaration is a node of one of its grammar's declaration kinds, a predefined set of tree-sitter node kinds registered per language beside the grammar (`Grammar.declarations`; for TypeScript, for example, functions, classes, methods, interfaces, type aliases, enums, namespaces and `const`/`let`/`var` declarations), reached through wrappers holding nothing else (`export`) and filling its lines but for a trailing `;` or `,` (the maintainer: "선언을 predefined node name set으로", declarations as a predefined set of node names). A `name` field alone does not make one, so an added JSX element or import name, an added argument, a statement inside a kept function, or a declaration sharing its line with other code keeps today's emphasis; a language with no set has whole files only. The label is still what `begin` would read, or the name of a declaration's single binding. A whole unit's lines are changed but carry no `Span.changed`; syntax scopes stay. Its top node is in the outline with `whole` (and `label` for a declaration); for an added or deleted file that is every top node of the side. Viewed and review granularity do not change (the maintainer: "marks as read, review 같은 건 부분적으로 진행할 수 있어야 함", marking read and reviewing must still work part by part): the atoms inside a whole unit stay its named leaves, so a reviewer can mark part of a new file viewed and anchor a comment on any node in it. A whole unit's viewed state is derived like any `changed: false` outline node, viewed once every atom below it is, and toggling it writes all of them; it has no atom of its own. Code that moved into an added file, or out of a deleted one, is not part of the unit: it keeps its `Side.moves` and the atom it shares with the other half, and edits found inside a moved node keep their emphasis.

**`NodeOutline.atom`** is the key a "viewed" mark is filed under. `atomKey` hashes the file path, the labels of the atom's ancestors (each kind, with the declared name where the node declares one), the before node's hash and the after node's hash; an insertion has no before hash and a deletion no after hash. It holds no line number and no `AstSteps`, so an edit keeps its key when code above it grows or shrinks, and a reformat leaves it alone because node hashes skip whitespace. The engine computes one key per edit where it pairs the halves, so both halves of an update or a move carry the identical string: the ancestors are taken from the before side, and a move between files uses `<before path>→<after path>` as its path on both. Two identical edits under the same ancestors share a key, which is accepted: marking one viewed marks the other.

**`Span`** keeps syntax colour (`scope`) and diff emphasis (`changed`) as separate fields, so a renderer can draw both. A one-line node whose words are all changed, keeping only joiners such as `.`, `,`, brackets or `?.`, is emphasized whole when it holds two or more changed words, so `basicColor.DARKGRAY400` becoming `themedColor.foreground3` reads as one removed run and one added run rather than interleaving around the kept `.`. A node keeping any word or literal (`theme.colors.a` becoming `theme.colors.b`) keeps its token-level emphasis.

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

## In the shared renderer: cross-file moves and "viewed"

`@hihyou/ui` draws `Side.moves` for both front ends, and adds two things the engine contract does not carry.

**A cross-file move expands in place.** The source file reads the block as code moved away and the target file as code moved in, each under a "Moved to/from `<path>:<line>`" label. The label is a button with `aria-expanded`: Enter, Space or a click on it or on the block expands the pair under the block, and the same control or Escape folds it. Split puts the source half on the left and the target half on the right, line by line; unified shows the inner diff, the two halves merged as `mergeLines` merges a reflow, or one half's lines after the other's when they share no unchanged text. The other half's text comes from the other file's already-loaded `FileDiff` (`movePair` in `moves.ts`); when its half is not found, the expansion shows the half it has and a button opening the other file. A move within one file keeps its jump-and-flash label.

**"Viewed" marks move pairs and files** (stage 1 of the plan recorded on 2026-10-01). Both halves of a move share one subject, so expanding the pair in either file marks it viewed in both, and a "Viewed" toggle on each label and each file header sets or clears the mark from the keyboard. Viewed code is dimmed. Ordinary hunks get no mark of their own: the file toggle covers them, and a per-hunk key would have no identity that survives a new iteration. A file's subject includes its blob ids, so a new revision of the file reads as unviewed again, as on GitHub; a move's subject includes its halves' lines and text.

Every key goes through one `KeyOf` function (`plainKeyOf` today; stage 2 swaps in an HMAC so a gist never holds a path). The state is a last-writer-wins element set: each key holds `{ viewed, ts, device }`, a merge keeps the larger `ts` per key with `device` as the tiebreak, and un-viewing writes `viewed: false`. `ts` comes from a hybrid logical clock that moves past every timestamp it merges in, so a device whose wall clock runs behind still writes after an entry it has seen. The `ViewedStore` interface (`get`, `set`, `subscribe`, `merge`, `state`) has one in-session implementation, which keeps the state for as long as the open review's view lives. A `KeyOf` is synchronous, so the stage 2 HMAC needs a synchronous SHA-256 (WebCrypto's `sign` is async) or keys computed ahead of the draw.

## Open questions

All undecided; recorded here, not decided.

1. **`ReviewComment` body and timestamp.** Neither field is specified yet.
2. **Id formats.** The format of `Diffset.id` and of `BlobId` is undecided beyond "opaque, same content gives the same id".
3. **Sending drafts to a forge.** Publishing a draft as a GitHub review comment would need line numbers (through `intoLineRanges`) and multi-author sync. Not designed.
4. **Where verdicts live.** Options: local per user, a file committed to the repo, or synced through the forge. Recommendation: local per user first, since it is the only option that asks nothing of the team, per "Require no workflow change" (`docs/research/gerrit-experience.md`, item 9 of its implications; `docs/research/phabricator-experience.md` makes the same point as item 8). A committed file needs the team to agree on a new file; forge sync needs item 3.
5. **Standalone shell: Tauri or Electron.** Undecided. The engine needs only a `Host`, so the choice changes no engine code.
6. **Whether to recreate `docs/roadmap.md`.** `docs/research/gerrit.md` cites it as the source of the rerere-like idea, but the file exists on no branch. Pillar 3 of `docs/design/product.md` already states the idea.
7. **Resolved: syntax highlighting.** syntechs ships a hand-written `HighlightModule` per grammar (TypeScript, TSX and JavaScript so far) rather than tree-sitter queries, and `HighlightModule` became the whole-tree `highlight(tree, paint)` described above.
8. **If a large PR visibly stalls the UI.** Add `Host.yield`; invariant 4 leaves room for it.
9. **`Verdict.rubric`'s axis set.** `RequestAxis` and `design` are only `hihyou-taste@1`; what a later version adds or changes is undecided.
10. **`claims.owner`.** Kept in the shape but not yet discussed: what it means for a reviewer to claim ownership, and how it affects anything downstream.
11. **Per-edit verdict carry across iterations.** `docs/design/product.md`'s `(anchor, before hash, after hash)` idea for surviving a rerere-like carry is not yet mapped onto this `Verdict`/`ReviewComment` shape.
12. **Groups and risk are out of scope.** The previous engine grouped edits across files and scored each file's risk; this contract carries neither, and whether either comes back, and in what shape, is undecided.
