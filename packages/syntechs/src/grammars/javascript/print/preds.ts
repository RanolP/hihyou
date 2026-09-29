// The `pred(name, ...args)` conditions of format.ts: general queries about a node the grammar cannot state, each
// parameterized so the spec, not the predicate, names the kinds and fields it asks about.

import type { PredicateRule } from "../../../fmt/dsl/runtime.js";
import { jsCtx } from "../sink.js";
import { startsWith } from "./operators.js";
import { needsParens, role } from "./parens.js";
import { field, hasCommentThroughParens, items, kind, type JsOptions, parent } from "./util.js";

export const jsPreds = {
  /** Seen through parentheses, the node sits in a `parentKind` under prettier's key `key` (any key without it). */
  role: (node, s, parentKind, key) => {
    const js = jsCtx(s).js;
    const r = role(js, node);
    return kind(js, r.parent) === parentKind && (key === undefined || r.key === key);
  },
  /** The node's field `name` holds a child with comments attached, seen through parentheses as prettier's AST has none. */
  commented: (node, s, name) => {
    const js = jsCtx(s).js;
    const child = field(js, node, name as string);
    return child !== undefined && hasCommentThroughParens(js, child);
  },
  /** The node needs parentheses where it sits. */
  needsParens: (node, s) => needsParens(node, jsCtx(s).js),
  /**
   * The node's nearest `ancestorKind` ancestor, met before any `stopKind`, starts with the node: the node is the
   * leftmost operand of its first child (prettier's startsWithNoLookaheadToken).
   */
  startsAncestor: (node, s, ancestorKind, stopKind) => {
    const js = jsCtx(s).js;
    let a = parent(js, node);
    while (a !== undefined && kind(js, a) !== ancestorKind && kind(js, a) !== stopKind) a = parent(js, a);
    return a !== undefined && kind(js, a) === ancestorKind && startsWith(js, items(js, a)[0], node);
  },
} satisfies Record<string, PredicateRule<JsOptions>>;
