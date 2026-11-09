import {
  type Language,
  NO_NODE,
  parseTree,
  type Tree,
} from "../../core/index.js";
import { publicSymbol } from "../../core/language.js";

/**
 * A TypeScript language whose parse regroups what tree-sitter-typescript binds wrong: a call or instantiation
 * with type arguments under `await` or a unary operator. The grammar gives `a.b<T>(c)` no precedence over
 * the operator, so `await a.b<T>(c)` parses as `(await a.b)<T>(c)` where `await a.b(c)` parses right; the
 * formatter would print those parens and the diff match the wrong shapes. The operator is moved above the
 * call, then above each member access, subscript, call or `!` that follows, which bind tighter too.
 */
export function regroupPrefixes(table: Language): Language {
  const kind = (name: string) =>
    publicSymbol(table, table.symbolNames.indexOf(name));
  const typeArguments = kind("type_arguments");
  const prefix = new Set([kind("await_expression"), kind("unary_expression")]);
  const postfix = new Set([
    kind("call_expression"),
    kind("instantiation_expression"),
    kind("member_expression"),
    kind("subscript_expression"),
    kind("non_null_expression"),
  ]);
  const wrong = (tree: Tree, n: number) =>
    n !== NO_NODE &&
    postfix.has(tree.kind(n)) &&
    prefix.has(tree.kind(tree.child(n, 0)));
  const parse = (text: string): Tree => {
    const tree = parseTree(table, text);
    const calls: number[] = [];
    for (let o = 0; o < tree.nodeCount; o++) {
      const n = tree.at(o);
      if (tree.kind(n) === typeArguments && wrong(tree, tree.parent(n)))
        calls.push(tree.parent(n));
    }
    for (let n of calls) {
      while (wrong(tree, n)) {
        while (wrong(tree, n)) tree.sinkPrefix(n);
        let top = tree.parent(n);
        while (prefix.has(tree.kind(tree.parent(top)))) top = tree.parent(top);
        n = tree.parent(top);
      }
    }
    return tree;
  };
  return { ...table, parse };
}
