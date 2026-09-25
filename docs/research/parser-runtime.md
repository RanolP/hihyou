# Parser runtime for hihyou: web-tree-sitter, a bulk-export build, or tree-sitter re-implemented in TS

## Recommendation

> Superseded on 2026-09-25: the user ruled out wasm. The pure-TS runtime now exists and has been measured. See the section dated 2026-09-25 at the end of this document.

Ship option B now: build the tree-sitter C runtime and the grammars into our own wasm module, which has one export that serializes the whole tree into a `Uint32Array`, and put it behind the `parse/` interface. Do not re-implement tree-sitter in TS yet. Keep option C (a pure-TS runtime running on tables tree-sitter generated) as a later, optional stage, and scope it to grammars without an external scanner, with B as the fallback.

The top three reasons, each backed by measurements further down:

1. The cost we can remove cheaply is the JS↔wasm boundary, not the parse. web-tree-sitter's cursor walk costs 0.7–1.3x the parse itself, and materializing to JS objects costs 1.1–2.5x the parse. B replaces all of those crossings with one export call. With B, parse plus materialize drops from 58.5 to 35.1 ms on `scanner.ts`, and from 712 to 435 ms on `checker.ts`, and the trees are node-for-node identical to web-tree-sitter's.
2. A pure-TS runtime is fast only on the happy path, and parity is the expensive part. The spike parses JSON 3.4x faster than web-tree-sitter on the same tables and walks 6–7x faster. But it skips GLR, error recovery, external scanners, keywords, aliases and fields. The TypeScript grammar declares 48 GLR conflicts and 10 external tokens. gotreesitter, the one mature non-C port, spent about 177k lines of Go and still reports parity divergences, and it runs 4–5x slower than C.
3. Lezer (option E) is not a drop-in alternative. On real TypeScript compiler sources, `@lezer/javascript` in TS mode produces 6 error nodes in `scanner.ts` and 17 in `checker.ts`, while tree-sitter produces none. Its parse is 1.5–1.75x slower than web-tree-sitter's. It also yields a different tree shape, which would change what hihyou diffs.

The staged path:

- **Stage 1 (now, about 1–2 person-weeks, inference):** ship B behind `parse/`. The flat record format becomes the contract every runtime must emit.
- **Stage 2:** build a tree-parity harness that compares any runtime's records against B over a corpus. This is `sameAsWts` from `research/parser-bench/bulk.mjs`, generalized.
- **Stage 3 (optional, only if profiling the full hihyou pipeline still shows parse as the bottleneck):** grow the spike into a C-lite runtime for scanner-less, conflict-free grammars. It falls back to B on the first `RECOVER` action or multi-action entry.
- **Full C or D:** undertake only with a multi-month budget.

## Premises and constraints

The fixed constraints come from the brief. hihyou must run in Node and inside a browser extension, with no native bindings. The user's words are "we "may re-implement" entire tree-sitter as a embeddable typescript library ... performance matters". So performance is the deciding axis, and "may" makes a re-implementation optional rather than a goal in itself.

Premises I chose, which the reader should check:

- hihyou needs the whole tree in JS: every node's type, range and row/column, plus leaf text, because GumTree matching visits every node. So "parse + full materialize" is the number that matters, not parse alone.
- The same tree-sitter grammars stay the source of truth, so tree shape must match upstream tree-sitter exactly.
- Incremental reparse and queries are not needed, because hihyou diffs two complete snapshots.

## Measurements

Setup:

- Machine: this Windows 11 machine, Node v24.18.0.
- Parsers: web-tree-sitter 0.27.0, tree-sitter-typescript 0.23.2, tree-sitter-python 0.25.0, tree-sitter-json 0.24.8, @lezer/javascript 1.5.5, @lezer/lr 1.4.10, and native node-tree-sitter 0.25.1 (prebuilt).
- Timing: the median of 15 runs after 1 warm-up, in ms.
- Inputs: TypeScript v5.8.3 `src/compiler/scanner.ts` (4101 lines, 214 KB) and `checker.ts` (53016 lines, 3.0 MB), CPython v3.13.0 `Lib/argparse.py` (2670 lines), and TypeScript v5.8.3 `package-lock.json` (8063 lines, 348 KB).
- Walk: visits every node and reads the type, start and end index, start and end position, and leaf text.
- Scripts: `research/parser-bench/` (`bench.mjs`, `native.mjs`, `bulk.mjs`, `cold.mjs`, plus `fetch-inputs.sh`) and `research/ts-sitter-spike/`.

