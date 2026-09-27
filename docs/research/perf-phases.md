# Where formatter time goes, per language

The folder-level bench (`packages/syntechs/dist/fmt/bench.node.js`) says how far syntechs is from oxfmt and ruff, but not where the time goes. This page splits one folder-level run into phases, and one warm run on the largest input into parse and format sub-phases, so the next optimization can be picked by size. It measures only; nothing here changes a production path.

Measured at `cb27b44` (docs(research): measure GLR fork cost and plan an LR fast path), Node 24.18.0, Windows 11, on an otherwise idle machine. One run per number (Table A: median of 3 whole-process runs after 1 warmup). Differences of a few ms are noise.

## Findings

- **The fixed cost of a run is 70-120 ms, of which bare Node is about 32 ms.** Import, bundle eval, table decode and fmt modules together cost 21-63 ms. Table decode is at most 15 ms (TS, which decodes three grammars). It is not the lever the bench gap suggested.
- **Cold JIT is the biggest part of the folder-vs-in-process gap.** Running the same files again in the same process is 64 ms (JSON) to 315 ms (TS) faster than the first time. For CSS, JS and Python the first pass costs about twice the warm pass.
- **Warm, format is 45-68% of parse + format.** It is the larger half everywhere except JSON, where parse is 55%.
- **Inside format, the split depends on the language.** For JSON and CSS the printer is the larger part (53-56% of format). For JS and TS, Doc building by the rules is the larger part (58-65%). For Python, printer and Doc build are about equal (38% and 37%), and comment attachment plus AST lowering take 25%.
- **GC is 4-9% of phase time**, in every language, so it is not a lever.
- **`typing.py` does not format at `cb27b44`.** `format` returns `unsupported expression: union_type at 42182`, so the bench's Python folder time includes a format that bails partway, and never prints that file.

## A) Cold folder-level run, one process

`phases.node.js cold <lang>` writes the bench's corpus inputs for the language to a temp dir (same file names, same filter: only inputs prettier and oxfmt both accept), then spawns an instrumented copy of `fmt/cli.node.js` that clocks each step with `performance.now()`. "Node bootstrap" is the child's own clock at script entry. "Spawn + teardown" is the parent's wall time minus the child's clock at its last step. The fmt modules import the grammars they format (`typescript/fmt.js` imports `javascript` and `tsx` too), so the child loads those grammars first, which charges their cost to the bundle and decode rows.

Inputs: JSON is big.json and package-lock.json (3479 KB). CSS is bootstrap.css, normalize.css and animate.css (374 KB). JS is lodash.js and jquery.js (810 KB). TS is scanner.ts, checker.ts, App.tsx and LayerUI.tsx (3504 KB). Python is argparse.py, typing.py, dataclasses.py and base_events.py (370 KB).

ms (% of the syntechs total):

