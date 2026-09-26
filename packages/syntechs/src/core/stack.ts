// Port of tree-sitter v0.27.0 lib/src/stack.c: the graph-structured stack of the GLR parser.
// Nodes are shared between versions exactly as in C; the garbage collector replaces ref-counting.

import { SYM_ERROR } from "./language.js";
import {
  COST_PER_RECOVERY,
  errorCost,
  externalStateEq,
  nodeCountOf,
  nodeDynamicPrecedence,
  type Subtree,
  totalRows,
  totalSize,
} from "./subtree.js";

const MAX_LINK_COUNT = 8;
const MAX_ITERATOR_COUNT = 64;
const ERROR_STATE = 0;

interface StackLink {
  node: StackNode;
  subtree: Subtree | null;
  isPending: boolean;
}

/**
 * A node's first link is stored in its own fields and only the rest in `more`: nearly every node has exactly
 * one link, and a push per token and per reduction made the link object and its array most of the allocation.
 * Links are values, as C's `StackLink` structs are, so each node owns its copies.
 */
export class StackNode {
  state: number;
  /** Position in UTF-16 units, and its row. */
  position = 0;
  row = 0;
  linkCount = 0;
  node0: StackNode | null = null;
  subtree0: Subtree | null = null;
  pending0 = false;
  /** Links 1.. of `linkCount`. */
  more: StackLink[] | null = null;
  errorCost = 0;
  nodeCount = 0;
  dynamicPrecedence = 0;

  constructor(
    previous: StackNode | null,
    subtree: Subtree | null,
    isPending: boolean,
    state: number,
  ) {
    this.state = state;
    if (previous !== null) {
      this.linkCount = 1;
      this.node0 = previous;
      this.subtree0 = subtree;
      this.pending0 = isPending;
      this.position = previous.position;
      this.row = previous.row;
      this.errorCost = previous.errorCost;
      this.dynamicPrecedence = previous.dynamicPrecedence;
      this.nodeCount = previous.nodeCount;
      if (subtree !== null) {
        this.errorCost += errorCost(subtree);
        this.position += totalSize(subtree);
        this.row += totalRows(subtree);
        this.nodeCount += nodeCountOf(subtree);
        this.dynamicPrecedence += nodeDynamicPrecedence(subtree);
      }
    }
  }
}

export interface SummaryEntry {
  position: number;
  row: number;
  depth: number;
  state: number;
}

const ACTIVE = 0;
const PAUSED = 1;
const HALTED = 2;

interface StackHead {
  node: StackNode;
  summary: SummaryEntry[] | null;
  nodeCountAtLastError: number;
  lastExternalToken: Subtree | null;
  lookaheadWhenPaused: Subtree | null;
  status: number;
}

export interface StackSlice {
  subtrees: Subtree[];
  version: number;
}

interface StackIterator {
  node: StackNode;
  subtrees: Subtree[];
  subtreeCount: number;
  isPending: boolean;
}

const NONE = 0;
const STOP = 1;
const POP = 2;

function subtreeIsEquivalent(
  left: Subtree | null,
  right: Subtree | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (left.symbol !== right.symbol) return false;
  if (errorCost(left) > 0 && errorCost(right) > 0) return true;
  return (
    left.padding === right.padding &&
    left.size === right.size &&
    left.children.length === right.children.length &&
    left.extra === right.extra &&
    externalStateEq(left, right)
  );
}

function linkNode(self: StackNode, i: number): StackNode {
  return (
    i === 0 ? self.node0 : (self.more as StackLink[])[i - 1]?.node
  ) as StackNode;
}

function linkSubtree(self: StackNode, i: number): Subtree | null {
  return i === 0
    ? self.subtree0
    : ((self.more as StackLink[])[i - 1] as StackLink).subtree;
}

function linkPending(self: StackNode, i: number): boolean {
  return i === 0
    ? self.pending0
    : ((self.more as StackLink[])[i - 1] as StackLink).isPending;
}

function setLinkSubtree(
  self: StackNode,
  i: number,
  subtree: Subtree | null,
): void {
  if (i === 0) self.subtree0 = subtree;
  else ((self.more as StackLink[])[i - 1] as StackLink).subtree = subtree;
}

