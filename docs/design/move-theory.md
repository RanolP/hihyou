# Move theory: claims that are provably true

Design date 2026-10-04. Status: theory agreed as the target; steps 1 to 3 of the change list are implemented. It builds on the move and extract presentation in `docs/design/review-core.md` and does not restate it.

The maintainer's instruction: "ast level이라 더 고가치 정보가 많으니 (cst도 아니고) 선택적으로 수용해서 theory를 만들자. 증명가능하게 false positive가 없도록." (We diff at AST level, not text and not a raw CST, so we hold richer information; adopt the literature selectively and build a theory under which move claims provably have no false positives.)

## What the tree holds

syntechs parses into a tree-sitter-shaped tree (`Tree` in `packages/syntechs/src/core/arena.ts`). Physically it is a concrete syntax tree: every token is a node, `(` and `;` and `return` included. Each node also carries what makes an AST view of it cheap:

- **Exists today:** the node kind by name (`kindName`); the `named` flag, false for anonymous tokens; the field a node fills in its parent (`fieldName`: `name`, `body`, `operator`, `condition`, and `kind` on `const`/`let`); a leaf's label (`label`, whitespace in comments collapsed); exact subtree isomorphism ids (`isoIds` in `packages/syntechs/src/diff/matcher.ts`, interned strings, so no hash collisions); a declaration's declared name (`nameOf` in `packages/syntechs/src/diff/move.ts`); a per-language set of declaration kinds (`Grammar.declarations`).
- **Absent:** scopes and bindings. No grammar ships a locals query (the generated `highlight.gen.ts` files say "no locals query"), so nothing knows which identifier occurrence refers to which declaration.
- **Cheap to derive:** a per-language table of binder positions, `(kind, field)` pairs such as `variable_declarator.name` or `required_parameter.pattern`, and of scope kinds (function, block, `for`, `catch`), kept beside `Grammar.declarations`. They name binding occurrences and scopes syntactically; they do not resolve references across files.

The theory uses two projections of one tree. **Equality** is over the normalized CST: kind, field, label and shape of every node, punctuation included, after the one normalization below, which is `isoIds` computed over alpha-normalized labels; a pure move's equality alone skips that normalization and compares the code as written. **Measure** is over the AST projection: it counts content atoms (named leaves and field-tagged operators, defined below), never punctuation, and `k = 4`. A stricter equality can only drop claims, never make one false; a measure that counts punctuation is what makes unrelated code look alike (#76).

## Normalization

Only semantics-preserving normalization is allowed, and only one is: scope-certain alpha-conversion of local binders, which are parameters, `let`/`const` declarators, `catch` parameters and loop variables. Free names, imports, properties and a declaration's own name are never alpha-normalized; renaming any of them changes what the code means or what it exposes.