### web-tree-sitter (option A) and Lezer (option E)

| file | nodes | wts parse | cursor walk | `.children` walk | firstChild/nextSibling walk | materialize to objects | materialize, no `isNamed` | plain-object walk | lezer nodes | lezer errors | lezer parse | lezer walk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| scanner.ts | 43169 | 26.0 | 17.1 | 20.8 | 39.0 | 32.5 | 17.3 | 1.0 | 40238 | 6 | 39.4 | 2.1 |
| checker.ts | 512331 | 281.5 | 206.1 | 291.0 | 492.1 | 430.4 | 265.0 | 35.2 | 494272 | 17 | 492.9 | 34.2 |
| argparse.py | 18660 | 14.8 | 10.1 | 10.0 | 18.0 | 16.4 | 7.4 | 0.2 | 16511 | 0 | 16.5 | 1.0 |
| package-lock.json | 64373 | 17.7 | 23.3 | 26.2 | 44.7 | 44.3 | 25.0 | 0.6 | 33537 | 0 | 25.0 | 2.2 |

Evidence for reason 1:

- Walking the already-materialized plain objects costs 0.2–35 ms. Walking the same tree through web-tree-sitter costs 10–492 ms. The difference is boundary crossings: each property read and each cursor step is its own wasm export call through the transfer buffer.
- Reading `isNamed` alone adds 60–120% to materialization.

### Native node-tree-sitter (reference only)

| file | parse | cursor walk | `.children` walk |
|---|---|---|---|
| scanner.ts | 21.8 | 34.5 | 116.9 |
| checker.ts | 247.1 | 438.1 | 1646.7 |
| argparse.py | 10.3 | 14.9 | 72.3 |
| package-lock.json | 15.8 | 49.9 | 179.6 |

Native parse is only 11–30% faster than wasm, and its N-API walks are 1.5–7x slower than web-tree-sitter's. So even a native build would not remove the walk cost, which the brief rules out anyway.

### Bulk export (option B)

The build is `research/parser-bench/bulk/`: the tree-sitter v0.27.0 runtime plus the TS, Python and JSON grammars, compiled with `zig cc -target wasm32-wasi` from the PyPI `ziglang` package. The module imports only three WASI functions (`fd_close`, `fd_seek`, `fd_write`), which the parse path never calls, so JS stubs them and no WASI polyfill is needed. One `export_tree` call writes pre-order records of 8 u32 each: symbol with named/error/missing bits, child count, start, end, start row, start column, end row, end column. Offsets are in UTF-16 units, because input is passed as UTF-16LE. All four trees compare identical to web-tree-sitter's, node for node.

| file | parse | export (1 crossing + copy) | walk records | materialize to objects | parse+export+walk | wts parse+cursor walk | wts parse+materialize | B parse+export+materialize |
|---|---|---|---|---|---|---|---|---|
| scanner.ts | 27.1 | 5.6 | 0.4 | 2.4 | 32.0 | 43.1 | 58.5 | 35.1 |
| checker.ts | 309.4 | 73.0 | 3.9 | 52.4 | 440.3 | 487.6 | 711.9 | 434.8 |
| argparse.py | 13.8 | 2.0 | 0.1 | 0.7 | 14.7 | 24.9 | 31.2 | 16.5 |
| package-lock.json | 25.8 | 8.4 | 0.3 | 3.1 | 32.8 | 41.0 | 62.0 | 37.3 |

The wts columns sum the separately measured medians from the first table. B's export+materialize is 3.4–6x faster than wts materialize. Its parse ranges from 7% faster to 46% slower than the web-tree-sitter build of the same C, as the JSON row shows.

Inference: the likely causes are the zig/wasi-libc `malloc` against emscripten's allocator, and the build flags. Tuning that is part of stage 1, not a blocker.

Instantiation takes 0.3–0.4 ms.

### Pure-TS spike on tree-sitter's own tables (toward option C)

