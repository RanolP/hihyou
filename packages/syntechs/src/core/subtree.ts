// Port of tree-sitter v0.27.0 lib/src/subtree.c: the parts the parser uses when parsing from scratch.
// Subtrees are records in one growable Int32Array per parse, bump-allocated and freed together with the parse;
// a subtree is its record's word offset. There is no ref-counting, so `make_mut` always copies, which C also
// does whenever a subtree is shared (the token cache always shares the lookahead): a record is written only by
// the call that allocated it, before any other version can reach it. Versions that lose leave their records
// behind as garbage until the parse ends.
// Sizes are UTF-16 units; costs double them because tree-sitter measures UTF-16 input in bytes.

import {
  aliasAt,
  FLAG_NAMED,
  FLAG_VISIBLE,
  type Language,
  STATE_NONE,
  SYM_ERROR,
  SYM_ERROR_REPEAT,
  symbolFlags,
} from "./language.js";

export const COST_PER_RECOVERY = 500;
export const COST_PER_MISSING_TREE = 110;
export const COST_PER_SKIPPED_TREE = 100;
export const COST_PER_SKIPPED_LINE = 30;
export const COST_PER_SKIPPED_CHAR = 1;

export const EMPTY_STATE = new Uint8Array(0);

export const VISIBLE = 1;
export const NAMED = 2;
export const EXTRA = 4;
export const FRAGILE_LEFT = 8;
export const FRAGILE_RIGHT = 16;
export const IS_KEYWORD = 32;
export const IS_MISSING = 64;
export const HAS_EXTERNAL_TOKENS = 128;
export const HAS_EXTERNAL_SCANNER_STATE_CHANGE = 256;
/** The record is a token's short one, with `EXTERNAL` where a node's record keeps its production id. */
const LEAF_RECORD = 512;

declare const subtreeBrand: unique symbol;
/** A record's word offset in its parse's `Subtrees`. */
export type Subtree = number & { readonly [subtreeBrand]: true };
/** No subtree: C's NULL_SUBTREE, which the stack links for an error and the parser passes for no lookahead. */
export const NONE = -1 as Subtree;

// Every record starts with these words.
export const SYMBOL = 0;
export const FLAGS = 1;
const PARSE_STATE = 2;
export const PADDING = 3;
const PADDING_ROWS = 4;
export const SIZE = 5;
const SIZE_ROWS = 6;
/** Stored cost; read it through `errorCost()`, which prices missing leaves. */
const COST = 7;
export const CHILD_COUNT = 8;
// A token's record ends with the index of its external scanner state.
const EXTERNAL = 9;
const LEAF_WORDS = 10;
// A node's record goes on with these, then its children's handles. A node may have no children (an ERROR
// node recovery pushes at the end of input); only `LEAF_RECORD` tells the two layouts apart.
export const PRODUCTION_ID = 9;
const DYNAMIC_PRECEDENCE = 10;
const VISIBLE_DESCENDANT_COUNT = 11;
const VISIBLE_CHILD_COUNT = 12;
const FIRST_LEAF_SYMBOL = 13;
const FIRST_LEAF_PARSE_STATE = 14;
export const CHILDREN = 15;

/**
 * Words reserved per UTF-16 unit of source before the first doubling, just above the largest ratio among the
 * bench and corpus inputs, dead GLR branches included: json 2.92, css 2.24-6.32, javascript 2.81-5.82,
 * typescript 4.19-5.75, tsx 4.58-5.48, python 3.61-4.63. Overshooting costs untouched zeroed memory,
 * undershooting a copy of everything allocated so far.
 */
const WORDS_PER_CHAR: Record<string, number> = {
  json: 3.0,
  css: 6.5,
  javascript: 6.0,
  typescript: 6.0,
  tsx: 5.6,
  python: 4.8,
};
const MIN_WORDS = 1024;

/** VISIBLE and NAMED as a symbol's metadata gives them. */
function symbolBits(lang: Language, symbol: number): number {
  const flags = symbolFlags(lang, symbol);
  return (
    ((flags & FLAG_VISIBLE) !== 0 ? VISIBLE : 0) |
    ((flags & FLAG_NAMED) !== 0 ? NAMED : 0)
  );
}