| Phase | json | css | js | ts | python |
| :-- | --: | --: | --: | --: | --: |
| Node bootstrap to script entry | 21.1 (4.6) | 20.2 (6.9) | 19.8 (3.9) | 18.9 (1.3) | 19.8 (5.9) |
| import `core/index` (parser) | 6.1 (1.3) | 6.2 (2.1) | 6.3 (1.2) | 6.1 (0.4) | 6.1 (1.8) |
| import `fmt/format` (formatter core) | 11.5 (2.5) | 11.9 (4.1) | 11.9 (2.3) | 11.8 (0.8) | 11.8 (3.5) |
| grammar bundle eval (`bundle.js`) | 0.7 (0.2) | 2.4 (0.8) | 2.7 (0.5) | 9.8 (0.7) | 2.4 (0.7) |
| table decode (`loadLanguage`) | 1.0 (0.2) | 3.2 (1.1) | 5.3 (1.0) | 15.1 (1.1) | 4.8 (1.4) |
| fmt module import (`grammars/*/fmt.js`) | 1.8 (0.4) | 2.7 (0.9) | 18.5 (3.6) | 19.7 (1.4) | 15.1 (4.5) |
| first file parse | 146.5 (32.3) | 76.1 (26.1) | 86.2 (16.9) | 74.6 (5.2) | 40.9 (12.1) |
| first file format | 166.5 (36.8) | 74.8 (25.6) | 137.9 (27.0) | 97.6 (6.8) | 68.3 (20.3) |
| remaining files parse | 21.9 (4.8) | 31.8 (10.9) | 77.1 (15.1) | 434.1 (30.2) | 63.8 (19.0) |
| remaining files format | 38.0 (8.4) | 31.7 (10.9) | 113.3 (22.2) | 696.3 (48.4) | 61.6 (18.3) |
| IO (read + write) | 7.3 (1.6) | 2.9 (1.0) | 3.2 (0.6) | 15.3 (1.1) | 3.6 (1.1) |
| process spawn + teardown | 30.2 (6.7) | 27.5 (9.4) | 28.8 (5.6) | 37.4 (2.6) | 37.8 (11.2) |
| **syntechs total (wall)** | **453.0** | **291.7** | **511.3** | **1437.4** | **336.6** |
| reference total (oxfmt; ruff for Python) | 84.3 | 74.5 | 81.8 | 234.0 | 30.7 |
| syntechs / reference | 5.4x | 3.9x | 6.3x | 6.1x | 11.0x |
| `node -e 0` (wall) | 31.9 | 32.1 | 32.2 | 34.4 | 32.1 |

The first file is the first in the table's input list (big.json, bootstrap.css, lodash.js, scanner.ts, argparse.py). Table decode per grammar: json 1.0, css 3.2, javascript 5.3 to 5.5, typescript 5.4, tsx 4.3, python 4.8 ms. Of the 11.8 ms `fmt/format` import, 7.6 ms is `fmt/width.js` (emoji-regex, get-east-asian-width, narrow-emojis), measured apart with a one-off dynamic import.

The ratios here are higher than the bench's verdict (json 4.50x, js 2.81x, ts 4.34x) because the bench sums corpus and fixtures, and the fixtures are many small files where both tools pay mostly startup. This table covers the corpus set only.

Derived per language, from the rows above:

| | json | css | js | ts | python |
| :-- | --: | --: | --: | --: | --: |
| fixed cost (bootstrap, imports, decode, spawn + teardown) | 72.4 | 74.1 | 93.3 | 118.8 | 97.8 |
| fixed cost above `node -e 0` | 40.5 | 42.0 | 61.1 | 84.4 | 65.7 |
| parse + format, cold (this run) | 372.8 | 214.4 | 414.4 | 1302.8 | 234.6 |
| parse + format, warm (same process, median of 5 repeats) | 309.2 | 100.3 | 201.6 | 987.3 | 97.7 |
| of which parse / format, warm | 169.5 / 139.7 | 40.8 / 59.5 | 72.3 / 129.3 | 337.0 / 650.3 | 44.0 / 53.7 |
| cold-JIT excess (cold - warm) | 63.6 | 114.1 | 212.8 | 315.4 | 137.0 |

The warm row comes from `cold-child <dir> --warm`, which after the timed run repeats the same parse and format work 5 times in the same process. It runs in a spawn of its own, so it does not inflate the timed wall.

## B) Warm, largest input per language

`phases.node.js warm <lang> [passes]` parses and formats the largest input after 3 warmups and reports the medians. A `PerformanceObserver` on `gc` entries charges each collection to the phase it started in. `typing.py` is larger than argparse.py, but it does not format (see Findings), so Python uses argparse.py.

| Input | KB | parse ms | format ms | format share | GC in parse | GC in format |
| :-- | --: | --: | --: | --: | --: | --: |
| json: big.json | 3131 | 147.4 | 119.4 | 45% | 6.4% | 8.7% |
| css: bootstrap.css | 274 | 28.0 | 38.4 | 58% | 1.7% | 7.8% |
| js: lodash.js | 531 | 32.3 | 65.9 | 67% | 2.3% | 4.7% |
| ts: checker.ts | 3007 | 284.8 | 536.2 | 65% | 2.5% | 8.9% |
| python: argparse.py | 100 | 11.1 | 19.6 | 64% | 2.7% | 8.0% |

