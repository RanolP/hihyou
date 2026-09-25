# Display formatter for hihyou: a dprint-style printer driven by declarative rules over tree-sitter trees

## Recommendation

Build a small formatter of our own in three pieces. The first is a TS port of dprint-core's IR and printer, reduced to what layout needs. The second is one declarative rule file per language, keyed on tree-sitter node kinds and fields. The third is one interpreter that turns a hihyou `SyntaxTree` plus a rule file plus the reviewer's `Style` into that IR. Every token the interpreter emits carries its original span, so the printer returns exact original-to-formatted anchors, and the Myers-diff heuristic in `packages/present/src/align.ts` goes away.

The top reasons, each backed by evidence further down:

1. **dprint can only reach us as a port.** Every dprint plugin on npm (`@dprint/typescript`, `json`, `markdown`, `toml`, `ruff`, `dprint-plugin-malva`, `dprint-plugin-yaml`) ships exactly one `plugin.wasm` plus a `getPath()` helper. `@dprint/formatter` is a wasm host that calls `WebAssembly.Module` / `Instance`. Under "no wasm at all", no npm artifact of dprint is usable (measured: package contents).
2. **dprint-core's printer is small; its generators are not.** The IR plus printer plus list helpers are about 2.9k lines of Rust. The TypeScript generator alone is 8.8k lines in one file (`generate.rs`), written against swc's AST, which tree-sitter does not produce. Porting the IR is cheap. Porting a generator means porting a parser too (measured: line counts).
3. **Topiary proves that declarative rules over tree-sitter are cheap, but its model cannot break lines by width.** Its JSON style is 22 query lines and its CSS style is 125. Its softlines break only when the node already spanned several lines *in the input*; there is no line width anywhere in `topiary-core`. GDScript-formatter started on Topiary and rewrote its renderer because users wanted automatic line wrapping. We keep Topiary's rule vocabulary and put dprint's width-aware printer under it (measured: source; GDScript claim quoted from its README).
4. **The reviewer's style fits in rules as named settings.** Rules name a setting (`trailing: "trailingCommas"`) instead of hard-coding a choice, so one rule file serves every reviewer. dprint's TS plugin shows how far this can go (174 settings, compared with prettier's roughly 20). We start with about 10 settings.
5. **It reuses the tree the engine already parsed.** prettier re-parses every file with its own parser. Here the formatter walks the `SyntaxTree` the diff already built.

Rejected paths, one line each:

- **Keep prettier (d):** pure JS and already in use, but it cannot follow a reviewer's style beyond about 20 options, costs 554 KB min+gzip for today's language set, took 15.8 s on `checker.ts`, and still needs a Python formatter by hand. Its output also needs the `align.ts` heuristic, because prettier emits no positions.
- **Port a dprint plugin's generator mechanically (b):** the TS generator is 8.8k lines over swc's AST (`dprint-swc-ext` adds 22k generated lines of AST views), so a port drags in an swc-shaped parser. And the CSS, YAML and markup plugins use `tiny_pretty`, not dprint-core, so "port dprint" does not even mean one IR.
- **Our own Wadler doc IR (c):** viable, since prettier's `doc` printer is 639 lines and bundles to 8 KB min+gzip. We still prefer dprint's IR because its conditions and infos express "put a trailing comma only if this list ended up multi-line" and "keep this object expanded if it was expanded" directly. See the comparison under Details.

### First milestone (inferred scope)

1. Port the IR and printer (`PrintItems`, `Signal`, `Condition`, `Info`, save-point lookahead, writer), with token anchors in the write items. Target: 1.5–2.5k lines of TS.
2. Write the interpreter with the generic parts: the spacing table, `list`, `block`, comments, blank lines, token anchors, and the token-preservation check.
3. Write the JSON rules (about 20 lines) and put them behind `Formatter` for `.json` only. Gate: byte-identical to prettier on JSON corpora under a prettier-equivalent `Style`, idempotent, all tokens preserved.
4. Then do TS/TSX/JS, then CSS, then Python. Markdown and YAML come last, if ever, because their layout is not a token tree.

## Premises and constraints

Fixed constraints, in the user's words: "i said no wasm at all." "we may run on browser without any server." Everything runs in Node, in a browser page and in an MV3 extension. "formatter can be implemented by our hands." "prefer "person's opinion", not repo's." So a reviewer's own settings drive the layout, and repo config files such as `.prettierrc` or `dprint.json` are never read. "for 2, we may research dprint." The chosen direction is: "I'd like to create cheap our-tree-sitter-node formatting rule that can be interpreted by our dprint-ish core."

Premises I chose, which the reader should check:

- **Display-only formatting.** The formatted text is shown to a reviewer, never written back. So the formatter never inserts or removes parentheses, reorders imports, or rewrites ASI semicolons. It changes whitespace and a whitelisted set of token spellings (quotes, trailing commas). The display-only premise is what makes a rule file cheap.
- **Trees come from `packages/engine/src/parse`**, whose `SyntaxNode` has `kind`, `named`, `field`, `start`/`end` in UTF-16 units and `children`, including anonymous tokens and comments. The interpreter reads token text as `text.slice(start, end)`, not `label`, because `label` collapses whitespace inside comments. JSX text that is only layout whitespace is absent from the tree, which suits a formatter.
- **A file that fails the formatter's own checks is shown unformatted.** This matches today's `Unformatted` reasons. A formatter bug therefore costs prettiness, never correctness.

## Numbers

Setup: this Windows 11 machine, Node v24.18.0, prettier 3.9.9 standalone with the same plugins `format.ts` loads, and `@dprint/formatter` 0.5.1 with `@dprint/typescript` 0.96.1 and `@dprint/json` 0.24.0 at `lineWidth: 80, indentWidth: 2`. Times are the median of 15 runs after 1 warm-up (5 runs for `checker.ts`), in ms, from `performance.now()` around `format` / `formatText`. The inputs are the same pinned files as in `parser-runtime.md`: TypeScript v5.8.3 `scanner.ts`, `checker.ts` and `package-lock.json`. dprint runs as wasm here, so its numbers are a reference for what a native-speed printer achieves, not a candidate. The two formatters also produce different output, so the numbers compare the work each one does, not identical work.

### Formatting time (measured)

| input | prettier standalone | dprint wasm (reference) |
|---|---|---|
| `packages/engine/src/**/*.ts` (22 files, 2483 lines) | 111.4 | 25.2 |
| `scanner.ts` (4101 lines) | 272.6 | 44.8 |
| `checker.ts` (53016 lines) | 15833.1 | 653.7 |
| `package-lock.json` (8063 lines) | 29.4 | 11.2 |

dprint's instantiate cost is 6.3 ms for TypeScript and 3.4 ms for JSON. prettier grows superlinearly on `checker.ts`: 13x the lines of `scanner.ts` costs 58x the time. A TS port of the dprint printer should land between the two columns. My guess is 2–4x the wasm time, without the parse, because the tree already exists (inferred, not measured).

### Bundle size, min+gzip (measured)

esbuild 0.28.2 `--minify --format=esm --platform=browser`, gzip level 9. For wasm, the table gives the gzip size of `plugin.wasm` as shipped.

| artifact | min | min+gzip |
|---|---|---|
| prettier standalone + estree, typescript, babel, postcss, yaml, markdown (today's `format.ts`) | 2065 KB | 554 KB |
| prettier standalone + estree + typescript (TS only) | 1169 KB | 295 KB |
| `prettier/doc` (builders + printer only, the size of option c's runtime) | 28 KB | 8 KB |
| `@dprint/formatter` JS host, no plugin | 8 KB | 3 KB |
| `@dprint/typescript` `plugin.wasm` | 4076 KB raw | 1127 KB |
| `@dprint/json` `plugin.wasm` | 622 KB raw | 204 KB |
| `@dprint/markdown` `plugin.wasm` | 744 KB raw | 234 KB |
| `@dprint/toml` `plugin.wasm` | 499 KB raw | 164 KB |
| `@dprint/ruff` `plugin.wasm` | 4411 KB raw | 1495 KB |
| `dprint-plugin-malva` (CSS/SCSS/Less) `plugin.wasm` | 1431 KB raw | 400 KB |
| `dprint-plugin-yaml` (pretty_yaml) `plugin.wasm` | 563 KB raw | 178 KB |

The proposed formatter's bundle would be the printer (comparable to `prettier/doc`, about 10 KB min+gzip) plus the interpreter plus the rule data, likely under 40 KB for all languages (inferred).

### dprint plugins (measured from the published crates)

Lines are non-blank, non-comment lines of Rust under `src/`, excluding tests. The option counts are fields of each plugin's `Configuration` struct.

| plugin (crate version) | languages | parser | IR | generator lines | whole crate | options |
|---|---|---|---|---|---|---|
| dprint-plugin-typescript 0.96.1 | TS, TSX, JS, JSX | swc via `deno_ast`, AST views from `dprint-swc-ext` (22.3k lines, 20.7k generated) | dprint-core | 8774 (`generation/generate.rs`) + about 1.3k helpers | 13079 | 174 |
| dprint-plugin-json 0.24.0 | JSON, JSONC | `jsonc-parser` (8.6k lines) | dprint-core | 724 | 2475 | 13 |
| dprint-plugin-markdown 0.24.0 | CommonMark + GFM, embedded HTML | its own `parser/` (about 3.9k) and `html/` | dprint-core | 2582 + 451 types + 405 utils | 11223 | 31 |
| dprint-plugin-toml 0.8.0 | TOML | its own `parser.rs` (532) | dprint-core | 489 | 2074 | 18 |
| malva 0.16.0 | CSS, SCSS, Sass, Less | `raffia` (14.6k) | **tiny_pretty** (Wadler-style, 399 lines) | about 6.1k (`doc_gen/`) | 7209 | 39 |
| pretty_yaml 0.6.0 | YAML | `yaml_parser` (2.5k, rowan CST) | **tiny_pretty** | 1302 (`printer.rs`) | 1477 | 19 |
| markup_fmt 0.27.5 | HTML, Vue, Svelte, Astro, Angular, Jinja | its own `parser.rs` (2.8k) | **tiny_pretty** | 2674 (`printer.rs`) | 7280 | not counted |
| dprint-plugin-ruff (HEAD) | Python | ruff's parser | **ruff_formatter** (a prettier-style IR from Rome/Biome) | wrapper 70; `ruff_python_formatter` is 22.3k, `ruff_formatter` 6.5k, `ruff_python_parser` 12.6k (ruff HEAD) | 240 | 7 |

For comparison, prettier's `src/language-js/print` is 8516 lines and `src/language-js` is 17279 (3.9.9 tag). prettier exposes about 20 style options (`getSupportInfo()` lists 22, including `parser` and `plugins`).

### Topiary query sizes (measured, tweag/topiary HEAD, v0.7.3)

Non-comment, non-blank lines of `topiary-queries/queries/<lang>/formatting.scm`:

| language | status in Topiary | query lines |
|---|---|---|
| JSON | supported | 22 |
| TOML | supported | 61 |
| tree-sitter query | supported | 98 |
| CSS | contributed | 125 |
| Rust | experimental | 152 |
| WIT | contributed | 207 |
| Nickel | supported | 376 |
| Bash | supported | 480 |
| OCaml | supported | 1807 |

`topiary-core/src` is 4297 lines of Rust.

### Grammar surface the rules must cover (measured from `node-types.json`)

| grammar | named inner kinds | named leaves | anonymous tokens | field names |
|---|---|---|---|---|
| tree-sitter-typescript 0.23.2 (typescript) | 145 | 31 | 141 | 40 |
| tree-sitter-typescript 0.23.2 (tsx) | 151 | 33 | 143 | 43 |
| tree-sitter-javascript 0.25.0 | 87 | 27 | 107 | 36 |
| tree-sitter-json 0.24.8 | 5 | 7 | 7 | 2 |
| tree-sitter-css 0.25.0 | 41 | 23 | 41 | 0 |
| tree-sitter-python 0.25.0 | 101 | 21 | 89 | 32 |

tree-sitter-css has no fields, so its rules key on kinds and child order alone.

## Details

### dprint-core's IR and printer

Files are in dprint-core 0.69.1 `src/formatting/`:

- `print_items.rs` (889 lines) defines the IR. `PrintItems` is a linked list of `PrintItem`s: `String` (text with no newline), `Signal`, `Condition`, `Info`, `Anchor`, `ConditionReevaluation`, and `RcPath` (a shared sub-path).
- The `Signal`s are `NewLine`, `Tab`, `PossibleNewLine`, `SpaceOrNewLine`, `ExpectNewLine`, `QueueStartIndent`, `StartIndent`/`FinishIndent`, `StartNewLineGroup`/`FinishNewLineGroup`, `SingleIndent`, `StartIgnoringIndent`/`FinishIgnoringIndent`, `StartForceNoNewLines`/`FinishForceNoNewLines`, and `SpaceIfNotTrailing`.
- The `Info`s are placeholders the printer resolves while printing: `LineNumber`, `ColumnNumber`, `IsStartOfLine`, `IndentLevel`, `LineStartColumnNumber` and `LineStartIndentLevel`.
- A `Condition` holds a resolver closure (`ConditionResolver = Rc<dyn Fn(&mut ConditionResolverContext) -> Option<bool>>`) and true/false branches. The resolver reads infos, including infos that come *later* in the stream. `conditions.rs` (125) and `condition_resolvers.rs` (46) hold the stock ones, such as "is multi-line between these two infos".
- `printer.rs` (612) is a single pass with backtracking, not Wadler's fits check. `PossibleNewLine` and a `SpaceOrNewLine` that still fits record a save point. When text overflows `max_width`, the printer restores the most recent save point that is allowed to break and writes a newline there. `NewLineGroup` depth lowers a break point's priority, so inner groups break last. When a condition or info is read before it resolves, the printer records a look-ahead save point, and it rewinds once the info resolves. `infinite_reevaluation_protection.rs` (64) caps the loops.
- `writer.rs` (331) keeps indentation and column state as a cheaply cloned persistent list, so a save point is cheap.
- `ir_helpers/` (794, mostly `gen_separated_values.rs`, 566) is the list layout: single-line or one item per line, decided by a condition, plus hanging indent and trailing separators. This is what a `list` rule would call.

Plugins build `PrintItems` directly in Rust. For example, `dprint-plugin-typescript/src/generation/generate.rs` has one `gen_*` function per swc node type, and uses conditions for choices like "trailing comma only when multi-line" and "keep the list multi-line if the input put its open token and first member, or its first two members, on different lines" (`get_use_new_lines_for_nodes*` in `generate.rs` and `node_helpers.rs`). That last one is the `preferSingleLine: false` behavior. The input's layout is an input to the style.

**What to port (inferred sizes):** `print_items.rs`, `printer.rs`, `writer.rs`, `conditions.rs`, `condition_resolvers.rs`, `infinite_reevaluation_protection.rs` and `ir_helpers/`, which is about 2.9k lines of Rust. In TS it is likely 1.5–2.5k lines, because the bump allocator, the `UnsafePrintLifetime` pointers and `thread_state.rs` disappear in a GC language. **What to drop:** `plugins/` (1986 lines: the wasm and process plugin hosts), `communication/` (215), `configuration.rs` (458; our `Style` replaces it), `tracing.rs`, and `tokens/token_finder.rs` (a swc-token helper). Also drop the `Tab` signal, and keep `RcPath` only if the interpreter needs shared sub-paths.

**The one change to the port:** make `String` items carry an optional source span `[start, end)`. The writer already keeps its output as a persistent list that is rewound on backtrack, so the spans ride along. When the final write items are serialized, each spanned string yields an anchor `(formattedOffset, originalStart, originalEnd)` with no extra bookkeeping.

### Topiary, the prior art for declarative rules

Topiary (tweag/topiary, v0.7.3) formats from tree-sitter queries. A query matches nodes and tags them with captures. The capture vocabulary, taken from `topiary-core/src`, is:

- **Spacing:** `@append_space`, `@prepend_space`, `@append_antispace`, `@prepend_antispace`, `@append_delimiter`, `@prepend_delimiter`.
- **Lines:** `@append_hardline`, `@prepend_hardline`, `@append_empty_softline`, `@append_spaced_softline`, `@append_input_softline`, `@append_empty_input_softline`, and their `prepend_` twins, plus `@allow_blank_line_before`.
- **Indent:** `@append_indent_start`, `@prepend_indent_end`, and so on, plus `@multi_line_indent_all` and `@single_line_no_indent`.
- **Scopes:** `@append_begin_scope`, `@prepend_end_scope`, `@append_spaced_scoped_softline`, `@append_empty_scoped_softline`, `@append_begin_measuring_scope`, and so on, all with `#scope_id!`.
- **Content:** `@leaf`, `@delete`, `@keep_whitespace`, `@do_nothing`, `@lower_case`, `@upper_case`, and `@multi_line_string`.
- **Predicates:** `#single_line_only!` and `#multi_line_only!` gate a query on the node's input shape.

The whole JSON style (`queries/json/formatting.scm`) is: `(string) @leaf`, `":" @append_space`, `"{"`/`"["` with `@append_spaced_softline @append_indent_start` when non-empty, the closers with `@prepend_spaced_softline @prepend_indent_end`, and `","` with `@append_spaced_softline`.

**How Topiary breaks lines.** Its book (`reference/capture-names/vertical-spacing.md`) says: "Topiary goes through the CST nodes and detects all that span more than one line. This is interpreted as an indication from the programmer who wrote the input that the node in question should be formatted as multi-line." A softline expands to a newline only if its parent node was multi-line in the input. Scopes and measuring scopes widen or narrow that "was it multi-line" region, but the region is still measured on the input. `topiary-core/src` has no line width or max-column setting at all. So **a Topiary list never breaks because it is too long, and a long single-line call stays one line.** Topiary is gofmt-like: it normalizes, but does not reflow, which is far from prettier quality on code that was written wide.

**Why the fix goes in the printer, not the rules.** GDScript-formatter's README says: "The first version of the formatter was built on Topiary ... Users then asked for features that Topiary couldn't support well, like automatic line wrapping, so we rewrote the formatter with our own formatting and rendering code on top of the Tree-sitter parser." Our design keeps Topiary's cheap per-node vocabulary, but compiles it to dprint IR, where softlines become `SpaceOrNewLine`/`PossibleNewLine` inside groups and conditions that the printer resolves against the line width. The input-shape behavior survives as an option (`keepExpanded`), which is exactly what dprint's `preferSingleLine: false` and prettier's object rule already do.

**Why not tree-sitter queries as the rule format.** Queries need a query engine. The pure-TS `packages/sitter` runtime would have to grow one, and `.scm` files carry no types. Rules keyed on `kind` and `field` cover almost every Topiary query in the JSON, TOML and CSS files, because those queries mostly say "inside kind K, around child C", with anchors (`.`) for first and last. We use plain TS data and add a `match` escape hatch for the rare real pattern.

Other query- or rule-driven formatters found: nvim-treesitter and Helix ship `indents.scm` files (indent-only, no line breaking), and there is an open VS Code issue (microsoft/vscode#208985) that proposes declarative tree-sitter indentation rules. None of them does width-aware breaking. Topiary is the only complete formatter in this family I found (from a web search, not exhaustive).

### The proposed rule format

A rule file is typed TS data: `Rules<Kind extends string>`. The interpreter owns every generic behavior, and a rule only says what differs from the defaults.

Defaults the interpreter applies everywhere:

- **Tokens:** each leaf becomes one `String` item with its span. Its text is the source slice, passed through the leaf transforms the rules enable (`quote`).
- **Horizontal spacing** between two adjacent tokens comes from a per-language token-pair table: `none` after `(`, `[`, `.`, `?.` and `...`, and `none` before `)`, `]`, `,`, `;`, `.` and `:`. The default is one space. The table is the bulk of the rule file.
- **Comments:** a comment keeps its line relation to the previous token. A trailing comment stays on that token's line, and a comment on its own line stays on its own line. A line comment forces a newline after it (`ExpectNewLine`). A block comment is a leaf.
- **Blank lines:** at every hardline, `min(blank lines in the input, style.maxBlankLines)` blank lines are kept.
- **Anything the rules do not name** keeps its tokens on one line with table spacing. An unknown construct therefore degrades to "normalized spacing", never to broken output.

The rule kinds a node can have:

- `block({ open?, close?, sep? })`: children on their own lines, indented between `open` and `close`, with blank lines kept.
- `list({ open, close, sep, trailing?, pad?, keepExpanded?, hug? })`: the separated-values layout from `gen_separated_values`. It is all on one line if it fits, otherwise one item per line. The trailing separator depends on a setting, and `pad` puts a space inside the delimiters when the list is single-line (`bracketSpacing`). `hug: "last"` lets a last argument that is an object, array or arrow body open on the same line.
- `seq({ between?, breakBefore?, indent? })`: an ordinary node. `between` overrides spacing between named fields, and `breakBefore` marks the fields where a `SpaceOrNewLine` with continuation indent is allowed (binary operators, `=`, `=>`, `extends`).
- `chain({ link })`: member and call chains (`a.b().c()`), which break every link or none.
- `verbatim`: template strings, regex and JSX text. It is emitted as is.

**Settings referenced by name** (the reviewer's `Style`, never the repo's): `lineWidth`, `indentWidth`, `useTabs`, `quoteStyle` (`preserve`/`single`/`double`), `trailingCommas` (`never`/`always`/`onlyMultiLine`), `bracketSpacing`, `spaceBeforeFunctionParen`, `keepExpanded`, `maxBlankLines`, `semicolons` (`preserve` only at first, because adding or removing an ASI semicolon needs grammar knowledge). A rule field holds either a literal or a setting name, so the same file serves every reviewer. Adding a setting later means adding a field and naming it in the relevant rules. This is how dprint reaches 174 options without 174 code paths.

Example: a TS function declaration and a call's argument list, in tree-sitter-typescript kinds and fields:

```ts
export const typescript: Rules = {
  space: {
    noneAfter: ["(", "[", ".", "?.", "...", "!", "<"],
    noneBefore: [")", "]", ",", ";", ".", "?.", ":", "!", ">"],
  },
  quote: { string: "quoteStyle", template_string: "verbatim" },
  kinds: {
    // async function name<T>(params): R { body }
    function_declaration: seq({
      between: {
        "name>type_parameters": "none",
        "name>parameters": { setting: "spaceBeforeFunctionParen" },
        "type_parameters>parameters": "none",
      },
    }),
    formal_parameters: list({ open: "(", close: ")", sep: ",", trailing: "trailingCommas" }),
    type_annotation: seq({ between: { ":>*": " " } }), // ": R"; noneBefore ":" handles the left side
    statement_block: block({ open: "{", close: "}" }),
    // f(a, b, () => {...})
    call_expression: seq({ between: { "function>arguments": "none", "function>type_arguments": "none" } }),
    arguments: list({ open: "(", close: ")", sep: ",", trailing: "trailingCommas", hug: "last" }),
    object: list({ open: "{", close: "}", sep: ",", pad: "bracketSpacing", trailing: "trailingCommas", keepExpanded: "keepExpanded" }),
    binary_expression: seq({ breakBefore: ["operator"], indent: "continuation" }),
  },
};
```

What the interpreter emits for `arguments`: `(`, then a `Condition` that is true when the `LineNumber` info at `(` differs from the one at `)`. When it is true, the result is `StartIndent`, then for each item the item, `,` and `NewLine`, then `FinishIndent`, with the trailing `,` gated by `trailingCommas`. When it is false, the items are joined by `,` and `SpaceOrNewLine`. The group ends with `)`. This is the `gen_separated_values` shape, so "break only when it does not fit" comes from the printer's width check, and "trailing comma only when broken" comes from the same condition.

### Rule file size per language (inferred)

These estimates scale from the grammar surface above, Topiary's query sizes and dprint's generator sizes. The display-only premise removes dprint's and prettier's largest cost centers: comment attachment edge cases, parenthesis insertion, ASI and import sorting.

| language | inner kinds | rule data | escape-hatch code | anchor for the estimate |
|---|---|---|---|---|
| JSON | 5 | 15–25 lines | none | Topiary JSON is 22 lines; dprint's JSON generator is 724 lines |
| CSS | 41 | 80–150 lines | about 50 lines (selector and value spacing) | Topiary CSS is 125 lines; malva is about 6.1k for CSS plus SCSS, Sass and Less |
| TS/TSX/JS (one shared file, TSX/JS add-ons) | 145 / 151 / 87 | 400–700 lines | 300–600 lines (member chains, arrow chains, JSX children, template literals, hugging) | Topiary OCaml is 1807 lines for a grammar of similar size; dprint's TS generator is 8.8k lines |
| Python | 101 | 150–300 lines | about 100 lines | soft breaks are allowed only inside brackets, because a break outside them would need a backslash; statements keep their input lines |

The shared interpreter is about 1–1.5k lines, and the printer port is 1.5–2.5k lines. For TS, the whole formatter lands around 3.5–5k lines, against prettier's 17.3k for JS/TS or dprint's 13k plus swc.

### Paths compared

| path | size (inferred) | fidelity risk | reviewer settings | performance | position mapping |
|---|---|---|---|---|---|
| **chosen:** dprint-core IR port + declarative rules over tree-sitter | printer 1.5–2.5k + interpreter 1–1.5k + rules as above | medium: rules cover less than prettier; mitigated by the fallback to unformatted | named settings in rules; unlimited growth | printer work like dprint's, with no second parse; likely below prettier (inferred) | exact: token spans become anchors |
| (a) dprint IR port + hand-written generators per language | printer as above + about 0.7k (JSON), 6–9k (TS), 2–4k (Python) | medium-low for the languages written | as rich as we write | same as above | exact, same mechanism |
| (b) mechanical port of a dprint generator | 13k TS plugin + an swc-shaped AST (`dprint-swc-ext` alone is 22k lines) + a TS parser | low for TS; YAML, CSS and markup are `tiny_pretty` or `ruff_formatter`, another port each | dprint's 174 options | good | exact if spans are added |
| (c) Wadler/prettier doc IR of our own + rules | `prettier/doc` printer is 639 lines, 8 KB min+gzip; rules as chosen | same as chosen | same | same | exact, same mechanism (spans on text docs) |
| (d) keep prettier + hand-write Python | Python formatter only (2–4k) | lowest for JS/TS/CSS | about 20 options; repo-style defaults | 111 ms on engine/src, 15.8 s on `checker.ts` (measured) | heuristic only (`align.ts`); prettier emits no positions |

Chosen over (c): prettier's `group`/`ifBreak`/`fill` cover most layouts, and its printer is smaller. But dprint's infos and conditions express the two choices a reviewer's style most often depends on without special cases. One is input-shape preferences (`keepExpanded`, and prettier handles its object rule as an exception inside the printer). The other is choices that depend on where a later token landed. Either IR works under the same rule format, so this choice is reversible: the rules do not see the IR.

### Position mapping

Every emitted token carries its span, so the printer returns a sorted anchor array. `Alignment.range(start, end)` becomes a binary search: the first anchor whose original span overlaps `start`, to the last whose span overlaps `end`. `Alignment.original` becomes the reverse search. Tokens the formatter inserted (a trailing comma) have no anchor, and they map the way unmatched characters do today. Tokens it rewrote (quotes) map as a whole token. `align.ts`'s `maxEditLength` budget and the `unalignable` reason both become unnecessary for rule-formatted languages. They stay for any language still formatted by an external tool.

The same array gives the correctness check for free. The spelled tokens in the output, compared in order with the input tokens modulo the whitelisted transforms, must be equal. The interpreter checks this after printing and returns `formatter-error` when they differ, which is the "one runnable check" that catches a rule that dropped or duplicated a token.

### Measuring quality against prettier

- **Corpus:** TypeScript v5.8.3 `src/compiler` (the pinned inputs used in `parser-runtime.md`), hihyou's own `packages/*/src`, and for JSON the TypeScript `package-lock.json` plus `tsconfig` files.
- **Style:** a `Style` preset equal to prettier's defaults (`lineWidth: 80`, `indentWidth: 2`, `quoteStyle: double`, `trailingCommas: always`, and so on).
- **Metrics per file:**
  - byte-identical to prettier (yes or no);
  - the share of lines that differ from prettier's output (a line diff);
  - idempotence (`format(format(x)) === format(x)`);
  - token preservation (must be 100%);
  - lines over `lineWidth` that prettier fits.
- **Gates:** JSON must be 100% byte-identical to prettier on the corpus before it replaces prettier for `.json`. For TS, set the gate once the first version exists. A starting proposal is 95% of lines identical and zero token-preservation failures. The unmatched lines are sorted by node kind, which points straight at the missing rule.
- **Speed:** time the formatter on the same four inputs as the table above, in Node and in a browser page, excluding parse, because the engine already has the tree.

## Unverified

- Every size and time for the proposed formatter is inferred. None of it exists yet.
- Ruff line counts are from ruff HEAD, not the 0.16.8 tag that `dprint-plugin-ruff` pins.
- `markup_fmt`'s option count and the TS plugin's non-generator helper total are approximate.
- The claim that no other width-aware, rule-driven tree-sitter formatter exists comes from one web search.
- Prettier's `checker.ts` time (15.8 s) was not profiled. Part of it may be GC pressure in a single long run.