function errorExtentCost(size: number, rows: number): number {
  return (
    COST_PER_RECOVERY +
    COST_PER_SKIPPED_CHAR * 2 * size +
    COST_PER_SKIPPED_LINE * rows
  );
}

/**
 * One parse's subtrees. Every method that allocates may replace `words`, so a caller holding the array across
 * an allocation must read it again.
 */
export class Subtrees {
  words: Int32Array;
  /** Words in use; the next record starts here. */
  top = 0;
  /** Records allocated and not released, garbage included. */
  records = 0;
  /** External scanner states by `EXTERNAL` index; 0 is the empty state. */
  private readonly external: Uint8Array[] = [EMPTY_STATE];

  constructor(
    readonly lang: Language,
    sourceLength: number,
  ) {
    this.words = new Int32Array(
      Math.max(
        MIN_WORDS,
        Math.ceil(sourceLength * (WORDS_PER_CHAR[lang.name] ?? 4)),
      ),
    );
  }

  private alloc(words: number): Subtree {
    const t = this.top;
    const need = t + words;
    if (need > this.words.length) {
      let size = this.words.length * 2;
      while (size < need) size *= 2;
      const next = new Int32Array(size);
      next.set(this.words.subarray(0, t));
      this.words = next;
    }
    this.top = need;
    this.records++;
    return t as Subtree;
  }

  /** Frees `t`, the last record allocated, which nothing may reference any more. */
  release(t: Subtree): void {
    this.top = t;
    this.records--;
  }

  // ---- reads ---------------------------------------------------------------------------------------------

  symbol(t: Subtree): number {
    return this.words[t + SYMBOL] as number;
  }

  flag(t: Subtree, bit: number): boolean {
    return ((this.words[t + FLAGS] as number) & bit) !== 0;
  }

  parseState(t: Subtree): number {
    return this.words[t + PARSE_STATE] as number;
  }

  padding(t: Subtree): number {
    return this.words[t + PADDING] as number;
  }

  size(t: Subtree): number {
    return this.words[t + SIZE] as number;
  }

  childCount(t: Subtree): number {
    return this.words[t + CHILD_COUNT] as number;
  }

  child(t: Subtree, i: number): Subtree {
    return this.words[t + CHILDREN + i] as Subtree;
  }

  /** A copy of the children's handles, which the caller owns. */
  children(t: Subtree): Subtree[] {
    const n = this.childCount(t);
    const out: Subtree[] = [];
    for (let i = 0; i < n; i++) out.push(this.child(t, i));
    return out;
  }

  productionId(t: Subtree): number {
    return this.flag(t, LEAF_RECORD)
      ? 0
      : (this.words[t + PRODUCTION_ID] as number);
  }

  errorCost(t: Subtree): number {
    return this.flag(t, IS_MISSING)
      ? COST_PER_MISSING_TREE + COST_PER_RECOVERY
      : (this.words[t + COST] as number);
  }

  leafSymbol(t: Subtree): number {
    const w = this.words;
    return w[t + CHILD_COUNT] === 0
      ? (w[t + SYMBOL] as number)
      : (w[t + FIRST_LEAF_SYMBOL] as number);
  }

  leafParseState(t: Subtree): number {
    const w = this.words;
    return w[t + CHILD_COUNT] === 0
      ? (w[t + PARSE_STATE] as number)
      : (w[t + FIRST_LEAF_PARSE_STATE] as number);
  }

  totalSize(t: Subtree): number {
    const w = this.words;
    return (w[t + PADDING] as number) + (w[t + SIZE] as number);
  }

  totalRows(t: Subtree): number {
    const w = this.words;
    return (w[t + PADDING_ROWS] as number) + (w[t + SIZE_ROWS] as number);
  }

  /** 0 for `NONE` and for a subtree with no children. */
  nodeDynamicPrecedence(t: Subtree): number {
    return t === NONE || this.words[t + CHILD_COUNT] === 0
      ? 0
      : (this.words[t + DYNAMIC_PRECEDENCE] as number);
  }