Passes: json 10, css 20, js 20, ts 5, python 50 (the same runs as the profiles below).

### Sub-phases from `--cpu-prof`

`phases.node.js analyze <file.cpuprofile>` assigns each sample to the outermost frame on its stack that names a phase:

- **parse:** `parseSubtree` and `buildTree`.
- **comment attachment:** `attachComments` in `fmt/comments.ts`, or Python's `attach`.
- **Python AST lowering:** `toAst`.
- **printer:** `print` in `fmt/printer.ts`.
- **Doc build:** everything else under `format`, which is the language's rules building the Doc.
- **GC:** the profiler's `(garbage collector)` node. V8 charges it at the root, so it cannot be split by phase here. The observer's split is in the table above.

Sampled ms, all passes including warmups (% of the profile):

| Phase | json | css | js | ts | python |
| :-- | --: | --: | --: | --: | --: |
| parse | 1804.8 (48.8) | 696.5 (37.9) | 858.7 (31.8) | 2346.9 (33.4) | 645.1 (33.3) |
| format: printer | 850.1 (23.0) | 496.8 (27.0) | 624.6 (23.2) | 1295.9 (18.4) | 405.1 (20.9) |
| format: Doc build (rules) | 556.4 (15.0) | 408.6 (22.2) | 935.2 (34.7) | 2601.6 (37.0) | 392.0 (20.2) |
| format: comment attachment | 106.5 (2.9) | 27.4 (1.5) | 49.5 (1.8) | 132.7 (1.9) | 136.3 (7.0) |
| format: Python AST lowering | - | - | - | - | 130.0 (6.7) |
| GC | 275.8 (7.5) | 104.5 (5.7) | 114.9 (4.3) | 481.0 (6.8) | 121.4 (6.3) |
| other (module load, input read) | 104.3 (2.8) | 103.1 (5.6) | 114.3 (4.2) | 170.5 (2.4) | 107.0 (5.5) |

Within format only (GC excluded), the printer / Doc build / attachment (+ toAst) split is: json 56 / 37 / 7%, css 53 / 44 / 3%, js 39 / 58 / 3%, ts 32 / 65 / 3%, python 38 / 37 / 13 + 12%.

### Top-10 self time under `format`

Source locations are in `packages/syntechs/src/`. `print`, `fits`, `trimLineEnd`, `breaks` and `visit` are all in `fmt/printer.ts`: `print` (line 157) is the main layout loop, `fits` (266) measures a group, `trimLineEnd` (480) trims trailing whitespace, and `breaks` (766) and `visit` (781) propagate hard breaks before layout. `collect` (`fmt/comments.ts:91`) is the whole-tree walk that finds comments. It runs even when the input has none, as in JSON.

**json** (big.json, 1513 ms under format):

| Function | self ms | % of format |
| :-- | --: | --: |
| `print` fmt/printer.ts | 341.4 | 22.6 |
| `fits` fmt/printer.ts | 152.0 | 10.0 |
| sequence rule closure, `fmt/rules.ts` (dist rules.js:71) | 114.2 | 7.5 |
| `listRule` closure, `fmt/rules.ts` (dist rules.js:101) | 101.4 | 6.7 |
| `collect` fmt/comments.ts | 95.0 | 6.3 |
| `trimLineEnd` fmt/printer.ts | 89.7 | 5.9 |
| `breaks` fmt/printer.ts | 82.6 | 5.5 |
| `visit` fmt/printer.ts | 76.9 | 5.1 |
| `printBare` fmt/format.ts | 45.2 | 3.0 |
| `listRule` items callback, `fmt/rules.ts` (dist rules.js:181) | 40.7 | 2.7 |

**css** (bootstrap.css, 933 ms under format):

