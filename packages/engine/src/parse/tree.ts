import { NO_NODE, type Tree } from "syntechs/core";
import type { RawEdit } from "syntechs/diff";
import type { LanguageId } from "./languages.js";

export type { Tree } from "syntechs/core";

export interface SyntaxParser {
  parse(lang: LanguageId, text: string): Promise<Tree>;
}

/**
 * A node of a `Tree` read as an object, for the code that walks around an edited node (risk, groups, names).
 * Each property reads the tree when accessed; `parent` and `children` make new views, so compare by `handle`.
 */
export interface SyntaxNode {
  readonly handle: number;
  readonly kind: string;
  /** False for anonymous tokens the grammar spells literally (punctuation, keywords). */
  readonly named: boolean;
  /** The node's role in its parent, as the grammar names it (`condition`, `operator`), if it has one. */
  readonly field: string | undefined;
  /** Token text for leaves, whitespace runs in comments and JSX text collapsed; "" for inner nodes. */
  readonly label: string;
  readonly start: number;
  readonly end: number;
  readonly parent: SyntaxNode | undefined;
  readonly children: SyntaxNode[];
}

class NodeView implements SyntaxNode {
  constructor(
    private readonly tree: Tree,
    readonly handle: number,
  ) {}
  get kind() {
    return this.tree.kindName(this.handle);
  }
  get named() {
    return this.tree.named(this.handle);
  }
  get field() {
    return this.tree.fieldName(this.handle);
  }
  get label() {
    return this.tree.label(this.handle);
  }
  get start() {
    return this.tree.start(this.handle);
  }
  get end() {
    return this.tree.end(this.handle);
  }
  get parent(): SyntaxNode | undefined {
    const p = this.tree.parent(this.handle);
    return p === NO_NODE ? undefined : new NodeView(this.tree, p);
  }
  get children(): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    for (let i = 0, n = this.tree.count(this.handle); i < n; i++)
      out.push(new NodeView(this.tree, this.tree.child(this.handle, i)));
    return out;
  }
}

export function nodeOf(tree: Tree, handle: number): SyntaxNode {
  return new NodeView(tree, handle);
}

/** A `RawEdit` whose `a` and `b` are node views instead of handles. */
export type NodeEdit = RawEdit extends infer E
  ? E extends unknown
    ? { [K in keyof E]: K extends "a" | "b" ? SyntaxNode : E[K] }
    : never
  : never;

/**
 * `edit` with its handles read against the trees they came from: `a` in `ta`, `b` in `tb`. A line-mode
 * edit has no handles and needs no trees.
 */
export function withNodes(edit: RawEdit, ta?: Tree, tb?: Tree): NodeEdit {
  const view = (tree: Tree | undefined, handle: number) => {
    if (!tree)
      throw new RangeError(`edit names node ${handle} but got no tree for it`);
    return nodeOf(tree, handle);
  };
  const { a, b, ...rest } = edit as RawEdit & { a?: number; b?: number };
  return {
    ...rest,
    ...(a !== undefined && { a: view(ta, a) }),
    ...(b !== undefined && { b: view(tb, b) }),
  } as NodeEdit;
}
