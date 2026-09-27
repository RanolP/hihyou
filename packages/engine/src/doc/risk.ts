import { NO_NODE } from "syntechs/core";
import type { RawEdit } from "syntechs/diff";
import type { Tree } from "../parse/tree.js";
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

/**
 * The signals one edit shows, from its own kind and the syntax around it. Its `a` is a node of `ta`, its
 * `b` of `tb`; a line-mode edit has neither and needs no trees.
 */
export function signalsOf(edit: RawEdit, ta?: Tree, tb?: Tree): RiskSignal[] {
  const a = "a" in edit ? edit.a : undefined;
  const b = "b" in edit ? edit.b : undefined;
  const nodes: [Tree, number][] = [];
  if (a !== undefined) nodes.push([ta as Tree, a]);
  if (b !== undefined) nodes.push([tb as Tree, b]);
  const [first] = nodes;
  if (!first) return ["line-mode"];
  const [t, n] = first;
  if (t.kindName(n).includes("comment")) return ["comment"];
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
        a !== undefined &&
          b !== undefined &&
          isIdentifier(ta as Tree, a) &&
          isIdentifier(tb as Tree, b)
          ? "renamed"
          : t.named(n)
            ? "literal"
            : "operator",
      );
  }
  for (const [tree, node] of nodes) {
    for (const p of ancestry(tree, node)) {
      if (tree.fieldName(p) === "condition") signals.add("condition");
      if (errorHandling.test(tree.kindName(p))) signals.add("error-handling");
    }
    const owner = signatureOwner(tree, node);
    const parent = tree.parent(node);
    if (
      (owner !== undefined && isExported(tree, owner)) ||
      (tree.kindName(node) === "export_statement" && edit.kind !== "move") ||
      (tree.fieldName(node) === "name" &&
        parent !== NO_NODE &&
        isExported(tree, parent))
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