| Function | self ms | % of format |
| :-- | --: | --: |
| `print` fmt/printer.ts | 197.2 | 21.1 |
| `fits` fmt/printer.ts | 103.0 | 11.0 |
| `breaks` fmt/printer.ts | 99.0 | 10.6 |
| `trimLineEnd` fmt/printer.ts | 38.5 | 4.1 |
| `declaration` grammars/css/fmt.ts | 28.7 | 3.1 |
| `collect` fmt/comments.ts | 23.5 | 2.5 |
| `braces` grammars/css/fmt.ts | 23.5 | 2.5 |
| `code` grammars/css/fmt.ts | 20.6 | 2.2 |
| `parts` grammars/css/fmt.ts | 20.1 | 2.2 |
| anonymous, grammars/css/fmt.ts (dist fmt.js:185) | 19.0 | 2.0 |

**js** (lodash.js, 1609 ms under format):

| Function | self ms | % of format |
| :-- | --: | --: |
| `print` fmt/printer.ts | 217.6 | 13.5 |
| `fits` fmt/printer.ts | 155.0 | 9.6 |
| `breaks` fmt/printer.ts | 100.1 | 6.2 |
| `wrap` closure (print cache + parens), grammars/javascript/fmt.ts | 61.1 | 3.8 |
| `printBare` fmt/format.ts | 43.5 | 2.7 |
| `trimLineEnd` fmt/printer.ts | 40.3 | 2.5 |
| `printComment` grammars/javascript/print/literals.ts | 32.7 | 2.0 |
| `collect` fmt/comments.ts | 30.7 | 1.9 |
| `role` grammars/javascript/print/parens.ts | 28.8 | 1.8 |
| `visit` fmt/printer.ts | 28.5 | 1.8 |

**ts** (checker.ts, 4030 ms under format):

| Function | self ms | % of format |
| :-- | --: | --: |
| `print` fmt/printer.ts | 436.0 | 10.8 |
| `fits` fmt/printer.ts | 435.0 | 10.8 |
| `wrap` closure (print cache + parens), grammars/javascript/fmt.ts | 215.0 | 5.3 |
| `printBare` fmt/format.ts | 175.6 | 4.4 |
| `breaks` fmt/printer.ts | 130.5 | 3.2 |
| `trimLineEnd` fmt/printer.ts | 124.5 | 3.1 |
| `role` grammars/javascript/print/parens.ts | 106.2 | 2.6 |
| `argumentsDoc` grammars/javascript/print/calls.ts | 89.1 | 2.2 |
| `needsParens` grammars/javascript/print/parens.ts | 88.9 | 2.2 |
| `collect` fmt/comments.ts | 78.8 | 2.0 |

**python** (argparse.py, 1063 ms under format):

| Function | self ms | % of format |
| :-- | --: | --: |
| `breaks` fmt/printer.ts | 124.1 | 11.7 |
| `fits` fmt/printer.ts | 123.4 | 11.6 |
| `print` fmt/printer.ts | 108.1 | 10.2 |
| `commentIndentationAfter` grammars/python/fmt/comments.ts | 42.0 | 3.9 |
| `bare` grammars/python/fmt/ast.ts | 27.6 | 2.6 |
| `fields` grammars/python/fmt/expr.ts | 18.6 | 1.7 |
| `collect` fmt/comments.ts | 18.5 | 1.7 |
| `formatExpr` grammars/python/fmt/expr.ts | 17.4 | 1.6 |
| `afterBranch` grammars/python/fmt/comments.ts | 15.5 | 1.5 |
| `trimLineEnd` fmt/printer.ts | 15.2 | 1.4 |

For JS and TS the Doc-build time is spread thinly: no single rule function passes 6% self. The printer functions that appear in each top 10 (`print`, `fits`, `breaks`, `visit`, `trimLineEnd`) add up to 49% of format self time in JSON, 47% in CSS, 35% in Python, 34% in JS and 28% in TS.

## Reading the numbers: the biggest lever per language

Everything here is evidence from the tables above, except where a line is marked as inference.

