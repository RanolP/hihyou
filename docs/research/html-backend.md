# An HTML highlighting backend matching shiki

The goal, in the user's words: "our new syntechs formatter backend comes. the "html". matching to shiki output but 3x faster than shiki is goal." This page measures what that takes before any code exists. It answers four questions: where scopes could attach in the formatter DSL, how much of shiki's TextMate scope stack a tree-sitter node path can reproduce, what the time budget is per language, and whether the grammars' own `highlights.scm` queries help. It ends with a DSL sketch and questions for the user.

Fixed constraints (the user's decisions, not open here): parity is per character, each character's color and fontStyle equal to shiki's `codeToHtml` / `codeToTokens`, while span boundaries may differ. Scopes come from extending the fmt DSL, and codegen (`packages/syntechs/src/fmt/dsl/emit.ts`, run by `node packages/syntechs/generate.mjs`) emits the highlighter. Shiki theme JSON is read as is for scope-to-style matching; a pure-TS TextMate engine is rejected. The speed baseline is warm shiki with both engines (Oniguruma wasm and `createJavaScriptRegexEngine`), and syntechs must be at least 3x faster than the faster of the two, end to end (parse + highlight + HTML string).

Measured at `15b2ff2` (fix(syntechs): restore the ident doc comment in the DSL emitter), shiki 4.4.3 from npm, Node 24.18.0, Windows 11. The scripts live outside the repo, in a scratch directory, and nothing in the repo changed apart from this page.

## Findings

- **The formatter already records which source node every output token came from.** Every printed token goes through `sToken(node, text, synthetic?)`, and `printStream` returns per-token `nodes`, `at` and `synthetic` arrays that `format()` exposes as `Anchor[]`. Styling formatted output needs a scope per node, not a second pass over the layout.
- **Scopes cannot live inside the structure trees.** JavaScript lays out most kinds through `custom(...)` rules, Python through `.via(...)` rules, and a kind with no structure rule prints as one `tree.text(node)` token. The tokens those print never pass through a structure tree, so a scope annotation there would miss them. The scopes need their own per-kind section, parallel to `wrapping`, that one scope pass reads by node kind.
- **Highlighting must work without formatting.** Kotlin has a grammar and no formatter at all. The review UI shows raw code for unsupported languages, and `format()` can return `ok: false`. The scope pass is therefore a standalone tree walk, and the formatted view reuses its per-node result through the anchors.
- **Shiki styles most characters by the leaf scope alone.** Across 7 languages and 5 themes, the leaf scope decides 69-100% of non-whitespace characters, an ancestor `meta.*` scope decides 0-6%, and the rest take the theme's default foreground. A descendant selector decides at most 0.4% of characters, except one-dark-pro on JSON (5.9%).
- **A short tree-sitter path predicts shiki's style for 94-100% of characters, and adding the leaf's text raises that to 97-100%.** The key is the leaf's kind and field plus 1-3 ancestors. CSS and Python need the text: CSS property values and Python builtins are classified by word lists in the TextMate grammars.
- **What remains in JS/TS is styling inside one tree-sitter leaf.** JSDoc inside a `comment` (6.4% of lodash/jquery characters) and `regex_pattern` (2.1%) are single leaves that shiki splits into several scopes. Reaching those needs a small hand-written sub-lexer per case.
- **The budget is generous for every language but Kotlin.** A naive leaf walk that emits shiki-shaped HTML with no scope logic takes 3-42% of the budget. Kotlin's parse alone (10.5 ms) exceeds a third of shiki's time (7.1 ms).
- **The grammars' `highlights.scm` files are a useful checklist, not a scope source.** All six vendored grammar packages ship one. Their patterns are exactly the (parent kind, field) shapes the scope table needs, for example "an identifier in `call_expression.function` is a function". Their 20-35 capture names are far coarser than TextMate scopes and have no `meta.*` layer.

## 1. Where scopes attach in the DSL

A spec (`src/fmt/dsl/dsl.ts`) has two per-kind parts: `structure`, what a node prints in order, and `wrapping`, where that sequence breaks. `emit.ts` compiles each kind's structure into one stream rule. Every source token reaches the stream in one of these ways, all through `sToken(node, text, synthetic)`:

| Where the token comes from | Emitted call | Node it carries |
|---|---|---|
| A literal in the structure (`":"`, `"def"`), bound to the k-th anonymous child with that spelling | `sToken(c, t.text(c))` | the anonymous child |
| A literal the source lacks (bracket, trailing comma) | `sToken(node, text, true)` | the parent, marked synthetic |
| `verbatim`, `text(fn)` | `sToken(node, t.text(node))` or the normalized text | the whole node, possibly an inner node |
| `inOrder` | `sToken(c, t.text(c))` per anonymous child | the child |
| A kind with no structure rule, or a node in an ERROR range | `sToken(node, tree.text(node))` in `formatStream` | the whole node, possibly an inner node |
| `custom` / `.via` rules (most of JS, much of Python) | whatever the hand-written code calls, through `sToken` or the JS `sink.ts` | whatever it passes |
| Comments | `ctx.comment(c)` into `sToken(c, ...)` | the comment |

`printStream` returns `{ text, nodes, lengths, synthetic, at }`, one entry per printed token, and `format()` turns those into `Anchor { from, to, synthetic? }`. So the output side is solved: for each printed token, look up the scope of its node. Three cases need care:

- **Whole-node tokens** (`verbatim`, unruled kinds, ERROR ranges) cover an inner node such as a JSON `string` with its quote and content children. Their text equals the source, so the highlighter styles the node's source range and shifts it by the anchor.
- **Respelled tokens** (`text("requote")`, `lower`, `printNumber`) keep their node, so they take the node's scope. Where shiki scopes parts of such a token apart (a string's quote characters, a number's unit), the highlighter must split the respelled text the same way it splits the source. Not checked here: whether `requote` changes any scope (shiki may scope `'…'` and `"…"` differently, as `string.quoted.single` and `string.quoted.double`).
- **Synthetic tokens** carry the parent node and their spelling, so the scope comes from the parent kind's token table, the same one that scopes a real `,` or `;` of that kind.

Can the scope pass reuse the formatter's walk? Only partly. The structure walk cannot carry scopes, because custom rules and unruled kinds print tokens it never sees, and some kinds (Python's `.via` frames, JS's member chains) print children in orders the scope logic should not depend on. What it does reuse is the anchors that walk already produces. The design is one scope pass over the tree, `O(nodes)`, writing an interned scope-stack id per leaf. The raw view reads those ids in source order, and the formatted view reads them through the anchors. Formatting and highlighting then cost parse + format + scope pass, with no re-parse of the formatted text.

## 2. The scope problem

Script: `codeToTokens(code, { includeExplanation: true })` with the JavaScript regex engine, on the first 600 lines of 2-3 bench inputs per language (lines of 1000+ characters dropped, because shiki's explanation path throws on `scanner.ts`'s 4657-character `unicodeES5IdentifierStart` line). Each non-whitespace character is classified by which level of its scope stack the theme matched deepest, and paired with the deepest syntechs node covering that offset.

Themes tested: github-light, github-dark, one-dark-pro, vitesse-light, vitesse-dark.

### What decides a character's style

| Language (samples) | chars | distinct stacks | mean depth | leaf decides | ancestor decides | default fg |
|---|---|---|---|---|---|---|
| json (package-lock, edge, big) | 27,387 | 107 | 8.6 | 87-100% | 0-5.9% | 0-7.4% |
| css (normalize, bootstrap, animate) | 26,779 | 160 | 3.8 | 87-99% | 0-1.2% | 1.2-12.2% |
| javascript (lodash, jquery) | 29,259 | 729 | 6.2 | 88-99.8% | 0.2-5.4% | 0-7.5% |
| typescript (scanner, checker) | 31,476 | 360 | 4.4 | 92-99.8% | 0.2-0.8% | 0-7.4% |
| tsx (LayerUI, App) | 26,915 | 1,135 | 7.5 | 89-100% | 0-3.9% | 0-10.8% |
| python (argparse, dataclasses, base_events) | 44,775 | 315 | 2.6 | 69-75% | 0-1.2% | 24-31% |
| kotlin (Result, Okio, build.gradle.kts) | 18,047 | 43 | 1.9 | 75-81% | 0-0.3% | 19-25% |

Ranges span the five themes. vitesse gives a style to almost every scope (default foreground 0% outside Python and Kotlin). one-dark-pro is the theme where ancestors matter most: 5.4% of JS characters and 3.9% of TSX characters get their color from a `meta.*` scope (for example `meta.object-literal.key`, `meta.brace.square`).

### What a theme's selectors test

| Theme | rules | distinct selectors | descendant selectors | with `>` | fontStyle rules |
|---|---|---|---|---|---|
| github-light | 45 | 73 | 6 | 0 | 14 |
| github-dark | 45 | 73 | 6 | 0 | 14 |
| one-dark-pro | 275 | 447 | 16 | 8 | 5 |
| vitesse-light | 56 | 126 | 6 | 0 | 12 |
| vitesse-dark | 56 | 126 | 6 | 0 | 12 |

The github and vitesse descendant selectors are about embedded code in strings, regex escapes and markdown headings (`string variable`, `string.regexp constant.character.escape`). one-dark-pro adds JSON-specific ones (`source.json meta.structure.dictionary.json > string.quoted.json`). In the samples, a descendant selector decides at most 0.4% of characters for any theme and language, except one-dark-pro on JSON at 5.9%.

A plain selector can still depend on context, because TextMate matches it against every element of the stack. A theme only needs the stack elements that one of its selector atoms prefixes. For the five themes that is a short list of `meta.*` atoms: github has 8 (all diff, `meta.property-name`, `meta.module-reference`, `meta.separator`), vitesse has 18 (adds `meta.type.annotation`, `meta.object-literal.key`, `meta.var.expr.ts`, `meta.brace`), and one-dark-pro has 33. Across all ~60 bundled shiki themes, however, nearly every element of every sampled stack is tested by some theme: filtering stacks down to the elements any bundled theme's atoms prefix removed only 0-12% of the distinct stacks. So "any shiki theme" means emitting the full stack, while "these five themes" means emitting the leaf plus a handful of `meta` names.

### How much a tree-sitter path reproduces

Grouping characters by the key (leaf kind and field, then d ancestors with their fields) and taking each group's majority style gives the share of characters a deterministic table keyed that way could get right:

| Language | d=0 | d=1 | d=2 | d=3 | d=1 + leaf text |
|---|---|---|---|---|---|
| json | 69.3 | 99.7 | 100 | 100 | 100 |
| css | 69-80 | 75-86 | 76-87 | 81-87 | 99.9-100 |
| javascript | 88-93 | 94-96 | 94-96 | 94-96 | 97.2-97.5 |
| typescript | 95-96 | 98-99 | 98-99 | 98-99 | 99.0-99.1 |
| tsx | 88-91 | 95-97 | 97-98 | 98-99 | 99.2-99.3 |
| python | 85-91 | 94-95 | 95-96 | 96-97 | 99.6-99.8 |
| kotlin | 85-88 | 96 | 97 | 99 | 98.8-99.1 |

Percent of non-whitespace characters; ranges over the five themes. The "leaf text" column slightly overstates, because every distinct identifier becomes its own group. It is still the right signal: what it fixes is keyword-list classification (CSS `none`/`block`, `px` units, color names; Python `print`/`len`/`self`), which the DSL can state as word lists.

Examples of what the path has to carry (shiki stack, then the syntechs path, leaf first):

- JSON key quote: `source.json meta.structure.dictionary.json … string.json support.type.property-name.json punctuation.support.type.property-name.begin.json`, from `"\""` < `string@key` < `pair` < `object`. The stack is 12 deep because every nesting level repeats `meta.structure.dictionary.json meta.structure.dictionary.value.json`; the style needs only `@key`.
- JS method assignment: `x.foo = function () {}` makes `foo` `entity.name.function.js`, from `property_identifier@property` < `member_expression@left` < `assignment_expression` whose `right` is a function. The deciding fact is a sibling field, which `highlights.scm` states as a pattern too.
- JS call: `entity.name.function.js` under `meta.function-call.js`, from `identifier@function` < `call_expression`. A `new Foo()` gives the same scope under `new.expr.js`.
- Python builtin: `support.function.builtin.python` under `meta.function-call.python`, from `identifier@function` < `call`, but only for names in Python's builtin list.
- CSS: `support.type.property-name.css` under `meta.property-list.css meta.property-name.css`, from `property_name` < `declaration`. For a property value such as `block`, the `plain_value` < `declaration` path is the same for `block` and `foo`, and only the word decides.

### Styling inside one tree-sitter leaf

Share of non-whitespace characters in leaves whose characters shiki styles in more than one way (github-dark, one-dark-pro, vitesse-dark):

| Language | mixed | where |
|---|---|---|
| json | 0% | |
| css | 0-1.2% | vitesse only: `@` of `at_keyword`, `@media`, `@keyframes` styled apart from the name |
| javascript | 8.5-8.7% | `comment` 6.4% (JSDoc tags, types, names), `regex_pattern` 2.1-2.3% |
| typescript | 1.3% | `comment` 1.1%, `regex_pattern` 0.2% |
| tsx | 0% | |
| python | 0.5% | `string_start` / `string_content` (prefixes, format specs) |
| kotlin | 0.2-0.3% | `string_content` (templates), `return@label`, `!is` |

These are what a node-keyed table cannot reach. Three sub-lexers cover almost all of it: JSDoc inside block comments, the regex pattern language, and string-prefix/escape splitting where the grammar leaves them in one leaf.

## 3. Time budget

Script: one highlighter per engine created once with `github-dark` and all seven languages, then warm `codeToHtml(text, { lang, theme: "github-dark" })` over each language's bench inputs (the `FETCHED` list of `src/core/corpus.node.ts` that `src/fmt/bench.node.ts` formats), 2 warmups, median of 5, summed per language. `syntechs_parse` is `parseTree` from the built `packages/syntechs/dist` (`pnpm build` reported it up to date) on the same texts. Budget = min(shiki_onig, shiki_js) / 3 − syntechs_parse: what the scope pass and the HTML string may cost together. The fixture set the fmt bench also runs was not included.

| Language | inputs | bytes | shiki_onig | shiki_js | syntechs_parse | budget | naive walk + HTML |
|---|---|---|---|---|---|---|---|
| json | big, package-lock, edge | 3,562,099 | 1243.8 | 1038.1 | 160.9 | 185.1 | 77.2 |
| css | bootstrap, normalize, animate | 382,555 | 634.9 | 313.1 | 46.3 | 58.1 | 9.7 |
| javascript | lodash, jquery | 829,410 | 1025.6 | 1369.9 | 80.3 | 261.6 | 9.5 |
| typescript | scanner, checker | 3,297,951 | 5859.8 | 50185.5 | 302.1 | 1651.2 | 72.7 |
| tsx | App, LayerUI | 289,922 | 539.6 | 2280.3 | 42.9 | 137.0 | 3.7 |
| python | argparse, typing, dataclasses, base_events | 378,836 | 409.7 | 402.1 | 65.4 | 68.6 | 3.7 |
| kotlin | Collections, Result, Delay, Transform, Okio, build.gradle.kts | 55,035 | 22.7 | 21.3 | 10.5 | −3.4 | 0.6 |

All times in ms. Neither engine wins everywhere: the JavaScript engine is faster for JSON, CSS, Python and Kotlin, and Oniguruma for JS, TS and TSX. The JavaScript engine takes 50 s on `checker.ts`, 8.6x Oniguruma. For a few seconds during the TypeScript row, an unrelated `grep` shared the machine, so that row carries some noise.

"Naive walk + HTML" is a floor, not a design. It walks every leaf, looks up a per-kind style string, escapes `<>&`, and builds shiki's `<pre class="shiki"><code><span class="line">…` shape with one span per leaf and multi-line tokens split per line. It has no scope logic. It fits inside every budget except Kotlin's, taking 42% of JSON's budget, 17% of CSS's and 3-6% of the others, which leaves 48 ms (CSS) to 1578 ms (TypeScript) for scope logic. The consequence for the design: the per-token work at run time must be table lookups. Resolve each distinct interned scope stack to a style once per theme (the samples have 43-1,135 distinct stacks per language), cache that, and have the per-leaf step be "stack id → style string".

Kotlin cannot meet the target by highlighting alone. Its parse runs at about 5 MB/s against JSON's 22 MB/s, and shiki's Kotlin grammar is shallow (mean stack depth 1.9) and fast.

## 4. Tree-sitter `highlights.scm`

Every vendored grammar package under `packages/syntechs/node_modules` ships queries:

| Package | file | patterns | capture names |
|---|---|---|---|
| tree-sitter-json 0.24.8 | `queries/highlights.scm` | 5 | `@string.special.key @string @number @escape @constant.builtin @comment` |
| tree-sitter-css 0.25.0 | `queries/highlights.scm` | 25 | `@operator @keyword @property @variable @tag @attribute @string @number @function …` |
| tree-sitter-javascript 0.25.0 | `highlights.scm`, `highlights-jsx.scm`, `highlights-params.scm` (+ `locals.scm`, `injections.scm`) | 21 + 7 + 1 | `@function @function.method @variable @variable.builtin @constructor @constant @property …` |
| tree-sitter-typescript 0.23.2 | `queries/highlights.scm` (layered on JS's) | 6 | `@type @type.builtin @variable.parameter @keyword @punctuation.bracket` |
| tree-sitter-python 0.25.0 | `queries/highlights.scm` | 15 | `@function @function.builtin @function.method @constructor @constant @type @escape …` |
| tree-sitter-kotlin 0.3.8 | `queries/highlights.scm` | 47 | nvim-treesitter-style: `@keyword.function @keyword.return @conditional @repeat @include @exception …` |

They help as a starting point for which node paths are distinct. The patterns are the (parent kind, field) and sibling-field shapes the table in section 2 needs, for example `(assignment_expression left: (member_expression property: (property_identifier) @function.method) right: [(function_expression) (arrow_function)])`, which is the TextMate `entity.name.function` case above. `#match?` predicates (`^[A-Z]` for constructors, `^[A-Z_][A-Z\d_]+$` for constants) mirror TextMate's regex heuristics.

As a scope source they lose too much. There is one capture per node with no stack, so `meta.function-call`, `meta.object-literal.key` and `meta.type.annotation`, which one-dark-pro and vitesse test, have no counterpart. Keywords and operators land in one `@keyword` / `@operator` bucket, where TextMate splits `storage.type`, `keyword.control`, `keyword.operator.new`, `storage.modifier` and more, and themes color those differently. The Python and JS queries also style much less than shiki: no builtin word lists beyond a handful, and nothing for punctuation roles. Mapping capture names to scopes would be a lossy many-to-one table that still needs every exception written by hand. Reading the patterns once while writing each language's scope section is worth it. Generating from them is not.

## Recommended DSL surface

A third per-kind section, `scopes`, next to `structure` and `wrapping` in the same spec, so the kind that lays a node out also names its scopes. Codegen emits one `scopeOf` pass per language (a switch on kind id writing interned stack ids per leaf) plus the interned stack table. A small TS theme matcher resolves each stack against the shiki theme JSON once per theme. The options:

- `scope`: the node's own scope (a leaf's leaf scope, or pushed for an inner node's whole range).
- `meta`: pushed for everything inside the node.
- `tokens`: anonymous children (and synthetic tokens anchored to the node) by spelling.
- `fields`: a scope pushed around one field's child.
- `words`: leaf classification by text.
- `when`: the existing `Cond` machinery (`parentIs`, `when(rule)`) for context.
- `lex`: a hand-written sub-lexer, the way `custom` names a hand-written layout.

JSON: parent field decides key vs value, and the repeated `meta.structure.*` pairs become `meta` on the kinds that open them.

```ts
scopes: {
  document: { scope: "source.json" },
  object: {
    meta: "meta.structure.dictionary.json",
    tokens: {
      "{": "punctuation.definition.dictionary.begin.json",
      "}": "punctuation.definition.dictionary.end.json",
      ",": "punctuation.separator.dictionary.pair.json",
    },
  },
  pair: {
    fields: { value: "meta.structure.dictionary.value.json" },
    tokens: { ":": "punctuation.separator.dictionary.key-value.json" },
  },
  string: {
    scope: "string.quoted.double.json",
    tokens: { '"': "punctuation.definition.string.json" },
    // A key: `when` swaps in another entry while its condition holds.
    when: [[fieldIs("key"), {
      scope: "string.json support.type.property-name.json",
      tokens: { '"': "punctuation.support.type.property-name.json" },
    }]],
  },
  number: { scope: "constant.numeric.json" },
},
```

CSS: the path is the same for `block` and `foo`, so the value is classified by word list, generated from the TextMate grammar's own lists.

```ts
scopes: {
  block: { meta: "meta.property-list.css" },
  property_name: { scope: "meta.property-name.css support.type.property-name.css" },
  plain_value: {
    scope: "meta.property-value.css",
    words: {
      "support.constant.property-value.css": cssPropertyValues,
      "support.constant.color.w3c-standard-color-name.css": cssColorNames,
    },
  },
  integer_value: { scope: "constant.numeric.css" },
  unit: { scope: "keyword.other.unit.css" },
},
```

JavaScript: a call's callee and a method assignment's name, keyed by field paths from the parent, the shapes `highlights.scm` lists.

```ts
scopes: {
  call_expression: {
    meta: "meta.function-call.js",
    fields: { function: calleeName("entity.name.function.js") }, // the identifier, or a member_expression's property
  },
  assignment_expression: {
    when: [[fieldKindIs("right", ["function_expression", "arrow_function"]),
      { fields: { left: calleeName("entity.name.function.js") } }]],
  },
  identifier: { scope: "variable.other.readwrite.js", words: { "variable.other.constant.js": /^[A-Z_][A-Z\d_]+$/ } },
  regex_pattern: { lex: "regex" },
  comment: { scope: "comment.block.js", lex: "jsdoc" },
},
```

Python: builtins and `self` by word list under the call's field.

```ts
scopes: {
  call: {
    meta: "meta.function-call.python",
    fields: { function: "meta.function-call.generic.python", arguments: "meta.function-call.arguments.python" },
  },
  identifier: {
    scope: "",
    words: {
      "support.function.builtin.python": pythonBuiltins,
      "variable.language.special.self.python": ["self"],
      "support.type.python": ["int", "str", "list", "dict", "set", "tuple", "bool", "float", "object"],
    },
  },
  string: { meta: "string.quoted.single.python", lex: "pythonStringPrefix" },
},
```

Kotlin, which has no layout: a spec with `scopes` and no `structure` is valid, and codegen emits only the highlighter.

```ts
export const kotlin = format({
  structure: {},
  scopes: {
    function_declaration: { fields: { name: "entity.name.function.kotlin" }, tokens: { fun: "storage.type.function.kotlin" } },
    string_literal: { scope: "string.quoted.double.kotlin", tokens: { "${": "punctuation.section.embedded.begin.kotlin" } },
  },
});
```

The parity check is a test, not a runtime self-check: `codeToTokens` from a pinned shiki over the corpus, compared per character for color and fontStyle, reporting the node path of each mismatch so the fix lands in the right kind's `scopes`.

## Open questions for the user

1. Which themes must match? For the five tested here, the stack reduces to the leaf scope plus a few `meta` names. For any shiki theme, the full stack must be emitted, because across all bundled themes almost every stack element is tested by one. Full stacks cost only table size at run time, since stacks are interned, but they cost authoring effort per kind.
2. Are hand-written sub-lexers acceptable for JSDoc, regex and string prefixes (`lex: "jsdoc"`), the way `custom` is for layouts? Without them, up to 8.5% of JS characters (the lodash/jquery samples' JSDoc comments and regexes) cannot match.
3. Kotlin's parse alone is over a third of shiki's time, so Kotlin cannot reach 3x without a faster Kotlin parse. Should Kotlin be exempt from the speed target, or does the target mean parse work too?
4. Which shiki version do we pin for parity? The TextMate grammars change between releases (the samples here are 4.4.3), so the parity test needs a pinned version and an update procedure.
5. Single theme per render, or light and dark in one HTML (shiki's `themes: { light, dark }` with CSS variables)? Dual themes double the style lookups but not the scope pass.
6. What should a parse error look like? Shiki colors through broken code; syntechs has ERROR nodes, which the formatter prints verbatim. Is "ERROR range styled as plain text" acceptable, or must the scope pass lex through it?
7. Embedded languages (CSS or HTML in JS template literals, `<style>` in TSX) are out of scope unless you say otherwise; shiki's default grammars inject only a few of these.
