// Syntax highlighting over a syntechs Tree, answered in TextMate scopes so shiki and VS Code themes apply
// directly. A grammar's `HighlightModule` names scopes per node; `scopeRuns` stacks them into the runs a
// renderer colours, and `compileTheme` resolves a run's scope stack to a colour the way vscode-textmate does.
//
// `createHighlighter` decides each node's TextMate scope from the patterns of the grammar's
// queries/highlights.scm. src/highlight/generate.node.ts parses that file (./query.ts) into a grammar's
// highlight.gen.ts; this runs those patterns against a syntechs Tree with tree-sitter's query semantics, and
// ./sitter-to-tm.ts turns the winning capture into a scope. As in nvim-treesitter, whose highlights.scm these
// files follow, a later pattern wins over an earlier one for the same node.
//
// A node's scope is asked for one node at a time, so the matcher runs a pattern from the node up: for each capture
// in a pattern that could land on this node, it climbs to where the pattern's root would sit, matches the whole
// pattern there (backtracking over child assignments, then checking predicates), and keeps the match only when
// that capture is bound to this very node.

import type { Tree } from "../core/index.js";
import type { Element, NodeElement, Pattern, Predicate } from "./query.js";
import { tmScopeOf } from "./sitter-to-tm.js";

/**
 * Receives one scope for node `node`, or for `[from, to)` of it (offsets relative to the node's start) when
 * a token has inner structure the tree does not split, such as a JSDoc tag inside a comment.
 */
export type Paint = (
  node: number,
  scope: string,
  from?: number,
  to?: number,
) => void;

export interface HighlightModule {
  /**
   * Calls `paint` for every node that carries a TextMate scope, an enclosing node before the nodes inside
   * it. An inner scope stacks onto the scopes enclosing it, as TextMate's scope stack does, so a theme
   * rule for the outer scope still colours what no inner rule matches.
   */
  highlight(tree: Tree, paint: Paint): void;
}

export interface ScopeRuns {
  /** Space-separated scope stacks, outermost first; index 0 is the empty stack. */
  stacks: string[];
  /** `[start, end, stack]` triples, sorted and disjoint, covering every painted character. */
  runs: Int32Array;
}

/**
 * The highlighter's scopes as runs over a text of `length` characters. `start` and `end` place a node in that
 * text; they default to the tree's own offsets, and a caller showing formatted output passes its mapping.
 */
export function scopeRuns(
  tree: Tree,
  module: HighlightModule,
  length: number,
  start: (n: number) => number = (n) => tree.start(n),
  end: (n: number) => number = (n) => tree.end(n),
): ScopeRuns {
  const at = new Int32Array(length);
  const stacks = [""];
  const ids = new Map<string, number>();
  const pushed = new Map<number, Map<string, number>>();
  module.highlight(tree, (n, scope, from, to) => {
    const s0 = start(n);
    const s = from === undefined ? s0 : s0 + from;
    const e = to === undefined ? end(n) : s0 + to;
    if (e <= s || s < 0 || e > length) return;
    // Paint order nests, so every character of the node sits under the same enclosing stack.
    const outer = at[s] as number;
    let byScope = pushed.get(outer);
    if (!byScope) pushed.set(outer, (byScope = new Map()));
    let id = byScope.get(scope);
    if (id === undefined) {
      const text = outer === 0 ? scope : `${stacks[outer]} ${scope}`;
      id = ids.get(text);
      if (id === undefined) {
        id = stacks.length;
        stacks.push(text);
        ids.set(text, id);
      }
      byScope.set(scope, id);
    }
    at.fill(id, s, e);
  });
  const runs: number[] = [];
  for (let i = 0; i < length; ) {
    const id = at[i] as number;
    let j = i + 1;
    while (j < length && at[j] === id) j++;
    if (id !== 0) runs.push(i, j, id);
    i = j;
  }
  return { stacks, runs: Int32Array.from(runs) };
}

export { compileTheme, type Theme, type ThemeRule, type CompiledTheme } from "./theme.js";

export type { Pattern } from "./query.js";

export interface Highlighter {
  /** TextMate scope for one node (e.g. "keyword.control.loop.swift"), undefined for none. */
  scopeOf(tree: Tree, node: number): string | undefined;
  /** The capture that decides the node's scope, and the index of its pattern in highlights.scm. */
  captureOf(
    tree: Tree,
    node: number,
  ): { pattern: number; capture: string } | undefined;
}