- **python (11.0x ruff):** ruff's whole run (30.7 ms) is below `node -e 0` (32.1 ms). The warm parse + format on the four files is 97.7 ms, which is 3.2x ruff on its own. The rest is cold-JIT excess (137 ms) and fixed cost (98 ms, 66 ms of it above bare Node). *Inference:* even a perfect cold start leaves about 130 ms (bare Node + warm work), which is 4.2x ruff. So passing ≤5x needs most of the cold-JIT excess and most of the above-Node fixed cost removed. No single phase gets there alone.
- **json (5.4x oxfmt on the corpus):** parse runs at the same speed cold and warm (168 vs 170 ms), so its cost is steady-state throughput. Parse is 55% of the warm run on big.json. Within format, the printer takes 56%, and `collect` spends 6% walking a tree with no comments. *Inference:* the lever is steady-state parse throughput, then the printer.
- **css (3.9x):** cold-JIT excess (114 ms) is larger than the whole warm parse + format (100 ms). The fixed cost is 74 ms. Within format, the printer takes 53%, and `breaks` alone is 11%.
- **js (6.3x):** cold-JIT excess is the single largest item (213 ms, which exceeds warm format at 129 ms). Warm, format is 67% of the work, and Doc build is 58% of format, spread across many rules.
- **ts (6.1x):** steady-state work dominates. Warm parse + format is 987 ms against 315 ms of cold-JIT excess and 119 ms of fixed cost. Format is 65% of warm, and Doc build is 65% of format. The largest named items are `fits` and `print` (11% each), then the per-node `wrap`/`printBare`/`role`/`needsParens` path, about 15% combined. *Inference:* the per-node overhead of dispatching rules and checking parens in JS/TS is the concentrated target inside Doc build.

## Doc size and allocations

This section tests one hypothesis: that per-node and per-token object allocation in Doc build and the printer is the cost to remove. It counts what one format of the largest input builds, finds where format allocates by bytes, and prices each allocation class in format time. Measured at `71f3346` (docs(research): measure where formatter time goes per language), same machine and inputs as section B. The warm format times used as the denominator come from the same session: json 119.9, css 40.8, js 68.9, ts 548.2 and python 19.5 ms. Run-to-run noise in warm format time is about ±5% (±10% for Python), so a delta under that size is unresolved.

### Findings

- **The Doc is already mostly allocation-free.** Doc nodes live in one `Int32Array`, and line, softline and hardline are shared constants. The printer's print and width-check stacks are typed arrays. `fits` allocates 0.1% of format bytes or less. The objects that remain are the JS arrays used as concatenations, one `PlacedToken` object per printed token, the output strings, and the rules' own temporaries: closures, `items` arrays, `map`/`filter` results, and Python's AST.
- **Format allocates 0.8 to 1.25 GB per second of format time:** 116 MB per pass on big.json and 433 MB on checker.ts. Doc build (the rules) accounts for 51-85% of those bytes. `print` accounts for 8-34%, and more than a third of its bytes are `PlacedToken` objects.
- **Pricing each class gives a small share of format time:**
  - Replacing `PlacedToken` objects with the handle: -2% to -6% in JSON, CSS, JS and TS. For Python the difference is within noise.
  - Retaining the Doc's JS arrays: 1-4% in a microbenchmark.
  - A 4x larger young generation (`--max-semi-space-size=64`): no faster in any language.
  - GC as a whole: 4-10%.
- **Walking the Doc costs more than allocating it.** The array branch of `print` and `fits` is 5-12% of format self time. The Doc holds 2.6-5.4 items (nodes plus arrays) per printed token. 25-50% of those arrays are empty. In JS and TS, 12-13% of the token docs that are built are never printed, because they sit in an `ifBreak` branch or conditional-group state that was not chosen.
- **Verdict:** removing allocation outright has a ceiling of about 10-20% of format time. That estimate comes from summing the measured shares above, which overlap, so the true ceiling is lower. It is not the lever for the ≤5x goal. The cost is the number of items built and visited per token, and the per-node dispatch around them.

### Doc size, largest input, one format

From `alloc.node.js size <lang>`. It hooks `print`'s one read of `layout.ruff`, which comes right after `docCount()`, so it reads the finished Doc before `releaseDocs`. "Leaves" counts tree nodes with no children. "Placed tokens" counts the tokens the printer emitted, which is the length of `anchors`. "Arrays" counts every distinct JS array the Doc reaches: those in `lists`, and those nested inside them.

