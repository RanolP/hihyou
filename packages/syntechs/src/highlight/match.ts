// Runs a tree-sitter highlight query that highlight/generate.node.ts compiled, painting each capture as the
// TextMate scope the language's sitter-to-tm ruleset names for it. The generated src/grammars/<name>/highlight.gen.ts
// holds the patterns as data; this is the matcher they share.
//
// Matching follows tree-sitter's: a child pattern matches any later child (gaps allowed), `.` anchors it to the
// next named child, a quantified child may repeat or be absent, and every way a pattern matches is a match. When
// patterns capture the same node, the one later in the query wins, as `tree-sitter highlight` resolves them.
//
// An injection query's matches name ranges of the tree to parse with another language (JSDoc in a comment, a
// regular expression in a regex literal). That language's highlighter paints them after the host's, so its
// scopes stack inside the host's as a TextMate grammar's embedded scopes do. `highlight` stays synchronous:
// the module's `load` imports the injected languages first, and until it has, nothing is injected.

import { type Language, parseTree, type Tree } from "../core/index.js";
import type { HighlightModule, Paint } from "./index.js";

export interface QueryNode {
  /** A named node's kind, or an anonymous node's text when `anon`; absent for a wildcard. */
  kind?: string;
  anon?: boolean;
  /** `(_)` matches named nodes only; `_` matches any node. */
  namedOnly?: boolean;
  field?: string;
  /** Indexes into the module's captures. */
  captures?: number[];
  children?: QueryItem[];
  /** A `.` after the last child: no named child may follow it. */
  anchorEnd?: boolean;
  /** An alternation: matches what any of these matches. */
  alt?: QueryNode[];
}

export interface QueryItem {
  node: QueryNode;
  quant?: "?" | "*" | "+";
  /** A `.` before this child: it is the first named child, or the named sibling right after the previous one. */
  anchored?: boolean;
}

export interface QueryPattern {
  root: QueryNode;
  /** The pattern's predicates, given the texts each capture holds in this match. */
  test?: (texts: (capture: number) => string[]) => boolean;
}

/** How one capture paints: the scope for the node, refined by its kind or text. */
export interface CaptureScope {
  scope: string;
  byKind?: Record<string, string>;
  byText?: Record<string, string>;
  /** `[prefix, scope]` pairs, the first whose prefix starts the node's text winning. */
  byPrefix?: [string, string][];
  /** Paint the node's anonymous tokens (`return`, `constructor`) rather than all of it. */
  tokens?: boolean;
}

export interface CompiledQuery {
  /** By capture index; null for a capture that paints nothing and does not win over others (`@_name`). */
  captures: (CaptureScope | null)[];
  patterns: QueryPattern[];
  injections?: CompiledInjections;
}

/** One pattern of an injection query; its captures index the injection query's own capture list. */
export interface InjectionPattern extends QueryPattern {
  /** The injected language's name (`#set! injection.language`), or the capture whose text names it. */
  language: string | { capture: number };
  /** The `@injection.content` capture. */
  content: number;
  /** `injection.combined`: every match's content is parsed as one document. */
  combined?: boolean;
  /** `injection.include-children`: the content keeps the text of its child nodes. */
  includeChildren?: boolean;
  /** A regular expression the content's text must match (the ruleset's `injectionMatch`). */
  contentMatch?: RegExp;
}

export interface InjectedLanguage {
  language: Language;
  highlight: HighlightModule;
}

export interface CompiledInjections {
  patterns: InjectionPattern[];
  /**
   * The languages the patterns may inject, each with its tree-sitter.json `injection-regex` (which a name
   * read from a capture is matched against) and its loader, which `HighlightModule.load` runs.
   */
  languages: Record<string, { regex: RegExp; load: () => Promise<InjectedLanguage> }>;
}

const key = (named: boolean, kind: string) => (named ? kind : `"${kind}"`);

