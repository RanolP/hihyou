// The visible tree, walked the way tree-sitter's tree_cursor.c walks it (aliases, hidden nodes, inherited
// fields), materialised in the engine's SyntaxNode shape or appended to the typed-array arena. The shape is
// declared here rather than imported so this package stays independent of packages/engine.

import { FIXED, isFixed, MISSING, NAMED as NAMED_NODE, type Tree, TreeBuilder } from "./arena.js";
import { jsxText, LABEL_JSX_TEXT, LABEL_TOKEN, labelModes, labelText } from "./label.js";
import {
  aliasAt,
  FLAG_NAMED,
  type Language,
  publicSymbol,
  SYM_ERROR,
  symbolFlags,
  symbolName,
} from "./language.js";
import { EXTRA, flag, IS_MISSING, NAMED, type Subtree, VISIBLE } from "./subtree.js";

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

function fieldFor(lang: Language, productionId: number, structuralIndex: number): number {
  const start = lang.fieldSliceIndex[productionId] as number;
  const end = start + (lang.fieldSliceLength[productionId] as number);
  for (let i = start; i < end; i++) {
    if (lang.fieldEntryInherited[i] === 0 && lang.fieldEntryChild[i] === structuralIndex)
      return lang.fieldEntryField[i] as number;
  }
  return 0;
}

/** What the walk needs of each symbol (aliases included), looked up once per language instead of per node. */
interface Symbols {
  kind: string[];
  /** For an alias: whether the alias is named; a node's own symbol reads its subtree's flag instead. */
  named: boolean[];
  label: Uint8Array;
  /**
   * For an anonymous token the grammar spells as a string, its name's length: unaliased, a node of that
   * width reads exactly its name. -1 where only the source can tell (external tokens, named symbols,
   * nonterminals, aliases).
   */
  fixedLength: Int32Array;
}

const symbolsOf = new WeakMap<Language, Symbols>();

function symbols(lang: Language): Symbols {
  let s = symbolsOf.get(lang);
  if (s) return s;
  const count = lang.symbolNames.length;
  s = {
    kind: [],
    named: [],
    label: labelModes(lang),
    fixedLength: new Int32Array(count).fill(-1),
  };
  const external = new Set(lang.externalSymbolMap);
  for (let symbol = 0; symbol < count; symbol++) {
    const kind = symbolName(lang, publicSymbol(lang, symbol));
    const named = (symbolFlags(lang, symbol) & FLAG_NAMED) !== 0;
    s.kind.push(kind);
    s.named.push(named);
    if (symbol > 0 && symbol < lang.tokenCount && !named && !external.has(symbol))
      s.fixedLength[symbol] = kind.length;
  }
  symbolsOf.set(lang, s);
  return s;
}

/**
 * What a walk does with each visible node: `enter` in preorder, `leave` once the node's visible descendants
 * have left, so leaves leave in source order and a leaf leaves right after it enters. `symbol` is the alias
 * when there is one, else the subtree's own symbol; `field` is 0 for none.
 */
interface Visitor {
  enter(tree: Subtree, symbol: number, named: boolean, field: number, start: number): void;
  leave(tree: Subtree, symbol: number, named: boolean, field: number, start: number): void;
}

/** Walks the visible nodes under the parser's `root` into `v`; returns the characters ERROR nodes cover, nested ones counted once. */
function walk(lang: Language, root: Subtree, v: Visitor): number {
  const sym = symbols(lang);
  let errorChars = 0;
  /** Visible ERROR nodes open around the current one. */
  let errors = 0;

  // The frames of the walk as parallel arrays, `depth` deep: an object per frame was one more allocation per
  // node. `hiddenField` is -1 for a visible frame; a hidden one holds the field its visible descendants
  // inherit when their own parent names none. The `open*` arrays describe a visible frame's node.
  const trees: Subtree[] = [root];
  const index: number[] = [0];
  const structural: number[] = [0];
  /** End of the previous child; the parent's start before the first. */
  const position: number[] = [root.padding];
  const hiddenField: number[] = [-1];
  const openSymbol: number[] = [root.symbol];
  const openNamed: boolean[] = [flag(root, NAMED)];
  const openField: number[] = [0];
  const openStart: number[] = [root.padding];
  v.enter(root, root.symbol, flag(root, NAMED), 0, root.padding);
  if (root.symbol === SYM_ERROR) {
    errorChars += root.size;
    errors++;
  }
  let depth = 1;
  while (depth > 0) {
    const d = depth - 1;
    const tree = trees[d] as Subtree;
    const children = tree.children;
    const i = index[d] as number;
    if (i === children.length) {
      depth = d;
      if (hiddenField[d] === -1) {
        const symbol = openSymbol[d] as number;
        if (symbol === SYM_ERROR) errors--;
        v.leave(
          tree,
          symbol,
          openNamed[d] as boolean,
          openField[d] as number,
          openStart[d] as number,
        );
      }
      continue;
    }
    const child = children[i] as Subtree;
    const start = i === 0 ? (position[d] as number) : (position[d] as number) + child.padding;
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
      const symbol = alias !== 0 ? alias : child.symbol;
      const named = alias !== 0 ? (sym.named[alias] as boolean) : flag(child, NAMED);
      v.enter(child, symbol, named, field, start);
      const error = symbol === SYM_ERROR;
      if (error && errors === 0) errorChars += child.size;
      if (hasChildren) {
        if (error) errors++;
        trees[depth] = child;
        index[depth] = 0;
        structural[depth] = 0;
        position[depth] = start;
        hiddenField[depth] = -1;
        openSymbol[depth] = symbol;
        openNamed[depth] = named;
        openField[depth] = field;
        openStart[depth] = start;
        depth++;
      } else v.leave(child, symbol, named, field, start);
    } else if (hasChildren) {
      trees[depth] = child;
      index[depth] = 0;
      structural[depth] = 0;
      position[depth] = start;
      hiddenField[depth] = field;
      depth++;
    }
  }
  return errorChars;
}

