// The visible tree, walked the way tree-sitter's tree_cursor.c walks it (aliases, hidden nodes, inherited
// fields), and appended to the typed-array arena.

import { FIXED, isFixed, MISSING, NAMED as NAMED_NODE, type Tree, TreeBuilder } from "./arena.js";
import { jsxText, LABEL_JSX_TEXT, labelModes } from "./label.js";
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
    // A leaf, or a node whose children are all hidden and childless, which reads as one token.
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
 * The arena form of the visible tree under the parser's `root`: the nodes the walk visits, less the
 * layout-only JSX text, in postorder.
 */
export function buildTree(lang: Language, root: Subtree, source: string): Tree {
  const b = new TreeBuilder(lang, source);
  const errorChars = walk(lang, root, new ArenaVisitor(lang, b, source));
  return b.finish(errorChars);
}
