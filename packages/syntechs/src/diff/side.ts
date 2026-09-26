import type { Tree } from "../core/arena.js";

/**
 * One side of a diff: the subtree of `tree` under `root`, its nodes numbered in preorder from 0. The diff
 * works on these indices, and every per-node table it keeps (`Mapping.src`, `Claimed`, the iso ids) is
 * indexed by them; a subtree is the index range `[i, i + size[i])`. Preorder rather than the tree's
 * postorder ordinals keeps the matcher's greedy tiebreaks and the edit order what they were over the
 * preorder ids of the object tree this replaced.
 */
export class Side {
  private constructor(
    readonly tree: Tree,
    readonly root: number,
    /** Handle by index. */
    readonly nodes: Uint32Array,
    /** Nodes in the subtree at each index, itself included. */
    readonly size: Uint32Array,
    /** 1 for a leaf, else one more than its tallest child. */
    readonly height: Uint32Array,
    /** Parent's whole-tree index by index. */
    private readonly up: Uint32Array,
    /** Whole-tree index by ordinal, shared by every `sub` view of one tree. */
    private readonly pre: Uint32Array,
    private readonly base: number,
  ) {}

  /** The whole tree. */
  static of(tree: Tree): Side {
    const count = tree.nodeCount;
    const nodes = new Uint32Array(count);
    const pre = new Uint32Array(count);
    const stack = [tree.root];
    for (let i = 0; stack.length > 0; i++) {
      const n = stack.pop() as number;
      nodes[i] = n;
      pre[tree.ord(n)] = i;
      for (let k = tree.count(n) - 1; k >= 0; k--) stack.push(tree.child(n, k));
    }
    const size = new Uint32Array(count);
    const height = new Uint32Array(count);
    const up = new Uint32Array(count);
    // Reverse preorder reaches every child before its parent.
    for (let i = count - 1; i >= 0; i--) {
      const n = nodes[i] as number;
      let s = 1;
      let h = 1;
      for (let k = tree.count(n) - 1; k >= 0; k--) {
        const c = pre[tree.ord(tree.child(n, k))] as number;
        s += size[c] as number;
        h = Math.max(h, (height[c] as number) + 1);
        up[c] = i;
      }
      size[i] = s;
      height[i] = h;
    }
    return new Side(tree, tree.root, nodes, size, height, up, pre, 0);
  }

  /** The subtree under `n`, a node of this side, as a side of its own sharing this one's columns. */
  sub(n: number): Side {
    const i = this.index(n);
    const end = i + (this.size[i] as number);
    return new Side(
      this.tree,
      n,
      this.nodes.subarray(i, end),
      this.size.subarray(i, end),
      this.height.subarray(i, end),
      this.up.subarray(i, end),
      this.pre,
      this.base + i,
    );
  }

  /** The index of handle `n`, a node of this side. */
  index(n: number): number {
    return (this.pre[this.tree.ord(n)] as number) - this.base;
  }

  /** The handle at index `i`. */
  node(i: number): number {
    const n = this.nodes[i];
    if (n === undefined)
      throw new RangeError(`no index ${i} in a side of ${this.nodes.length}`);
    return n;
  }

  /** Index of the parent of index `i`; -1 for this side's root, even when the tree goes on above it. */
  parentOf(i: number): number {
    return i === 0 ? -1 : (this.up[i] as number) - this.base;
  }

  /** Indices of the children of index `i`, in source order. */
  childrenOf(i: number): number[] {
    const size = this.size;
    const out: number[] = [];
    for (
      let c = i + 1, end = i + (size[i] as number);
      c < end;
      c += size[c] as number
    )
      out.push(c);
    return out;
  }
}