  nodeCountOf(t: Subtree): number {
    const w = this.words;
    let count =
      w[t + CHILD_COUNT] === 0 ? 0 : (w[t + VISIBLE_DESCENDANT_COUNT] as number);
    if (((w[t + FLAGS] as number) & VISIBLE) !== 0) count++;
    if (w[t + SYMBOL] === SYM_ERROR_REPEAT) count++;
    return count;
  }

  /** A token's scanner state as the lexer serialized it, whether or not the token has external tokens; empty for `NONE`. */
  externalStateOf(t: Subtree): Uint8Array {
    return t === NONE || !this.flag(t, LEAF_RECORD)
      ? EMPTY_STATE
      : (this.external[this.words[t + EXTERNAL] as number] as Uint8Array);
  }

  /** `ts_subtree_external_scanner_state`: empty unless `t` is a token with external tokens. */
  externalScannerState(t: Subtree): Uint8Array {
    return t !== NONE &&
      this.flag(t, HAS_EXTERNAL_TOKENS) &&
      this.childCount(t) === 0
      ? this.externalStateOf(t)
      : EMPTY_STATE;
  }

  externalStateEq(a: Subtree, b: Subtree): boolean {
    return bytesEqual(this.externalScannerState(a), this.externalScannerState(b));
  }

  lastExternalToken(tree: Subtree): Subtree {
    if (!this.flag(tree, HAS_EXTERNAL_TOKENS)) return NONE;
    let t = tree;
    while (this.childCount(t) > 0) {
      for (let i = this.childCount(t) - 1; i >= 0; i--) {
        const child = this.child(t, i);
        if (this.flag(child, HAS_EXTERNAL_TOKENS)) {
          t = child;
          break;
        }
      }
    }
    return t;
  }

  /** -1, 0 or 1: symbol, then child count, then children, in preorder. */
  compare(left: Subtree, right: Subtree): number {
    const stack: Subtree[] = [left, right];
    while (stack.length > 0) {
      const r = stack.pop() as Subtree;
      const l = stack.pop() as Subtree;
      const ls = this.symbol(l);
      const rs = this.symbol(r);
      if (ls < rs) return -1;
      if (rs < ls) return 1;
      const ln = this.childCount(l);
      const rn = this.childCount(r);
      if (ln < rn) return -1;
      if (rn < ln) return 1;
      for (let i = ln; i > 0; i--)
        stack.push(this.child(l, i - 1), this.child(r, i - 1));
    }
    return 0;
  }

  /** Moves the trailing extras of `self` into a new array, in their original order. */
  removeTrailingExtras(self: Subtree[]): readonly Subtree[] {
    if (
      self.length === 0 ||
      !this.flag(self[self.length - 1] as Subtree, EXTRA)
    )
      return NO_SUBTREES;
    const out: Subtree[] = [];
    while (self.length > 0 && this.flag(self[self.length - 1] as Subtree, EXTRA))
      out.push(self.pop() as Subtree);
    out.reverse();
    return out;
  }

  // ---- writes, only to a record the caller has just allocated ---------------------------------------------

  setFlag(t: Subtree, bit: number, on: boolean): void {
    const w = this.words;
    const flags = w[t + FLAGS] as number;
    w[t + FLAGS] = on ? flags | bit : flags & ~bit;
  }

  setSymbol(t: Subtree, symbol: number): void {
    const w = this.words;
    w[t + SYMBOL] = symbol;
    w[t + FLAGS] =
      ((w[t + FLAGS] as number) & ~(VISIBLE | NAMED)) |
      symbolBits(this.lang, symbol);
  }

  setParseState(t: Subtree, state: number): void {
    this.words[t + PARSE_STATE] = state;
  }

  /** On a node's record; a token has no dynamic precedence. */
  addDynamicPrecedence(t: Subtree, amount: number): void {
    const w = this.words;
    w[t + DYNAMIC_PRECEDENCE] = (w[t + DYNAMIC_PRECEDENCE] as number) + amount;
  }

  /** On a token's record. */
  setExternalState(t: Subtree, state: Uint8Array): void {
    this.words[t + EXTERNAL] = this.external.length;
    this.external.push(state);
  }

  // ---- constructors --------------------------------------------------------------------------------------

