// Runs a tree-sitter highlight query that highlight/generate.node.ts compiled, painting each capture as the
// TextMate scope the language's sitter-to-tm ruleset names for it. The generated src/grammars/<name>/highlight.gen.ts
// holds the patterns as data; this is the matcher they share.
//
// Matching follows tree-sitter's: a child pattern matches any later child (gaps allowed), `.` anchors it to the
// next named child, a quantified child may repeat or be absent, and every way a pattern matches is a match. When
// patterns capture the same node, the one later in the query wins, as `tree-sitter highlight` resolves them.

import type { Tree } from "../core/index.js";
import type { HighlightModule } from "./index.js";

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
}

const key = (named: boolean, kind: string) => (named ? kind : `"${kind}"`);

export function queryHighlighter(query: CompiledQuery): HighlightModule {
  const candidates = indexPatterns(query.patterns);

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
    },
  };
  return module;
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
