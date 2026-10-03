import type { Tree } from "../core/arena.js";

/**
 * Whether `n` is a content atom: what the code says, as against how it is punctuated. Either a named node, not a
 * comment, with no named child (an identifier, a number, a whole string, `break;`), or an anonymous token filling a
 * field (`<` as a binary operator, `const` as a declaration's kind). `(`, `;` and keywords filling no field never
 * are, so two blocks sharing only their brackets share no content.
 */
export function isContentAtom(tree: Tree, n: number): boolean {
  const count = tree.count(n);
  if (!tree.named(n))
    return (
      count === 0 &&
      tree.fieldName(n) !== undefined &&
      tree.end(n) > tree.start(n)
    );
  if (tree.kindName(n).includes("comment") || tree.end(n) === tree.start(n))
    return false;
  for (let i = 0; i < count; i++)
    if (tree.named(tree.child(n, i))) return false;
  return true;
}

/**
 * The content atoms in the subtree of `n`, each keyed by its kind and its tokens' labels, so isomorphic subtrees
 * yield equal multisets of keys; whitespace inside an atom (`break ;`) does not count.
 */
export function contentAtoms(tree: Tree, n: number): string[] {
  const out: string[] = [];
  const stack = [n];
  while (stack.length > 0) {
    const m = stack.pop() as number;
    if (isContentAtom(tree, m)) {
      out.push(`${tree.kindName(m)}\0${leafLabels(tree, m)}`);
      continue;
    }
    for (let i = tree.count(m) - 1; i >= 0; i--) stack.push(tree.child(m, i));
  }
  return out;
}

function leafLabels(tree: Tree, n: number): string {
  const count = tree.count(n);
  if (count === 0) return tree.label(n);
  let out = "";
  for (let i = 0; i < count; i++)
    out += `${leafLabels(tree, tree.child(n, i))}\u0001`;
  return out;
}

/**
 * Whether `n` is a unit, a piece a move may carry over whole: a named node filling no field in its parent (a
 * statement, a member, a parameter, an argument). Operands, callees and declarator values fill fields and are not.
 */
export const isUnit = (tree: Tree, n: number): boolean =>
  tree.named(n) && tree.fieldName(n) === undefined;