  newLeaf(
    symbol: number,
    padding: number,
    paddingRows: number,
    size: number,
    sizeRows: number,
    parseState: number,
    hasExternalTokens: boolean,
    isKeyword: boolean,
  ): Subtree {
    const t = this.alloc(LEAF_WORDS);
    const w = this.words;
    w[t + SYMBOL] = symbol;
    w[t + FLAGS] =
      LEAF_RECORD |
      symbolBits(this.lang, symbol) |
      (symbol === 0 ? EXTRA : 0) |
      (hasExternalTokens ? HAS_EXTERNAL_TOKENS : 0) |
      (isKeyword ? IS_KEYWORD : 0);
    w[t + PARSE_STATE] = parseState;
    w[t + PADDING] = padding;
    w[t + PADDING_ROWS] = paddingRows;
    w[t + SIZE] = size;
    w[t + SIZE_ROWS] = sizeRows;
    w[t + COST] = 0;
    w[t + CHILD_COUNT] = 0;
    w[t + EXTERNAL] = 0;
    return t;
  }

  newError(
    padding: number,
    paddingRows: number,
    size: number,
    sizeRows: number,
    parseState: number,
  ): Subtree {
    const t = this.newLeaf(
      SYM_ERROR,
      padding,
      paddingRows,
      size,
      sizeRows,
      parseState,
      false,
      false,
    );
    this.setFlag(t, FRAGILE_LEFT | FRAGILE_RIGHT, true);
    return t;
  }

  newMissingLeaf(
    symbol: number,
    state: number,
    padding: number,
    paddingRows: number,
  ): Subtree {
    const t = this.newLeaf(symbol, padding, paddingRows, 0, 0, state, false, false);
    this.setFlag(t, IS_MISSING, true);
    return t;
  }

  /** `ts_subtree_make_mut`: a fresh copy of `t`'s record the caller may change. */
  cloneLeaf(t: Subtree): Subtree {
    const words = this.flag(t, LEAF_RECORD)
      ? LEAF_WORDS
      : CHILDREN + this.childCount(t);
    const c = this.alloc(words);
    this.words.copyWithin(c, t, t + words);
    return c;
  }

  newNode(
    symbol: number,
    children: readonly Subtree[],
    productionId: number,
  ): Subtree {
    const n = children.length;
    const t = this.alloc(CHILDREN + n);
    const w = this.words;
    const fragile = symbol === SYM_ERROR || symbol === SYM_ERROR_REPEAT;
    w[t + SYMBOL] = symbol;
    w[t + FLAGS] =
      symbolBits(this.lang, symbol) |
      (fragile ? FRAGILE_LEFT | FRAGILE_RIGHT : 0);
    w[t + PARSE_STATE] = 0;
    w[t + CHILD_COUNT] = n;
    w[t + PRODUCTION_ID] = productionId;
    for (let i = 0; i < n; i++) w[t + CHILDREN + i] = children[i] as Subtree;
    this.summarizeChildren(t);
    return t;
  }

  newErrorNode(children: readonly Subtree[], extra: boolean): Subtree {
    const t = this.newNode(SYM_ERROR, children, 0);
    this.setFlag(t, EXTRA, extra);
    return t;
  }

