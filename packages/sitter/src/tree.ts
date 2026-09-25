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

export interface SyntaxNode {
  id: number;
  kind: string;
  named: boolean;
  field: string | undefined;
  label: string;
  start: number;
  end: number;
  parent: SyntaxNode | undefined;
  children: SyntaxNode[];
  height: number;
  size: number;
}

export interface SyntaxTree {
  nodes: SyntaxNode[];
  errorChars: number;
  node(id: number): SyntaxNode;
}

/** The walk before layout-only JSX text is dropped; `missing` holds the nodes tree-sitter inserted. */
export interface RawTree {
  nodes: SyntaxNode[];
  missing: Set<SyntaxNode>;
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
  const missing = new Set<SyntaxNode>();
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
    if (tree.isMissing) missing.add(node);
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
  return { nodes, missing, layout, errorChars };
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
function jsxText(token: string): string {
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