| | json | css | js | ts | python |
| :-- | --: | --: | --: | --: | --: |
| tree nodes | 579,360 | 76,837 | 62,981 | 512,331 | 18,660 |
| tree leaves | 415,000 | 48,068 | 44,295 | 348,308 | 12,475 |
| placed tokens | 229,987 | 47,966 | 42,203 | 355,352 | 11,824 |
| Doc nodes (buffer) | 374,394 | 71,002 | 102,378 | 732,794 | 21,496 |
| of which token | 229,987 | 47,966 | 48,604 | 403,375 | 14,182 |
| text | 57,114 | 11,008 | 19,992 | 87,894 | 0 |
| group | 72,595 | 5,695 | 17,961 | 121,749 | 2,547 |
| indent | 14,698 | 5,828 | 10,653 | 78,233 | 2,485 |
| ifBreak | 0 | 0 | 4,215 | 33,513 | 1,321 |
| other kinds | 0 | 505 (fill, lineSuffix) | 953 (align, fill) | 8,030 (align, lineSuffix) | 961 (bestFitParenthesize, fitsExpanded, ...) |
| JS arrays in the Doc | 216,966 | 87,286 | 72,152 | 592,324 | 42,521 |
| of which empty | 57,861 (27%) | 22,042 (25%) | 21,536 (30%) | 175,518 (30%) | 21,462 (50%) |
| array elements | 576,625 | 154,110 | 173,108 | 1,262,924 | 63,361 |
| strings in the side table | 287,101 | 58,974 | 68,596 | 491,269 | 14,183 |
| output bytes | 2,886,402 | 283,202 | 551,543 | 3,043,179 | 101,539 |
| Doc nodes / placed token | 1.63 | 1.48 | 2.43 | 2.06 | 1.82 |
| Doc nodes + arrays / placed token | 2.57 | 3.30 | 4.14 | 3.73 | 5.41 |
| Doc nodes / output byte | 0.13 | 0.25 | 0.19 | 0.24 | 0.21 |
| token docs built but not printed | 0 | 0 | 6,401 (13%) | 48,023 (12%) | 2,358 (17%) |

Line docs do not appear in the node counts because every `line`, `softline` and `hardline` is a shared constant built at module load. They show up only as array elements. Placed tokens are fewer than leaves in JSON because a string's quote and content leaves print as one token.

### Where format allocates

From `alloc.node.js heap <lang> <passes>`. It uses V8's sampling heap profiler through `node:inspector` at a 256-byte interval, and keeps objects that a minor or major GC collected, so the numbers are bytes allocated rather than bytes retained. Parse and format are sampled in separate windows. Format runs on trees parsed before its window opens. Bytes are attributed to the allocating JS function. A builtin such as `push`, `slice` or an iterator's `next` is charged to its caller. `ArrayBuffer` backing stores are not sampled, so these numbers leave out the printer's typed arrays and the Doc buffer. The profile gives bytes but not object counts: Node's sampled `size` is the allocation step, not the object. A check on 1M `{node, text, synthetic}` objects read 56 MB, which is 48 bytes per object plus the 8-byte array slot that holds it. Object counts therefore come from the table above.

| | json | css | js | ts | python |
| :-- | --: | --: | --: | --: | --: |
| parse, MB/pass | 53.3 | 8.6 | 13.8 | 130.9 | 7.8 |
| format, MB/pass | 116.5 | 51.0 | 58.9 | 433.4 | 21.6 |
| format bytes per input byte | 37 | 186 | 111 | 144 | 216 |
| format allocation rate, GB/s of format time | 0.97 | 1.25 | 0.85 | 0.79 | 1.11 |
| Doc build (rules), % of format bytes | 65.7 | 85.4 | 83.6 | 84.5 | 51.3 |
| Python `toAst` | - | - | - | - | 36.5 |
| printer `print` | 34.3 | 14.6 | 14.8 | 13.8 | 8.3 |
| comment attachment | 0.0 | 0.0 | 1.4 | 1.6 | 3.9 |
| printer `fits` | 0.0 | 0.0 | 0.0 | 0.1 | 0.0 |

