import { NO_NODE, type Tree } from "syntechs/core";
import {
  decodeText,
  type Version,
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

/** The side's blob of `path`, parsed, with its text as written: the lines GitHub's diff counts. */
async function sideTree(
  ctx: EngineContext,
  changes: readonly ChangedFileRef[],
  side: "before" | "after",
  path: string,
): Promise<{ tree: Tree; v: Version }> {
  const ref = changes.find((c) => sidePath(c, side) === path);
  const blob = ref?.[side];
  if (!ref || blob === undefined || blob === null)
    throw new RangeError(`the diffset has no ${side} side for ${path}`);
  const grammar = await ctx.host.grammars.forPath(path);
  const text = decodeText(await readBlob(ctx, blob));
  if (!grammar || text === undefined)
    throw new RangeError(`${path} has no syntax tree to anchor in`);
  const tree = await parseBlob(ctx, blob, grammar, text);
  return { tree, v: plainVersion(text, tree) };
}

const linesOf = (tree: Tree, v: Version, n: number): LineRange => ({
  start: lineOf(v, tree.start(n)) + 1,
  end: lineOf(v, Math.max(tree.start(n), tree.end(n) - 1)) + 1,
});

/**
 * The inverse of `intoLineRanges`: the outermost named nodes lying wholly on `range`'s lines, or, when none does
 * (a line holding only a closing brace), the innermost named node holding all of them.
 */
export function nodesOnLines(
  tree: Tree,
  v: Version,
  range: LineRange,
): AstSteps[] {
  const out: AstSteps[] = [];
  const visit = (n: number, steps: AstSteps) => {
    const { start, end } = linesOf(tree, v, n);
    if (end < range.start || start > range.end) return;
    if (start >= range.start && end <= range.end) {
      out.push(steps);
      return;
    }
    namedChildren(tree, n).forEach((c, i) => visit(c, [...steps, i]));
  };
  visit(tree.root, []);
  if (out.length > 0) return out;
  let n = tree.root;
  const steps: AstSteps = [];
  for (;;) {
    const kids = namedChildren(tree, n);
    const i = kids.findIndex((c) => {
      const { start, end } = linesOf(tree, v, c);
      return start <= range.start && end >= range.end;
    });
    const next = kids[i];
    if (next === undefined) return [steps];
    steps.push(i);
    n = next;
  }
}

/** The anchor on the nodes `nodesOnLines` finds in `path`'s `side`. */
export async function anchorOnLines(
  ctx: EngineContext,
  changes: readonly ChangedFileRef[],
  side: "before" | "after",
  path: string,
  range: LineRange,
): Promise<AnchorData> {
  const { tree, v } = await sideTree(ctx, changes, side, path);
  return { side, path, nodes: nodesOnLines(tree, v, range) };
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
      const { tree, v } = await sideTree(ctx, changes, data.side, data.path);
      const ranges: LineRange[] = [];
      for (const steps of nodes) {
        const n = nodeAt(tree, steps);
        if (n === undefined)
          throw new RangeError(
            `${data.path} has no node at [${steps.join(", ")}]`,
          );
        const { start, end } = linesOf(tree, v, n);
        const last = ranges.at(-1);
        if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
        else ranges.push({ start, end });
      }
      return ranges;
    },
  };
}
