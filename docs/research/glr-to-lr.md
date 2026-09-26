# GLR to LR: how much does forking cost, and where is the speed?

The parser in `packages/syntechs/src/core/parser.ts` is a TypeScript port of tree-sitter 0.27's GLR loop over a graph-structured stack. The question was how to run it as plain LR more aggressively. The short answer from the measurements: on the big inputs the parser already runs single-version for 93-100% of tokens, and multi-version bookkeeping costs 0% (JSON, CSS), 2-5% (JS, Python), or 5-10% (TS, TSX) of parse time. The remaining gains come from making the single-version path itself cheaper, not from removing forks.

## Method

Measurements were taken at `1c7cc75` with temporary instrumentation in `parser.ts` and `stack.ts`, all reverted afterwards.

- **Tokens multi:** the share of lookahead tokens consumed while more than one stack version was alive.
- **Episode:** a stretch from the first fork until the parser is back to one version. Its lifetime is counted in tokens.
- **Cause:** what opened the episode. Either a conflict entry (a table entry with 2 or more effective actions, not counting repetition shifts), a multi-link pop (a `popCount` through a node that an earlier merge gave several links), or error recovery.
- **Time multi / single:** wall time in `parse()` iterations with more than one version alive, compared with the time in iterations with one. The probe adds overhead, so read the ratio and not the absolute numbers.
- **CPU profile:** `node --cpu-prof` on a clean build, reading self time per function.

## Measurements

| File | Tokens | Tokens multi | Episodes | Life avg / max | Max versions | Time multi / single | Static conflict entries (states) | Episode causes |
|---|---|---|---|---|---|---|---|---|
| big.json | 415000 | 0% | 0 | - | 1 | 0 / all | 0 | - |
| package-lock.json | 46110 | 0% | 0 | - | 1 | 0 / all | 0 | - |
| bootstrap.css | 50621 | 0.06% | 16 | 2 / 2 | 2 | 0.7 / 90.1 ms | 0 | 16 error recovery |
| lodash.js | 44295 | 1.11% | 148 | 2.32 / 19 | 4 | 4.4 / 108.2 ms | 418 (118) | 86 conflict, 62 multi-link pop |
| jquery.js | 48524 | 2.66% | 563 | 1.31 / 17 | 4 | 4.6 / 101.6 ms | 418 (118) | 275 conflict, 288 multi-link pop |
| checker.ts | 348332 | 3.36% | 3622 | 2.27 / 26 | 4 | 60.7 / 626.7 ms (8.8%) | 1539 (451) | 1910 conflict, 1712 multi-link pop |
| App.tsx | 41105 | 7.27% | 1049 | 1.89 / 67 | 4 | 9.3 / 80.4 ms (10.4%) | 1494 (433) | 590 conflict, 459 multi-link pop |
| typing.py | 14513 | 1.17% | 65 | 1.75 / 19 | 6 | 1.5 / 34.1 ms | 1627 (129) | 57 conflict, 8 multi-link pop |
| argparse.py | 12483 | 0.89% | 34 | 2.29 / 6 | 3 | 0.5 / 22.8 ms | - | 34 conflict |

Episodes are short. In checker.ts, lifetimes break down as 534 episodes at 0 tokens, 958 at 1, 1245 at 2-3, 816 at 4-7, 66 at 8-15, and 3 at 16 or more. Reductions in checker.ts: 511257 went through the existing single-version `reduceLinear` fast path, 5303 were GLR `reduce` calls while one version was alive, and 31219 were GLR `reduce` calls while several versions were alive.

### The conflicts that fork

- **JS / TS / TSX:** `R primary_expression/1 | R _property_name/1` on `(`. This is the method-versus-call ambiguity. checker.ts state 1216 alone forks 1046 times, 814 of those episodes end in a merge, and lifetimes average 3.67 tokens (max 16).
- **JS / TS / TSX:** `R primary_expression/1 | R pattern/1` (dynamic precedence -1) on `,` `]` `=` `:` `)`. This is the arrow-parameter / destructuring ambiguity. In App.tsx state 1251 on `)`, 113 forks were all pruned. It cannot be resolved early: `(a, b) =>` needs the dp-1 branch to survive until `=>`.
- **TS:** `R pattern (dp-1) | S` on `=`, and `R primary_expression | S` on `.`.
- **JS:** a conflict entry on `in` (state 555).
- **TSX:** `object_repeat1` versus `object_pattern_repeat1`, and `rest_pattern`.
- **Python:** `R pattern/1 | R primary_expression/1` on `,`, and `R primary_expression/1 | R list_splat_pattern/2`. These are assignment-target ambiguities.

Every remaining multi-action entry comes from a conflict the grammar declares on purpose (`conflicts:` in `grammar.js`). None is an accidental table ambiguity.

### Where the time goes (CPU profile, self time)

| Function | checker.ts | big.json |
|---|---|---|
| GC | 27% | 22% |
| lexing | ~17% | 16% |
| `advance` | 14% | 18% |
| `reduceLinear` | 11% | 15% |
| `summarizeChildren` | 6% | 6% |
| `push` | 3% | 7% |
| `popLinear` | 3% | 4% |
| `tableEntry` / `lookup` | 2% | - |
| GLR-only functions (`reduce`, `popCount`, `iter`, `renumber`, `condenseStack`, `canMerge`, `addLink`) | ~5% | 0% |