export function queryHighlighter(query: CompiledQuery): HighlightModule {
  const candidates = indexPatterns(query.patterns);
  const injections = query.injections;
  const injectionCandidates = injections && indexPatterns(injections.patterns);
  /** The injected languages `load` has imported, by name. */
  const loaded = new Map<string, InjectedLanguage>();
  let loading: Promise<void> | undefined;

  const module: HighlightModule = {
    highlight(tree, paint) {
      const won = new Map<number, number>();
      const winner = new Map<number, number>();
      const assign = (cap: number, n: number, prio: number) => {
        if ((won.get(n) ?? -1) > prio) return;
        won.set(n, prio);
        winner.set(n, cap);
      };
      forEachMatch(tree, query.patterns, candidates, (prio, caps) => {
        for (let i = 0; i < caps.length; i += 2) {
          const cap = caps[i] as number;
          const n = caps[i + 1] as number;
          const rule = query.captures[cap];
          if (!rule) continue;
          if (rule.tokens && tree.count(n) > 0) {
            for (let j = 0, count = tree.count(n); j < count; j++) {
              const c = tree.child(n, j);
              if (!tree.named(c) && tree.count(c) === 0) assign(cap, c, prio);
            }
          } else assign(cap, n, prio);
        }
      });

      const visit = (n: number): void => {
        const cap = winner.get(n);
        if (cap !== undefined) {
          const scope = scopeOf(query.captures[cap] as CaptureScope, tree, n);
          if (scope !== "") paint(n, scope);
        }
        for (let i = 0, count = tree.count(n); i < count; i++) visit(tree.child(n, i));
      };
      visit(tree.root);

      if (injections && injectionCandidates && loaded.size > 0)
        inject(tree, paint, injections, injectionCandidates, loaded);
    },
  };
  if (injections)
    module.load = () =>
      (loading ??= Promise.all(
        Object.entries(injections.languages).map(async ([name, entry]) => {
          const injected = await entry.load();
          await injected.highlight.load?.();
          loaded.set(name, injected);
        }),
      ).then(
        () => {},
        (e: unknown) => {
          // A failed import (a chunk that did not load) may succeed on the next call.
          loading = undefined;
          throw e;
        },
      ));
  return module;
}

/** `[from, to)` of node `node`'s text, one stretch of what an injection parses. */
interface Piece {
  node: number;
  from: number;
  to: number;
}

function inject(
  tree: Tree,
  paint: Paint,
  injections: CompiledInjections,
  candidates: (key: string) => number[],
  loaded: Map<string, InjectedLanguage>,
): void {
  // tree-sitter finds the language for a name by each language's injection-regex.
  const resolve = (name: string): InjectedLanguage | undefined => {
    for (const [id, entry] of Object.entries(injections.languages))
      if (entry.regex.test(name)) return loaded.get(id);
    return undefined;
  };
  const separate: { lang: InjectedLanguage; pieces: Piece[] }[] = [];
  const combined = new Map<string, { lang: InjectedLanguage; pieces: Piece[] }>();
  forEachMatch(tree, injections.patterns, candidates, (i, caps) => {
    const pattern = injections.patterns[i] as InjectionPattern;
    let name: string | undefined;
    if (typeof pattern.language === "string") name = pattern.language;
    else
      for (let j = 0; j < caps.length; j += 2)
        if (caps[j] === pattern.language.capture) name = tree.text(caps[j + 1] as number);
    const lang = name === undefined ? undefined : resolve(name);
    if (!lang) return;
    for (let j = 0; j < caps.length; j += 2) {
      if (caps[j] !== pattern.content) continue;
      const n = caps[j + 1] as number;
      if (pattern.contentMatch && !pattern.contentMatch.test(tree.text(n))) continue;
      const pieces = contentPieces(tree, n, !!pattern.includeChildren);
      if (!pattern.combined) {
        separate.push({ lang, pieces });
        continue;
      }
      const groupKey = `${i} ${name}`;
      const group = combined.get(groupKey);
      if (group) group.pieces.push(...pieces);
      else combined.set(groupKey, { lang, pieces });
    }
  });
  for (const { lang, pieces } of [...separate, ...combined.values()]) paintInjection(tree, paint, lang, pieces);
}

/** The node's text, less its children's unless `includeChildren`, as tree-sitter's injection ranges. */
function contentPieces(tree: Tree, n: number, includeChildren: boolean): Piece[] {
  const start = tree.start(n);
  const length = tree.end(n) - start;
  if (includeChildren) return [{ node: n, from: 0, to: length }];
  const pieces: Piece[] = [];
  let at = 0;
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    const from = tree.start(c) - start;
    if (from > at) pieces.push({ node: n, from: at, to: from });
    at = Math.max(at, tree.end(c) - start);
  }
  if (length > at) pieces.push({ node: n, from: at, to: length });
  return pieces;
}

/** Parses the pieces' text with the injected language and paints its scopes back onto the host's nodes. */
function paintInjection(tree: Tree, paint: Paint, lang: InjectedLanguage, pieces: Piece[]): void {
  const offsets: number[] = [];
  let text = "";
  for (const p of pieces) {
    offsets.push(text.length);
    text += tree.text(p.node).slice(p.from, p.to);
  }
  const inner = parseTree(lang.language, text);
  lang.highlight.highlight(inner, (m, scope, from, to) => {
    const s = inner.start(m) + (from ?? 0);
    const e = to === undefined ? inner.end(m) : inner.start(m) + to;
    pieces.forEach((p, k) => {
      const o = offsets[k] as number;
      const a = Math.max(s, o);
      const b = Math.min(e, o + p.to - p.from);
      if (a < b) paint(p.node, scope, p.from + a - o, p.from + b - o);
    });
  });
}

