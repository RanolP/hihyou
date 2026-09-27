// The visible tree, walked the way tree-sitter's tree_cursor.c walks it (aliases, hidden nodes, inherited
// fields), and appended to the typed-array arena.

import {
  FIXED,
  isFixed,
  MISSING,
  NAMED as NAMED_NODE,
  type Tree,
  TreeBuilder,
} from "./arena.js";
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
import {
  CHILD_COUNT,
  CHILDREN,
  EXTRA,
  FLAGS,
  IS_MISSING,
  NAMED,
  PADDING,
  PRODUCTION_ID,
  SIZE,
  type Subtree,
  type Subtrees,
  SYMBOL,
  VISIBLE,
} from "./subtree.js";

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
    if (
      symbol > 0 &&
      symbol < lang.tokenCount &&
      !named &&
      !external.has(symbol)
    )
      s.fixedLength[symbol] = kind.length;
  }
  symbolsOf.set(lang, s);
  return s;
}

/**
 * Appends a visible node as it leaves: an inner node when records were appended since its `mark`, else a
 * leaf, which a node whose children are all hidden and childless also is, since it reads as one token.
 * Layout-only JSX text is dropped.
 */
function leave(
  b: TreeBuilder,
  lang: Language,
  sym: Symbols,
  source: string,
  w: Int32Array,
  tree: number,
  symbol: number,
  named: boolean,
  field: number,
  start: number,
  mark: number,
): void {
  const kind = publicSymbol(lang, symbol);
  const end = start + (w[tree + SIZE] as number);
  let flags =
    (named ? NAMED_NODE : 0) |
    (((w[tree + FLAGS] as number) & IS_MISSING) !== 0 ? MISSING : 0);
  if (mark !== b.mark()) {
    b.inner(kind, field, flags, start, end, mark);
    return;
  }
  if (
    sym.label[symbol] === LABEL_JSX_TEXT &&
    jsxText(source.slice(start, end)) === ""
  )
    return;
  if (flags === 0) {
    const length =
      symbol === w[tree + SYMBOL] ? (sym.fixedLength[symbol] ?? -1) : -1;
    if (
      length >= 0
        ? end - start === length
        : isFixed(lang, kind, source, start, end)
    )
      flags = FIXED;
  }
  b.leaf(kind, field, flags, start, end);
}

/**
 * The arena form of the visible tree under the parser's `root`: each visible node appended as it leaves, so
 * in postorder, less the layout-only JSX text. Reads the parser's records straight out of `subtrees.words`.
 */
export function buildTree(
  subtrees: Subtrees,
  root: Subtree,
  source: string,
): Tree {
  const lang = subtrees.lang;
  const w = subtrees.words;
  const sym = symbols(lang);
  const b = new TreeBuilder(lang, source);
  /** Characters ERROR nodes cover, nested ones counted once. */
  let errorChars = 0;
  /** Visible ERROR nodes open around the current one. */
  let errors = 0;

  // The frames of the walk as parallel arrays, `depth` deep. `hiddenField` is -1 for a visible frame; a
  // hidden one holds the field its visible descendants inherit when their own parent names none. The `open*`
  // arrays describe a visible frame's node, `openMark` being `b.mark()` when it entered.
  const trees: number[] = [root];
  const index: number[] = [0];
  const structural: number[] = [0];
  /** End of the previous child; the parent's start before the first. */
  const position: number[] = [w[root + PADDING] as number];
  const hiddenField: number[] = [-1];
  const openSymbol: number[] = [w[root + SYMBOL] as number];
  const openNamed: boolean[] = [((w[root + FLAGS] as number) & NAMED) !== 0];
  const openField: number[] = [0];
  const openStart: number[] = [w[root + PADDING] as number];
  const openMark: number[] = [b.mark()];
  if (w[root + SYMBOL] === SYM_ERROR) {
    errorChars += w[root + SIZE] as number;
    errors++;
  }
  let depth = 1;
  while (depth > 0) {
    const d = depth - 1;
    const tree = trees[d] as number;
    const i = index[d] as number;
    if (i === w[tree + CHILD_COUNT]) {
      depth = d;
      if (hiddenField[d] === -1) {
        const symbol = openSymbol[d] as number;
        if (symbol === SYM_ERROR) errors--;
        leave(
          b,
          lang,
          sym,
          source,
          w,
          tree,
          symbol,
          openNamed[d] as boolean,
          openField[d] as number,
          openStart[d] as number,
          openMark[d] as number,
        );
      }
      continue;
    }
    const child = w[tree + CHILDREN + i] as number;
    const childFlags = w[child + FLAGS] as number;
    const start =
      i === 0
        ? (position[d] as number)
        : (position[d] as number) + (w[child + PADDING] as number);
    position[d] = start + (w[child + SIZE] as number);
    index[d] = i + 1;
    let alias = 0;
    let field = 0;
    if ((childFlags & EXTRA) === 0) {
      const s = structural[d] as number;
      const productionId = w[tree + PRODUCTION_ID] as number;
      alias = aliasAt(lang, productionId, s);
      field = fieldFor(lang, productionId, s);
      if (field === 0) {
        const inherited = hiddenField[d] as number;
        if (inherited > 0) field = inherited;
      }
      structural[d] = s + 1;
    }
    const hasChildren = (w[child + CHILD_COUNT] as number) > 0;
    if ((childFlags & VISIBLE) !== 0 || alias !== 0) {
      const symbol = alias !== 0 ? alias : (w[child + SYMBOL] as number);
      const named =
        alias !== 0
          ? (sym.named[alias] as boolean)
          : (childFlags & NAMED) !== 0;
      const error = symbol === SYM_ERROR;
      if (error && errors === 0) errorChars += w[child + SIZE] as number;
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
        openMark[depth] = b.mark();
        depth++;
      } else
        leave(
          b,
          lang,
          sym,
          source,
          w,
          child,
          symbol,
          named,
          field,
          start,
          b.mark(),
        );
    } else if (hasChildren) {
      trees[depth] = child;
      index[depth] = 0;
      structural[depth] = 0;
      position[depth] = start;
      hiddenField[depth] = field;
      depth++;
    }
  }
  return b.finish(errorChars);
}
