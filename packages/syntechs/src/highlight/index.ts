// Syntax highlighting over a syntechs Tree, answered in TextMate scopes so shiki and VS Code themes apply
// directly. A grammar's `HighlightModule` names scopes per node; `scopeRuns` stacks them into the runs a
// renderer colours, and `compileTheme` resolves a run's scope stack to a colour the way vscode-textmate does.

import type { Tree } from "../core/index.js";

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
