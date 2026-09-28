# Structural diff and pattern-based filtering

Research date 2026-09-29. Scope: how existing structural diff tools (difftastic, GumTree, SemanticDiff, diffsitter, Pierre's diffs) compare with hihyou's engine, which pattern/rewrite engines hihyou could reproduce in pure TypeScript over syntechs, and whether the proposed rule "a hunk hides only when rewriting base reproduces head on that span" is safe. Every claim is tagged **[fact]** (with a source URL or a file in this repo) or **[inference]** (my reasoning, not stated by a source).

The two product ideas this answers, in the user's words: (1) "understanding hunk by hunk, or even more, ast node by ast node ... like difftastic's idea. but tightly integrated to web"; (2) "grouping changes and hide at once ... standard migration patterns ... shall not be noticed after seeing it once ... porting ast-grep or gritql to web ... make query to be built from AI ... (since pattern cannot lie. right?)".

## Short answer

hihyou's engine is already past difftastic on the axis that matters for idea 2: it is a GumTree matcher with move edits, cross-file declaration moves, and groups for symbol renames, file renames with import updates, and signature changes. **[fact]** (`packages/syntechs/src/diff/matcher.ts`, `packages/engine/src/match/cross-file.ts`, `packages/engine/src/doc/groups.ts`). What it lacks is a user-authored rule layer: a way to state "this before→after transformation is approved" and have every hunk it explains fold away.

For that layer, port ast-grep's pattern semantics (pattern-as-code with `$X`/`$$$X` metavariables, a `fix` template, `inside`/`has`/`not` constraints) as a small own implementation over the syntechs `Tree`, not GritQL. **[inference]** The verification rule only needs "pattern + replacement + a few constraints"; ast-grep's rule is data (YAML/JSON) that an AI already writes well and that needs no new parser, while GritQL is a full language with its own grammar, sequential/file-level semantics and a 200+ pattern stdlib.

"Pattern cannot lie" holds only in a narrow sense. The rewrite-and-compare check proves that every hidden span is exactly what the approved rule produces, so nothing hides that the rule does not describe. It does not prove the rule is harmless: a rule is a change like any other, and a literal one-site rule (`` `x > 0` => `x >= 0` ``) passes the check with zero residual while hiding a behaviour change. **[inference]** So the verdict is **conditional**: sound relative to what the reviewer approved, provided the reviewer sees the rule, the rule is scored for risk like an edit, and syntactic matches are pinned to the binding they meant (import provenance).

## Part A — structural diff tools

### difftastic

- Unit of comparison: tree-sitter syntax nodes flattened into lists of atoms and delimited lists. **[fact]** "Difftastic treats diff calculations as a route finding problem on a directed acyclic graph"; a vertex is a position in both trees, edges are "syntax nodes match" or "novel atom", and the novel edge costs more; Dijkstra finds the cheapest route and "vertex neighbours are constructed as the graph is explored" ([diffing](https://difftastic.wilfred.me.uk/diffing.html)).
- Move detection: none. **[fact]** "Difftastic does not support the concepts of moves and can only try to align either the moved code or the unchanged code" ([SemanticDiff vs difftastic](https://semanticdiff.com/blog/semanticdiff-vs-difftastic/)); a move proposal sits open as "If a subtree is deeply novel on both sides but exists on both sides, it could be treated as a move" ([#508](https://github.com/Wilfred/difftastic/issues/508)), and even string/comment moves are an open request ([#792](https://github.com/Wilfred/difftastic/issues/792)).
- Presentation: side-by-side or inline terminal output, novel tokens coloured; reordering inside a list such as `(x y)` → `(y x)` is listed as hard to display ([tricky cases](https://difftastic.wilfred.me.uk/tricky_cases.html)). **[fact]**
- Scalability: `DEFAULT_BYTE_LIMIT = 1_000_000` and `DEFAULT_GRAPH_LIMIT = 3_000_000` vertices, "small enough to terminate in ~5 seconds"; `DEFAULT_PARSE_ERROR_LIMIT = 0`, so any parse error falls back to a line diff ([options.rs](https://github.com/Wilfred/difftastic/blob/master/src/options.rs)). **[fact]**

### GumTree

- Unit: AST nodes with a label and kind. Two phases: greedy top-down matching of the largest isomorphic subtrees, then bottom-up matching of containers by the share of matched descendants (dice), with a recovery step; the edit script (Chawathe et al.) is insert, delete, update and move ([ASE 2014 paper](https://www.labri.fr/perso/xblanc/data/papers/ASE14.pdf), [repo](https://github.com/GumTreeDiff/gumtree)). **[fact]**
- Move detection: yes, a first-class action; the goal is edit scripts "short and close to the original developer intent" ([paper](https://www.labri.fr/perso/xblanc/data/papers/ASE14.pdf)). **[fact]** A follow-up, "Fine-grained, accurate and scalable source differencing" (ICSE 2024, [ACM](https://dl.acm.org/doi/10.1145/3597503.3639148)), targets its speed; I could not read the abstract (403), so its specific changes are **unverified**.
- Presentation: a web view and a directory diff viewer, plus the raw edit script ([repo](https://github.com/GumTreeDiff/gumtree)). **[fact]**
- Scalability: bottom-up phase is the expensive one; hihyou's own port records it as "cubic on deep nesting" and caps it with a work budget. **[fact]** (`packages/syntechs/src/diff/matcher.ts`)

### SemanticDiff

- Unit: parse tree plus per-language "invariances" — rules that declare two constructs equal: whitespace, optional commas, unnecessary parentheses, `1337` vs `0x539`, reordered Python keyword arguments ([what is](https://semanticdiff.com/docs/what-is-semanticdiff/), [vs difftastic](https://semanticdiff.com/blog/semanticdiff-vs-difftastic/)). **[fact]**
- Moves: "detects moved code, even if it contains additional changes", within a file, with a compare button for old vs new ([home](https://semanticdiff.com/)). **[fact]**
- Refactorings: "tries to detect repeated changes" such as a variable rename and groups them visually ([vs difftastic](https://semanticdiff.com/blog/semanticdiff-vs-difftastic/)). **[fact]**
- What it hides: the invariance classes above; freemium, closed source, "11+" languages. **[fact]** Algorithm details are not published. **[fact]**

### diffsitter and Pierre's diffs

- diffsitter: tree-sitter AST diff that ignores formatting, with `include_kinds`/`exclude_kinds` filters ([repo](https://github.com/afnanenayet/diffsitter)). **[fact]** No move detection is documented. **[fact]** It is a leaf-level differ, not a model for hihyou. **[inference]**
- `@pierre/diffs` 1.5.1 depends on `diff` (jsdiff) and `shiki` ([npm registry](https://registry.npmjs.org/@pierre/diffs/latest)). **[fact]** So it is a line diff with syntax highlighting — a rendering reference for the web viewer, not a structural differ. **[inference]**

### hihyou's engine today

Read from `packages/engine/src` and `packages/syntechs/src/diff`. **[fact]** for everything in this list.

- Matcher: GumTree (top-down isomorphic subtrees, then bottom-up with `minHeight: 2`, `minDice: 0.5`), with a work budget that throws `MatchBudgetExceeded` (`syntechs/src/diff/matcher.ts`).
- Edit script: `insert`, `delete`, `update` (a token whose text changed in place), `move` (a node that changed parent or order); inserts and deletes reported at their outermost node; punctuation never reported as moved (`syntechs/src/diff/edit-script.ts`).
- Whitespace is never content: an edit appears only where whitespace splits tokens or is syntax (Python, YAML, Makefile indentation) (`engine/src/doc/schema.ts`, `FileDiff.edits`).
- Cross-file moves: unmatched subtrees of ≥8 nodes paired across files, first by identical subtree, then by same declaration kind and name with an inner diff for edits made on the way; imports excluded as noise (`engine/src/match/cross-file.ts`).
- Groups (`engine/src/doc/groups.ts`): `move` (declarations moved file→file), `rename-file` (file renamed with import paths updated to follow, resolving relative specifiers and `index`/`__init__`), `rename-symbol` (one identifier renamed, joined across files only through imports), `signature` (a declaration's parameters plus its call sites).
- Folding: generated, lockfile, snapshot, binary, submodule, `format-only` (text changed, syntax did not), `moved` (every edit is an in-file move), renamed/copied, empty (`engine/src/doc/fold.ts`).
- Risk: per-edit signals (`condition`, `operator`, `error-handling`, `exported-api`, `literal`, …) summed per file and per group (`engine/src/doc/risk.ts`, `schema.ts`).
- Fallback to line mode at 500 000 chars, 50 000 nodes, >10 % of text inside ERROR nodes, or matcher budget exceeded (`engine/src/doc/build.ts`) — more lenient than difftastic's zero-parse-error rule.
- Languages: typescript, tsx, javascript, json, python, css (`engine/src/parse/languages.ts`); syntechs also has a Kotlin grammar not wired into the engine.

Missing relative to the ideas: **[inference]**

1. No rule or pattern layer — groups are fixed heuristics; a reviewer cannot say "this transformation is fine, hide every instance".
2. No directory-level move compression: `rename-file` groups are per file, so moving `a/` to `b/` shows N groups instead of one `mv a b`.
3. Invariances stop at whitespace; SemanticDiff-style equalities (quote style, redundant parens, numeric spelling, trailing comma) are not applied to the diff, although `syntechs/src/fmt/check.ts` already has a `Normalize` hook and `decimalValue` for exactly these.
4. Import-block changes are not modelled as a set, so reordering or re-sorting imports shows as edits.
5. No "partially applied" signal: a rename or migration applied at 9 of 10 sites is not flagged at the 10th.

## Part B — pattern and rewrite engines

### ast-grep

- Pattern syntax: a pattern is code parsed by the same tree-sitter grammar; `$X` matches one node, `$$$X` zero or more, `$$X` includes unnamed nodes, `$_X` is non-capturing; reusing a name forces equal subtrees (`$A == $A`) ([pattern syntax](https://ast-grep.github.io/guide/pattern-syntax.html)). **[fact]** Languages where `$` is not an identifier (Python) substitute an `expandoChar` ([custom language](https://ast-grep.github.io/advanced/custom-language.html)). **[fact]**
- Strictness: `cst` (every node), `smart` (default: skips unnamed nodes in the target), `ast`, `relaxed` (also skips comments), `signature` (kinds only, text ignored) ([match algorithm](https://ast-grep.github.io/advanced/match-algorithm.html)). **[fact]**
- Rules: atomic `pattern`/`kind`/`regex`/`nthChild`; relational `inside`/`has`/`follows`/`precedes` with `stopBy` and `field`; composite `all`/`any`/`not`/`matches` ([relational rules](https://ast-grep.github.io/guide/rule-config/relational-rule.html)). **[fact]**
- Rewrite: `fix` is a template with metavariables; "ast-grep's rewrite is indentation sensitive"; `expandStart`/`expandEnd` widen the replaced range (to eat a comma); `transform` and `rewriters` for case conversion, regex replace and sub-rewrites ([rewrite](https://ast-grep.github.io/guide/rewrite-code.html)). **[fact]**
- Runtime: Rust on tree-sitter; `@ast-grep/napi` for Node and `@ast-grep/wasm` 0.45.3 for browsers ([npm](https://registry.npmjs.org/@ast-grep/wasm/latest)). **[fact]** Using the wasm build is ruled out by the project constraint of no Rust anywhere, wasm included.
- Pure-TS reproduction: feasible. **[inference]** Everything ast-grep reads from a node — kind, named/unnamed, field name, children, parent, text — the syntechs `Tree` exposes as `kind`, `kindName`, `named`, `fieldName`, `count`/`child`, `parent`, `start`/`end`, `text`/`label` (`syntechs/src/core/arena.ts`). **[fact]** A minimal port needs: (a) parse a pattern snippet with the target grammar, trying a few wrappers (expression, statement, top-level) and taking the innermost node the snippet produced; (b) a matcher over the pattern tree with `$X`/`$$$X` binding, `smart` strictness and equality of repeated metavariables — ast-grep's list matching for `$$$` is a backtracking walk over sibling lists; (c) `fix` template substitution splicing captured source text and re-indenting; (d) `inside`/`has`/`not`/`all`/`any` as tree walks. Transforms, `follows`/`precedes`, `nthChild` and `expandStart/End` can wait.

### GritQL

- Language: backtick code snippets with `$x` metavariables and `$...` spread, `$_` anonymous; `=>` rewrites; `where` with `<:` (matches); `contains`, `within`, `maybe`, `some`, `every`, `and`/`or`/`not`; lists, functions, file and sequential patterns ([overview](https://docs.grit.io/language/overview), [patterns](https://docs.grit.io/language/patterns), [modifiers](https://docs.grit.io/language/modifiers)). **[fact]**
- Engine: Rust over tree-sitter, MIT, WebAssembly bindings exist, "200+ standard patterns", 12 languages ([repo](https://github.com/getgrit/gritql)). **[fact]** Grit was acquired by Honeycomb in 2025 and GritQL was donated to Biome, announced 2025-12-18 ([Biome blog](https://biomejs.dev/blog/gritql-under-biome-umbrella/)). **[fact]** Biome extracted a `grit-core-patterns` crate "entirely free of TreeSitter dependencies" and runs GritQL over its own parsers ([Biome plugins](https://biomejs.dev/linter/plugins/), [#2582](https://github.com/biomejs/biome/issues/2582)). **[fact]** That split — a parser-independent pattern core plus a per-parser binding — is the shape a syntechs port would take too. **[inference]**
- Pure-TS reproduction: possible but a much larger unit. **[inference]** Needs a GritQL parser (syntechs' compiler could build one from the tree-sitter-gritql grammar, or a hand parser), the pattern/predicate evaluator with backtracking over bindings, `=>` inside arbitrary positions, file-level and sequential semantics, and the stdlib's language-specific helper patterns. Its strength — `before => after` as native syntax with `where` guards — is exactly the rule shape, but ast-grep's `pattern` + `fix` expresses the same pair.

### Refactoring detectors

- RefactoringMiner (Java implementation): 106 refactoring types across Java, Python, Kotlin, TypeScript, JavaScript, C/C++, from statement mappings; also emits AST diffs per commit/PR ([repo](https://github.com/tsantalis/RefactoringMiner)). **[fact]**
- RefDiff: Java, JavaScript, C; code-structure tree of entities; rename, move, move-and-rename, extract/inline, pull-up/push-down, change signature; "precision is 96% and recall is 80%" on 3,248 Java refactorings ([repo](https://github.com/aserg-ufmg/RefDiff)). **[fact]**
- Pure TS: neither is a pattern engine; both are entity-matching heuristics, and hihyou's `rename-symbol`/`move`/`signature` groups are already that kind of detector. **[inference]** What is worth borrowing is the catalogue (extract function, inline, change signature with default argument) as future group kinds, not code.

### Codemod ecosystems

- Kotlin `@Deprecated(ReplaceWith(expression, imports))`: the expression is interpreted at the call site, parameter names are substituted with the call's arguments, and `imports` lists what must be imported ([kotlinlang](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/-replace-with/)). **[fact]** This is the before→after rule the user described, anchored to a declaration rather than to syntax: the "pattern" is "a call that resolves to this symbol". **[inference]** A hihyou rule can be generated from such an annotation in base: pattern `oldFunction($x, $y)` constrained to calls whose callee is imported from the declaring file, fix `newFunction($x, $y)`, plus an import delta. **[inference]**
- OpenRewrite: recipes run over a Lossless Semantic Tree that carries type attribution and formatting; types are needed because `logger.info("Hi")` alone cannot say whether it is SLF4J or Logback ([LST](https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees)). **[fact]** This is the precise limit of syntactic rules. **[inference]**
- jscodeshift: imperative transforms over a Babel/TS AST via recast, which "tries to preserve the style of original code" ([repo](https://github.com/facebook/jscodeshift)). **[fact]** Arbitrary JS transforms cannot be verified or shown to a reviewer as one line; they are the wrong shape for hiding. **[inference]**

### Learning rules from the diff itself

- Getafix mines fix patterns from human before/after edits with anti-unification and hierarchical clustering, from general to specific ([Meta](https://engineering.fb.com/2018/11/06/developer-tools/getafix-how-facebook-tools-learn-to-fix-bugs-automatically/)). **[fact]**
- Refazer learns a transformation from example edits in a DSL and "learns the intended program transformation in 84% of the cases using only 2.9 examples on average" ([arXiv](https://arxiv.org/abs/1608.09000)). **[fact]**
- For hihyou: anti-unifying the before/after subtrees of repeated edits yields candidate rules deterministically, with AI as an alternative proposer; both feed the same verifier. **[inference]**

## Part C — verification: "rewrite base, compare to head, empty residual"

Setup. **[inference]** for this whole part unless tagged. A rule R = (pattern P, fix F, constraints C). Apply R to base at every non-overlapping match, producing base′. Diff base′ against head with the existing engine. A span of head is *explained by R* when it is covered by a rewrite site and base′ and head agree there. The residual is every edit between base′ and head. Only explained spans hide.

### Soundness: can it hide a semantic change?

What the check guarantees: every hidden character of head is exactly F instantiated with text copied from base. Edits inside a captured `$X` are not hidden, because base′ copies `$X` verbatim from base, so head's edited `$X` differs and lands in the residual. That part is sound.

Where it is not sound by itself:

1. The rule is the change. A rule with no metavariables that matches one site is just the hunk restated; it hides whatever it says, including `>` → `>=`. Mitigation: diff P against F with the engine and score it with `risk.ts` signals — an `operator` or `condition` edit inside the rule marks it high risk and it is never auto-hidden; require either ≥2 sites or at least one metavariable to be called a rule at all.
2. Same syntax, different binding. `aa(x)` → `bb(x)` is right where `aa` is the imported deprecated function and wrong where `aa` is a local that shadows it. ast-grep and GritQL match syntax, not bindings; OpenRewrite needs types for exactly this ([LST](https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees), **[fact]**). Mitigation: a constraint `resolvesTo: { name, from: module }` built on the import resolution `groups.ts` already does (`importedFrom`, `imports`), and show "N sites, of which M resolved by import" on the rule card.
3. Partial application. Sites in base that match P but whose head is not F(site) are the most interesting evidence: either the author forgot one or deliberately left it. Surface them as "unapplied sites" rather than ignoring them.
4. Comments and trivia inside the matched span but outside any capture are dropped by the rewrite; if head also dropped them the comment deletion hides. Compare comments as `check` does (as a multiset) and put any lost comment in the residual.
5. Precedence. Substituting `$X` textually into F can change parsing (`$X * 2` with `$X = a + b`). Re-parse base′ and require the substituted node to parse as the same subtree; ast-grep has the same hazard. A failed re-parse means the rule does not apply at that site.
6. Rule interaction. Two approved rules can overlap or feed each other. Apply all approved rules in one pass over base with a fixed order and no re-application to their own output; attribute each hidden span to exactly one rule, the way `groupEdits` gives each edit at most one group.

### Completeness: what legitimate mechanical changes it fails to hide

1. Formatting after the rewrite. A byte comparison fails when F's layout differs from what the formatter or author produced. The engine already treats whitespace as non-content, so the residual computed by the engine diff (not by string equality) absorbs re-indentation and re-wrapping. **[fact]** for the engine behaviour (`schema.ts`); the rest **[inference]**. Style changes a formatter also makes (trailing comma, quote style, parens) need the `Normalize` equalities `check` uses (`syntechs/src/fmt/check.ts`, **[fact]**). Running syntechs fmt on both base′ and head is the stronger alternative, but it only works for languages with a formatter and costs a full format per file; token-normalized comparison is enough.
2. Imports. `aa` → `bb` also removes `import { aa }` and adds `import { bb }`, possibly re-sorted. A pattern over call sites cannot reproduce that. Model a rule's import delta explicitly (Kotlin's `imports`, **[fact]** [kotlinlang](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/-replace-with/)) and compare the import block as a set of (module, name, alias) bindings, not as text; ordering changes then vanish.
3. Moved and edited. A function moved to another file and migrated on the way is a cross-file `move` with inner edits (`cross-file.ts`, **[fact]**). Apply rules to the inner edit pairs as well, so the move is shown once and its migrated calls hide.
4. Context-dependent variants: one site became `bb(x)`, another `bb(x, {})` because it had an options argument. Needs `any` of several fixes or a second rule; AI or anti-unification proposes the second.
5. Non-local rewrites: the replacement depends on something outside the span (a new parameter whose value comes from the enclosing function). Not expressible as P → F; stays visible. That is acceptable.

### File moves plus import-path updates

`mv a b` is a derived rule, not a pattern: for every importer, a specifier that resolves to `a/p` becomes one that resolves to `b/p`. Its correct fix is a function of the importer's path (the relative specifier changes by directory), so it is checked by resolution equivalence rather than by text: an import in head is explained when its specifier resolves to `b/p` and base's resolved to `a/p` with the same imported names. `groups.ts` already resolves relative specifiers and `index`/`__init__` for `rename-file`. **[fact]** Compression: when every file under `a/` in base appears under `b/` in head with the same suffix and every import change is explained, fold them into one `mv a b` group. Path aliases (`tsconfig` `paths`, `@/x`) and package self-imports need config the engine does not read, so leave those in the residual. **[inference]**

### Showing an AI-generated rule once

The card a reviewer approves: rule text (pattern → fix, constraints, import delta); "N sites, M explained, 0 residual, K unapplied"; the rule's own risk (P vs F scored with the edit signals); three samples — first, the most different capture, and one from another file; the unapplied sites listed in full. Approving hides the M sites; the residual at any site stays visible; the unapplied sites stay visible and flagged. The AI is never trusted: it only proposes, and the verifier's numbers are mechanical. The one thing the reviewer must actually read is the rule, which is why the rule card, not the hidden hunks, is the unit of review. **[inference]**

## Part D — synthesis

### Data model sketch **[inference]**

```ts
type Rule = {
  id: string;
  language: LanguageId;
  pattern: string;             // ast-grep-style snippet with $X / $$$X
  fix: string;                 // template over the same metavariables
  where?: Constraint[];        // inside / has / not / kind / resolvesTo
  imports?: { add: Binding[]; remove: Binding[] };
  origin: "ai" | "mined" | "replace-with" | "derived-mv" | "user";
};
type Application = {           // one site
  rule: string;
  base: Range; head?: Range;   // head absent when unapplied
  captures: Record<string, Range>;
  status: "explained" | "residual" | "unapplied" | "no-reparse";
  residual: Edit[];            // engine edits between base′ and head on this site
};
type RuleGroup = {             // a new Group kind beside rename-symbol, move, ...
  kind: "rule"; rule: string;
  sites: number; explained: number; unapplied: number;
  risk: Risk;                  // of the rule itself, P vs F
  edits: number[];             // edit ids it hides
};
type DirMove = { kind: "mv"; from: string; to: string; files: number; edits: number[] };
```

A rule group joins `Group` in `schema.ts`; edits it explains belong to it the same way edits belong to `rename-symbol` today, and `fold` gains a `rule` reason for a file whose every edit is explained.

### What to build first **[inference]**

1. Directory move compression (`mv a b`) on top of `rename-file`: no new language, uses the import resolution that exists, and is the case the user named first.
2. Import block as a binding set, so import reorders and import-path updates stop being edits.
3. The verifier: rule → apply to base → engine diff base′ vs head → per-site status. Start with a pattern matcher supporting `$X`, `$$$X`, repeated-name equality and `smart` strictness, plus `fix` substitution — enough for rename-call and argument-reshuffle migrations.
4. Rule risk scoring and the rule card in the viewer.
5. Rule proposal: anti-unification of repeated edit pairs first (deterministic, runs in the browser), AI proposer second, both through the same verifier. `resolvesTo` constraint and Kotlin `ReplaceWith` import after that.

### Open questions for the user

1. Where do approved rules live: per review session, per repo (committed file), or per user? This decides whether a rule seen once in one PR stays hidden in the next.
2. Should the residual compare by tokens under `check`-style normalization (fast, every language) or by running syntechs fmt on both sides first (stricter about style, only where a formatter exists)?
3. Is a one-site rule allowed to hide anything, or does hiding require ≥2 sites or a metavariable?
4. Should an "unapplied site" (matches P in base, unchanged in head) block the rule from hiding, or only be flagged?
5. Rule syntax facing the user: ast-grep YAML/JSON verbatim (so existing ast-grep rules and AI familiarity carry over), or a GritQL-like `before => after` one-liner compiled to the same model?
6. Which languages first: the engine's six, or wire Kotlin in so `@Deprecated ReplaceWith` can be the first rule source?

## Unverified

- GumTree ICSE 2024 abstract (ACM returned 403); its exact scalability changes are not read.
- SemanticDiff's move/invariance algorithms are not published; only its documented behaviour is cited.
- diffsitter's exact algorithm (the README does not state it).
- Whether ast-grep's `$$$` list matching is greedy with backtracking — stated from reading of its docs' behaviour, not its source.
- None of the Part C mechanisms were prototyped; they are design reasoning over the engine's current code.