In App.tsx the GLR-only functions total about 9-10%.

Table lookup cost: `lookup` scans the small-state table linearly. On average one lookup scans 10.7 words in big.json (919k lookups), 35.4 in bootstrap.css (140k), 32.7 in checker.ts (749k small plus 786k large-state lookups), and 30-33 in jquery.js, App.tsx and typing.py.

## Ceiling on removing forks

Even if multi-version tokens cost the same as single-version tokens, removing all GLR overhead saves at most about 5.7% on checker.ts, 3.3% on App.tsx, 1.7% on jquery.js, and nothing on JSON or CSS. This caps every "fork less" option below.

## Options

| Option | Expected gain | Parity risk | Cost | Verdict |
|---|---|---|---|---|
| Single-version fast loop (inline lex, cache check, sole action, shift and `reduceLinear` in one tight loop; hand off to `advance` on any conflict) | Unmeasured, likely under 10%. The prototype was deep-equal to GLR on 280 inputs, but the A/B timing was within machine noise | Low: it hands off exactly where GLR would fork | Medium | Do it only together with the array stack below, where it has a real structure to exploit |
| Array-based LR stack while one version is alive (plain arrays of state, subtree and position; materialize `StackNode`s only on fork) | Largest available lever on the lean path: `push` + `popLinear` + node recycling + part of GC is roughly 10-15% of self time | Medium: it must reproduce errorCost, nodeCount and dynamic precedence exactly at the fork boundary | Medium to high | Do it, after the arena worker lands |
| Faster table lookup (dense per-state row cache, or precomputed symbol-to-action maps for hot small states) | 2-5% on JS/TS/CSS, less on JSON. A dense-row prototype (env `DENSE`) showed -28% to +48% per file across runs, which is noise, not signal | None: the same table, a different index | Low | Do it, and measure with more repetitions on an idle machine |
| Compile-time static resolution of conflicts | ~0 | High | - | Not feasible: all remaining multi-action entries are declared conflicts, and dynamic precedence decides them only at the end |
| LR(k) / LAR lookahead to pick the branch early | ≤ the 3-6% ceiling | High: `(a, b) =>` and pattern versus expression need unbounded lookahead | High | Skip |
| Early merge of versions | ≤ the 3-6% ceiling; 814 of 1046 top forks already merge within about 4 tokens | Medium: merge order changes the chosen tree under ties | Medium | Skip for now |
| Grammar-specific sub-parser (e.g. JSON) | Only lex and allocation savings. JSON never forks, so the generic fast path already behaves as a deterministic parser | Medium: a second parser has to match the tree shape | High | Skip; the generic lean-path work benefits JSON the same way |
| Less allocation per node (`summarizeChildren` and GC at 30%+ combined) | The biggest bucket overall | Low | - | This is the arena worker's area; see below |

### A latent bug

In `stack.ts`, `popLinear` pushes the nodes it walks onto `free` before it knows the pop will succeed. If it then meets a multi-link node and bails out, those nodes are already on the free list while still referenced. Production is safe only because nothing calls `popLinear` again after such a failure. The fast-loop prototype hit this: the fallback path re-ran the pop, the same nodes were freed twice, the stack gained a cycle, and `iter` failed with "Invalid array length" on lodash.js. The fix is to free the walked nodes only after the loop succeeds. It is independent of every option here and should land first.

## Interaction with the arena worker

The arena work changes how the parser allocates nodes: `push`, `popLinear`, `reduceLinear` and `newNode` start writing into the arena directly. This plan touches the same functions, so:

- The array-stack unit rewrites `push`, `popLinear` and `reduceLinear`. It must be based on the arena commit, not run in parallel with it.
- On the GLR path, the losing branches' nodes become unreachable arena garbage rather than GC garbage. The share of multi-version tokens above (0-7%) bounds that waste. The arena design should tolerate it, for example by never compacting mid-parse.
- The `popLinear` free-on-success fix is small and conflicts little. Hand it to the arena worker, or land it first and let them rebase.
- The table-lookup unit touches only `language.ts` and can run in parallel with anything.

## Plan

Each unit is independently verifiable by the existing tree-sitter 0.27 CLI parity check plus the bench. The speedups are estimates from the profile shares above.

1. **Fix `popLinear` early free** (`stack.ts`). Gain 0%, safety only. It can run in parallel now.
2. **Faster `lookup`** (`language.ts`: a dense row cache for hot small states). Expected 2-5% on JS/TS/CSS/Python. It can run in parallel now; measure with at least 9 alternating repetitions on an idle machine.
3. **Array-based single-version stack** (`stack.ts`, `parser.ts`, `reduceLinear`/`push`). Expected 5-15% on every grammar. Start it after the arena work lands.
4. **Single-version fast loop** on top of unit 3 (`parser.ts` `parse`/`advance`). Expected a few percent more, and it is only worth keeping if it measures positive. Depends on unit 3.
5. **Not planned:** static conflict resolution, LR(k), early merge, and a dedicated JSON parser. Their ceiling is 0-6% and their parity risk is high.
