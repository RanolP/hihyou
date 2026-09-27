import { nameOf } from "../match/cross-file.js";
import { NO_NODE } from "syntechs/core";
import type { Tree } from "../parse/tree.js";

// What an edited node means in its surroundings, read off grammar field names so it holds across languages.

export function* ancestry(tree: Tree, n: number): Generator<number> {
  for (let p = n; p !== NO_NODE; p = tree.parent(p)) yield p;
}

/** The first child of `n` that `test` accepts. */
export function findChild(
  tree: Tree,
  n: number,
  test: (c: number) => boolean,
): number | undefined {
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (test(c)) return c;
  }
  return undefined;
}

const signatureFields = new Set([
  "parameters",
  "parameter",
  "return_type",
  "type_parameters",
]);

/** The function whose parameters, return type or type parameters hold `n`, if any. */
export function signatureOwner(tree: Tree, n: number): number | undefined {
  for (const p of ancestry(tree, n)) {
    const field = tree.fieldName(p);
    if (field !== undefined && signatureFields.has(field)) {
      const owner = tree.parent(p);
      return owner === NO_NODE ? undefined : owner;
    }
  }
  return undefined;
}

/** The name a function is called by: its own, or that of the variable an arrow function or function expression is assigned to. */
export function functionName(tree: Tree, fn: number): string | undefined {
  const name = nameOf(tree, fn);
  if (name !== undefined) return name;
  const p = tree.parent(fn);
  return p !== NO_NODE && tree.kindName(p) === "variable_declarator"
    ? nameOf(tree, p)
    : undefined;
}

/**
 * Whether a declaration is visible outside its module: under an `export` (through `const x = ...`), or,
 * in Python, defined at module level under a name without a leading underscore.
 */
export function isExported(tree: Tree, decl: number): boolean {
  const parentKind = (n: number) => {
    const p = tree.parent(n);
    return p === NO_NODE ? undefined : tree.kindName(p);
  };
  let d = decl;
  while (
    /^(variable_declarator|lexical_declaration|variable_declaration|arrow_function|function_expression)$/.test(
      parentKind(d) ?? "",
    )
  )
    d = tree.parent(d);
  if (parentKind(d) === "export_statement") return true;
  const name = nameOf(tree, d);
  if (parentKind(d) === "decorated_definition") d = tree.parent(d);
  return (
    parentKind(d) === "module" && name !== undefined && !name.startsWith("_")
  );
}

/** An identifier the edit names in its own right: a variable, property or type name. */
export function isIdentifier(tree: Tree, n: number): boolean {
  return (
    tree.named(n) &&
    tree.count(n) === 0 &&
    tree.kindName(n).endsWith("identifier")
  );
}

/**
 * The function called where `n` sits among a call's arguments, if it does: its name, and for a member
 * call (`P.pad(...)`) the expression it is looked up on.
 */
export function calleeOf(
  tree: Tree,
  n: number,
): { name: string; object?: number } | undefined {
  for (const p of ancestry(tree, n)) {
    if (tree.fieldName(p) !== "arguments") continue;
    const call = tree.parent(p);
    if (call === NO_NODE) continue;
    const fn = findChild(tree, call, (c) => {
      const field = tree.fieldName(c);
      return field === "function" || field === "constructor";
    });
    if (fn === undefined) return undefined;
    if (tree.count(fn) === 0) return { name: tree.label(fn) };
    const member = findChild(tree, fn, (c) => {
      const field = tree.fieldName(c);
      return field === "property" || field === "attribute";
    });
    const object = findChild(tree, fn, (c) => tree.fieldName(c) === "object");
    return member !== undefined && tree.count(member) === 0
      ? { name: tree.label(member), ...(object !== undefined && { object }) }
      : undefined;
  }
  return undefined;
}
