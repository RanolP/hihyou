# Tree arena: replacing per-node `SyntaxNode` objects with one typed-array buffer

## Recommendation

- **Build the visible tree into one growable `Uint32Array`, appending records in postorder, and use the wide layout.** A token is `[head, start, end, parent, ord]` and an inner node is `[head, start, end, parent, ord, count, c1..cn]`, with every inner position stored. On the two large inputs this cuts retained memory from 154–172 to 29 B/node. A forced full GC with the tree alive drops from 50–291 ms to about 0. The preorder walk runs 2.5–5x faster, and the build itself runs 20–25% faster.
- **The contract is functions over an opaque number handle, and the handle is the record's word offset.** Readers call `kind(n)`, `child(n, i)`, `text(n)`, `lf(n)` and so on, through a tree object. Because a handle is a number, it keeps working as a `Map` key, a `Set` member and a `Token.node`, which is how the formatter uses node identity today.
- **The formatter receives the tree and nothing else, and positions are not part of its API.** It gets token text from `text(n)` and line breaks from `lf(n)`: the newlines before the node's first leaf, clamped to 0–3 and packed into the head word at build time. `start` and `end` stay in the record, but only the tree's own `text`, the diff and the review UI read them.
- **Derived data lives in columns owned by the consumer that needs it, indexed by the dense ordinal.** A column is a typed array such as `size`, `height` or `isoId`. The record carries its ordinal and the tree carries `ords` (ordinal → handle). Postorder keeps each subtree a contiguous ordinal range, `[ord - size + 1, ord]`, which the diff's dice and `linkSubtree` loops depend on.
- **`Uint32Array` is the one buffer type, and every stored value keeps bits 30 and 31 clear.** Unsigned costs nothing while values stay below 2^31. The one measured penalty is boxing: a value ≥ 2^31 stored into a tagged slot runs 5.5–8x slower. Mixed-width views and `DataView` buy nothing over shift-and-mask on one word. Let the buffer grow by doubling and copying (about 3–4 ms per 300K records), and presize it from the source length.

The bigger build-time win is a later step: the parser writes these records itself, and the `Subtree` walk goes away. Today that walk accounts for 73 of the 93 ms on `big.json` and 131 of the 190 ms on `checker.ts`. Materializing the arena adds only 20–60 ms on top of it.

## Premises

Decisions the user already made, which this document builds on and does not revisit:

- "Preserve functions, not the data": the contract is a set of functions over an opaque handle.
- Storage is a bump-allocator arena in one growable typed-array buffer, and the handle is the record offset. Records are a per-kind tagged union: fixed arity looks like `If = [kind, start, end, cond, then, otherwise]`, and variable arity looks like `[kind, start, end, count, c1..cn]`. Accessors are generated from a per-kind layout table. Growth is double-and-copy, and the whole tree is freed at once.
- A token is an id. Keyword and punctuation text comes from the symbol table. Identifiers, literals and comments carry start and end, and their text is sliced on demand. The tree stores no strings.
- Positions are needed only for variable-token text, formatter layout reads and the review UI's mapping.
- There is no runtime self-check. Tests and a separate checker cover correctness.

Two constraints were added during this work:

1. The formatter never sees the source string. The tree is its only input.
2. Line breaks are exposed as a function, `lf(node) → n`, the newlines before the node's first leaf, and not as tokens in the children list. The formatter gets no positions.

Constraint 2 overrides the earlier premise that positions serve formatter layout reads: under it, positions serve only `text`, the diff and the review UI.

Fixed constraints from the repo are unchanged: pure TypeScript, browser-only, no wasm.

## Record layout

All words are `u32` in one `Uint32Array`. A handle is the word offset of a record's head.

| word | token (leaf) | inner node | notes |
|---|---|---|---|
| 0 | head | head | see below |
| 1 | start | start | UTF-16 offset |
| 2 | end | end | |
| 3 | parent | parent | handle; patched when the parent closes; the root holds its own handle |
| 4 | ord | ord | postorder ordinal, dense from 0 |
| 5 | | count | visible children |
| 6.. | | c1..cn | child handles, in source order |

The head word:

| bits | field | range |
|---|---|---|
| 0–15 | kind | public symbol id after aliasing; the name comes from the symbol table |
| 16–23 | field | field id, 0 for none |
| 24 | `F_NAMED` | |
| 25 | `F_MISSING` | |
| 26 | `F_INNER` | the record has `count` and children |
| 27 | `F_FIXED` | fixed-text token, so its text is the symbol name |
| 28–29 | `lf` | newlines before the first leaf, clamped to 3 |
| 30–31 | clear | keeps the word a small integer in Chrome (see "Unsigned arrays") |