/** Pattern indexes by the node key their root matches, wildcard roots included, in pattern order. */
function indexPatterns(patterns: QueryPattern[]): (key: string) => number[] {
  const byRoot = new Map<string, number[]>();
  const anyRoot: number[] = [];
  patterns.forEach((p, i) => {
    const kinds = rootKeys(p.root);
    if (kinds === null) anyRoot.push(i);
    else
      for (const k of kinds) {
        let list = byRoot.get(k);
        if (!list) byRoot.set(k, (list = []));
        list.push(i);
      }
  });
  const merged = new Map<string, number[]>();
  return (k) => {
    let list = merged.get(k);
    if (!list) merged.set(k, (list = [...(byRoot.get(k) ?? []), ...anyRoot].sort((a, b) => a - b)));
    return list;
  };
}

/**
 * Calls `onMatch` for every match of every pattern whose predicates hold, in preorder and pattern order, with
 * the match's captures as flat `[capture, node]` pairs (valid only during the call).
 */
function forEachMatch(
  tree: Tree,
  patterns: QueryPattern[],
  candidates: (key: string) => number[],
  onMatch: (pattern: number, caps: number[]) => void,
): void {
  const caps: number[] = [];
  const commit = (i: number) => {
    const pattern = patterns[i] as QueryPattern;
    if (pattern.test) {
      const texts = (cap: number) => {
        const out: string[] = [];
        for (let j = 0; j < caps.length; j += 2) if (caps[j] === cap) out.push(tree.text(caps[j + 1] as number));
        return out;
      };
      if (!pattern.test(texts)) return;
    }
    onMatch(i, caps);
  };

  const node = (p: QueryNode, n: number, k: () => void): void => {
    if (p.alt) {
      for (const a of p.alt) node(a, n, () => withCaptures(p, n, k));
      return;
    }
    if (p.kind !== undefined) {
      if (tree.named(n) === !!p.anon || tree.kindName(n) !== p.kind) return;
    } else if (p.namedOnly && !tree.named(n)) return;
    withCaptures(p, n, p.children ? () => seq(p, n, 0, 0, false, k) : k);
  };
  const withCaptures = (p: QueryNode, n: number, k: () => void) => {
    const mark = caps.length;
    if (p.captures) for (const c of p.captures) caps.push(c, n);
    k();
    caps.length = mark;
  };
  /** Matches `p`'s children from item `ii` on against `parent`'s children from `ci` on. */
  const seq = (p: QueryNode, parent: number, ii: number, ci: number, again: boolean, k: () => void): void => {
    const items = p.children as QueryItem[];
    const count = tree.count(parent);
    if (ii === items.length) {
      if (p.anchorEnd) for (let j = ci; j < count; j++) if (tree.named(tree.child(parent, j))) return;
      k();
      return;
    }
    const item = items[ii] as QueryItem;
    const optional = again || item.quant === "?" || item.quant === "*";
    const repeats = item.quant === "*" || item.quant === "+";
    if (optional) seq(p, parent, ii + 1, ci, false, k);
    const anchored = item.anchored && !again;
    for (let j = ci; j < count; j++) {
      const c = tree.child(parent, j);
      if (item.node.field === undefined || tree.fieldName(c) === item.node.field)
        node(item.node, c, () => {
          if (repeats) seq(p, parent, ii, j + 1, true, k);
          else seq(p, parent, ii + 1, j + 1, false, k);
        });
      if (anchored && tree.named(c)) break;
    }
  };

  const stack = [tree.root];
  while (stack.length > 0) {
    const n = stack.pop() as number;
    for (const i of candidates(key(tree.named(n), tree.kindName(n))))
      node((patterns[i] as QueryPattern).root, n, () => commit(i));
    for (let i = tree.count(n) - 1; i >= 0; i--) stack.push(tree.child(n, i));
  }
}

function scopeOf(rule: CaptureScope, tree: Tree, n: number): string {
  // Own keys only: a node whose text is `constructor` must not find Object.prototype's.
  const kind = tree.kindName(n);
  if (rule.byKind && Object.hasOwn(rule.byKind, kind)) return rule.byKind[kind] as string;
  if (rule.byText || rule.byPrefix) {
    const text = tree.text(n);
    if (rule.byText && Object.hasOwn(rule.byText, text)) return rule.byText[text] as string;
    if (rule.byPrefix) for (const [prefix, scope] of rule.byPrefix) if (text.startsWith(prefix)) return scope;
  }
  return rule.scope;
}

/** The node keys a pattern's root can match, or null when it is a wildcard. */
function rootKeys(p: QueryNode): string[] | null {
  if (p.alt) {
    const out: string[] = [];
    for (const a of p.alt) {
      const k = rootKeys(a);
      if (k === null) return null;
      out.push(...k);
    }
    return out;
  }
  return p.kind === undefined ? null : [key(!p.anon, p.kind)];
}
