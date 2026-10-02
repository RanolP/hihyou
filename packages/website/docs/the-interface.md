<script setup lang="ts">
import { data, type ScorecardRow } from "./scorecard.data.ts";

/** One graph: syntechs' time over the baseline's, so the baseline is 1 and below 1 is faster. */
interface Speed {
  label: string;
  baseline: string;
  ratio: number;
}

/**
 * The graphs a row has numbers for; a speed not measured for a language shows no graph. The formatter's
 * baseline is oxfmt for the prettier family (`js@oxfmt`) and the row's own reference otherwise; shiki's ratio
 * is its time over ours, so it is inverted to read the same way.
 */
const graphs = (row: ScorecardRow): Speed[] => {
  const prettierFamily = row.language.endsWith("@oxfmt");
  const formatter = prettierFamily ? row.ratio.oxfmt : row.ratio.reference;
  const out: Speed[] = [];
  if (formatter != null)
    out.push({
      label: "Formatter",
      baseline: prettierFamily ? "oxfmt" : (row.reference.split(" ")[0] as string),
      ratio: formatter,
    });
  if (row.ratio.shiki !== undefined)
    out.push({ label: "Highlighter", baseline: "shiki", ratio: 1 / row.ratio.shiki });
  return out;
};

/** Bar width in percent: the longer of the two bars fills the track. */
const width = (ratio: number, of: number) => `${(ratio / Math.max(1, of)) * 100}%`;
const times = (ratio: number) => `${ratio < 1 ? ratio.toFixed(2) : ratio.toFixed(1)}x`;
const percent = (s: { passed: number; total: number }) =>
  s.total === 0 ? "-" : `${((s.passed / s.total) * 100).toFixed(2)}%`;
</script>

# The Interface

## Why AST-Diffing

A line diff does not know the syntax, so it shows noise; ignore whitespace, and it hides real changes as well. syntechs reads the syntax, not the whitespace, and where whitespace is syntax it does not miss it. Each example below was run through `git diff --no-index` and through syntechs.

### Wrapping `a` in `d(a)` marks everything changed

```ts
// before
export const user = {
  id: 1,
  name: "Ada",
  roles: ["admin", "editor"],
};

// after
export const user = deepFreeze(
  {
    id: 1,
    name: "Ada",
    roles: ["admin", "editor"],
  },
);
```

- **git diff**: 5 lines removed and 7 added, the whole file. With `-w`, the 4 lines holding `{`, `};`, `},` and `);` still show as changed.
- **syntechs**: 2 edits. The object moved unchanged into its new place, and one `deepFreeze(…)` call was inserted. All the reviewer reads is "wrapped in deepFreeze".

### Wrapping a Python block changes every line of it

```python
# before
def sync(repo):
    repo.fetch()
    for branch in repo.branches:
        if branch.is_stale():
            branch.delete()
    repo.gc()

# after
def sync(repo):
    with repo.lock():
        repo.fetch()
        for branch in repo.branches:
            if branch.is_stale():
                branch.delete()
        repo.gc()
```

- **git diff**: 5 lines removed and 6 added.
- **syntechs**: the body block moved unchanged, and one `with` block was inserted.

### Ignoring whitespace hides the real change

```python
# before
def sync(repo):
    with repo.lock():
        repo.fetch()
        for branch in repo.branches:
            if branch.is_stale():
                branch.delete()
        repo.gc()

# after
def sync(repo):
    with repo.lock():
        repo.fetch()
        for branch in repo.branches:
            if branch.is_stale():
                branch.delete()
    repo.gc()
```

`repo.gc()` moved out of the `with` block, so it now runs outside the lock. The meaning changed.

- **`git diff -w`**: 0 lines. The behavior changed, and the reviewer sees nothing.
- **syntechs**: one move, of the `repo.gc()` statement.

### Moves

A node that changed place reads as one of three kinds of move:

- **pure**: every token came along unchanged.
- **edited**: it moved and changed, but enough of it stayed the same to read as moved.
- **replaced**: too little survived, or the node is too small for "moved" to mean anything, so it reads as a delete and an insert.

Moves are found across files too, not only inside one file. When a change is too large for tree matching within its budget, syntechs falls back to a line diff.

## Unified View

hihyou shows a unified view only.

```ts
// before
await sendInvoice(customer.email, invoice.pdf, { retry: 3 });

// after
await sendInvoice(customer.email, invoice.pdf, {
  retry: 3,
  timeoutMs: 5000,
  priority: "high",
});
```

Adding two options breaks a one-line call onto five lines. `git diff` shows 1 line removed and 5 added, with or without `-w`. syntechs finds 5 inserts: the two new properties and three commas. A split view sets 1 line beside 5; the unified view shows the after layout with only the new tokens marked.

Once AST matching aligns the two layouts, the columns of a split view are nearly identical, so the second one is redundant. And the aligned before column is a synthetic layout: neither the source nor the formatter's output. The exception is a block rewritten whole, replaced or unmatched.

## Fast by Default

### Less Temporary Object GC with Arena

The tree is one growable typed array, not one object per node, so the garbage collector has no per-node objects to trace.