Every node therefore costs 5 words, and an inner node costs `6 + count` words. The measured average is 6.25–6.32 words per node, which is 25–29 B/node including the `ords` index.

A per-kind layout table (`If = [kind, start, end, cond, then, otherwise]`) can be layered on this later without changing the storage. Tree-sitter's visible children are variable in practice: optional fields, extras such as comments interleaved anywhere, and `MISSING` and `ERROR` nodes. So the generated accessors for a kind like `if_statement` would be `field(n, FIELD_condition)` lookups over the child list, not fixed offsets. I recommend starting with the one variable-arity inner record above and generating named field accessors from the grammar's field table. A fixed-offset record per kind is worth doing only if profiling shows the field scan as a cost.

### Why postorder

The inner record needs `count` when it is written. `walkTree` learns the count only when a node closes, because hidden nodes flatten their children into the nearest visible ancestor. So records are appended when a node closes, from the `kids` stack: children first, then the parent (postorder). Postorder has two further benefits:

- It is the order in which the parser reduces, so the later step where the parser writes records directly needs no reordering.
- A subtree is still one contiguous ordinal range, `[ord - size + 1, ord]`.

The cost is that ordinals are no longer preorder, which changes one thing today: the `id` tiebreaks and sorts in `diff/edit-script.ts` and `engine/doc/groups.ts`. If output order must not change, a preorder-ordinal column costs one O(n) pass after the build (see "Open questions").

### Positions: stored or derived

The alternative `lean` layout stores no positions on inner nodes: `[head, ord, count, c..]`. A token stores `[head, ord, start]` if its text is fixed, or `[head, ord, start, end]` otherwise. An inner node's start and end are then found by following first and last children down to a leaf, and parents move to a column indexed by ordinal.

Measured with `node --expose-gc research/tree-arena/tree.mjs`, Node v24.18.0. Each figure is the median of 11 runs after 1 warm-up, each run starts from a collected heap, and each variant is the median of 3 processes:

| input | nodes | tree | build ms | build less traversal ms | bytes/node | words/node | full GC ms (tree alive) | preorder walk ms | parent chains ms |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| big.json | 579,360 | objects (today) | 115.1 | 41.6 | 154 | | 50.4 | 13.2 | 13.4 |
| | | arena wide | 93.2 | 19.7 | 29 | 6.28 | ≈0 | 5.4 | 3.2 |
| | | arena lean | 103.5 | 29.9 | 25 | 4.17 | ≈0 | 10.0 | 5.2 |
| checker.ts | 512,331 | objects (today) | 249.7 | 118.9 | 172 | | 291.0 | 34.3 | 23.4 |
| | | arena wide | 189.9 | 59.1 | 29 | 6.32 | ≈0 | 6.9 | 5.2 |
| | | arena lean | 191.5 | 60.7 | 25 | 4.26 | ≈0 | 11.5 | 7.4 |
| package-lock.json | 64,373 | objects (today) | 17.1 | 6.5 | 156 | | 9.8 | 1.0 | 0.6 |
| | | arena wide | 21.0 | 10.5 | 29 | 6.28 | ≈0 | 0.6 | 0.3 |
| | | arena lean | 19.5 | 9.0 | 25 | 4.17 | ≈0 | 0.8 | 0.3 |
| scanner.ts | 43,169 | objects (today) | 15.3 | 2.5 | 164 | | 6.0 | 0.5 | 0.3 |
| | | arena wide | 16.7 | 3.9 | 29 | 6.25 | ≈0 | 0.4 | 0.3 |
| | | arena lean | 18.6 | 5.8 | 25 | 4.29 | ≈0 | 0.4 | 0.4 |

How to read the columns:

- **build less traversal** subtracts the time of the same `Subtree` walk with no output. That walk costs 73.5 ms on `big.json`, 130.8 ms on `checker.ts`, 10.5 ms on `package-lock.json` and 12.8 ms on `scanner.ts`.
- **full GC** is the median of 5 forced full GCs with only the tree alive, less the same with nothing alive.
- **GC in build** was 0.0 ms everywhere, so that column is omitted.
- **The small inputs** (43–64K nodes) build 2–4 ms slower as an arena, starting from a 1K-word buffer. That is the doubling copies plus the typed-array allocations, and presizing does not remove it at this size. Across the diff, the arena's advantage scales with node count.

