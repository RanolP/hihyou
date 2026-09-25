// The visible tree, walked the way tree-sitter's tree_cursor.c walks it (aliases, hidden nodes, inherited
// fields), materialised in the engine's SyntaxNode shape. The shape is declared here rather than imported so
// this package stays independent of packages/engine.

import {
  aliasAt,
  FLAG_NAMED,
  type Language,
  publicSymbol,
  symbolFlags,
  symbolName,
} from "./language.js";
import type { Subtree } from "./subtree.js";

/** Plain-object syntax tree, materialized once so its readers never cross into the parser. Offsets are UTF-16 code units into the source text. */
export interface SyntaxNode {
  /** Preorder index; a node's descendants are exactly ids `id + 1 .. id + size - 1`. */
  id: number;
  kind: string;
  /** False for anonymous tokens the grammar spells literally (punctuation, keywords); they carry no meaning of their own. */
  named: boolean;
  /** The node's role in its parent, as the grammar names it (`condition`, `operator`, `parameters`), if it has one. */
  field: string | undefined;
  /** A zero-width node the parser inserted to recover from a syntax error, such as a value after a trailing comma. */
  missing: boolean;
  /**
   * Token text for leaves, "" for inner nodes. Comments and JSX text carry prose, so their whitespace runs
   * collapse to one space; JSX text that is only layout whitespace does not appear in the tree at all.
   * Whitespace between tokens never appears in a tree, so it never takes part in a diff.
   */
  label: string;
  start: number;
  end: number;
  parent: SyntaxNode | undefined;
  children: SyntaxNode[];
  height: number;
  size: number;
}

export interface SyntaxTree {
  /** Preorder; `nodes[0]` is the root. */
  nodes: SyntaxNode[];
  /** Characters covered by ERROR nodes, for the caller's parse-error threshold. */
  errorChars: number;
  /** `nodes[id]`, throwing when `id` is not in this tree. */
  node(id: number): SyntaxNode;
}

/** The walk before layout-only JSX text is dropped. */
export interface RawTree {
  nodes: SyntaxNode[];
  layout: Set<SyntaxNode>;
  errorChars: number;
}

interface Frame {
  tree: Subtree;
  index: number;
  structuralIndex: number;
  /** End of the previous child; the parent's start before the first. */
  position: number;
  node: SyntaxNode;
  hidden: boolean;
  /** For a hidden frame, the field its visible descendants inherit when their own parent names none. */
  field: number;
}

function fieldFor(
  lang: Language,
  productionId: number,
  structuralIndex: number,
): number {
  const start = lang.fieldSliceIndex[productionId] as number;
  const end = start + (lang.fieldSliceLength[productionId] as number);
  for (let i = start; i < end; i++) {
    if (
      lang.fieldEntryInherited[i] === 0 &&
      lang.fieldEntryChild[i] === structuralIndex
    )
      return lang.fieldEntryField[i] as number;
  }
  return 0;
}

