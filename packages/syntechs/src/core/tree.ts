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
import {
  EXTRA,
  flag,
  IS_MISSING,
  NAMED,
  type Subtree,
  VISIBLE,
} from "./subtree.js";

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

const LABEL_TOKEN = 0;
const LABEL_COMMENT = 1;
const LABEL_JSX_TEXT = 2;

/** What the walk needs of each symbol (aliases included), looked up once per language instead of per node. */
interface Symbols {
  kind: string[];
  /** For an alias: whether the alias is named; a node's own symbol reads its subtree's flag instead. */
  named: boolean[];
  label: Uint8Array;
}

const symbolsOf = new WeakMap<Language, Symbols>();

function symbols(lang: Language): Symbols {
  let s = symbolsOf.get(lang);
  if (s) return s;
  const count = lang.symbolNames.length;
  s = { kind: [], named: [], label: new Uint8Array(count) };
  for (let symbol = 0; symbol < count; symbol++) {
    const kind = symbolName(lang, publicSymbol(lang, symbol));
    s.kind.push(kind);
    s.named.push((symbolFlags(lang, symbol) & FLAG_NAMED) !== 0);
    s.label[symbol] = kind.includes("comment")
      ? LABEL_COMMENT
      : kind === "jsx_text"
        ? LABEL_JSX_TEXT
        : LABEL_TOKEN;
  }
  symbolsOf.set(lang, s);
  return s;
}

const NO_NODES: SyntaxNode[] = [];

export function walkTree(lang: Language, root: Subtree, text: string): RawTree {
  const nodes: SyntaxNode[] = [];
  const layout = new Set<SyntaxNode>();
  const sym = symbols(lang);
  let errorChars = 0;
  // The children of the open visible nodes, innermost last. A node takes its own off the end when it closes,
  // as an array of exactly their length: pushing onto a fresh array reserved room for 17.
  const kids: SyntaxNode[] = [];

  const open = (
    tree: Subtree,
    alias: number,
    field: number,
    start: number,
    parent: SyntaxNode | undefined,
  ): SyntaxNode => {
    const symbol = alias !== 0 ? alias : tree.symbol;
    const kind =
      symbol < sym.kind.length
        ? (sym.kind[symbol] as string)
        : symbolName(lang, publicSymbol(lang, symbol));
    const end = start + tree.size;
    const node: SyntaxNode = {
      id: nodes.length,
      kind,
      named: alias !== 0 ? (sym.named[alias] as boolean) : flag(tree, NAMED),
      field: field === 0 ? undefined : lang.fieldNames[field],
      missing: flag(tree, IS_MISSING),
      label: "",
      start,
      end,
      parent,
      children: NO_NODES,
      height: 1,
      size: 1,
    };
    nodes.push(node);
    if (parent) kids.push(node);
    if (kind === "ERROR" && !insideError(parent)) errorChars += end - start;
    return node;
  };
  const close = (node: SyntaxNode, symbol: number, from: number) => {
    if (kids.length === from) {
      const token = text.slice(node.start, node.end);
      const mode = symbol < sym.label.length ? sym.label[symbol] : LABEL_TOKEN;
      if (mode === LABEL_TOKEN) node.label = token;
      else if (mode === LABEL_COMMENT) node.label = token.replace(/\s+/g, " ");
      else {
        node.label = jsxText(token);
        if (node.label === "") layout.add(node);
      }
      return;
    }
    const children = kids.slice(from);
    kids.length = from;
    node.children = children;
    let height = 1;
    let size = 1;
    for (let i = 0; i < children.length; i++) {
      const c = children[i] as SyntaxNode;
      if (c.height >= height) height = c.height + 1;
      size += c.size;
    }
    node.height = height;
    node.size = size;
  };

  // The frames of the walk as parallel arrays, `depth` deep: an object per frame was one more allocation per
  // node. `hiddenField` is -1 for a visible frame; a hidden one holds the field its visible descendants
  // inherit when their own parent names none.
  const trees: Subtree[] = [root];
  const index: number[] = [0];
  const structural: number[] = [0];
  /** End of the previous child; the parent's start before the first. */
  const position: number[] = [root.padding];
  const owner: SyntaxNode[] = [open(root, 0, 0, root.padding, undefined)];
  const ownerSymbol: number[] = [root.symbol];
  const hiddenField: number[] = [-1];
  const kidsFrom: number[] = [0];
  let depth = 1;
  while (depth > 0) {
    const d = depth - 1;
    const tree = trees[d] as Subtree;
    const children = tree.children;
    const i = index[d] as number;
    if (i === children.length) {
      depth = d;
      if (hiddenField[d] === -1)
        close(
          owner[d] as SyntaxNode,
          ownerSymbol[d] as number,
          kidsFrom[d] as number,
        );
      continue;
    }
    const child = children[i] as Subtree;
    const start =
      i === 0
        ? (position[d] as number)
        : (position[d] as number) + child.padding;
    position[d] = start + child.size;
    index[d] = i + 1;
    let alias = 0;
    let field = 0;
    if (!flag(child, EXTRA)) {
      const s = structural[d] as number;
      alias = aliasAt(lang, tree.productionId, s);
      field = fieldFor(lang, tree.productionId, s);
      if (field === 0) {
        const inherited = hiddenField[d] as number;
        if (inherited > 0) field = inherited;
      }
      structural[d] = s + 1;
    }
    const hasChildren = child.children.length > 0;
    if (flag(child, VISIBLE) || alias !== 0) {
      const node = open(child, alias, field, start, owner[d]);
      if (hasChildren) {
        trees[depth] = child;
        index[depth] = 0;
        structural[depth] = 0;
        position[depth] = start;
        owner[depth] = node;
        ownerSymbol[depth] = alias !== 0 ? alias : child.symbol;
        hiddenField[depth] = -1;
        kidsFrom[depth] = kids.length;
        depth++;
      } else close(node, alias !== 0 ? alias : child.symbol, kids.length);
    } else if (hasChildren) {
      trees[depth] = child;
      index[depth] = 0;
      structural[depth] = 0;
      position[depth] = start;
      owner[depth] = owner[d] as SyntaxNode;
      hiddenField[depth] = field;
      depth++;
    }
  }
  return { nodes, layout, errorChars };
}

/** The tree without the layout-only JSX text the walk collected. */
export function visibleTree(raw: RawTree): SyntaxTree {
  return syntaxTree(withoutLeaves(raw.nodes, raw.layout), raw.errorChars);
}

/** Wraps preorder `nodes` whose ids are their indices, such as a subtree copied out with its ids rebased. */
export function syntaxTree(
  nodes: SyntaxNode[],
  errorChars: number,
): SyntaxTree {
  return {
    nodes,
    errorChars,
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
