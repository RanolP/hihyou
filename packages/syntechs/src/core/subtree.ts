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

export class Subtree {
  symbol: number;
  parseState: number;
  padding = 0;
  paddingRows = 0;
  size = 0;
  sizeRows = 0;
  /** Stored cost; read it through `errorCost()`, which prices missing leaves. */
  cost = 0;
  children: Subtree[] = NO_CHILDREN;
  visible: boolean;
  named: boolean;
  extra = false;
  fragileLeft = false;
  fragileRight = false;
  isKeyword = false;
  isMissing = false;
  hasExternalTokens = false;
  hasExternalScannerStateChange = false;
  externalState: Uint8Array = EMPTY_STATE;
  productionId = 0;
  dynamicPrecedence = 0;
  visibleDescendantCount = 0;
  visibleChildCount = 0;
  firstLeafSymbol = 0;
  firstLeafParseState = 0;

  constructor(
    symbol: number,
    parseState: number,
    visible: boolean,
    named: boolean,
  ) {
    this.symbol = symbol;
    this.parseState = parseState;
    this.visible = visible;
    this.named = named;
  }
}

export function errorCost(t: Subtree): number {
  return t.isMissing ? COST_PER_MISSING_TREE + COST_PER_RECOVERY : t.cost;
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
  const flags = symbolFlags(lang, symbol);
  const t = new Subtree(
    symbol,
    parseState,
    (flags & FLAG_VISIBLE) !== 0,
    (flags & FLAG_NAMED) !== 0,
  );
  t.padding = padding;
  t.paddingRows = paddingRows;
  t.size = size;
  t.sizeRows = sizeRows;
  t.extra = symbol === 0;
  t.hasExternalTokens = hasExternalTokens;
  t.isKeyword = isKeyword;
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
  t.fragileLeft = true;
  t.fragileRight = true;
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
  t.isMissing = true;
  return t;
}

/** `ts_subtree_make_mut` for a leaf: a fresh copy the caller may change. */
export function cloneLeaf(t: Subtree): Subtree {
  const c = new Subtree(t.symbol, t.parseState, t.visible, t.named);
  c.padding = t.padding;
  c.paddingRows = t.paddingRows;
  c.size = t.size;
  c.sizeRows = t.sizeRows;
  c.cost = t.cost;
  c.children = t.children;
  c.extra = t.extra;
  c.fragileLeft = t.fragileLeft;
  c.fragileRight = t.fragileRight;
  c.isKeyword = t.isKeyword;
  c.isMissing = t.isMissing;
  c.hasExternalTokens = t.hasExternalTokens;
  c.hasExternalScannerStateChange = t.hasExternalScannerStateChange;
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
  const flags = symbolFlags(lang, symbol);
  t.symbol = symbol;
  t.named = (flags & FLAG_NAMED) !== 0;
  t.visible = (flags & FLAG_VISIBLE) !== 0;
}

export function summarizeChildren(lang: Language, self: Subtree): void {
  self.visibleChildCount = 0;
  self.cost = 0;
  self.visibleDescendantCount = 0;
  self.hasExternalTokens = false;
  self.hasExternalScannerStateChange = false;
  self.dynamicPrecedence = 0;
  let structuralIndex = 0;
  const productionId = self.productionId;
  const isErrorParent =
    self.symbol === SYM_ERROR || self.symbol === SYM_ERROR_REPEAT;
  const children = self.children;
  const n = children.length;
  for (let i = 0; i < n; i++) {
    const child = children[i] as Subtree;
    if (child.hasExternalScannerStateChange)
      self.hasExternalScannerStateChange = true;
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
        !child.extra &&
        !(child.symbol === SYM_ERROR && grandchildCount === 0)
      ) {
        if (child.visible) self.cost += COST_PER_SKIPPED_TREE;
        else if (grandchildCount > 0)
          self.cost += COST_PER_SKIPPED_TREE * child.visibleChildCount;
      }
    }
    if (grandchildCount > 0) {
      self.dynamicPrecedence += child.dynamicPrecedence;
      self.visibleDescendantCount += child.visibleDescendantCount;
    }
    if (
      !child.extra &&
      child.symbol !== 0 &&
      aliasAt(lang, productionId, structuralIndex) !== 0
    ) {
      self.visibleDescendantCount++;
      self.visibleChildCount++;
    } else if (child.visible) {
      self.visibleDescendantCount++;
      self.visibleChildCount++;
    } else if (grandchildCount > 0) {
      self.visibleChildCount += child.visibleChildCount;
    }
    if (child.hasExternalTokens) self.hasExternalTokens = true;
    if (child.symbol === SYM_ERROR) {
      self.fragileLeft = true;
      self.fragileRight = true;
      self.parseState = STATE_NONE;
    }
    if (!child.extra) structuralIndex++;
  }
  if (isErrorParent) self.cost += errorExtentCost(self.size, self.sizeRows);
  if (n > 0) {
    const first = children[0] as Subtree;
    const last = children[n - 1] as Subtree;
    self.firstLeafSymbol = leafSymbol(first);
    self.firstLeafParseState = leafParseState(first);
    if (first.fragileLeft) self.fragileLeft = true;
    if (last.fragileRight) self.fragileRight = true;
  }
}

export function newNode(
  lang: Language,
  symbol: number,
  children: Subtree[],
  productionId: number,
): Subtree {
  const flags = symbolFlags(lang, symbol);
  const t = new Subtree(
    symbol,
    0,
    (flags & FLAG_VISIBLE) !== 0,
    (flags & FLAG_NAMED) !== 0,
  );
  const fragile = symbol === SYM_ERROR || symbol === SYM_ERROR_REPEAT;
  t.fragileLeft = fragile;
  t.fragileRight = fragile;
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
  t.extra = extra;
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
  return t?.hasExternalTokens && t.children.length === 0
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
  if (!tree.hasExternalTokens) return null;
  let t = tree;
  while (t.children.length > 0) {
    for (let i = t.children.length - 1; i >= 0; i--) {
      const child = t.children[i] as Subtree;
      if (child.hasExternalTokens) {
        t = child;
        break;
      }
    }
  }
  return t;
}

/** Moves the trailing extras of `self` into a new array, in their original order. */
export function removeTrailingExtras(self: Subtree[]): Subtree[] {
  const out: Subtree[] = [];
  while (self.length > 0 && (self[self.length - 1] as Subtree).extra)
    out.push(self.pop() as Subtree);
  out.reverse();
  return out;
}

export function nodeCountOf(t: Subtree): number {
  let count = t.children.length === 0 ? 0 : t.visibleDescendantCount;
  if (t.visible) count++;
  if (t.symbol === SYM_ERROR_REPEAT) count++;
  return count;
}