**Use-based naming.** A bound name is replaced by a name derived from its uses, as in Maziarz et al., ["Hashing Modulo Alpha-Equivalence"](https://arxiv.org/abs/2105.02856) (PLDI 2021), not by a positional de Bruijn index, so inserting a binder does not renumber the rest of the block.

**Scope uncertain, names kept.** Where scope is not certain (`var` hoisting, `with`, `eval`), the original names are kept. That loses recall and never makes a false positive.

**Rejected: commutative and associative normalization** (`a && b` as `and({a, b})`). Order is meaningful everywhere: `user && user.name` short-circuits, operands have side effects, `+` on strings is not commutative, and float addition is not associative. A reorder shown as a move is correct, because it exposes the change.

## Definitions

**Content atom.** A node that is either (a) named, not a comment, and without a named child (an identifier, a number, `null`, `this`, a whole `""`, a `break;`), or (b) an anonymous token filling a field (`<` in `binary_expression.operator`, `const` in `lexical_declaration.kind`). `C(n)` is the multiset of content-atom labels in the subtree of `n`, `|C(n)|` its size. `(`, `;`, `{`, and keywords filling no field (`return`, `if`, `async`) are never content. `<` against `<=` is a content difference; `return f(x)` against `return g(y)` differs in two of its two atoms.

**Unit.** A named node that fills no field in its parent: a statement, a class member, a parameter, an argument, an array element, a returned or parenthesized expression. Operands (`left`, `right`), callees, conditions' wrappers and declarator values fill fields and are not units. This is read off `fieldName` alone.

**Rename relation.** A rename map `ρ` is a bijection between identifier labels. `x ≡ρ y` holds when the two subtrees have the same shape, and every pair of corresponding nodes has the same kind and field and either the same label, or both are of kind `identifier` and `ρ` maps one label to the other. `ρ` is admissible for `(x, y)` when it is the identity on every label but the renamed ones, and for every pair `u ↦ v` with `u ≠ v`, every occurrence of `u` in `x` lies inside the scope node of a binder of `u` that is itself inside `x`, and likewise `v` in `y`. Without the scope condition, `f(x); { const x = 1; g(x); }` against `f(y); { const y = 1; g(y); }` would pass with `x ↦ y`, although the first `x` refers to an outer variable and the second code calls `f` on a different one. Shorthand properties and property names are other kinds, so `{a}` becoming `{b}` breaks `≡ρ` instead of hiding a changed key. With `ρ` the identity, `≡ρ` is `isoIds` equality. A canonical id that replaces each scoped local bound name by its use-based name (see Normalization) decides `≡ρ` in one pass.

**Core.** Given `x` and `y`, a core `K` is a list of pairs `(s_i, t_i)` where each `s_i` is a unit inside `x` (or `x` itself) and each `t_i` a unit inside `y` (or `y`), the `s_i` are pairwise disjoint and so are the `t_i`, the list is increasing in document order on both sides (no crossing pairs), `s_i ≡ρ t_i` for one admissible `ρ` shared by all pairs, and every `s_i` holds at least two content atoms. Its weight `w(K)` counts the content atoms inside the `s_i` whose label `ρ` leaves fixed; an occurrence equal only because `ρ` renamed it counts zero, since the rename map, not the code, made it equal. `top(K)` is the weight of its heaviest pair.

**Declaration chain.** `chain(n)` is the list of `(kind, nameOf)` of the ancestors of `n` whose kind is in `Grammar.declarations`, outermost first. It reads the tree only.

**Anchor.** A pair `(z, z')`, `z` in the before file of `x` and `z'` in the after file of `y`, with the same iso id, that id occurring exactly once in each of the two files, `|C(z)| ≥ 2`, and `z` disjoint from `x`, `z'` from `y`. It is patience diff's unique line, at node resolution.

**Moved.** `moved(x, y)` holds when (a) `x` and `y` are in different files, or (b) `chain(x) ≠ chain(y)`, or (c) some anchor `(z, z')` has `x` before `z` and `y` after `z'` in document order, or the reverse. None of the three reads the matcher's mapping.

## What a claim asserts

A move claim is `(x, y, class, W)` with a witness `W`. Every claim asserts **F1** `moved(x, y)`, **F0** `|C(x)| ≥ k` and `|C(y)| ≥ k`, and **F3** uniqueness: in the whole Diffset, no other after node admits a witness of this class or a stronger one with `x`, and no other before node with `y` (pure is stronger than edited). The class adds one fact:

- **Pure** ("Moved"), `W = ∅`: **F2p** `x ≡ y` over the whole subtree as written, every token included: equal iso ids with `ρ` the identity. A pure move is exactly a moved-and-edited one whose diff is empty; code equal only modulo a local rename is moved and edited, with the renamed occurrences counting zero toward `w`.
- **Moved and edited**, `W = (ρ, K)`: **F2e** `w(K) ≥ θ·|C(x)|`, `w(K) ≥ θ·|C(y)|` and `top(K) ≥ k`, with `θ = 1/2`. At least half of what the old code said is carried over in whole units, unchanged and in order; at least half of what the new code says came from the old; and one carried unit is substantial on its own. `x` and `y` have the same kind.
- **Extract** ("Extracted into `n`" / "Extracted from"), with `R` the removed nodes at a site and `D` the new declaration named `n`: a node inserted at the site calls `n` (call `c`), and `W = (σ, K)` where `σ` substitutes each parameter of `D` with the argument subtree `c` passes it, and `K` is a core between `R` (its top nodes count as units) and `body(D)[σ]` with `w(K) ≥ θ·|C(R)|` and `top(K) ≥ k`. F3 reads: no other new declaration and no other site admits such a witness.

`k` starts at 4 content atoms and is calibrated on fixtures. It is the content-counted counterpart of git's 20 alphanumeric characters and Phabricator's 3 lines of 30. A one-atom move is not false, only not worth a label; `k` is part of the claim so that the checker, not a classifier's goodwill, keeps `return null;` from ever being called moved. The import exclusion in `packages/engine/src/move.ts` (`importKinds`) stays a filter on proposals.

In plain words, "Moved" says: this exact code is gone from here, stands there, and stands nowhere else in the change. "Moved and edited" says: most of this code, in whole statements and in order, is gone from here and stands there, and nowhere else could claim as much.

**Asserted versus shown.** A claim's facts are what the reviewer may rely on; everything else on screen is presentation and asserts nothing.

| On screen | Status |
| --- | --- |
| "Moved" / "Moved to/from `<path>:<line>`", and the two halves sharing one atom | asserted: F0, F1, F3, F2p |
| "Moved and edited" | asserted: F0, F1, F3, F2e |
| A local rename shown on an edited move | asserted: the pairs of `ρ`, which the label must list |
| "Extracted into `n`" / "Extracted from" | asserted: the extract facts |
| Emphasis inside a moved node, or an extract's "generalized" emphasis | shown, not asserted: it reads "not matched", which may include code that was carried over; it does not say the code changed |
| The moved box widened over blank and bracket-only lines (`Side.moves`) | shown: those lines hold no content atom |
| The expanded inner diff of a cross-file pair (`mergeLines`) | shown |
| A move dropped because both halves sit in one hunk | shown: dropping a claim asserts nothing |

**False positive**, then, has one meaning: an emitted claim one of whose asserted facts is false of the two trees. Author intent is out of reach and is not part of the definition; what the reviewer is told is.

## The checker and the theorem

`checkClaim(claim)` evaluates, from the two trees and the witness alone:

1. F0 and F1 by the definitions: content counts, declaration chains, and the anchor's iso ids and occurrence counts in both files.
2. For pure: equal iso ids of `x` and `y` as written. For edited and extract: `ρ` bijective and admissible; every core pair a unit pair with equal canonical ids (for an extract, the ids of `body(D)[σ]`, computed with each parameter occurrence standing for its argument's id); disjoint, increasing on both sides, two atoms each; `σ` mapping exactly the parameters of `D` to the arguments of `c`; and the inequalities in integer arithmetic (`2·w ≥ |C|`, `top ≥ k`).
3. F3, by exact count for pure and by a bound for edited. Pure: `x`'s canonical id occurs once among all before nodes of the Diffset and `y`'s once among all after nodes; no threshold is involved, so no bound is used. Edited: for every other after node `y'` of `x`'s kind, `|C(x) ∩ C(y')| < θ·|C(x)|` or `|C(x) ∩ C(y')| < θ·|C(y')|` (multiset intersection of content labels), and also no other node has `x`'s or `y`'s canonical id; symmetrically for `x'` against `y`. A candidate the bound cannot exclude is not searched further: the claim is declined.

**Lemma (bound).** For any core `K` between `x` and `y'`, `w(K) ≤ |C(x) ∩ C(y')|`. Each pair `s_i ≡ρ t_i` has the same atoms in the same order, and an atom counts toward `w` only when `ρ` fixes its label, so it has the same label on both sides; the `s_i` are disjoint and so are the `t_i`, so the counted atoms form a sub-multiset of `C(x)` matched label for label into a sub-multiset of `C(y')`.

**Theorem (soundness).** Every claim the engine emits satisfies F0, F1, F3 and its class fact.

*Proof.* The engine emits a claim only when `checkClaim` returns true on it; any other candidate is demoted to a delete plus an insert, which asserts no pairing. F0, F1 and F2 are predicates on the two trees and the witness, and steps 1 and 2 evaluate them exactly: canonical ids are interned strings, so equal ids mean `≡ρ` holds; occurrence counts and weights are integers the checker computes itself; declaration chains and anchors read the trees, not the mapping. For F3, suppose another after node `y'` admits a witness with `x` of the same or a stronger class. If that witness is pure, `y'` has `x`'s canonical id, which step 3 counted, and the claim was declined. If it is edited, `y'` has `x`'s kind and its core `K'` has `θ·|C(x)| ≤ w(K')` and `θ·|C(y')| ≤ w(K')`, so by the lemma both bounds in step 3 fail for `y'`, and the claim was declined. The same argument covers another before node `x'`, and the extract's other declarations and sites. So every emitted claim's facts hold. ∎

The proof never mentions the matcher's mapping, `bestFor`, `recover`, dice or name pairing. They decide which candidates are proposed, which governs recall, and nothing they do can make an emitted claim false. The matcher stays heuristic and free to change; soundness lives in one small function. The one place the mapping still shows through is a plain atom inside a moved node, which the screen presents as carried over: the checker confirms that each such atom is paired with an atom of the same label, and that is all it asserts.

## Declaration rename

A renamed declaration (`load` becoming `fetchItem`) involves two separate claims, checked separately.

- **(A) The body is equal modulo `{old ↦ new}`.** This is a textual fact about the two trees. It is accepted with F3 uniqueness and `k`, with no usage analysis.
- **(B) The call sites changed only by the rename.** Normalizing call sites as rename-only requires all of:
  - at least one otherwise-identical usage, so the claim is never vacuously true;
  - a scan of the whole repository at both commits, with an exported API's claim scoped to "within repo";
  - a bijection: the old name is absent after, and the new name absent before;
  - scope-correct resolution, imports and shadowing included;
  - a decline when the old name appears as a string literal.

  Phase 1 covers only top-level functions, consts and classes; methods need types.

## Cases

- **Pure move.** A function moved verbatim below its neighbour: equal ids, the neighbour a unique anchor, the id unique in the Diffset: "Moved".
- **Move with a consistent rename.** `const r = fetch(u); log(r); return r.json();` moved, `r` renamed to `res` throughout: `ρ = {r ↦ res}` is admissible, since every `r` lies in the scope of the `const` inside the moved code, but the code is not equal as written, so it is not pure: "Moved and edited", with `r → res` in the label. The renamed occurrences count zero, so the core weighs `fetch`, `u`, `log`, `json` and the binder kinds, and passes F2e only when that unrenamed content is half of each side.
- **Moved and edited.** A function moved with one of five statements changed: the other four and the parameters are core pairs, well over half the atoms both ways.
- **Operator-only edit.** `if (i < n) { total += items[i].price; log(total); }` moved and becoming `if (i <= n) { ... }`: `<` and `<=` differ, so it is not pure; the two body statements are the core, so it reads "Moved and edited" with `<=` emphasized. Pure can never hide it, because pure is equality over every token.
- **Same shape, different content.** `if (a) { return f(x); }` moved and becoming `if (b) { return g(y); }`: no unit of one equals a unit of the other, `w = 0`, no claim.
- **#76, punctuation inflation, and the rewritten same-named function.** `function load(id: string) { const r = fetch(url + id); log(r); return r.json(); }` moved below a sibling and rewritten to `{ const v = cache.get(id); track(v); return v ?? null; }`: 12 content atoms a side; the only equal unit is the parameter `id: string`, `w = 2 < 6`. With `ρ = {r ↦ v}`, `log(r)` against `track(v)` still differs in its callee, and renamed occurrences count zero. No claim, provably: by the lemma no core of any shape reaches 6.
- **Scattered words.** `if (user.name) return user.id;` against `log(user.name, user.id);`: the units `user.name` and `user.id` match, `w = 4` of 4 and 5, but `top(K) = 2 < k`: no claim. Without the `top` condition the theory would readmit a word bag in order.
- **Duplicates.** Two identical helpers both deleted and one identical copy inserted: two before nodes share `y`'s id, so no claim. Code kept in place and also pasted elsewhere: the after side holds its id twice, so no claim, and the paste reads as an addition.
- **Cross-file move.** F1 holds by file; F3 counts over every file, so an identical copy inserted into a third file makes it ambiguous.
- **Extract.** `total = price * count;` removed, and `function scale(count, price) { return count / price; }` added and called as `scale(count, price)` at the site: `σ` maps each parameter to the same-named argument, and `count / price` equals no unit of the removed code: `w = 0`, no claim. An extract whose body keeps a statement of four atoms or more from the removed code, and half its atoms, is claimed.

## Literature adopted and rejected

| Source | Adopted | Rejected, and why |
| --- | --- | --- |
| [GumTree](https://doi.org/10.1145/2642937.2642982) (ASE'14) | Isomorphic-subtree equality as F2p; the matcher as an untrusted candidate generator; `θ = 1/2` | Dice over all descendants as a claim criterion: it counts punctuation, and the mapping it builds is not evidence |
| ["simple" recovery](https://hal.science/hal-04855170) (ICSE'24) | Iso LCS, kind and label LCS, unique-kind pairing, kept in `recover` as proposals | As a decision: it maps, it does not prove |
| [RefactoringMiner AST diff](https://arxiv.org/abs/2403.05939) (TOSEM'24) | Units equal after consistent replacement, no similarity threshold: the core's `≡ρ` pairs; argument substitution as the extract's `σ` | Replacements beyond scoped renames (any expression for any expression): not checkable as one bijection |
| IJM (ICSME'18) | Name awareness as a proposal: a unique kind and name pairs candidates (`recover`, PR #418; `sameName` in `crossFileMoves`) | Name similarity as acceptance: a shared name proves the name, not the body |
| [RefDiff 2.0](https://arxiv.org/abs/2001.04794) (TSE'20) | The token bag, only as F3's upper bound | A bag threshold as acceptance: order and structure are lost, so rewritten code pairs |
| ChangeDistiller (TSE'07), MTDiff (ASE'16), iASTMapper (ASE'23) | Nothing beyond the above | Their similarity thresholds decide mappings, and mappings never decide claims here |
| Fan et al. (ICSE'21) | GumTree, MTDiff and IJM map wrongly on 20 to 36% of revisions: why F1 and F3 do not read the mapping | |
| [Hashing Modulo Alpha-Equivalence](https://arxiv.org/abs/2105.02856) (PLDI'21) | Use-based names for bound variables in the normalized iso ids | Positional de Bruijn indices: inserting a binder renumbers the rest |
| [git `--color-moved`](https://git-scm.com/docs/git-diff), Phabricator, BDiff (2025) | A minimum-content `k`, counted in content atoms; unique anchors, as in patience diff | Line-text equality: coarser than the tree |

No paper isolates punctuation filtering with an ablation. The theory needs none: punctuation is outside the measure by definition and inside equality.

## Where today's code is unsound

Probed on 2026-10-04 with a scratch vitest over `editScript(match(...))` on TypeScript, not committed. Step 3 of the change list fixes items 1, 2, 3 and 6; items 4 and 5 stand, guarded by `checkClaim`:

1. **`classifyMove` (`packages/syntechs/src/diff/move.ts`)** scores dice over every non-empty leaf, punctuation and fieldless keywords included, and `minNodes` counts every node. `if (a) { return f(x); }` moved below `keep(1, 2, 3);` and becoming `if (b) { return g(y); }` is emitted as an edited move (probed): `if ( ) { return ( ) ; }` carry it past 0.5 while every content atom changed. The rewritten `load` above, moved below one sibling, is emitted as an edited move (probed): the name pass in `recover` proposes it and the punctuation-heavy dice accepts it. Its `pure` means "every leaf paired with a same-label leaf", not subtree equality; a moved `f(g(a1), h(b1))` with swapped arguments read edited, so no counterexample was found, but the theorem needs equality rather than a pairing that happens to coincide with it.
2. **The `SameLeaf` hook (`move.ts`)** lets a caller declare any leaf pair equal, so any rule plugged in can make a rewritten move read pure. A rename must be a witness `ρ` the checker verifies.
3. **`identical` in `crossFileMoves` (`packages/engine/src/move.ts`)** takes the first unclaimed identical candidate in another file (`byIso.get(id)?.find(...)`). A helper deleted from one file and pasted verbatim into two others is claimed as moved into the first (by reading the code, not probed). Same-file look-alikes are not counted.
4. **`settleMoves` (`packages/syntechs/src/diff/edit-script.ts`)** checks look-alikes for exact copies only, within one file: an edited move has no uniqueness check, and an identical copy inserted into another file leaves an in-file move standing.
5. **In-file "moved" (`movesAt`, same file)** is read off the mapping: a parent the matcher paired wrongly makes code that stayed put read as moved. F1 replaces it with chains and anchors.
6. **`findExtracts` (`packages/engine/src/extract.ts`)** accepts by a bag of regex words (a third per delete, half in total, two at least), counting the declaration's name and parameters and splitting string contents into words. The `scale` example passes it (by reading: `price` and `count` are two of the removed code's three words) though the body computes something else. Two sites sharing equally many words go to the first (`shared > prev.shared`), and a delete wanted by two declarations goes to the greedier, where the theory declines both.

The matcher's heuristics (`minDice` in `bestFor`, the passes of `recover`, `fits`) are not on this list: under the theory they propose and never decide.

## Change list, in order

1. **`checkClaim` at the one place every claim meets.** A standalone module run in `packages/engine/src/diffset.ts` that verifies every move, cross-file move and extract claim (each move `settleMoves` kept, each `crossFileMoves` pair, each `findExtracts` result), with the content measure, Diffset-wide id counts, declaration chains and anchors. A failing claim is demoted to delete plus insert. From here every emitted claim is sound, whatever the classifiers do; the remaining steps win recall back. Its runnable check: a test that builds each fixture's Diffset and asserts every emitted claim passes a `checkClaim` recomputed from the trees, so a classifier that emits an unchecked claim fails it.
2. **TS/JS binders, scopes and alpha-normalized iso ids.** Binder and scope tables for TypeScript and JavaScript, and iso ids computed over the use-based names of scope-certain local binders (see Normalization).
3. **Witness-based classification.** `classifyMove` returns a witness instead of a dice class: pure when the iso ids are equal as written; edited when a unit core (unit pairs with equal normalized iso ids inside `x` and `y`, then their longest chain increasing on both sides) passes F2e. `SameLeaf` is deleted and `k` replaces `minNodes`. `crossFileMoves` declines when more than one candidate shares the id, instead of taking the first. `findExtracts` keeps its word overlap as a proposal, then builds its witness by argument substitution (`σ`) and a core against the substituted body, declining ties.

## What is not guaranteed

Soundness is bought with recall; which real moves stop being claimed, and which of those losses are acceptable, is still under discussion.

## Oracle review

Before this definition was fixed, an independent review (the `oracle` agent) was asked whether it is both provably sound and useful for review, and where it is weakest. Its verdict: sound only for the predicate written down, and the first draft's theorem was not yet true, because F1 ("the parent is not mapped to the parent") and the candidate pools were read off the matcher's mapping, so the checker verified facts against an unverified premise; useful for pure moves, weaker than a reviewer reads for edited ones, because single-identifier core pieces readmit the word bag in order. Its weakest point was the mapping leaking into F1 and the pools. All of its holes are taken here: F1 is now different file, different declaration chain, or a crossed unique anchor, none of which read the mapping, and F3 counts over every node of the Diffset rather than over a pool the mapping defines; renames require every occurrence to lie in the scope of a binder inside the moved code, after its shadowing counterexample; core pieces are whole units of at least two atoms and the heaviest must reach `k`, after its `user.name` / `user.id` counterexample; pure candidates go to the exact count, not the bound; emphasis reads "not matched", not "changed". One suggestion is taken in part: `k` is now part of the claim, checked like the rest, but only so that no classifier can emit a trivial claim, since a small claim is noise rather than a falsehood. Its open question, how often the matcher mispairs the parent of an exactly moved node and how often in-parent reorders occur with no anchor between them, decides how much recall F1 costs and is left to measurement on hihyou's own history.