In parse, a single site allocates most of the bytes in every language: `reduceLinear` (`core/parser.ts`) takes 99% in JSON, 83% in JS and 70% in TS, and `popLinear` (`core/stack.ts`) takes 92% in CSS. Python splits between `lex` (51%) and `reduceLinear` (43%).

The top allocating functions under format, in % of format bytes. A source line is the function's first line.

| Language | Top sites |
| :-- | :-- |
| json | `print` fmt/printer.ts 33.8, seqRule closure fmt/rules.ts 24.0, listRule closure fmt/rules.ts 12.0, `verbatimRule` 9.5, listRule `items.map` callback 6.8, `nextLineEmpty` fmt/text.ts 4.0, `token` fmt/doc.ts 3.4 |
| css | `print` 14.3, `declaration` grammars/css/fmt.ts 12.3, `concat` 7.1, `parts` 5.6, `commaGroups` 5.3, `braces` 4.7, `selectors` 4.2, then 12 functions of 2.5-3.5 each |
| js | `print` 14.4, `getComments` grammars/javascript/print/util.ts 7.7, `argumentsDoc` calls.ts 4.0, `separators` util.ts 3.7, `commaAfter` objects.ts 3.5, `role` parens.ts 3.0, then a long tail under 3 |
| ts | `print` 13.6, `getComments` 7.6, `argumentsDoc` 5.0, `separators` 4.2, `role` 3.7, `ctx.print` fmt/format.ts 3.1, `wrap` closure 2.8, `fallback` 2.7, then a long tail under 2.7 |
| python | `formatExpr` grammars/python/fmt/expr.ts 8.9, `print` 8.1, `bare` fmt/ast.ts 7.2, `named` 4.5, `tokens` fmt/trivia.ts 4.3, `needField` 4.3, then a long tail under 3 |

`role` and `getComments` allocate on every node they are asked about. For `role`, that is the result object `{parent, key, top}`. The seqRule closure allocates `used`, `docs`, a `[]` for each missing part, and one `tree.text()` string for each literal token.

*Inference from counts times measured object size:* of `print`'s bytes, `PlacedToken` objects (48 B each) and the growth of the array holding them come to about 15 MB of 39 MB per pass in JSON and about 23 MB of 59 MB in TS. Almost all the rest is output strings: `current += s` cons strings, their flattening at each line end, the `out` array and the final `join`.

### What each allocation class costs in format time

Evidence comes from three sources:

- **A/B:** a scratch patch of `dist/fmt/printer.js`, run as warm format medians. Baseline and variant alternate three times each, and the table shows the median delta. The patch was reverted after the runs.
- **Line ticks:** self time on the named source lines of `--cpu-prof` profiles of the section-B warm runs, taken with the `lines.mjs` method and given as % of format samples.
- **Microbenchmark:** a standalone loop that allocates the same count and shape.

| Class | json | css | js | ts | python | Source |
| :-- | --: | --: | --: | --: | --: | :-- |
| `PlacedToken` objects, `tokens.push({node, text, synthetic})` → `tokens.push(handle)` | -3.4% | -6.3% | -2.4% | -5.1% | +3.0% (noise) | A/B |
| the same lines' self time in `print` | 1.9% | 0.4% | 0.7% | 1.0% | 0.8% | line ticks |
| Doc JS arrays: allocate and retain, by literal | 2.9 ms (2.4%) | 1.4 ms (3.4%) | 0.9 ms (1.4%) | 23.7 ms (4.3%) | 0.6 ms (3.3%) | microbenchmark |
| the same elements in one growing `Int32Array` | 1.9 ms | 0.7 ms | 0.6 ms | 4.6 ms | 0.3 ms | microbenchmark |
| Doc JS arrays built by `push` instead of literal | 15.0 ms | 1.5 ms | 1.3 ms | 64.7 ms | 0.7 ms | microbenchmark |
| walking arrays in `print` + `fits` (`typeof d !== "number"`, the loop, `push`/`fpush(ds[i])`) | 5.4% | 12.2% | 5.8% | 4.6% | 9.4% | line ticks |
| building the output string (`out.join("")` line alone) | 2.6% | 1.6% | 1.1% | 1.4% | 0.4% | line ticks |
| printer stacks and `fits` frames | allocate nothing (typed arrays; `fits` 0.0-0.1% of bytes) | | | | | heap profile |
| GC, share of format phase time | 8.4% | 6.8% | 4.4% | 8.2% | 7.3% | `PerformanceObserver` |
| `--max-semi-space-size=64` (4x young generation) | +9.4% | +6.7% | -10.0% | +1.2% | +1.0% | A/B, all within noise |