`research/ts-sitter-spike/gen.ts` compiles tree-sitter-json's `src/parser.c` to TS: typed-array parse tables, the small-table map, parse actions and lex modes, and `ts_lex` translated from `switch`/`goto` C into a JS `for`/`switch` loop. `runtime.ts` is a deterministic LR loop that emits a struct-of-arrays tree with hidden nodes already spliced out, which reproduces tree-sitter's extras placement and root span.

What it deliberately skips:

- GLR: only the first `REDUCE` of an entry runs.
- Error recovery: anything unexpected throws `ParseError`.
- External scanners, keyword lexing, aliases, fields, reserved words and dynamic precedence.
- Incremental reuse and byte offsets.

| file | nodes | same tree as wts | wts parse | spike parse | wts cursor walk | spike walk | wts parse+walk | spike parse+walk |
|---|---|---|---|---|---|---|---|---|
| edge.json (comments, raw newline in string, non-BMP char, empty containers) | 56 | true | 0.0 | 0.0 | 0.3 | 0.0 | 0.1 | 0.0 |
| package-lock.json | 64373 | true | 16.9 | 4.9 | 21.2 | 3.1 | 38.7 | 8.6 |
| big.json (package-lock ×9, 3.1 MB) | 579360 | true | 161.8 | 47.1 | 203.0 | 31.9 | 350.5 | 113.8 |

On identical tables, pure TS parses 3.4x faster than tree-sitter-in-wasm and is 3–4.5x faster end to end.

Inference: the gap comes from per-token work the spike skips, not from JS beating wasm. Tree-sitter's runtime does the following for every token:

- allocates refcounted subtrees
- keeps a GLR stack of versions
- tracks padding, lookahead bytes and error cost
- decodes input through a callback

Each feature added for parity (GLR, error recovery, fields, scanners) adds some of that cost back. The only external data point is gotreesitter's `BENCH.md`, where the parity-complete Go port parses 4.8x slower than C (geomean, production mode).

### Cold start (15 fresh processes)

| step | ms |
|---|---|
| import web-tree-sitter JS | 4.0 |
| init runtime wasm | 4.4 |
| load TS grammar / first tiny parse | 2.6 / 2.9 |
| load Python grammar / first tiny parse | 0.9 / 0.8 |
| load JSON grammar / first tiny parse | 0.3 / 0.1 |
| import + configure Lezer TS | 13.0 |
| Lezer first tiny parse | 1.8 |
| instantiate bulk.wasm (B) | 0.3–0.4 |

Cold start is negligible for every option, so it does not decide anything.

### Bundle size for the extension

| artifact | raw | gzip | brotli |
|---|---|---|---|
| web-tree-sitter.wasm (runtime) | 209613 | 82869 | 68067 |
| web-tree-sitter.js | 156132 | 31797 | 26861 |
| tree-sitter-typescript.wasm | 1413849 | 134049 | 93152 |
| tree-sitter-tsx.wasm | 1445638 | 136318 | 99258 |
| tree-sitter-python.wasm | 457883 | 64653 | 50558 |
| tree-sitter-json.wasm | 5596 | 2209 | 1877 |
| **A total (runtime + JS + TS + Python + JSON)** | 2243073 | 315577 | 240515 |
| bulk.wasm, runtime + TS + Python + JSON, `-O2` unstripped | 3543566 | 751829 | 591945 |
| **bulk.wasm, same content, `-Os -s` (B)** | 1961383 | 232521 | 176962 |
| @lezer/lr + @lezer/common + @lezer/javascript (E, TS/JS only) | 235686 | 68218 | not measured |

The `-Os -s` build parses 6–18% slower than `-O2` (`scanner.ts` 28.8 vs 27.1 ms, `checker.ts` 364.6 vs 309.4 ms, 9 runs). Stripped, B is about 26% smaller than A (gzip), because it drops emscripten's JS glue and the dynamic-linking metadata that each grammar side module carries.

## Q1: tree-sitter internals

`tree-sitter generate` emits one `src/parser.c` per grammar. It contains:

- symbol names and metadata (visible, named, supertype)
- the parse table, in two parts. States with index ≤ 1, or with more than min(64, symbols/2) entries, go into a dense `ts_parse_table[LARGE_STATE_COUNT][SYMBOL_COUNT]` (`render.rs`). The rest go into `ts_small_parse_table`, stored as groups of (value, count, symbols…) and indexed through `ts_small_parse_table_map`.
- `ts_parse_actions`, whose kinds are SHIFT, SHIFT_REPEAT, SHIFT_EXTRA, REDUCE(symbol, child count, dynamic precedence, production id), ACCEPT and RECOVER
- `ts_lex_modes`
- the lexer `ts_lex`, emitted as C `switch`/`goto` with `START_LEXER`, `ADVANCE`, `ADVANCE_MAP`, `SKIP`, `ACCEPT_TOKEN` and `set_contains` character ranges
- `ts_lex_keywords` for keyword extraction
- field and alias maps
- supertype maps
- reserved-word sets (ABI 15)
- external-scanner symbol maps and valid-token tables

`parser.c` is the only machine-complete output. `--json-summary` carries diagnostics, and `node-types.json` carries node shapes only, not tables. So a TS runtime must parse `parser.c`, as `gen.ts` and gotreesitter's `ts2go` do, or fork the generator's Rust `render.rs` to emit TS directly.

Runtime sizes: tree-sitter master is 0.28.0, ABI 15, and `lib/src` holds 14695 lines of `.c` plus 2142 of `.h`.

| file | lines | needed by hihyou |
|---|---|---|
| parser.c (GLR driver, error recovery) | 2312 | yes |
| stack.c (graph-structured stack, max 6 versions) | 912 | yes |
| subtree.c | 1095 | yes |
| lexer.c | 511 | yes |
| language.c | 394 | yes |
| node.c | 869 | yes |
| tree_cursor.c | 724 | yes |
| tree.c, alloc.c, point.c, lib.c | 265 | yes |
| query.c | 4880 | no |
| wasm_store.c | 2176 | no |
| get_changed_ranges.c + reusable-node path | 557 + part of parser.c | no (incremental only) |

About 9k lines of C are needed and about 7.8k are skippable, counting the headers each part uses.

Parity-critical details:

- Error recovery is cost-based. The constants are `ERROR_COST_PER_RECOVERY` 500, `…_MISSING_TREE` 110, `…_SKIPPED_TREE` 100, `…_SKIPPED_LINE` 30 and `…_SKIPPED_CHAR` 1. The parser compares stack versions against these costs, so matching tree-sitter's error trees exactly means porting that search, not approximating it.
- SHIFT_REPEAT is skipped when an entry also reduces.
- Hidden nodes and aux repeats are spliced into their parents.
- Trailing extras are moved outside a reduced node.
- The root spans leading extras and trailing padding.

The spike had to reproduce the last three to match on `edge.json`.

GLR conflicts declared in the benchmark grammars: typescript 48, python 9, json 0.

## Q2: external scanners

| grammar | scanner | lines | external tokens | what it handles |
|---|---|---|---|---|
| typescript / tsx | `common/scanner.h` (C) | 347 | 10 | automatic semicolon insertion (ASI), template chars, ternary `?`, HTML comments, `\|\|`, escape sequences, regex patterns, JSX text, function-signature ASI, error-recovery sentinel; uses `iswalpha` |
| javascript | C | 364 | 8 | same family as TS |
| python | C | 437 | 12 | newline, indent and dedent stack (serialized state), string start/content/end, f-string escape interpolation, comment, bracket tokens, `except` |
| css | C | 100 | 3 | descendant operator, pseudo-class colon, error-recovery sentinel |
| json | none | 0 | 0 | none |
| rust | C | 403 | 11 | string content, raw strings (hash counting), float literals, nested block comments, doc comments |
| go | none | 0 | 0 | none |
| java | none | 0 | 0 | none |
| c-sharp | C | 640 | 13 | optional semicolon, interpolated, verbatim and raw strings, lambda paren |
| ruby | C | 1110 | 30 | heredocs, string/symbol/regex/array literal starts, line-break sensitivity, unary vs binary operators |
| yaml | C | 1417 | 113 | the whole indentation and block/flow structure |
| markdown (block) | C | 1602 | 47 | the whole block structure: containers, list markers, fences, headings |
| markdown-inline | C | 397 | 15 | emphasis, code spans, strikethrough, LaTeX spans |
| html | C | 362 | 9 | tag-name stack for implicit end tags, raw text, comments |