function addLink(
  self: StackNode,
  node: StackNode,
  subtree: Subtree | null,
  isPending: boolean,
): void {
  if (node === self) return;
  for (let i = 0; i < self.linkCount; i++) {
    const existingSubtree = linkSubtree(self, i);
    if (subtreeIsEquivalent(existingSubtree, subtree)) {
      const existingNode = linkNode(self, i);
      if (existingNode === node) {
        if (
          nodeDynamicPrecedence(subtree) >
          nodeDynamicPrecedence(existingSubtree)
        ) {
          setLinkSubtree(self, i, subtree);
          self.dynamicPrecedence =
            node.dynamicPrecedence + nodeDynamicPrecedence(subtree);
        }
        return;
      }
      if (
        existingNode.state === node.state &&
        existingNode.position === node.position &&
        existingNode.errorCost === node.errorCost
      ) {
        for (let j = 0; j < node.linkCount; j++)
          addLink(
            existingNode,
            linkNode(node, j),
            linkSubtree(node, j),
            linkPending(node, j),
          );
        let dynamicPrecedence = node.dynamicPrecedence;
        if (subtree !== null)
          dynamicPrecedence += nodeDynamicPrecedence(subtree);
        if (dynamicPrecedence > self.dynamicPrecedence)
          self.dynamicPrecedence = dynamicPrecedence;
        return;
      }
    }
  }
  if (self.linkCount === MAX_LINK_COUNT) return;
  let nodeCount = node.nodeCount;
  let dynamicPrecedence = node.dynamicPrecedence;
  if (self.linkCount === 0) {
    self.node0 = node;
    self.subtree0 = subtree;
    self.pending0 = isPending;
  } else {
    self.more ??= [];
    self.more.push({ node, subtree, isPending });
  }
  self.linkCount++;
  if (subtree !== null) {
    nodeCount += nodeCountOf(subtree);
    dynamicPrecedence += nodeDynamicPrecedence(subtree);
  }
  if (nodeCount > self.nodeCount) self.nodeCount = nodeCount;
  if (dynamicPrecedence > self.dynamicPrecedence)
    self.dynamicPrecedence = dynamicPrecedence;
}

export class Stack {
  heads: StackHead[] = [];
  private slices: StackSlice[] = [];
  private readonly baseNode = new StackNode(null, null, false, 1);

  constructor() {
    this.clear();
  }

  clear(): void {
    this.heads = [
      {
        node: this.baseNode,
        summary: null,
        nodeCountAtLastError: 0,
        lastExternalToken: null,
        lookaheadWhenPaused: null,
        status: ACTIVE,
      },
    ];
  }

  versionCount(): number {
    return this.heads.length;
  }

  private head(version: number): StackHead {
    const h = this.heads[version];
    if (h === undefined)
      throw new RangeError(
        `no stack version ${version} of ${this.heads.length}`,
      );
    return h;
  }

  haltedVersionCount(): number {
    let count = 0;
    for (const h of this.heads) if (h.status === HALTED) count++;
    return count;
  }

  state(version: number): number {
    return this.head(version).node.state;
  }

  position(version: number): number {
    return this.head(version).node.position;
  }

  row(version: number): number {
    return this.head(version).node.row;
  }

  lastExternalToken(version: number): Subtree | null {
    return this.head(version).lastExternalToken;
  }

  setLastExternalToken(version: number, token: Subtree | null): void {
    this.head(version).lastExternalToken = token;
  }

  errorCost(version: number): number {
    const head = this.head(version);
    let result = head.node.errorCost;
    if (
      head.status === PAUSED ||
      (head.node.state === ERROR_STATE &&
        head.node.subtree0 === null)
    ) {
      result += COST_PER_RECOVERY;
    }
    return result;
  }

  nodeCountSinceError(version: number): number {
    const head = this.head(version);
    if (head.node.nodeCount < head.nodeCountAtLastError)
      head.nodeCountAtLastError = head.node.nodeCount;
    return head.node.nodeCount - head.nodeCountAtLastError;
  }

  push(
    version: number,
    subtree: Subtree | null,
    pending: boolean,
    state: number,
  ): void {
    const head = this.head(version);
    const node = new StackNode(head.node, subtree, pending, state);
    if (subtree === null) head.nodeCountAtLastError = node.nodeCount;
    head.node = node;
  }