In the Doc-build rules sampled for line ticks, no single allocating line reaches 2% of format:

- **json:** seqRule's `docs.push(... token(child, tree.text(child)))` is 1.5%. listRule's `items.map` line is 1.0%.
- **css:** `declaration` spreads across its lines at 0.4-1.0% each.
- **js and ts:** `printBare` spends 3-4% on its one line `return rule(node, ctx, args)`, the megamorphic call into the rule. That is dispatch, not allocation. `role`, `needsParens` and `argumentsDoc` spread at 0.1-1.2% per line.
- **python:** `commentIndentationAfter`'s hottest line (2.5%) is the end of a `filter` callback.

### Reading it against the hypothesis

Everything above is evidence except where marked.

- **Already done, nothing left to remove:**
  - Doc nodes as objects: they are `Int32Array` slots.
  - Printer command tuples and stack frames: parallel typed arrays in both `print` and `fits`.
  - Line docs: shared constants.
- **Could be removed outright, with measured share:**
  - `PlacedToken` objects, replaced by an `Int32Array` of handles next to the existing `at`. The node, text and synthetic flag are all readable from the handle while the buffer is live. Share: 2-6% of format where it resolves above noise (JSON, CSS, TS). *Inference:* the anchors would have to be built before `releaseDocs`, or the three fields copied into typed arrays.
  - Empty arrays: 25-50% of the Doc's arrays. They could be one shared constant. Share: a fraction of the array row, under 1-2%.
  - Doc arrays as a class, replaced by a concat node whose children sit in the buffer. The allocation part is 1-4% by the microbenchmark (up to 11% in JSON and TS if the arrays are the push-built kind). *Inference:* the 5-12% array-walking share would shrink only partly, since a concat node is still walked.
- **Not allocation, and larger:**
  - The printer visits 2.6-5.4 Doc items per printed token, and `fits` re-walks them.
  - JS and TS build 12-13% of their token docs in branches that are never printed.
  - Every node pays a megamorphic rule call plus `role`/`needsParens`/`getComments` work.
  - *Inference:* merging adjacent tokens and texts into one run, building one branch lazily where only one is printed, and cutting per-node dispatch attack the same items that allocation-free storage would. They also remove the walking and dispatch cost that allocation-free storage leaves in place.

## Reproduce

```sh
# once, in a fresh worktree
bash scripts/worktree-setup.sh
pnpm run build

node packages/syntechs/dist/fmt/phases.node.js cold json   # also css, js, ts, python
node packages/syntechs/dist/fmt/phases.node.js warm ts 5
node --cpu-prof --cpu-prof-dir=<dir> packages/syntechs/dist/fmt/phases.node.js warm ts 5
node packages/syntechs/dist/fmt/phases.node.js analyze <dir>/<file>.cpuprofile
node packages/syntechs/dist/fmt/alloc.node.js size ts
node packages/syntechs/dist/fmt/alloc.node.js heap ts 2 [<dir to save .heapprofile files>]
```

`alloc.node.js` is `packages/syntechs/src/fmt/alloc.node.ts`. Heap passes used above: json 3, css 10, js 10, ts 2, python 20.

The script is `packages/syntechs/src/fmt/phases.node.ts`. Its child mode (`cold-child <dir>`) statically imports only Node builtins, so its import rows time exactly what `cli.node.js` loads.