export function walkTree(lang: Language, root: Subtree, text: string): RawTree {
  const nodes: SyntaxNode[] = [];
  const layout = new Set<SyntaxNode>();
  let errorChars = 0;

  const open = (
    tree: Subtree,
    alias: number,
    field: number,
    start: number,
    parent: SyntaxNode | undefined,
  ): SyntaxNode => {
    const symbol = alias !== 0 ? alias : tree.symbol;
    const kind = symbolName(lang, publicSymbol(lang, symbol));
    const node: SyntaxNode = {
      id: nodes.length,
      kind,
      named:
        alias !== 0
          ? (symbolFlags(lang, alias) & FLAG_NAMED) !== 0
          : tree.named,
      field: field === 0 ? undefined : lang.fieldNames[field],
      missing: tree.isMissing,
      label: "",
      start,
      end: start + tree.size,
      parent,
      children: [],
      height: 1,
      size: 1,
    };
    nodes.push(node);
    parent?.children.push(node);
    if (kind === "ERROR" && !insideError(parent))
      errorChars += node.end - node.start;
    return node;
  };
  const close = (node: SyntaxNode) => {
    if (node.children.length === 0) {
      const token = text.slice(node.start, node.end);
      if (node.kind.includes("comment"))
        node.label = token.replace(/\s+/g, " ");
      else if (node.kind === "jsx_text") {
        node.label = jsxText(token);
        if (node.label === "") layout.add(node);
      } else node.label = token;
      return;
    }
    for (const c of node.children) {
      if (c.height + 1 > node.height) node.height = c.height + 1;
      node.size += c.size;
    }
  };

  const rootNode = open(root, 0, 0, root.padding, undefined);
  const frames: Frame[] = [
    {
      tree: root,
      index: 0,
      structuralIndex: 0,
      position: root.padding,
      node: rootNode,
      hidden: false,
      field: 0,
    },
  ];
  while (frames.length > 0) {
    const f = frames[frames.length - 1] as Frame;
    const children = f.tree.children;
    if (f.index === children.length) {
      frames.pop();
      if (!f.hidden) close(f.node);
      continue;
    }
    const child = children[f.index] as Subtree;
    const start = f.index === 0 ? f.position : f.position + child.padding;
    f.position = start + child.size;
    f.index++;
    let alias = 0;
    let field = 0;
    if (!child.extra) {
      alias = aliasAt(lang, f.tree.productionId, f.structuralIndex);
      field = fieldFor(lang, f.tree.productionId, f.structuralIndex);
      if (field === 0 && f.hidden) field = f.field;
      f.structuralIndex++;
    }
    if (child.visible || alias !== 0) {
      const node = open(child, alias, field, start, f.node);
      if (child.children.length > 0) {
        frames.push({
          tree: child,
          index: 0,
          structuralIndex: 0,
          position: start,
          node,
          hidden: false,
          field: 0,
        });
      } else close(node);
    } else if (child.children.length > 0) {
      frames.push({
        tree: child,
        index: 0,
        structuralIndex: 0,
        position: start,
        node: f.node,
        hidden: true,
        field,
      });
    }
  }
  return { nodes, layout, errorChars };
}

export function syntaxTree(raw: RawTree): SyntaxTree {
  const nodes = withoutLeaves(raw.nodes, raw.layout);
  return {
    nodes,
    errorChars: raw.errorChars,
    node(id) {
      const n = nodes[id];
      if (!n)
        throw new RangeError(
          `no syntax node ${id} in a tree of ${nodes.length} nodes`,
        );
      return n;
    },
  };
}

function insideError(node: SyntaxNode | undefined): boolean {
  for (let n = node; n; n = n.parent) if (n.kind === "ERROR") return true;
  return false;
}

/** JSX text as JSX evaluates it, whitespace runs collapsed; "" means layout only. Mirrors packages/engine. */
export function jsxText(token: string): string {
  const lines = token.split(/\r\n|\n|\r/);
  return lines
    .map((line, i) => {
      let t = line;
      if (i > 0) t = t.trimStart();
      if (i < lines.length - 1) t = t.trimEnd();
      return t;
    })
    .filter((t) => t !== "")
    .join(" ")
    .replace(/\s+/g, " ");
}

function withoutLeaves(
  nodes: SyntaxNode[],
  drop: Set<SyntaxNode>,
): SyntaxNode[] {
  if (drop.size === 0) return nodes;
  const kept = nodes.filter((n) => !drop.has(n));
  for (const [id, n] of kept.entries()) {
    n.id = id;
    n.children = n.children.filter((c) => !drop.has(c));
    n.height = 1;
    n.size = 1;
  }
  for (const n of kept.toReversed())
    for (const c of n.children) {
      n.height = Math.max(n.height, c.height + 1);
      n.size += c.size;
    }
  return kept;
}