Verdict: store the positions. The lean layout saves 4 B/node, and it costs about 1.7x on every preorder walk that reads spans, because each inner `start` and `end` descends to a leaf. The diff and the review UI read inner-node spans constantly. The lean layout's build was also no faster.

## The API readers need

Every reader goes through a tree object that owns the buffer, the source string and the symbol table. Handles are plain numbers.

```ts
interface Tree {
  readonly root: number;
  readonly nodeCount: number;
  readonly errorChars: number;
  kind(n: number): number;          // symbol id
  kindName(n: number): string;      // from the symbol table
  named(n: number): boolean;
  missing(n: number): boolean;
  field(n: number): number;         // field id, 0 for none; fieldName(n) for the string
  count(n: number): number;         // 0 for a token
  child(n: number, i: number): number;
  parent(n: number): number;        // the root returns itself
  text(n: number): string;          // fixed token: symbol name; variable token: source slice; inner: ""
  label(n: number): string;         // text with the comment and JSX-text whitespace collapse applied
  lf(n: number): number;            // newlines before n's first leaf, 0..3
  start(n: number): number;         // not part of the formatter's view
  end(n: number): number;           // not part of the formatter's view
  ord(n: number): number;           // dense postorder ordinal
  at(ord: number): number;          // ordinal to handle
}
```

The formatter receives a narrower `FormatTree` that omits `start`, `end` and the source.

`label` is not a plain slice today: comments and JSX text collapse whitespace runs, and layout-only JSX text is dropped from the tree. The build keeps doing the dropping, by not appending those records. The collapse moves into `label(n)`, computed on demand. If the diff's repeated `label` reads show up in a profile, the diff can keep its own `string[]` column by ordinal.

### What each consumer reads today

**Formatter (`fmt/*`, through the structural `FormatNode` in `fmt/tree.ts`):**

- It reads `kind`, `named`, `field`, `missing`, `parent`, `children` (iterate, `find`, `filter`), `start` and `end`.
- It uses node identity as keys: the comments' `attached` and `dangling` Maps, the list rules' `seps` Map, the `used` Set, `Token.node` in `doc.ts`, and `out.node !== s.node` in `check.ts`.
- `start` and `end` serve slicing token text, `hasNewlineInRange`, `isNextLineEmpty`, and sorting by start in `check.ts`.

Under the new constraints these map as follows:

| today | becomes |
|---|---|
| slicing token text | `text(n)` |
| `hasNewlineInRange` / `isNextLineEmpty` between siblings | `lf(next) > 0` / `lf(next) >= 2` |
| newlines inside a token (template strings, block comments) | read from `text(n)` itself |
| sorting by start | sorting by `ord` (source order for leaves; a parent sorts after its children) |

The formatter never imports `SyntaxNode`, so changing it touches `fmt/*` but none of the 12 files below.

**Diff (`diff/matcher.ts`, `diff/edit-script.ts`):**

- It reads `id`, as a dense index into `Int32Array` and `Uint8Array` tables (`src`, `dst`, `isoIds`, `claimed`, `holds`).
- It reads `size`, relying on the contiguous descendant range.
- It reads `height` (the `HeightQueue` buckets), `parent` (ancestor walks, sibling index, the outermost check) and `children` (LCS through `commonPairs`).
- It reads `kind`, `label`, `named`, `field`, `start` and `end`, and uses `tree.node(id)` and `tree.nodes` in both directions.

In the new API, `id` becomes `ord(n)`, `node(id)` becomes `at(ord)`, and iterating `nodes` becomes an ordinal loop. `size` and `height` become diff-owned columns filled in one postorder pass, because in postorder every child's values are ready before its parent's. `isoIds` builds its string keys from `kind`, `label` and the child ids, and is unaffected apart from the accessor calls.

**Engine:**

- `parse/tree.ts` is the adapter from syntechs to the engine.
- `doc/risk.ts` and `doc/syntax-context.ts` read `kind`, `label`, `parent` and the spans.
- `doc/groups.ts` sorts edits by `id`.
- `RawEdit.a` and `RawEdit.b` hold `SyntaxNode` objects that the engine reads (`edit.a.kind`, `.label`). With handles, the edit script also has to carry both trees, or each edit a `(tree, handle)` pair.
- `match/cross-file.ts` `subtree()` copies nodes with `{...n}` and rebased ids. With an arena this becomes a view: a `(tree, root handle)` pair whose ordinal range is `[ord - size + 1, ord]`, rebased by subtracting `ord - size + 1`. Nothing is copied.

