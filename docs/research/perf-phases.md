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

## Reproduce

```sh
# once, in a fresh worktree
bash scripts/worktree-setup.sh
pnpm run build

node packages/syntechs/dist/fmt/phases.node.js cold json   # also css, js, ts, python
node packages/syntechs/dist/fmt/phases.node.js warm ts 5
node --cpu-prof --cpu-prof-dir=<dir> packages/syntechs/dist/fmt/phases.node.js warm ts 5
node packages/syntechs/dist/fmt/phases.node.js analyze <dir>/<file>.cpuprofile
```

The script is `packages/syntechs/src/fmt/phases.node.ts`. Its child mode (`cold-child <dir>`) statically imports only Node builtins, so its import rows time exactly what `cli.node.js` loads.
