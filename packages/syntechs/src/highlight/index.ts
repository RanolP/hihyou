// Syntax highlighting from a grammar's tree: each node's TextMate scope, decided by rules transcribed from the
// grammar's queries/highlights.scm. The rules cover the query shapes those files use: a node kind (named, or an
// anonymous token by its text), the chain of parents it sits under, the field it holds, and a `#match?` on its
// text. As in nvim-treesitter's highlights.scm, where these files come from, a later rule wins over an earlier
// one for the same node.

import type { Tree } from "../core/index.js";

export interface Step {
  kind: string;
  /** The field this node holds in its own parent. */
  field?: string;
}

export interface ScopeRule {
  /** Named node kinds this rule captures. */
  kinds?: string[];
  /** Anonymous tokens this rule captures, by their text. */
  tokens?: string[];
  /** The field the captured node holds in its parent. */
  field?: string;
  /** Its parent, then that one's parent, and so on: each must match. */
  up?: Step[];
  /** `#match?` on the captured node's text. */
  match?: RegExp;
  /** The highlights.scm capture name, without its `@`. */
  capture: string;
}

/**
 * Each nvim-treesitter capture name as a TextMate scope, before the language suffix. A capture missing here
 * falls back to its nearest listed prefix (`keyword.conditional.ternary` → `keyword.conditional`).
 */
export const CAPTURE_SCOPES: Record<string, string> = {
  attribute: "storage.modifier.attribute",
  boolean: "constant.language.boolean",
  "character.special": "variable.language.wildcard",
  comment: "comment",
  "comment.documentation": "comment.block.documentation",
  "constant.builtin": "constant.language",
  "constant.macro": "constant.language",
  constructor: "entity.name.function.constructor",
  "function.call": "entity.name.function",
  "function.macro": "entity.name.function.preprocessor",
  "function.method": "entity.name.function",
  keyword: "keyword.other",
  "keyword.conditional": "keyword.control.conditional",
  "keyword.conditional.ternary": "keyword.operator.ternary",
  "keyword.coroutine": "keyword.control.async",
  "keyword.directive": "keyword.control.directive",
  "keyword.exception": "keyword.control.exception",
  "keyword.function": "storage.type.function",
  "keyword.import": "keyword.control.import",
  "keyword.modifier": "storage.modifier",
  "keyword.operator": "keyword.operator",
  "keyword.repeat": "keyword.control.loop",
  "keyword.return": "keyword.control.return",
  "keyword.type": "storage.type",
  label: "entity.name.label",
  number: "constant.numeric.integer",
  "number.float": "constant.numeric.float",
  operator: "keyword.operator",
  "punctuation.bracket": "punctuation.section.brackets",
  "punctuation.delimiter": "punctuation.separator",
  "punctuation.special": "punctuation.section.embedded",
  string: "string.quoted",
  "string.escape": "constant.character.escape",
  "string.regexp": "string.regexp",
  type: "entity.name.type",
  variable: "variable.other",
  "variable.builtin": "variable.language",
  "variable.member": "variable.other.member",
  "variable.parameter": "variable.parameter",
};

function scopeFor(capture: string): string | undefined {
  for (let c = capture; ; ) {
    const scope = CAPTURE_SCOPES[c];
    if (scope !== undefined) return scope;
    const dot = c.lastIndexOf(".");
    if (dot < 0) return undefined;
    c = c.slice(0, dot);
  }
}

export interface Highlighter {
  /** TextMate scope for one node (e.g. "keyword.control.loop.swift"), undefined for none. */
  scopeOf(tree: Tree, node: number): string | undefined;
}

interface Compiled {
  rule: ScopeRule;
  scope: string;
}

/** A highlighter from rules in highlights.scm order, its scopes ending in `.${suffix}`. */
export function createHighlighter(
  rules: ScopeRule[],
  suffix: string,
): Highlighter {
  // Per kind (named kinds and tokens apart), its rules in reverse order, so the first match is the last rule.
  const named = new Map<string, Compiled[]>();
  const anonymous = new Map<string, Compiled[]>();
  for (const rule of rules) {
    const base = scopeFor(rule.capture);
    if (base === undefined)
      throw new Error(`highlight: no TextMate scope for @${rule.capture}`);
    const compiled = { rule, scope: `${base}.${suffix}` };
    for (const [map, keys] of [
      [named, rule.kinds],
      [anonymous, rule.tokens],
    ] as const)
      for (const k of keys ?? []) {
        const list = map.get(k) ?? [];
        list.unshift(compiled);
        map.set(k, list);
      }
  }
  const matches = (tree: Tree, node: number, rule: ScopeRule): boolean => {
    if (rule.field !== undefined && tree.fieldName(node) !== rule.field)
      return false;
    let n = node;
    for (const step of rule.up ?? []) {
      n = tree.parent(n);
      if (n < 0 || tree.kindName(n) !== step.kind) return false;
      if (step.field !== undefined && tree.fieldName(n) !== step.field)
        return false;
    }
    return rule.match === undefined || rule.match.test(tree.text(node));
  };
  return {
    scopeOf(tree, node) {
      const map = tree.named(node) ? named : anonymous;
      for (const c of map.get(tree.kindName(node)) ?? [])
        if (matches(tree, node, c.rule)) return c.scope;
      return undefined;
    },
  };
}