There are three options for scanners in a pure-TS world:

- **Hand-port each scanner.** This is about 1 person-week per small scanner and 2–4 for ruby, yaml or markdown (inference). Each port must then be re-diffed whenever upstream changes `scanner.c`. gotreesitter does exactly this and carries 119 hand-written Go scanners across 206 grammars.
- **Transpile C to TS mechanically.** This is plausible for the subset scanners use: a `TSLexer` vtable, `iswspace`/`iswalpha`, a fixed-size state struct serialized with `memcpy`, and the `Array(T)` macros from `tree_sitter/array.h`. But a tool that handles pointer arithmetic and the `array.h` macros generally is itself about 4–8 person-weeks, and it breaks silently on new C idioms (inference).
- **Keep a tiny wasm module per scanner.** This undoes the benefit. The scanner calls `lexer->advance` and reads `lexer->lookahead` per character through the `TSLexer` callbacks, so a TS runtime driving a wasm scanner would cross the boundary per character. That is worse than today's per-node cost (inference from the call structure; not measured).

## Q3: prior art

| project | what it is | status | performance |
|---|---|---|---|
| web-tree-sitter 0.27.0 | official C runtime compiled with emscripten; grammars as wasm side modules | active (published 2026-08-30) | measured above |
| gotreesitter (github.com/odvcencio/gotreesitter) | pure-Go tree-sitter runtime; `ts2go` extracts tables from `parser.c`; 119 hand-ported scanners for 206 grammars | active (last commit 2026-09-24), 567 stars, MIT | its `BENCH.md`: full parse 4.8x slower than C (geomean, production), 3.99x in compact mode |
| lezer-parser/import-tree-sitter | converter from tree-sitter grammars to Lezer | archived (last push 2026-04-15), described as "Helps import tree-sitter grammars" | n/a |
| Lezer (`@lezer/lr` 1.4.10, `@lezer/generator` 1.8.1, `@lezer/javascript` 1.5.5) | pure-JS incremental LR parser with GLR splitting; its own grammar format and grammars | active | measured above: 1.5–1.75x slower parse than wts on TS, but a nearly free walk (compact buffer tree) |

gotreesitter is a warning about scope. It needs about 177k lines of non-test Go in its root package, about 164k lines of tests and about 99k lines in `grammars/`. Its parity boards still show divergences, for example 29 of 69 supertype-map cases differ, and there are many per-grammar `parser_result_*` compatibility files. I found no pure-JS or pure-TS tree-sitter runtime.

Lezer is the design reference for the output side. Its tree is a flat `Uint16Array`/`Uint32Array` buffer that JS walks at plain-array speed, which is the same idea as B's record format.

## Q6: the options compared

Person-week figures are inference from the code sizes above and from gotreesitter's scale, not measurements.

| | A: web-tree-sitter | B: own wasm + bulk export | C: pure-TS runtime + table compiler + hand-ported scanners | D: C + C→TS scanner transpiler | E: Lezer |
|---|---|---|---|---|---|
| parse + materialize, `scanner.ts` / `checker.ts` | 58.5 / 712 ms | 35.1 / 435 ms | unknown for TS. JSON happy path is 3.4x faster than wasm, but parity work adds cost back (gotreesitter: 4–5x slower than C) | same as C | 41.5 / 527 ms parse+walk, but on a different, partly erroneous tree |
| engineering cost | 0 | 1–2 pw | 12–26 pw for TS + Python + JSON at error-recovery parity, then about 1–4 pw per extra scanner | C + 4–8 pw, with lower per-grammar cost afterwards | 1 pw to integrate. Missing syntax is fixed upstream or in our own grammar fork |
| correctness risk | none (reference) | none: same C, trees verified identical | high: GLR + cost-based error recovery must match tree-sitter exactly or diffs change | high, plus transpiler bugs | high: 6 and 17 error nodes on real TS sources; node types differ from tree-sitter |
| bundle (gzip, TS + Python + JSON) | 316 KB | 233 KB | estimated similar to B (the tables dominate; inference) | same as C | 68 KB, TS/JS only |
| maintenance on grammar updates | bump the package | rebuild the wasm (zig via `uvx`, no emscripten) | regenerate tables, follow `parser.c` ABI changes, re-port changed scanners by hand | regenerate and re-transpile | follow Lezer's grammars, not tree-sitter's |