  private addVersion(original: number, node: StackNode): number {
    const o = this.head(original);
    this.heads.push({
      node,
      summary: null,
      nodeCountAtLastError: o.nodeCountAtLastError,
      lastExternalToken: o.lastExternalToken,
      lookaheadWhenPaused: null,
      status: ACTIVE,
    });
    return this.heads.length - 1;
  }

  private addSlice(
    original: number,
    node: StackNode,
    subtrees: Subtree[],
  ): void {
    const slices = this.slices;
    for (let i = slices.length - 1; i >= 0; i--) {
      const version = (slices[i] as StackSlice).version;
      if (this.head(version).node === node) {
        slices.splice(i + 1, 0, { subtrees, version });
        return;
      }
    }
    slices.push({ subtrees, version: this.addVersion(original, node) });
  }

  private iter(
    version: number,
    callback: (it: StackIterator) => number,
    goal: number,
  ): StackSlice[] {
    this.slices = [];
    const includeSubtrees = goal >= 0;
    const iterators: StackIterator[] = [
      {
        node: this.head(version).node,
        subtrees: [],
        subtreeCount: 0,
        isPending: true,
      },
    ];
    while (iterators.length > 0) {
      for (let i = 0, size = iterators.length; i < size; i++) {
        const iterator = iterators[i] as StackIterator;
        const node = iterator.node;
        const action = callback(iterator);
        const shouldPop = (action & POP) !== 0;
        const shouldStop = (action & STOP) !== 0 || node.linkCount === 0;
        if (shouldPop) {
          const subtrees = shouldStop
            ? iterator.subtrees
            : iterator.subtrees.slice();
          subtrees.reverse();
          this.addSlice(version, node, subtrees);
        }
        if (shouldStop) {
          iterators.splice(i, 1);
          i--;
          size--;
          continue;
        }
        const linkCount = node.linkCount;
        for (let j = 1; j <= linkCount; j++) {
          let next: StackIterator;
          let l: number;
          if (j === linkCount) {
            l = 0;
            next = iterator;
          } else {
            if (iterators.length >= MAX_ITERATOR_COUNT) continue;
            l = j;
            next = {
              node: iterator.node,
              subtrees: iterator.subtrees.slice(),
              subtreeCount: iterator.subtreeCount,
              isPending: iterator.isPending,
            };
            iterators.push(next);
          }
          next.node = linkNode(node, l);
          const subtree = linkSubtree(node, l);
          if (subtree !== null) {
            if (includeSubtrees) next.subtrees.push(subtree);
            if (!subtree.extra) {
              next.subtreeCount++;
              if (!linkPending(node, l)) next.isPending = false;
            }
          } else {
            next.subtreeCount++;
            next.isPending = false;
          }
        }
      }
    }
    return this.slices;
  }

  popCount(version: number, count: number): StackSlice[] {
    // What `iter` does when every node above the goal has one link, without its iterators: one path, one slice.
    const subtrees: Subtree[] = [];
    let node = this.head(version).node;
    let depth = 0;
    while (depth !== count && node.linkCount === 1) {
      const subtree = node.subtree0;
      if (subtree !== null) {
        subtrees.push(subtree);
        if (!subtree.extra) depth++;
      } else depth++;
      node = node.node0 as StackNode;
    }
    if (depth === count) {
      subtrees.reverse();
      this.slices = [];
      this.addSlice(version, node, subtrees);
      return this.slices;
    }
    return this.iter(
      version,
      (it) => (it.subtreeCount === count ? POP | STOP : NONE),
      count,
    );
  }

  popPending(version: number): StackSlice[] {
    const pop = this.iter(
      version,
      (it) =>
        it.subtreeCount >= 1 ? (it.isPending ? POP | STOP : STOP) : NONE,
      0,
    );
    if (pop.length > 0) {
      const first = pop[0] as StackSlice;
      this.renumberVersion(first.version, version);
      first.version = version;
    }
    return pop;
  }

  popError(version: number): Subtree[] {
    const node = this.head(version).node;
    for (let i = 0; i < node.linkCount; i++) {
      const subtree = linkSubtree(node, i);
      if (subtree !== null && subtree.symbol === SYM_ERROR) {
        let foundError = false;
        const pop = this.iter(
          version,
          (it) => {
            if (it.subtrees.length > 0) {
              if (
                !foundError &&
                (it.subtrees[0] as Subtree).symbol === SYM_ERROR
              ) {
                foundError = true;
                return POP | STOP;
              }
              return STOP;
            }
            return NONE;
          },
          1,
        );
        if (pop.length > 0) {
          const first = pop[0] as StackSlice;
          this.renumberVersion(first.version, version);
          return first.subtrees;
        }
        break;
      }
    }
    return [];
  }