/** One capture of one pattern, as a candidate for a node. */
interface Site {
  pattern: number;
  root: Element;
  predicates: Predicate[];
  /** The element the capture sits on. */
  element: Element;
  /** How many nodes up from the captured node the pattern's root sits. */
  depth: number;
  capture: string;
  scope: string;
}

/** The node kinds an element can match on its own: `n:kind`, `a:token`, or `*` for any. */
function keysOf(el: Element): string[] {
  if (el.type === "node") {
    const m = el.match;
    return "kind" in m
      ? [`n:${m.kind}`]
      : "token" in m
        ? [`a:${m.token}`]
        : ["*"];
  }
  if (el.type === "alt") return el.members.flatMap(keysOf);
  return ["*"];
}

/** A highlighter from patterns in highlights.scm order, its scopes ending in `.${suffix}`. */
export function createHighlighter(
  patterns: Pattern[],
  suffix: string,
): Highlighter {
  // Per key, its sites latest first: the first site that matches is the one that wins.
  const sites = new Map<string, Site[]>();
  patterns.forEach((pattern, index) => {
    // A top-level sibling sequence `((a) (b))` matches under any parent.
    const root: Element =
      pattern.root.type === "seq"
        ? {
            type: "node",
            match: { wildcard: "any" },
            negated: [],
            children: pattern.root.members,
            captures: [],
          }
        : pattern.root;
    const visit = (el: Element, depth: number) => {
      if (el.type === "anchor") return;
      for (const capture of el.captures) {
        const scope = tmScopeOf(capture);
        if (scope === undefined)
          throw new Error(
            `highlight: no TextMate scope for @${capture} (pattern ${index}); add it to src/highlight/sitter-to-tm.ts`,
          );
        if (scope === null) continue;
        if (el.type === "seq")
          throw new Error(
            `highlight: @${capture} captures a sibling sequence (pattern ${index}), which is not supported`,
          );
        const site: Site = {
          pattern: index,
          root,
          predicates: pattern.predicates,
          element: el,
          depth,
          capture,
          scope: `${scope}.${suffix}`,
        };
        for (const key of new Set(keysOf(el))) {
          const list = sites.get(key) ?? [];
          list.unshift(site);
          sites.set(key, list);
        }
      }
      if (el.type === "node") for (const c of el.children) visit(c, depth + 1);
      else for (const m of el.members) visit(m, depth);
    };
    visit(root, 0);
  });
  // A wildcard site competes with every kind's own: merge it into each list by pattern order.
  const wildcards = sites.get("*") ?? [];
  if (wildcards.length > 0)
    for (const [key, list] of sites)
      if (key !== "*")
        sites.set(
          key,
          [...list, ...wildcards].sort((a, b) => b.pattern - a.pattern),
        );

  const regexes = new Map<string, RegExp>();
  const regex = (source: string) => {
    let r = regexes.get(source);
    if (r === undefined) {
      r = new RegExp(source, "u");
      regexes.set(source, r);
    }
    return r;
  };

  const find = (tree: Tree, node: number) => {
    const key = `${tree.named(node) ? "n" : "a"}:${tree.kindName(node)}`;
    for (const site of sites.get(key) ?? wildcards) {
      let root = node;
      for (let d = 0; d < site.depth && root >= 0; d++)
        root = tree.parent(root);
      if (root < 0) continue;
      if (matchSite(tree, site, root, node, regex)) return site;
    }
    return undefined;
  };
  return {
    scopeOf: (tree, node) => find(tree, node)?.scope,
    captureOf(tree, node) {
      const site = find(tree, node);
      return site && { pattern: site.pattern, capture: site.capture };
    },
  };
}