## Derived data

The record holds what the build knows when it closes a node. That covers everything above, including `parent`, which is patched into each child when its parent closes. Everything a consumer computes afterwards goes in a typed-array column indexed by ordinal and owned by that consumer:

- `size` and `height`: the diff, which is the only reader.
- the subtree hash or `isoId`: the diff.
- the preorder ordinal, if one is kept: whoever needs the preorder sort.

Columns are allocated at `nodeCount` length and freed along with their owner. They are not written into the record, because different consumers want different sets. A tree that the formatter alone reads should pay only for its own record.

## GC and memory

The arena is 2–3 large `ArrayBuffer`s per tree: the record buffer, `ords`, and whatever columns consumers add. The GC does not trace inside them, which explains the ≈0 full-GC cost with the tree alive. Their bytes count as external memory, though, and V8 can start a GC when external memory grows quickly. That could matter in a review of many files, where each diff builds two trees. In these runs no GC occurred during a build. Pooling buffers across files is an option to reserve, not a need measured yet (see "Open questions").

## Unsigned arrays

The user's ask: "unsigned number array를 활용할 여지도 검토해봐".

Measured with `node research/tree-arena/unsigned.mjs` on Node v24.18.0. Arrays hold 2^20 elements, and each figure is the median of 9 runs after 3 warm-ups, so 1 ms ≈ 1 ns per element. Each variant is compiled separately with `new Function`, so no two variants share type feedback. The ranges below are of the stored values.

| access | Uint32 | Int32 | reading |
|---|---:|---:|---|
| sum, < 2^30 | 0.92 | 0.84 | equal within noise |
| sum, ≥ 2^31 | 0.66 | 0.65 | equal |
| `===` compare, < 2^30 | 1.22 | 1.72 | noise: an earlier run gave 1.21 and 1.12 |
| `===` compare, ≥ 2^31 | 1.57 | 1.13 | Uint32 is 1.4x slower; the value is outside the 32-bit small-integer range |
| copy into a packed JS array, any range | 0.77–0.99 | 0.66–0.69 | a small gap |
| copy into an object array (tagged), < 2^30 | 1.27 | 1.27 | equal |
| copy into an object array (tagged), ≥ 2^31 | **5.82** | 0.71 | **8x slower: each store boxes a HeapNumber** |
| store, < 2^30 | 0.46 | 0.40 | equal |
| store, ≥ 2^31 | 0.99 | 0.67 | the value is a heap number before the store |

Reading the kind, field and one flag of every 4-word record, 256K records:

| head layout | ms |
|---|---:|
| one Uint32 word, shift and mask | 0.210 |
| the same, with bit 31 set | 0.208 |
| separate columns (SoA: Uint16 + Uint8 + Uint8) | 0.239 |
| `DataView` `getUint32`, shift and mask | 0.228 |
| `DataView` `getUint16` / `getUint8` | 0.243 |
| Uint16 + Uint8 views over the same buffer | 0.495 |

Appending 300K 4-word records:

| growth | ms |
|---|---:|
| presized | 1.4 |
| resizable `ArrayBuffer` (`maxByteLength`) | 3.7 |
| double and copy, from 1K words | 3.9 |
| JS array `push` | 12.0 |

Verdict:

- **Use `Uint32Array` for the record buffer, `ords` and the columns.** Unsigned costs nothing for values below 2^31, and every value the arena stores stays far below that:
  - handles and ordinals are bounded by the source size
  - positions are UTF-16 offsets, and V8 caps a string at about 2^29 code units
  - kinds are below 2^16
- **Keep bits 30 and 31 of every stored word clear.** The one real cost is a value outside the small-integer range landing in a tagged slot, such as a `Map` key, a `Doc` token or an object field. Such a value is boxed on every store, which is the 8x above. Node v24 is built without pointer compression, so its small integers are 32-bit. Chrome uses pointer compression, which makes small integers 31-bit, so the boundary there is 2^30 rather than 2^31. The head layout above leaves both bits clear by design.
- **Use Uint16 or Uint8 only for a separate column whose values really fit.** An example is a consumer's `height` column, where halving the bytes matters more than the access time. Narrow views over the record buffer itself are the slowest option measured.
- **Skip `DataView`**: it matches typed arrays at best, and adds bounds checks and endianness arguments.
- **Grow by doubling, and presize from the source length.** On the measured corpus, words per source byte suggest `source.length` words as a first guess for code and about 1.5x that for JSON. A resizable `ArrayBuffer` is no faster than doubling.