| | `big.json`, 579,360 nodes | `checker.ts`, 512,331 nodes |
| :-- | --: | --: |
| Memory per node | 154 → 29 B | 172 → 29 B |
| Full GC with the tree alive | 50.4 → ~0 ms | 291.0 → ~0 ms |
| Walk | 13.2 → 5.4 ms | 34.3 → 6.9 ms |
| Build | 115.1 → 93.2 ms | 249.7 → 189.9 ms |

### No WASM for No postMessage() between Worker and Main

A WASM parser in a worker puts a boundary between the worker and the page. The arena buffer could be transferred, but the source string is copied, the `Language` has to be bound again on the other side, and every engine output (the `Map`-based mapping, the edit script, the `FileDiff`, the fragments) is serialized and deserialized at each crossing. The API turns async as well.

The boundary is costly even within one thread: through web-tree-sitter, walking the tree with a cursor costs 0.7–1.3x the parse itself, and materializing it into JavaScript objects costs 1.1–2.5x the parse. The point is no boundary, not a faster parse.

`SharedArrayBuffer` would avoid the copies, but it needs `crossOriginIsolated`, which needs COOP and COEP headers that a GitHub page, a VS Code webview and GitHub Pages cannot set. It can only ever be an optional accelerator.

### Vertical Integration for Optimization

- One parse feeds the formatter, the highlighter and the diff.
- The line breaks before a node, `lf(n)`, are packed into the node's head word.
- Nodes take contiguous ordinals in postorder, so the diff keeps its per-node data in columns, and every subtree is one range of them.
- The formatter prints through a linear stream IR. Reducing the number of `Doc` nodes was measured, and it bought nothing.
- Formatter anchors map what is displayed back to the source.
- Tables are built at build time, and the highlighter is generated code.

### Codegen & Thin Core makes it Maintainable while Accelerating Runtime

`generate.mjs` generates three things at build time:

- the parser, by the compiler (`bundle.js`);
- the formatter, from the format DSL (`format.ts` → `fmt.gen.ts`);
- the highlighter, from nvim-treesitter's `highlights.scm` to TextMate scopes (`rules.node.ts`).

The hand-written core is about 4,500 lines. TypeScript and TSX are formatted from the `javascript/format.ts` spec, not by hand-written code.

### Real Data

CI measures every commit to `main` and rebuilds these numbers from the results. **Conformance** is the share of the reference's fixtures that syntechs prints byte-identical to the reference. Each bar is time relative to the baseline, which is 1.0x; a shorter bar is faster. Formatter baselines: oxfmt for the prettier-family languages, ruff for Python, ktfmt for Kotlin and swift-format for Swift. Highlighter baseline: shiki.

<div class="real-data">
  <section v-for="row in data.rows" :key="row.language" class="rd-row">
    <h4>{{ row.language }}</h4>
    <p class="rd-score">
      Conformance <strong>{{ row.score ? percent(row.score) : "not implemented" }}</strong>&nbsp;<span v-if="row.score">({{ row.score.passed }} / {{ row.score.total }} against {{ row.reference }})</span>
    </p>
    <div class="rd-graphs">
      <figure v-for="speed in graphs(row)" :key="speed.label" class="rd-graph">
        <figcaption>{{ speed.label }}</figcaption>
        <div class="rd-bar"><span class="rd-name">{{ speed.baseline }}</span><span class="rd-track"><span class="rd-fill rd-base" :style="{ width: width(1, speed.ratio) }"></span></span><span class="rd-value">1.0x</span></div>
        <div class="rd-bar"><span class="rd-name">syntechs</span><span class="rd-track"><span class="rd-fill rd-ours" :style="{ width: width(speed.ratio, speed.ratio) }"></span></span><span class="rd-value">{{ times(speed.ratio) }}</span></div>
      </figure>
    </div>
  </section>
</div>

Measured at commit <a :href="`https://github.com/RanolP/hihyou/commit/${data.commit}`"><code>{{ data.commit.slice(0, 7) }}</code></a> on {{ data.date.slice(0, 10) }}; speed timed against {{ data.benchTools }}.

<style scoped>
.rd-row { border-top: 1px solid var(--vp-c-divider); padding: 12px 0; }
.rd-row h4 { margin: 0; font-family: var(--vp-font-family-mono); }
.rd-score { margin: 4px 0 8px; }
.rd-score span { color: var(--vp-c-text-2); font-size: 0.9em; }
.rd-graphs { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px 24px; }
.rd-graph { margin: 0; }
.rd-graph figcaption { font-size: 0.85em; color: var(--vp-c-text-2); }
.rd-bar { display: grid; grid-template-columns: 5.5em 1fr 4em; align-items: center; gap: 8px; font-size: 0.85em; }
.rd-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rd-track { height: 10px; background: var(--vp-c-default-soft); border-radius: 3px; overflow: hidden; }
.rd-fill { display: block; height: 100%; }
.rd-base { background: var(--vp-c-text-3); }
.rd-ours { background: var(--vp-c-brand-1); }
.rd-value { text-align: right; font-variant-numeric: tabular-nums; }</style>
