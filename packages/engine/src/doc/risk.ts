import type { RawEdit } from "syntechs/diff";
import type { SyntaxNode } from "../parse/tree.js";
import type { Risk, RiskSignal } from "./schema.js";
import {
  ancestry,
  isExported,
  isIdentifier,
  signatureOwner,
} from "./syntax-context.js";

/**
 * Points per edit showing the signal, and the most edits counted, so a hundred renamed call sites
 * never outrank one changed condition.
 */
const scale: Record<RiskSignal, { weight: number; cap: number }> = {
  error: { weight: 20, cap: 1 },
  "exported-api": { weight: 10, cap: 3 },
  condition: { weight: 8, cap: 5 },
  "error-handling": { weight: 7, cap: 5 },
  operator: { weight: 6, cap: 5 },
  "removed-code": { weight: 3, cap: 10 },
  "added-code": { weight: 2, cap: 10 },
  literal: { weight: 2, cap: 10 },
  "line-mode": { weight: 2, cap: 20 },
  moved: { weight: 1, cap: 5 },
  renamed: { weight: 1, cap: 5 },
  comment: { weight: 1, cap: 5 },
};

const errorHandling =
  /^(try_statement|catch_clause|finally_clause|throw_statement|raise_statement|except_clause|try_expression)$/;

/** The signals one edit shows, from its own kind and the syntax around it. */
export function signalsOf(edit: RawEdit): RiskSignal[] {
  const a = "a" in edit ? edit.a : undefined;
  const b = "b" in edit ? edit.b : undefined;
  const nodes = [a, b].filter((n): n is SyntaxNode => n !== undefined);
  const [n] = nodes;
  if (!n) return ["line-mode"];
  if (n.kind.includes("comment")) return ["comment"];
  const signals = new Set<RiskSignal>();
  switch (edit.kind) {
    case "insert":
      signals.add("added-code");
      break;
    case "delete":
      signals.add("removed-code");
      break;
    case "move":
      signals.add("moved");
      break;
    case "update":
      signals.add(
        a && b && isIdentifier(a) && isIdentifier(b)
          ? "renamed"
          : n.named
            ? "literal"
            : "operator",
      );
  }
  for (const node of nodes) {
    for (const p of ancestry(node)) {
      if (p.field === "condition") signals.add("condition");
      if (errorHandling.test(p.kind)) signals.add("error-handling");
    }
    const owner = signatureOwner(node);
    if (
      (owner && isExported(owner)) ||
      (node.kind === "export_statement" && edit.kind !== "move") ||
      (node.field === "name" && node.parent && isExported(node.parent))
    )
      signals.add("exported-api");
  }
  return [...signals];
}

/** Each signal counted once per edit that shows it. */
export function riskOf(perEdit: Iterable<RiskSignal[]>): Risk {
  const counts = new Map<RiskSignal, number>();
  for (const signals of perEdit)
    for (const s of signals) counts.set(s, (counts.get(s) ?? 0) + 1);
  const reasons = [...counts]
    .map(([signal, count]) => ({
      signal,
      count,
      points: scale[signal].weight * Math.min(count, scale[signal].cap),
    }))
    .sort((p, q) => q.points - p.points || p.signal.localeCompare(q.signal));
  return { score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}