/** Whether `site`'s pattern matches at `root` with its capture bound to `target`. */
function matchSite(
  tree: Tree,
  site: Site,
  root: number,
  target: number,
  regex: (source: string) => RegExp,
): boolean {
  const bound: [Exclude<Element, { type: "anchor" }>, number][] = [];
  const kids = (n: number) => {
    const out: number[] = [];
    for (let i = 0; i < tree.count(n); i++) out.push(tree.child(n, i));
    return out;
  };

  const textsOf = (capture: string) =>
    bound
      .filter(([el]) => el.captures.includes(capture))
      .map(([, n]) => tree.text(n));
  const predicate = (p: Predicate): boolean => {
    const [subject, ...rest] = p.args;
    if (subject === undefined || !("capture" in subject)) return true;
    const texts = textsOf(subject.capture);
    if (texts.length === 0) return true;
    if (p.op === "match") {
      const r = regex((rest[0] as { string: string }).string);
      // Every node of a quantified capture must match (tree-sitter's `#match?`, not `#any-match?`).
      return texts.every((t) => r.test(t) !== p.negate);
    }
    let ok: boolean;
    if (p.op === "eq") {
      const other = rest[0];
      const want =
        other === undefined
          ? undefined
          : "string" in other
            ? other.string
            : textsOf(other.capture)[0];
      if (want === undefined) return true;
      ok = texts[0] === want;
    } else
      ok = rest.some((a) => "string" in a && a.string === texts[0]);
    return ok !== p.negate;
  };
  const done = () =>
    bound.some(([el, n]) => el === site.element && n === target) &&
    site.predicates.every(predicate);

  /** `el` (a node, or an alternation of nodes) against one tree node; `outers` are enclosing alternations. */
  const single = (
    el: Element,
    n: number,
    outers: Exclude<Element, { type: "anchor" }>[],
    k: () => boolean,
  ): boolean => {
    if (el.type === "alt") {
      for (const m of el.members)
        if (single(m, n, [...outers, el], k)) return true;
      return false;
    }
    if (el.type !== "node") return false;
    for (const e of [el, ...outers])
      if (e.field !== undefined && tree.fieldName(n) !== e.field) return false;
    if (!kindMatches(tree, el, n)) return false;
    for (const f of el.negated)
      for (const c of kids(n)) if (tree.fieldName(c) === f) return false;
    const mark = bound.length;
    for (const e of [el, ...outers]) bound.push([e, n]);
    const ok =
      el.children.length === 0
        ? k()
        : sequence(el.children, 0, kids(n), 0, false, () => k());
    if (!ok) bound.length = mark;
    return ok;
  };

  /** One occurrence of `el` among `children`, from `pos`; `k` gets the position after it. */
  const one = (
    el: Exclude<Element, { type: "anchor" }>,
    children: number[],
    pos: number,
    anchored: boolean,
    k: (next: number) => boolean,
  ): boolean => {
    if (el.type === "seq")
      return sequence(el.members, 0, children, pos, anchored, k);
    if (el.type === "alt" && el.members.some((m) => m.type === "seq")) {
      for (const m of el.members)
        if (m.type !== "anchor" && one(m, children, pos, anchored, k))
          return true;
      return false;
    }
    for (let j = pos; j < children.length; j++) {
      // An anchor lets only anonymous nodes sit between its neighbours.
      if (anchored && j > pos && tree.named(children[j - 1] as number))
        return false;
      if (single(el, children[j] as number, [], () => k(j + 1))) return true;
    }
    return false;
  };

  const quantified = (
    el: Exclude<Element, { type: "anchor" }>,
    children: number[],
    pos: number,
    anchored: boolean,
    k: (next: number) => boolean,
  ): boolean => {
    const star = (p: number): boolean =>
      one(el, children, p, false, (q) => q > p && star(q)) || k(p);
    switch (el.quantifier) {
      case undefined:
        return one(el, children, pos, anchored, k);
      case "?":
        return one(el, children, pos, anchored, k) || k(pos);
      case "*":
        return (
          one(el, children, pos, anchored, (q) => q > pos && star(q)) || k(pos)
        );
      case "+":
        return one(el, children, pos, anchored, (q) => q > pos && star(q));
      default:
        throw new Error(`highlight: unknown quantifier ${String(el.quantifier)}`);
    }
  };

  /** `elements[i..]` as an ordered subsequence of `children[pos..]`. */
  const sequence = (
    elements: Element[],
    i: number,
    children: number[],
    pos: number,
    anchored: boolean,
    k: (next: number) => boolean,
  ): boolean => {
    if (i === elements.length) {
      // A trailing anchor: nothing named after the last element.
      if (anchored && children.slice(pos).some((c) => tree.named(c)))
        return false;
      return k(pos);
    }
    const el = elements[i] as Element;
    if (el.type === "anchor")
      return sequence(elements, i + 1, children, pos, true, k);
    return quantified(el, children, pos, anchored, (next) =>
      sequence(elements, i + 1, children, next, false, k),
    );
  };

  return single(site.root, root, [], done);
}

function kindMatches(tree: Tree, el: NodeElement, n: number): boolean {
  const m = el.match;
  if ("kind" in m) return tree.named(n) && tree.kindName(n) === m.kind;
  if ("token" in m) return !tree.named(n) && tree.kindName(n) === m.token;
  return m.wildcard === "any" || tree.named(n);
}
