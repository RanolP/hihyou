import { NO_NODE, type Tree } from "syntechs/core";
import {
  decodeText,
  lineOf,
  parseBlob,
  plainVersion,
  readBlob,
} from "./file.js";
import type { ChangedFileRef, EngineContext } from "./host.js";
import type { AnchorData } from "./review.js";

/** From the file root, indices over NAMED children only. Named AstSteps by the user. */
export type AstSteps = number[];

/** 1-based lines of a blob's own text, both ends inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

/** Engine object from diffset.anchor(data). */
export interface Anchor extends AnchorData {
  intoLineRanges(): Promise<LineRange[]>; // disjoint nodes give several ranges
}

function namedChildren(tree: Tree, n: number): number[] {
  const out: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.named(c)) out.push(c);
  }
  return out;
}

/**
 * The path to `node`, a named node or the root. An anonymous token has no index among named children,
 * so it is addressed by its nearest named ancestor.
 */
export function stepsOf(tree: Tree, node: number): AstSteps {
  const steps: number[] = [];
  let n = node;
  while (n !== tree.root && !tree.named(n)) n = tree.parent(n);
  for (let p = tree.parent(n); p !== NO_NODE; n = p, p = tree.parent(p))
    steps.push(namedChildren(tree, p).indexOf(n));
  return steps.reverse();
}

/** The node `steps` names, or undefined when the tree has no such path. */
export function nodeAt(tree: Tree, steps: AstSteps): number | undefined {
  let n = tree.root;
  for (const step of steps) {
    const next = namedChildren(tree, n)[step];
    if (next === undefined) return undefined;
    n = next;
  }
  return n;
}

function compareSteps(p: AstSteps, q: AstSteps): number {
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    const d = (p[i] as number) - (q[i] as number);
    if (d !== 0) return d;
  }
  return p.length - q.length;
}

const isPrefix = (p: AstSteps, q: AstSteps) =>
  p.length <= q.length && p.every((s, i) => s === q[i]);

/** Document order, duplicates and descendants of an included ancestor dropped. */
export function normalizeSteps(nodes: readonly AstSteps[]): AstSteps[] {
  const out: AstSteps[] = [];
  for (const steps of nodes.toSorted(compareSteps)) {
    const last = out.at(-1);
    if (last === undefined || !isPrefix(last, steps)) out.push(steps);
  }
  return out;
}

export function sidePath(
  ref: ChangedFileRef,
  side: "before" | "after",
): string {
  return side === "before" ? (ref.oldPath ?? ref.path) : ref.path;
}

export function createAnchor(
  ctx: EngineContext,
  changes: readonly ChangedFileRef[],
  data: AnchorData,
): Anchor {
  if (data.nodes.length === 0)
    throw new RangeError(`an anchor on ${data.path} names no node`);
  const nodes = normalizeSteps(data.nodes);
  if (data.chars && nodes.length !== 1)
    throw new RangeError(
      `an anchor on ${data.path} narrows to characters across ${nodes.length} nodes`,
    );
  return {
    side: data.side,
    path: data.path,
    nodes,
    ...(data.chars && { chars: data.chars }),
    async intoLineRanges() {
      const ref = changes.find((c) => sidePath(c, data.side) === data.path);
      const blob = ref?.[data.side];
      if (!ref || blob === undefined || blob === null)
        throw new RangeError(
          `the diffset has no ${data.side} side for ${data.path}`,
        );
      const grammar = await ctx.host.grammars.forPath(data.path);
      const text = decodeText(await readBlob(ctx, blob));
      if (!grammar || text === undefined)
        throw new RangeError(`${data.path} has no syntax tree to anchor in`);
      const tree = await parseBlob(ctx, blob, grammar, text);
      const v = plainVersion(text, tree);
      const ranges: LineRange[] = [];
      for (const steps of nodes) {
        const n = nodeAt(tree, steps);
        if (n === undefined)
          throw new RangeError(
            `${data.path} has no node at [${steps.join(", ")}]`,
          );
        const start = lineOf(v, tree.start(n)) + 1;
        const end = lineOf(v, Math.max(tree.start(n), tree.end(n) - 1)) + 1;
        const last = ranges.at(-1);
        if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
        else ranges.push({ start, end });
      }
      return ranges;
    },
  };
}