Not measured: the same script in Chrome. `research/tree-arena/browser.mjs` runs `unsigned.html` in headless Chrome, and on this machine it produced no output before I stopped it. The Chrome claim above, about 31-bit small integers, is V8's documented pointer-compression behaviour, not a measurement. The one decision that depends on it, keeping bit 30 clear, costs nothing either way.

## Later step: the parser's `Subtree` shares the arena

Today the parser builds `Subtree` objects, and `walkTree` reads them into the visible tree. That walk alone costs 70–130 ms on the large inputs, and it is now the largest part of the build. The later step moves the parser's own nodes into an arena of the same kind:

- **Records** are `[head, padding, size, count, c..]`, with relative padding and size, as in tree-sitter. They are immutable once reduced.
- **Sharing:** in GLR, alternative stack versions share subtrees, so the parser arena is a DAG. A handle may be referenced by several parents, which is why the record stores no parent and no ordinal.
- **The visible tree** that the formatter and the diff read stays a separate tree arena, built by one walk over the parser arena. Sharing breaks the property that a subtree's ordinals are contiguous, and the diff needs that property. The walk becomes cheaper because it reads typed arrays instead of objects.
- **The step after that**, only once profiling calls for it, is for the parser to append visible records directly during reduce on unambiguous stretches, and fall back to the walk where a GLR split was live.

Nothing in the first step depends on this. The record format of the visible tree is chosen so that a postorder producer, which is what a reduce is, can write it directly.

## Migration order

Twelve files import `SyntaxNode` today. Every one of them changes, except `core/index.ts`, which only swaps its exports.

1. **`packages/syntechs/src/core/tree.ts`:** add `buildTree(lang, subtree, source): Tree` next to `walkTree`, sharing its traversal: aliases, `fieldFor`, inherited hidden fields, extras, and dropping layout-only JSX text.
   - `core/parity.test.ts` and `core/parity.node.ts`: compare the two trees node for node through the API. This is the separate checker the premises call for.
   - `core/bench.node.ts`: time both.
2. **The formatter (`fmt/*`, outside the 12):** switch `FormatNode` to `FormatTree` plus handles, replace the reads of `start`, `end` and the source with `text` and `lf`, and remove the source parameter from the entry point.
3. **The diff:** move `diff/matcher.ts` and `diff/edit-script.ts` to ordinals, with `size` and `height` columns. `RawEdit` carries handles, and the edit script carries both trees.
4. **The engine:** update `packages/engine/src/parse/tree.ts` (the adapter), `doc/risk.ts`, `doc/syntax-context.ts` and `doc/groups.ts`, which sorts by `ord` or by the preorder column, and replace `match/cross-file.ts` `subtree()` with a `(tree, handle)` view.
5. **`core/index.ts`:** export `Tree` and `buildTree`. Delete `SyntaxNode`, `SyntaxTree`, `RawTree` and `walkTree`, and move the parity test to fixtures.
6. **Later:** the parser arena, as described in the previous section.

Steps 2 and 3 are independent and can proceed in parallel once step 1 lands.

## Open questions

1. **Postorder ordinals change the tiebreak order in `edit-script.ts` and the sort in `groups.ts`.** Is a changed but still deterministic edit order acceptable, or should the tree carry a preorder-ordinal column (one O(n) pass, 4 B/node) so that output stays byte-identical?
2. **API style:** methods on a `Tree` object (`t.kind(n)`), or free functions taking the tree (`kind(t, n)`)? Methods keep call sites short and are monomorphic when there is one `Tree` class. Free functions allow tree-shaking.
3. **The `lf` clamp:** is 0–3 enough? Prettier keeps at most one blank line, so it needs 0, 1 and 2+. Ruff keeps up to two blank lines at the top level, so it needs 0–3. A larger range needs more head bits or its own word.
4. **Wide or lean:** this document recommends wide, based on the walk times above. Is the extra 4 B/node acceptable to you, or does memory matter more than span reads?
5. **Pooling buffers across files** in a many-file review, to avoid GCs triggered by external memory: defer until a multi-file profile shows it?
