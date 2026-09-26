// Port of tree-sitter v0.27.0 lib/src/subtree.c: the parts the parser uses when parsing from scratch.
// Subtrees are plain objects owned by the garbage collector, so there is no ref-counting; `make_mut` always
// clones, which C also does whenever a subtree is shared (the token cache always shares the lookahead).
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

const NO_CHILDREN: Subtree[] = [];
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

// The booleans share one small-integer field, read with `flag`: a parse allocates a subtree per token and per
// reduction, and nine fields of their own made each one about half again as large.
export interface Subtree {
  symbol: number;
  parseState: number;
  padding: number;
  paddingRows: number;
  size: number;
  sizeRows: number;
  /** Stored cost; read it through `errorCost()`, which prices missing leaves. */
  cost: number;
  children: Subtree[];
  flags: number;
  externalState: Uint8Array;
  productionId: number;
  dynamicPrecedence: number;
  visibleDescendantCount: number;
  visibleChildCount: number;
  firstLeafSymbol: number;
  firstLeafParseState: number;
}

// Every subtree comes from this one object literal rather than a class: V8 learns that the objects of a
// literal's allocation site outlive the young generation and then allocates them old, which it does not do
// for `new`, and a tree is long-lived. Copying survivors out of the young generation was most of the GC time.
function subtree(symbol: number, parseState: number, flags: number): Subtree {
  return {
    symbol,
    parseState,
    padding: 0,
    paddingRows: 0,
    size: 0,
    sizeRows: 0,
    cost: 0,
    children: NO_CHILDREN,
    flags,
    externalState: EMPTY_STATE,
    productionId: 0,
    dynamicPrecedence: 0,
    visibleDescendantCount: 0,
    visibleChildCount: 0,
    firstLeafSymbol: 0,
    firstLeafParseState: 0,
  };
}

export function flag(t: Subtree, bit: number): boolean {
  return (t.flags & bit) !== 0;
}

export function setFlag(t: Subtree, bit: number, on: boolean): void {
  t.flags = on ? t.flags | bit : t.flags & ~bit;
}

/** VISIBLE and NAMED as a symbol's metadata gives them. */
function symbolBits(lang: Language, symbol: number): number {
  const flags = symbolFlags(lang, symbol);
  return (
    ((flags & FLAG_VISIBLE) !== 0 ? VISIBLE : 0) |
    ((flags & FLAG_NAMED) !== 0 ? NAMED : 0)
  );
}

export function errorCost(t: Subtree): number {
  return flag(t, IS_MISSING)
    ? COST_PER_MISSING_TREE + COST_PER_RECOVERY
    : t.cost;
}

export function leafSymbol(t: Subtree): number {
  return t.children.length === 0 ? t.symbol : t.firstLeafSymbol;
}

export function leafParseState(t: Subtree): number {
  return t.children.length === 0 ? t.parseState : t.firstLeafParseState;
}

export function totalSize(t: Subtree): number {
  return t.padding + t.size;
}

export function totalRows(t: Subtree): number {
  return t.paddingRows + t.sizeRows;
}

export function nodeDynamicPrecedence(t: Subtree | null): number {
  return t === null || t.children.length === 0 ? 0 : t.dynamicPrecedence;
}

function errorExtentCost(size: number, rows: number): number {
  return (
    COST_PER_RECOVERY +
    COST_PER_SKIPPED_CHAR * 2 * size +
    COST_PER_SKIPPED_LINE * rows
  );
}

export function newLeaf(
  lang: Language,
  symbol: number,
  padding: number,
  paddingRows: number,
  size: number,
  sizeRows: number,
  parseState: number,
  hasExternalTokens: boolean,
  isKeyword: boolean,
): Subtree {
  const t = subtree(
    symbol,
    parseState,
    symbolBits(lang, symbol) |
      (symbol === 0 ? EXTRA : 0) |
      (hasExternalTokens ? HAS_EXTERNAL_TOKENS : 0) |
      (isKeyword ? IS_KEYWORD : 0),
  );
  t.padding = padding;
  t.paddingRows = paddingRows;
  t.size = size;
  t.sizeRows = sizeRows;
  return t;
}