## Things that surprised me

- Native node-tree-sitter parses only 11–30% faster than wasm, and walks 1.5–7x slower than web-tree-sitter.
- The pure-TS happy path beats tree-sitter-in-wasm by 3.4x on identical tables. The runtime's generality, not the wasm boundary, is what makes wasm parsing slow.
- Our own zig-built runtime parses up to 46% slower than emscripten's build of the same C (on JSON). Allocator and flag tuning is open work for stage 1.
- Calling web-tree-sitter's `Language.load` twice on the same grammar bytes in one process broke later parses with "null function or function signature mismatch". Loading each grammar once avoids it. I did not isolate the cause.

## 2026-09-25: the pure-TS runtime built and measured (`packages/sitter`)

The brief changed: "i said no wasm at all. why don't implement and compare?" and "we may run on browser without any server." That rules out options A and B for the shipped product, so I built option C and measured it against web-tree-sitter 0.27. web-tree-sitter now serves only as the reference.

What was built:

- **Runtime.** A faithful port of tree-sitter's `parser.c`, `stack.c` and `subtree.c`, in about 2.8k lines of TypeScript. It covers GLR stack splitting and merging, cost-based error recovery (MISSING insertion, ERROR wrapping, skipping), keywords, aliases, fields and external scanners. Positions are UTF-16 code units, so byte offsets are 2x units. It is browser-safe: Node APIs appear only in the `*.node.ts` build tooling.
- **Table compiler.** `compile.node.ts` compiles each grammar's `parser.c` into a TypeScript module under `src/generated/`, lexer functions included. The output is committed, because it is a pure function of the grammar versions in the lockfile.
- **Scanners.** CSS, JavaScript, TypeScript/TSX (one shared scanner) and Python are ported by hand. The Python scanner serializes its state byte for byte as the C scanner does.

### Parity

Every input's tree was compared against a web-tree-sitter cursor walk. The comparison covers each node's kind, whether it is named, whether it is MISSING, its start and end, and its field name, in preorder. Once those agree, it also compares the `SyntaxTree` hihyou consumes, rebuilt from the cursor the way `packages/engine` does: each node's label, parent, height and size, and the tree's `errorChars`. The corpus is each grammar's own test corpus plus real files, and most inputs deliberately contain errors.

| grammar | inputs identical | nodes compared | inputs with ERROR/MISSING |
|---|---|---|---|
| JSON | 609/609 | 731,844 | 486 |
| CSS | 63/63 | 154,474 | 61 |
| JavaScript | 168/168 | 261,161 | 151 |
| TypeScript | 1638/1638 | 1,670,571 | 1337 |
| TSX | 54/54 | 99,232 | 46 |
| Python | 126/126 | 110,140 | 108 |

As a check that divergences are detectable, comparing the JSON tables against the CSS wasm reports a divergence at node 0. The corpus is fetched, not committed, so `pnpm test` runs its own committed parity cases per grammar against web-tree-sitter. Most are broken inputs that force error recovery, Python dedent mismatches, unclosed templates and ASI branches.

The corpus alone did not prove Unicode parity. Before `iswalpha` used musl's table, a sweep of `"a\nin" + c + " b"` over every non-surrogate code point from U+0080 to U+1FFFF diverged from web-tree-sitter on 6,704 of 128,896 code points in JavaScript, TypeScript and TSX. For example, U+0363 is alphabetic to JavaScript's `\p{Alphabetic}` but not to musl, and U+0660 is the reverse. No corpus input contained such a code point. `wctype.node.ts` now reads musl's `iswalpha` out of `web-tree-sitter.wasm` into a committed range table. After the fix, that sweep, the same sweep after `instanceof`, and whitespace and `iswalnum` sweeps for the JavaScript and CSS scanners all report 0 divergences. `wctype.test.ts` keeps it that way: it checks `iswalpha`, `iswalnum`, `iswdigit` and `iswspace` against the wasm exports on every code point up to U+10FFFF.

### Speed (parse + materialize, warm median of 15, ms)