const NO_NODES: SyntaxNode[] = [];

/** Materialises the walk as SyntaxNode objects, noting the layout-only JSX text for `visibleTree` to drop. */
class ObjectVisitor implements Visitor {
  readonly nodes: SyntaxNode[] = [];
  readonly layout = new Set<SyntaxNode>();
  // The children of the open nodes, innermost last. A node takes its own off the end when it leaves, as an
  // array of exactly their length: pushing onto a fresh array reserved room for 17.
  private readonly kids: SyntaxNode[] = [];
  private readonly open: SyntaxNode[] = [];
  private readonly kidsFrom: number[] = [];
  private readonly sym: Symbols;

  constructor(
    private readonly lang: Language,
    private readonly text: string,
  ) {
    this.sym = symbols(lang);
  }

  enter(tree: Subtree, symbol: number, named: boolean, field: number, start: number): void {
    const open = this.open;
    const parent = open.length > 0 ? open[open.length - 1] : undefined;
    const kinds = this.sym.kind;
    const node: SyntaxNode = {
      id: this.nodes.length,
      kind:
        symbol < kinds.length
          ? (kinds[symbol] as string)
          : symbolName(this.lang, publicSymbol(this.lang, symbol)),
      named,
      field: field === 0 ? undefined : this.lang.fieldNames[field],
      missing: flag(tree, IS_MISSING),
      label: "",
      start,
      end: start + tree.size,
      parent,
      children: NO_NODES,
      height: 1,
      size: 1,
    };
    this.nodes.push(node);
    if (parent) this.kids.push(node);
    open.push(node);
    this.kidsFrom.push(this.kids.length);
  }

  leave(_tree: Subtree, symbol: number): void {
    const node = this.open.pop() as SyntaxNode;
    const from = this.kidsFrom.pop() as number;
    const kids = this.kids;
    if (kids.length === from) {
      const modes = this.sym.label;
      const mode = symbol < modes.length ? (modes[symbol] as number) : LABEL_TOKEN;
      node.label = labelText(mode, this.text.slice(node.start, node.end));
      if (mode === LABEL_JSX_TEXT && node.label === "") this.layout.add(node);
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
  }
}

export function walkTree(lang: Language, root: Subtree, text: string): RawTree {
  const v = new ObjectVisitor(lang, text);
  const errorChars = walk(lang, root, v);
  return { nodes: v.nodes, layout: v.layout, errorChars };
}

/** Appends each visible node to a TreeBuilder as it leaves, skipping the layout-only JSX text. */
class ArenaVisitor implements Visitor {
  /** `b.mark()` at each open node's enter. */
  private readonly marks: number[] = [];
  private readonly sym: Symbols;

  constructor(
    private readonly lang: Language,
    private readonly b: TreeBuilder,
    private readonly source: string,
  ) {
    this.sym = symbols(lang);
  }

  enter(): void {
    this.marks.push(this.b.mark());
  }

  leave(tree: Subtree, symbol: number, named: boolean, field: number, start: number): void {
    const b = this.b;
    const mark = this.marks.pop() as number;
    const kind = publicSymbol(this.lang, symbol);
    const end = start + tree.size;
    let flags = (named ? NAMED_NODE : 0) | (flag(tree, IS_MISSING) ? MISSING : 0);
    if (mark !== b.mark()) {
      b.inner(kind, field, flags, start, end, mark);
      return;
    }
    // A leaf, or a node whose children are all hidden and childless, which reads as one token as in walkTree.
    const sym = this.sym;
    if (sym.label[symbol] === LABEL_JSX_TEXT && jsxText(this.source.slice(start, end)) === "")
      return;
    if (flags === 0) {
      const length = symbol === tree.symbol ? (sym.fixedLength[symbol] ?? -1) : -1;
      if (length >= 0 ? end - start === length : isFixed(this.lang, kind, this.source, start, end))
        flags = FIXED;
    }
    b.leaf(kind, field, flags, start, end);
  }
}

/**
 * The arena form of the visible tree under the parser's `root`: the nodes `walkTree` makes, less the
 * layout-only JSX text `visibleTree` drops, in postorder.
 */
export function buildTree(lang: Language, root: Subtree, source: string): Tree {
  const b = new TreeBuilder(lang, source);
  const errorChars = walk(lang, root, new ArenaVisitor(lang, b, source));
  return b.finish(errorChars);
}

/** The tree without the layout-only JSX text the walk collected. */
export function visibleTree(raw: RawTree): SyntaxTree {
  return syntaxTree(withoutLeaves(raw.nodes, raw.layout), raw.errorChars);
}

/** Wraps preorder `nodes` whose ids are their indices, such as a subtree copied out with its ids rebased. */
export function syntaxTree(nodes: SyntaxNode[], errorChars: number): SyntaxTree {
  return {
    nodes,
    errorChars,
    node(id) {
      const n = nodes[id];
      if (!n) throw new RangeError(`no syntax node ${id} in a tree of ${nodes.length} nodes`);
      return n;
    },
  };
}

function withoutLeaves(nodes: SyntaxNode[], drop: Set<SyntaxNode>): SyntaxNode[] {
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