export function newError(
  lang: Language,
  padding: number,
  paddingRows: number,
  size: number,
  sizeRows: number,
  parseState: number,
): Subtree {
  const t = newLeaf(
    lang,
    SYM_ERROR,
    padding,
    paddingRows,
    size,
    sizeRows,
    parseState,
    false,
    false,
  );
  t.flags |= FRAGILE_LEFT | FRAGILE_RIGHT;
  return t;
}

export function newMissingLeaf(
  lang: Language,
  symbol: number,
  state: number,
  padding: number,
  paddingRows: number,
): Subtree {
  const t = newLeaf(
    lang,
    symbol,
    padding,
    paddingRows,
    0,
    0,
    state,
    false,
    false,
  );
  t.flags |= IS_MISSING;
  return t;
}

/** `ts_subtree_make_mut` for a leaf: a fresh copy the caller may change. */
export function cloneLeaf(t: Subtree): Subtree {
  const c = subtree(t.symbol, t.parseState, t.flags);
  c.padding = t.padding;
  c.paddingRows = t.paddingRows;
  c.size = t.size;
  c.sizeRows = t.sizeRows;
  c.cost = t.cost;
  c.children = t.children;
  c.externalState = t.externalState;
  c.productionId = t.productionId;
  c.dynamicPrecedence = t.dynamicPrecedence;
  c.visibleDescendantCount = t.visibleDescendantCount;
  c.visibleChildCount = t.visibleChildCount;
  c.firstLeafSymbol = t.firstLeafSymbol;
  c.firstLeafParseState = t.firstLeafParseState;
  return c;
}

export function setSymbol(lang: Language, t: Subtree, symbol: number): void {
  t.symbol = symbol;
  t.flags = (t.flags & ~(VISIBLE | NAMED)) | symbolBits(lang, symbol);
}

export function summarizeChildren(lang: Language, self: Subtree): void {
  self.visibleChildCount = 0;
  self.cost = 0;
  self.visibleDescendantCount = 0;
  self.flags &= ~(HAS_EXTERNAL_TOKENS | HAS_EXTERNAL_SCANNER_STATE_CHANGE);
  self.dynamicPrecedence = 0;
  let structuralIndex = 0;
  const productionId = self.productionId;
  const isErrorParent =
    self.symbol === SYM_ERROR || self.symbol === SYM_ERROR_REPEAT;
  const children = self.children;
  const n = children.length;
  for (let i = 0; i < n; i++) {
    const child = children[i] as Subtree;
    const childFlags = child.flags;
    if ((childFlags & HAS_EXTERNAL_SCANNER_STATE_CHANGE) !== 0)
      self.flags |= HAS_EXTERNAL_SCANNER_STATE_CHANGE;
    if (i === 0) {
      self.padding = child.padding;
      self.paddingRows = child.paddingRows;
      self.size = child.size;
      self.sizeRows = child.sizeRows;
    } else {
      // length_add: rows accumulate, bytes accumulate.
      self.size += child.padding + child.size;
      self.sizeRows += child.paddingRows + child.sizeRows;
    }
    const grandchildCount = child.children.length;
    if (child.symbol === SYM_ERROR_REPEAT) {
      self.cost +=
        errorCost(child) - errorExtentCost(child.size, child.sizeRows);
    } else {
      self.cost += errorCost(child);
      if (
        isErrorParent &&
        (childFlags & EXTRA) === 0 &&
        !(child.symbol === SYM_ERROR && grandchildCount === 0)
      ) {
        if ((childFlags & VISIBLE) !== 0) self.cost += COST_PER_SKIPPED_TREE;
        else if (grandchildCount > 0)
          self.cost += COST_PER_SKIPPED_TREE * child.visibleChildCount;
      }
    }
    if (grandchildCount > 0) {
      self.dynamicPrecedence += child.dynamicPrecedence;
      self.visibleDescendantCount += child.visibleDescendantCount;
    }
    if (
      (childFlags & EXTRA) === 0 &&
      child.symbol !== 0 &&
      aliasAt(lang, productionId, structuralIndex) !== 0
    ) {
      self.visibleDescendantCount++;
      self.visibleChildCount++;
    } else if ((childFlags & VISIBLE) !== 0) {
      self.visibleDescendantCount++;
      self.visibleChildCount++;
    } else if (grandchildCount > 0) {
      self.visibleChildCount += child.visibleChildCount;
    }
    if ((childFlags & HAS_EXTERNAL_TOKENS) !== 0)
      self.flags |= HAS_EXTERNAL_TOKENS;
    if (child.symbol === SYM_ERROR) {
      self.flags |= FRAGILE_LEFT | FRAGILE_RIGHT;
      self.parseState = STATE_NONE;
    }
    if ((childFlags & EXTRA) === 0) structuralIndex++;
  }
  if (isErrorParent) self.cost += errorExtentCost(self.size, self.sizeRows);
  if (n > 0) {
    const first = children[0] as Subtree;
    const last = children[n - 1] as Subtree;
    self.firstLeafSymbol = leafSymbol(first);
    self.firstLeafParseState = leafParseState(first);
    self.flags |= (first.flags & FRAGILE_LEFT) | (last.flags & FRAGILE_RIGHT);
  }
}