The wasm side walks the tree the way `packages/engine` does, so its numbers are lower than the A column above, which read more per node.

| grammar | input | ours | web-tree-sitter | ours / wts |
|---|---|---|---|---|
| JSON | big.json (3.1 MB) | 427.5 | 354.1 | 1.21x |
| JSON | package-lock.json | 38.8 | 37.5 | 1.04x |
| CSS | bootstrap.css | 66.1 | 50.1 | 1.32x |
| CSS | normalize.css | 0.4 | 0.6 | 0.64x |
| CSS | animate.css | 24.1 | 19.8 | 1.22x |
| JavaScript | lodash.js | 86.9 | 60.8 | 1.43x |
| JavaScript | jquery.js | 88.3 | 58.0 | 1.52x |
| TypeScript | scanner.ts | 58.6 | 39.5 | 1.49x |
| TypeScript | checker.ts | 738.1 | 578.5 | 1.28x |
| TSX | excalidraw App.tsx | 79.8 | 53.3 | 1.50x |
| TSX | excalidraw LayerUI.tsx | 3.2 | 3.7 | 0.85x |
| Python | argparse.py | 22.3 | 18.6 | 1.20x |
| Python | typing.py | 26.0 | 22.2 | 1.17x |
| Python | dataclasses.py | 13.4 | 19.3 | 0.70x |
| Python | base_events.py | 15.6 | 13.7 | 1.14x |

### Cold start and size

Cold start is the median of 7 fresh processes, from loading the grammar through the first parse. Sizes are esbuild min+gzip of the runtime plus one grammar. For web-tree-sitter, the size is its JS (75 KB min), plus the runtime wasm (205 KB), plus the grammar wasm, all gzipped.

| grammar | cold, ours (ms) | cold, wts (ms) | ours, min | ours, gzip | wts, gzip |
|---|---|---|---|---|---|
| JSON | 3.5 | 8.9 | 35 KB | 11 KB | 103 KB |
| CSS | 9.9 | 10.6 | 132 KB | 27 KB | 122 KB |
| JavaScript | 12.4 | 12.5 | 333 KB | 61 KB | 150 KB |
| TypeScript | 17.1 | 11.8 | 902 KB | 162 KB | 237 KB |
| TSX | 17.2 | 11.8 | 919 KB | 164 KB | 240 KB |
| Python | 10.8 | 10.5 | 394 KB | 82 KB | 168 KB |

### What is not ported or not verified

- **Not ported:**
  - incremental reparse (`edit`, subtree reuse), balancing, and included ranges;
  - queries, and the Node API beyond the `SyntaxTree` shape hihyou consumes.

  hihyou diffs two complete snapshots, so none of these is on its path today.
- **Rare recovery branches.** `pnpm test` reaches `recover`, `condenseStack` and the stack's `popError` and link merging, but not the cap that drops stack versions past `MAX_VERSION_COUNT`. `breakdownTopOfStack` runs but never breaks a subtree down: a pending entry needs a non-leaf lookahead, which only subtree reuse in incremental reparse supplies, and that is not ported.
- **Scanner buffer limit.** The case where a scanner's serialized state exceeds the 1024-byte buffer follows the C code, but no input reached it.
- **Performance.** The performance gap is not profiled. The port mirrors C's data layout and has no JS-specific tuning yet.
- **Engine wiring.** `packages/engine` still uses web-tree-sitter.

### Recommendation

Adopt the pure-TS runtime. It meets the new hard constraints that A and B cannot: no wasm, and it runs in a browser with no server. It does so with node-for-node parity on 2,658 inputs across six grammars, and on every code point the scanners classify.

The costs:

- **Warm parse.** 1.0–1.5x slower warm on large files, and faster on several small ones.
- **Cold start.** Equal or faster cold start, except TypeScript/TSX, at 17 ms against 12 ms.
- **Size.** Smaller over the wire for every grammar: 162 KB gzipped for TypeScript, against 237 KB for web-tree-sitter.

The earlier fear that parity would cost gotreesitter-scale effort did not hold. Porting the C runtime file by file, rather than re-deriving its behavior, reached parity in about 2.8k lines plus roughly 250 lines per scanner. A new grammar costs one run of the table compiler, plus a hand port if it has a scanner.
