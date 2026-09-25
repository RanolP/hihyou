import { nameOf } from "../match/cross-file.js";
import type { SyntaxNode } from "../parse/tree.js";

// What an edited node means in its surroundings, read off grammar field names so it holds across languages.

export function* ancestry(n: SyntaxNode): Generator<SyntaxNode> {
  for (let p: SyntaxNode | undefined = n; p; p = p.parent) yield p;
}

const signatureFields = new Set([
  "parameters",
  "parameter",
  "return_type",
  "type_parameters",
]);

/** The function whose parameters, return type or type parameters hold `n`, if any. */
export function signatureOwner(n: SyntaxNode): SyntaxNode | undefined {
  for (const p of ancestry(n))
    if (p.field !== undefined && signatureFields.has(p.field)) return p.parent;
  return undefined;
}

/** The name a function is called by: its own, or that of the variable an arrow function or function expression is assigned to. */
export function functionName(fn: SyntaxNode): string | undefined {
  return (
    nameOf(fn) ??
    (fn.parent?.kind === "variable_declarator" ? nameOf(fn.parent) : undefined)
  );
}

/**
 * Whether a declaration is visible outside its module: under an `export` (through `const x = ...`), or,
 * in Python, defined at module level under a name without a leading underscore.
 */
export function isExported(decl: SyntaxNode): boolean {
  let d = decl;
  while (
    d.parent &&
    /^(variable_declarator|lexical_declaration|variable_declaration|arrow_function|function_expression)$/.test(
      d.parent.kind,
    )
  )
    d = d.parent;
  if (d.parent?.kind === "export_statement") return true;
  const name = nameOf(d);
  if (d.parent?.kind === "decorated_definition") d = d.parent;
  return (
    d.parent?.kind === "module" && name !== undefined && !name.startsWith("_")
  );
}

/** An identifier the edit names in its own right: a variable, property or type name. */
export function isIdentifier(n: SyntaxNode): boolean {
  return n.named && n.children.length === 0 && /identifier$/.test(n.kind);
}

/**
 * The function called where `n` sits among a call's arguments, if it does: its name, and for a member
 * call (`P.pad(...)`) the expression it is looked up on.
 */
export function calleeOf(
  n: SyntaxNode,
): { name: string; object?: SyntaxNode } | undefined {
  for (const p of ancestry(n)) {
    if (p.field !== "arguments" || !p.parent) continue;
    const fn = p.parent.children.find(
      (c) => c.field === "function" || c.field === "constructor",
    );
    if (!fn) return undefined;
    if (fn.children.length === 0) return { name: fn.label };
    const member = fn.children.find(
      (c) => c.field === "property" || c.field === "attribute",
    );
    const object = fn.children.find((c) => c.field === "object");
    return member?.children.length === 0
      ? { name: member.label, ...(object && { object }) }
      : undefined;
  }
  return undefined;
}
