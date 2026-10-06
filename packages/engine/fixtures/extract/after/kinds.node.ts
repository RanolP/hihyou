// Checks a query pattern's node kind against the grammar. A name alone is not enough: `(foo)` matches only a named
// node and `"foo"` only an anonymous one, so a kind the grammar has under the other flavour can never match.
// (tree-sitter-css's grammar.patch makes `and`/`or`/`not`/`only` named, which left upstream's `"and" @operator`
// silently matching nothing.)

import { FLAG_NAMED, type Language } from "../core/language.js";

export type KindIndex = Map<string, { named: boolean; anon: boolean }>;

export function kindIndex(language: Pick<Language, "symbolNames" | "symbolFlags">): KindIndex {
  const index: KindIndex = new Map();
  language.symbolNames.forEach((name, symbol) => {
    const entry = index.get(name) ?? { named: false, anon: false };
    if (((language.symbolFlags[symbol] as number) & FLAG_NAMED) !== 0) entry.named = true;
    else entry.anon = true;
    index.set(name, entry);
  });
  return index;
}

/** Why `kind` written as a string (`anon`) or a parenthesized name cannot match in `languageName`, or undefined. */
export function kindError(index: KindIndex, kind: string, anon: boolean, languageName: string): string | undefined {
  const shown = anon ? JSON.stringify(kind) : `(${kind})`;
  const entry = index.get(kind);
  if (!entry) return `${shown} is not a node kind of ${languageName}`;
  if (anon ? entry.anon : entry.named) return undefined;
  return `${shown} never matches in ${languageName}: ${kind} exists only as ${anon ? "a named" : "an anonymous"} node (write ${anon ? `(${kind})` : JSON.stringify(kind)})`;
}