  popAll(version: number): StackSlice[] {
    return this.iter(
      version,
      (it) => (it.node.linkCount === 0 ? POP : NONE),
      0,
    );
  }

  recordSummary(version: number, maxDepth: number): void {
    const summary: SummaryEntry[] = [];
    this.iter(
      version,
      (it) => {
        const state = it.node.state;
        const depth = it.subtreeCount;
        if (depth > maxDepth) return STOP;
        for (let i = summary.length - 1; i >= 0; i--) {
          const entry = summary[i] as SummaryEntry;
          if (entry.depth < depth) break;
          if (entry.depth === depth && entry.state === state) return NONE;
        }
        summary.push({
          position: it.node.position,
          row: it.node.row,
          depth,
          state,
        });
        return NONE;
      },
      -1,
    );
    this.head(version).summary = summary;
  }

  summary(version: number): SummaryEntry[] | null {
    return this.head(version).summary;
  }

  dynamicPrecedence(version: number): number {
    return this.head(version).node.dynamicPrecedence;
  }

  hasAdvancedSinceError(version: number): boolean {
    const head = this.head(version);
    let node: StackNode | undefined = head.node;
    if (node.errorCost === 0) return true;
    while (node !== undefined) {
      if (node.linkCount > 0) {
        const subtree = node.subtree0;
        if (subtree !== null) {
          if (totalSize(subtree) > 0) return true;
          if (
            node.nodeCount > head.nodeCountAtLastError &&
            errorCost(subtree) === 0
          ) {
            node = node.node0 as StackNode;
            continue;
          }
        }
      }
      break;
    }
    return false;
  }

  removeVersion(version: number): void {
    this.heads.splice(version, 1);
  }

  renumberVersion(v1: number, v2: number): void {
    if (v1 === v2) return;
    const source = this.head(v1);
    const target = this.head(v2);
    if (target.summary !== null && source.summary === null)
      source.summary = target.summary;
    this.heads[v2] = source;
    this.heads.splice(v1, 1);
  }

  swapVersions(v1: number, v2: number): void {
    const t = this.head(v1);
    this.heads[v1] = this.head(v2);
    this.heads[v2] = t;
  }

  copyVersion(version: number): number {
    const h = this.head(version);
    this.heads.push({ ...h, summary: null });
    return this.heads.length - 1;
  }

  merge(v1: number, v2: number): boolean {
    if (!this.canMerge(v1, v2)) return false;
    const head1 = this.head(v1);
    const head2 = this.head(v2);
    const from = head2.node;
    for (let i = 0; i < from.linkCount; i++)
      addLink(
        head1.node,
        linkNode(from, i),
        linkSubtree(from, i),
        linkPending(from, i),
      );
    if (head1.node.state === ERROR_STATE)
      head1.nodeCountAtLastError = head1.node.nodeCount;
    this.removeVersion(v2);
    return true;
  }

  canMerge(v1: number, v2: number): boolean {
    const head1 = this.head(v1);
    const head2 = this.head(v2);
    return (
      head1.status === ACTIVE &&
      head2.status === ACTIVE &&
      head1.node.state === head2.node.state &&
      head1.node.position === head2.node.position &&
      head1.node.errorCost === head2.node.errorCost &&
      externalStateEq(head1.lastExternalToken, head2.lastExternalToken)
    );
  }

  halt(version: number): void {
    this.head(version).status = HALTED;
  }

  pause(version: number, lookahead: Subtree | null): void {
    const head = this.head(version);
    head.status = PAUSED;
    head.lookaheadWhenPaused = lookahead;
    head.nodeCountAtLastError = head.node.nodeCount;
  }

  isActive(version: number): boolean {
    return this.head(version).status === ACTIVE;
  }

  isHalted(version: number): boolean {
    return this.head(version).status === HALTED;
  }

  isPaused(version: number): boolean {
    return this.head(version).status === PAUSED;
  }

  resume(version: number): Subtree | null {
    const head = this.head(version);
    const result = head.lookaheadWhenPaused;
    head.status = ACTIVE;
    head.lookaheadWhenPaused = null;
    return result;
  }
}