export function newNode(
  lang: Language,
  symbol: number,
  children: Subtree[],
  productionId: number,
): Subtree {
  const fragile = symbol === SYM_ERROR || symbol === SYM_ERROR_REPEAT;
  const t = subtree(
    symbol,
    0,
    symbolBits(lang, symbol) | (fragile ? FRAGILE_LEFT | FRAGILE_RIGHT : 0),
  );
  t.children = children;
  t.productionId = productionId;
  summarizeChildren(lang, t);
  return t;
}

export function newErrorNode(
  lang: Language,
  children: Subtree[],
  extra: boolean,
): Subtree {
  const t = newNode(lang, SYM_ERROR, children, 0);
  setFlag(t, EXTRA, extra);
  return t;
}

/** -1, 0 or 1: symbol, then child count, then children, in preorder. */
export function compareSubtrees(left: Subtree, right: Subtree): number {
  const stack: Subtree[] = [left, right];
  while (stack.length > 0) {
    const r = stack.pop() as Subtree;
    const l = stack.pop() as Subtree;
    if (l.symbol < r.symbol) return -1;
    if (r.symbol < l.symbol) return 1;
    if (l.children.length < r.children.length) return -1;
    if (r.children.length < l.children.length) return 1;
    for (let i = l.children.length; i > 0; i--)
      stack.push(l.children[i - 1] as Subtree, r.children[i - 1] as Subtree);
  }
  return 0;
}

export function externalScannerState(t: Subtree | null): Uint8Array {
  return t !== null && flag(t, HAS_EXTERNAL_TOKENS) && t.children.length === 0
    ? t.externalState
    : EMPTY_STATE;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function externalStateEq(a: Subtree | null, b: Subtree | null): boolean {
  return bytesEqual(externalScannerState(a), externalScannerState(b));
}

export function lastExternalToken(tree: Subtree): Subtree | null {
  if (!flag(tree, HAS_EXTERNAL_TOKENS)) return null;
  let t = tree;
  while (t.children.length > 0) {
    for (let i = t.children.length - 1; i >= 0; i--) {
      const child = t.children[i] as Subtree;
      if (flag(child, HAS_EXTERNAL_TOKENS)) {
        t = child;
        break;
      }
    }
  }
  return t;
}

/** Moves the trailing extras of `self` into a new array, in their original order. */
export function removeTrailingExtras(self: Subtree[]): readonly Subtree[] {
  if (self.length === 0 || !flag(self[self.length - 1] as Subtree, EXTRA))
    return NO_CHILDREN;
  const out: Subtree[] = [];
  while (self.length > 0 && flag(self[self.length - 1] as Subtree, EXTRA))
    out.push(self.pop() as Subtree);
  out.reverse();
  return out;
}

export function nodeCountOf(t: Subtree): number {
  let count = t.children.length === 0 ? 0 : t.visibleDescendantCount;
  if (flag(t, VISIBLE)) count++;
  if (t.symbol === SYM_ERROR_REPEAT) count++;
  return count;
}