  private summarizeChildren(self: Subtree): void {
    const lang = this.lang;
    const w = this.words;
    let flags =
      (w[self + FLAGS] as number) &
      ~(HAS_EXTERNAL_TOKENS | HAS_EXTERNAL_SCANNER_STATE_CHANGE);
    let parseState = w[self + PARSE_STATE] as number;
    let padding = 0;
    let paddingRows = 0;
    let size = 0;
    let sizeRows = 0;
    let cost = 0;
    let dynamicPrecedence = 0;
    let visibleDescendantCount = 0;
    let visibleChildCount = 0;
    let structuralIndex = 0;
    const productionId = w[self + PRODUCTION_ID] as number;
    const selfSymbol = w[self + SYMBOL] as number;
    const isErrorParent =
      selfSymbol === SYM_ERROR || selfSymbol === SYM_ERROR_REPEAT;
    const n = w[self + CHILD_COUNT] as number;
    for (let i = 0; i < n; i++) {
      const child = w[self + CHILDREN + i] as number;
      const childFlags = w[child + FLAGS] as number;
      const childSymbol = w[child + SYMBOL] as number;
      const childSize = w[child + SIZE] as number;
      const childSizeRows = w[child + SIZE_ROWS] as number;
      if ((childFlags & HAS_EXTERNAL_SCANNER_STATE_CHANGE) !== 0)
        flags |= HAS_EXTERNAL_SCANNER_STATE_CHANGE;
      if (i === 0) {
        padding = w[child + PADDING] as number;
        paddingRows = w[child + PADDING_ROWS] as number;
        size = childSize;
        sizeRows = childSizeRows;
      } else {
        // length_add: rows accumulate, bytes accumulate.
        size += (w[child + PADDING] as number) + childSize;
        sizeRows += (w[child + PADDING_ROWS] as number) + childSizeRows;
      }
      const grandchildCount = w[child + CHILD_COUNT] as number;
      const childCost =
        (childFlags & IS_MISSING) !== 0
          ? COST_PER_MISSING_TREE + COST_PER_RECOVERY
          : (w[child + COST] as number);
      if (childSymbol === SYM_ERROR_REPEAT) {
        cost += childCost - errorExtentCost(childSize, childSizeRows);
      } else {
        cost += childCost;
        if (
          isErrorParent &&
          (childFlags & EXTRA) === 0 &&
          !(childSymbol === SYM_ERROR && grandchildCount === 0)
        ) {
          if ((childFlags & VISIBLE) !== 0) cost += COST_PER_SKIPPED_TREE;
          else if (grandchildCount > 0)
            cost +=
              COST_PER_SKIPPED_TREE *
              (w[child + VISIBLE_CHILD_COUNT] as number);
        }
      }
      if (grandchildCount > 0) {
        dynamicPrecedence += w[child + DYNAMIC_PRECEDENCE] as number;
        visibleDescendantCount += w[child + VISIBLE_DESCENDANT_COUNT] as number;
      }
      if (
        (childFlags & EXTRA) === 0 &&
        childSymbol !== 0 &&
        aliasAt(lang, productionId, structuralIndex) !== 0
      ) {
        visibleDescendantCount++;
        visibleChildCount++;
      } else if ((childFlags & VISIBLE) !== 0) {
        visibleDescendantCount++;
        visibleChildCount++;
      } else if (grandchildCount > 0) {
        visibleChildCount += w[child + VISIBLE_CHILD_COUNT] as number;
      }
      if ((childFlags & HAS_EXTERNAL_TOKENS) !== 0) flags |= HAS_EXTERNAL_TOKENS;
      if (childSymbol === SYM_ERROR) {
        flags |= FRAGILE_LEFT | FRAGILE_RIGHT;
        parseState = STATE_NONE;
      }
      if ((childFlags & EXTRA) === 0) structuralIndex++;
    }
    if (isErrorParent) cost += errorExtentCost(size, sizeRows);
    let firstLeafSymbol = 0;
    let firstLeafParseState = 0;
    if (n > 0) {
      const first = w[self + CHILDREN] as Subtree;
      const last = w[self + CHILDREN + n - 1] as number;
      firstLeafSymbol = this.leafSymbol(first);
      firstLeafParseState = this.leafParseState(first);
      flags |=
        ((w[first + FLAGS] as number) & FRAGILE_LEFT) |
        ((w[last + FLAGS] as number) & FRAGILE_RIGHT);
    }
    w[self + FLAGS] = flags;
    w[self + PARSE_STATE] = parseState;
    w[self + PADDING] = padding;
    w[self + PADDING_ROWS] = paddingRows;
    w[self + SIZE] = size;
    w[self + SIZE_ROWS] = sizeRows;
    w[self + COST] = cost;
    w[self + DYNAMIC_PRECEDENCE] = dynamicPrecedence;
    w[self + VISIBLE_DESCENDANT_COUNT] = visibleDescendantCount;
    w[self + VISIBLE_CHILD_COUNT] = visibleChildCount;
    w[self + FIRST_LEAF_SYMBOL] = firstLeafSymbol;
    w[self + FIRST_LEAF_PARSE_STATE] = firstLeafParseState;
  }
}

const NO_SUBTREES: readonly Subtree[] = [];

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
