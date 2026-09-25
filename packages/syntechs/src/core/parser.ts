// Port of tree-sitter v0.27.0 lib/src/parser.c for a full parse of one string: GLR with the same version
// limits, dynamic precedence and error-recovery cost model. Left out: incremental reuse, included ranges,
// cancellation, and tree balancing (balancing only reshapes hidden repetition nodes, never visible structure).

import {
  ACTION_ACCEPT,
  ACTION_RECOVER,
  ACTION_REDUCE,
  ACTION_SHIFT,
  actionCount,
  hasActions,
  hasReduceAction,
  isReservedWord,
  isReusable,
  type Language,
  nextState,
  STATE_NONE,
  SYM_END,
  SYM_ERROR,
  SYM_ERROR_REPEAT,
  tableEntry,
} from "./language.js";
import { type ExternalScanner, Lexer } from "./lexer.js";
import { Stack, type StackSlice } from "./stack.js";
import {
  bytesEqual,
  COST_PER_SKIPPED_CHAR,
  COST_PER_SKIPPED_LINE,
  COST_PER_SKIPPED_TREE,
  cloneLeaf,
  compareSubtrees,
  EMPTY_STATE,
  errorCost,
  externalScannerState,
  externalStateEq,
  lastExternalToken,
  leafParseState,
  leafSymbol,
  newError,
  newErrorNode,
  newLeaf,
  newMissingLeaf,
  newNode,
  nodeDynamicPrecedence,
  removeTrailingExtras,
  type Subtree,
  setSymbol,
  totalRows,
  totalSize,
} from "./subtree.js";

const MAX_VERSION_COUNT = 6;
const MAX_VERSION_COUNT_OVERFLOW = 4;
const MAX_SUMMARY_DEPTH = 16;
const MAX_COST_DIFFERENCE = 18 * COST_PER_SKIPPED_TREE;
const ERROR_STATE = 0;
const NO_VERSION = -1;

const TAKE_LEFT = 0;
const PREFER_LEFT = 1;
const COMPARISON_NONE = 2;
const PREFER_RIGHT = 3;
const TAKE_RIGHT = 4;

interface ErrorStatus {
  cost: number;
  nodeCount: number;
  dynamicPrecedence: number;
  isInError: boolean;
}

interface ReduceAction {
  symbol: number;
  count: number;
  dynamicPrecedence: number;
  productionId: number;
}

function compareVersions(a: ErrorStatus, b: ErrorStatus): number {
  if (!a.isInError && b.isInError)
    return a.cost < b.cost ? TAKE_LEFT : PREFER_LEFT;
  if (a.isInError && !b.isInError)
    return b.cost < a.cost ? TAKE_RIGHT : PREFER_RIGHT;
  if (a.cost < b.cost)
    return (b.cost - a.cost) * (1 + a.nodeCount) > MAX_COST_DIFFERENCE
      ? TAKE_LEFT
      : PREFER_LEFT;
  if (b.cost < a.cost)
    return (a.cost - b.cost) * (1 + b.nodeCount) > MAX_COST_DIFFERENCE
      ? TAKE_RIGHT
      : PREFER_RIGHT;
  if (a.dynamicPrecedence > b.dynamicPrecedence) return PREFER_LEFT;
  if (b.dynamicPrecedence > a.dynamicPrecedence) return PREFER_RIGHT;
  return COMPARISON_NONE;
}

/** Parses `text` from scratch and returns the root subtree, as `ts_parser_parse` would before balancing. */
export function parseSubtree(lang: Language, text: string): Subtree {
  return new Parser(lang, text).parse();
}

class Parser {
  private readonly lexer = new Lexer();
  private readonly stack = new Stack();
  private readonly scanner: ExternalScanner | undefined;
  private readonly scanBuffer = new Uint8Array(1024);
  private readonly validTokens: Uint8Array[] = [];
  private finishedTree: Subtree | null = null;
  private acceptCount = 0;
  private cacheToken: Subtree | null = null;
  private cachePosition = 0;
  private cacheLastExternal: Subtree | null = null;
  private reduceActions: ReduceAction[] = [];

  constructor(
    private readonly lang: Language,
    text: string,
  ) {
    this.lexer.setInput(text);
    this.scanner = lang.createScanner?.();
    const n = lang.externalTokenCount;
    for (let s = 0; s * n < lang.externalStates.length; s++)
      this.validTokens.push(lang.externalStates.subarray(s * n, s * n + n));
  }

  parse(): Subtree {
    const stack = this.stack;
    let lastPosition = 0;
    let versionCount = 0;
    do {
      // The version count is re-read each iteration: advancing a version can split or remove versions.
      // The loop condition is checked against the count read before condensing, as parser.c does.
      for (let version = 0; ; version++) {
        versionCount = stack.versionCount();
        if (version >= versionCount) break;
        while (stack.isActive(version)) {
          this.advance(version);
          const position = stack.position(version);
          if (
            position > lastPosition ||
            (version > 0 && position === lastPosition)
          ) {
            lastPosition = position;
            break;
          }
        }
      }
      const minErrorCost = this.condenseStack();
      if (
        this.finishedTree !== null &&
        errorCost(this.finishedTree) < minErrorCost
      ) {
        stack.clear();
        break;
      }
    } while (versionCount !== 0);
    if (this.finishedTree === null)
      throw new Error("tree-sitter port finished without a tree");
    return this.finishedTree;
  }

  // ---- version bookkeeping ---------------------------------------------------------------------------------

  private versionStatus(version: number): ErrorStatus {
    const stack = this.stack;
    let cost = stack.errorCost(version);
    const isPaused = stack.isPaused(version);
    if (isPaused) cost += COST_PER_SKIPPED_TREE;
    return {
      cost,
      nodeCount: stack.nodeCountSinceError(version),
      dynamicPrecedence: stack.dynamicPrecedence(version),
      isInError: isPaused || stack.state(version) === ERROR_STATE,
    };
  }

  private betterVersionExists(
    version: number,
    isInError: boolean,
    cost: number,
  ): boolean {
    if (this.finishedTree !== null && errorCost(this.finishedTree) <= cost)
      return true;
    const stack = this.stack;
    const position = stack.position(version);
    const status: ErrorStatus = {
      cost,
      isInError,
      dynamicPrecedence: stack.dynamicPrecedence(version),
      nodeCount: stack.nodeCountSinceError(version),
    };
    for (let i = 0, n = stack.versionCount(); i < n; i++) {
      if (i === version || !stack.isActive(i) || stack.position(i) < position)
        continue;
      const statusI = this.versionStatus(i);
      switch (compareVersions(status, statusI)) {
        case TAKE_RIGHT:
          return true;
        case PREFER_RIGHT:
          if (stack.canMerge(i, version)) return true;
          break;
      }
    }
    return false;
  }

  // ---- lexing ----------------------------------------------------------------------------------------------

  private canReuseFirstLeaf(
    state: number,
    tree: Subtree,
    entry: number,
  ): boolean {
    const lang = this.lang;
    const leafSym = leafSymbol(tree);
    const leafState = leafParseState(tree);
    const currentLexState = lang.lexState[state] as number;
    const currentExternal = lang.externalLexState[state] as number;
    if (currentLexState === STATE_NONE) return false;
    if (
      actionCount(lang, entry) > 0 &&
      lang.lexState[leafState] === currentLexState &&
      lang.externalLexState[leafState] === currentExternal &&
      (leafSym !== lang.keywordCaptureToken ||
        (!tree.isKeyword && tree.parseState === state))
    ) {
      return true;
    }
    if (tree.size === 0 && leafSym !== SYM_END) return false;
    return currentExternal === 0 && isReusable(lang, entry);
  }

  private lex(version: number, parseState: number): Subtree | null {
    const lang = this.lang;
    const lexer = this.lexer;
    const stack = this.stack;
    let lexState = lang.lexState[parseState] as number;
    let externalLexState = lang.externalLexState[parseState] as number;
    if (lexState === STATE_NONE) return null;
    const startPosition = stack.position(version);
    const startRow = stack.row(version);
    const externalToken = stack.lastExternalToken(version);
    let foundExternalToken = false;
    let errorMode = parseState === ERROR_STATE;
    let skippedError = false;
    let errorStart = 0;
    let errorStartRow = 0;
    let errorEnd = 0;
    let errorEndRow = 0;
    let externalState: Uint8Array = EMPTY_STATE;
    let externalStateChanged = false;
    lexer.reset(startPosition, startRow);
    for (;;) {
      let foundToken = false;
      const currentPosition = lexer.pos;
      const currentRow = lexer.row;
      if (externalLexState !== 0 && this.scanner !== undefined) {
        const scanner = this.scanner;
        lexer.start();
        const previous = externalToken?.externalState ?? EMPTY_STATE;
        scanner.deserialize(previous, previous.length);
        foundToken = scanner.scan(
          lexer,
          this.validTokens[externalLexState] as Uint8Array,
        );
        lexer.finish();
        if (foundToken) {
          const length = scanner.serialize(this.scanBuffer);
          externalState = this.scanBuffer.slice(0, length);
          externalStateChanged = !bytesEqual(
            externalScannerState(externalToken),
            externalState,
          );
          if (lexer.tokenEnd <= currentPosition && !externalStateChanged) {
            const symbol = lang.externalSymbolMap[lexer.resultSymbol] as number;
            const nextParseState = nextState(lang, parseState, symbol);
            const tokenIsExtra = nextParseState === parseState;
            if (
              errorMode ||
              !stack.hasAdvancedSinceError(version) ||
              tokenIsExtra
            )
              foundToken = false;
          }
        }
        if (foundToken) {
          foundExternalToken = true;
          break;
        }
        lexer.reset(currentPosition, currentRow);
      }
      lexer.start();
      foundToken = lang.lex(lexer, lexState);
      lexer.finish();
      if (foundToken) break;
      if (!errorMode) {
        errorMode = true;
        lexState = lang.lexState[ERROR_STATE] as number;
        externalLexState = lang.externalLexState[ERROR_STATE] as number;
        lexer.reset(startPosition, startRow);
        continue;
      }
      if (!skippedError) {
        skippedError = true;
        errorStart = lexer.tokenStart;
        errorStartRow = lexer.tokenStartRow;
        errorEnd = errorStart;
        errorEndRow = errorStartRow;
      }
      if (lexer.pos === errorEnd) {
        if (lexer.eof()) {
          lexer.resultSymbol = SYM_ERROR;
          break;
        }
        lexer.advance(false);
      }
      errorEnd = lexer.pos;
      errorEndRow = lexer.row;
    }

    if (skippedError) {
      return newError(
        lang,
        errorStart - startPosition,
        rowsBetween(errorStartRow, startRow),
        errorEnd - errorStart,
        rowsBetween(errorEndRow, errorStartRow),
        parseState,
      );
    }
    let isKeyword = false;
    let symbol = lexer.resultSymbol;
    const tokenStart = lexer.tokenStart;
    const tokenStartRow = lexer.tokenStartRow;
    const tokenEnd = lexer.tokenEnd;
    const tokenEndRow = lexer.tokenEndRow;
    if (foundExternalToken) {
      symbol = lang.externalSymbolMap[symbol] as number;
    } else if (
      symbol === lang.keywordCaptureToken &&
      symbol !== 0 &&
      lang.keywordLex !== undefined
    ) {
      lexer.reset(tokenStart, tokenStartRow);
      lexer.start();
      isKeyword = lang.keywordLex(lexer, 0);
      if (
        isKeyword &&
        lexer.tokenEnd === tokenEnd &&
        (hasActions(lang, parseState, lexer.resultSymbol) ||
          isReservedWord(lang, parseState, lexer.resultSymbol))
      ) {
        symbol = lexer.resultSymbol;
      }
    }
    const result = newLeaf(
      lang,
      symbol,
      tokenStart - startPosition,
      rowsBetween(tokenStartRow, startRow),
      tokenEnd - tokenStart,
      rowsBetween(tokenEndRow, tokenStartRow),
      parseState,
      foundExternalToken,
      isKeyword,
    );
    if (foundExternalToken) {
      result.externalState = externalState;
      result.hasExternalScannerStateChange = externalStateChanged;
    }
    return result;
  }

  private getCachedToken(
    state: number,
    position: number,
    lastExternal: Subtree | null,
  ): { token: Subtree; entry: number } | null {
    const token = this.cacheToken;
    if (
      token !== null &&
      this.cachePosition === position &&
      externalStateEq(this.cacheLastExternal, lastExternal)
    ) {
      const entry = tableEntry(this.lang, state, token.symbol);
      if (this.canReuseFirstLeaf(state, token, entry)) return { token, entry };
    }
    return null;
  }

  // ---- actions ---------------------------------------------------------------------------------------------

  private selectTree(left: Subtree | null, right: Subtree | null): boolean {
    if (left === null) return true;
    if (right === null) return false;
    if (errorCost(right) < errorCost(left)) return true;
    if (errorCost(left) < errorCost(right)) return false;
    if (nodeDynamicPrecedence(right) > nodeDynamicPrecedence(left)) return true;
    if (nodeDynamicPrecedence(left) > nodeDynamicPrecedence(right))
      return false;
    if (errorCost(left) > 0) return true;
    return compareSubtrees(left, right) === 1;
  }

  private selectChildren(left: Subtree, children: Subtree[]): boolean {
    const scratch = newNode(this.lang, left.symbol, children.slice(), 0);
    return this.selectTree(left, scratch);
  }

  private shift(
    version: number,
    state: number,
    lookahead: Subtree,
    extra: boolean,
  ): void {
    const isLeaf = lookahead.children.length === 0;
    let subtree = lookahead;
    if (extra !== lookahead.extra && isLeaf) {
      subtree = cloneLeaf(lookahead);
      subtree.extra = extra;
    }
    this.stack.push(version, subtree, !isLeaf, state);
    if (subtree.hasExternalTokens)
      this.stack.setLastExternalToken(version, lastExternalToken(subtree));
  }

  private reduce(
    version: number,
    symbol: number,
    count: number,
    dynamicPrecedence: number,
    productionId: number,
    isFragile: boolean,
    endOfNonTerminalExtra: boolean,
  ): number {
    const lang = this.lang;
    const stack = this.stack;
    const initialVersionCount = stack.versionCount();
    const pop = stack.popCount(version, count);
    let removedVersionCount = 0;
    const haltedVersionCount = stack.haltedVersionCount();
    for (let i = 0; i < pop.length; i++) {
      const slice = pop[i] as StackSlice;
      const sliceVersion = slice.version - removedVersionCount;
      if (
        sliceVersion >
        MAX_VERSION_COUNT + MAX_VERSION_COUNT_OVERFLOW + haltedVersionCount
      ) {
        stack.removeVersion(sliceVersion);
        removedVersionCount++;
        while (i + 1 < pop.length) {
          if ((pop[i + 1] as StackSlice).version !== slice.version) break;
          i++;
        }
        continue;
      }
      const children = slice.subtrees;
      let trailingExtras = removeTrailingExtras(children);
      let parent = newNode(lang, symbol, children, productionId);
      while (i + 1 < pop.length) {
        const next = pop[i + 1] as StackSlice;
        if (next.version !== slice.version) break;
        i++;
        const nextChildren = next.subtrees;
        const nextTrailingExtras = removeTrailingExtras(nextChildren);
        if (this.selectChildren(parent, nextChildren)) {
          trailingExtras = nextTrailingExtras;
          parent = newNode(lang, symbol, nextChildren, productionId);
        }
      }
      const state = stack.state(sliceVersion);
      const next = nextState(lang, state, symbol);
      if (endOfNonTerminalExtra && next === state) parent.extra = true;
      if (isFragile || pop.length > 1 || initialVersionCount > 1) {
        parent.fragileLeft = true;
        parent.fragileRight = true;
        parent.parseState = STATE_NONE;
      } else {
        parent.parseState = state;
      }
      parent.dynamicPrecedence += dynamicPrecedence;
      stack.push(sliceVersion, parent, false, next);
      for (const extra of trailingExtras)
        stack.push(sliceVersion, extra, false, next);
      for (let j = 0; j < sliceVersion; j++) {
        if (j === version) continue;
        if (stack.merge(j, sliceVersion)) {
          removedVersionCount++;
          break;
        }
      }
    }
    return stack.versionCount() > initialVersionCount
      ? initialVersionCount
      : NO_VERSION;
  }

  private accept(version: number, lookahead: Subtree): void {
    const stack = this.stack;
    stack.push(version, lookahead, false, 1);
    const pop = stack.popAll(version);
    for (const slice of pop) {
      const trees = slice.subtrees;
      let root: Subtree | null = null;
      for (let j = trees.length - 1; j >= 0; j--) {
        const tree = trees[j] as Subtree;
        if (!tree.extra) {
          trees.splice(j, 1, ...tree.children);
          root = newNode(this.lang, tree.symbol, trees, tree.productionId);
          break;
        }
      }
      if (root === null) throw new Error("accepted a stack slice with no root");
      this.acceptCount++;
      if (this.finishedTree !== null) {
        if (this.selectTree(this.finishedTree, root)) this.finishedTree = root;
      } else {
        this.finishedTree = root;
      }
    }
    stack.removeVersion((pop[0] as StackSlice).version);
    stack.halt(version);
  }

  private addCandidateActions(entry: number): boolean {
    const lang = this.lang;
    let hasShiftAction = false;
    const count = actionCount(lang, entry);
    for (let a = entry + 1; a <= entry + count; a++) {
      const type = lang.actType[a];
      if (type === ACTION_SHIFT || type === ACTION_RECOVER) {
        // A recover action's shift fields are zero, as in C's union.
        if (type === ACTION_RECOVER || ((lang.actB[a] as number) & 3) === 0)
          hasShiftAction = true;
      } else if (type === ACTION_REDUCE) {
        const childCount = lang.actB[a] as number;
        if (childCount > 0) {
          const symbol = lang.actA[a] as number;
          if (
            !this.reduceActions.some(
              (r) => r.symbol === symbol && r.count === childCount,
            )
          ) {
            this.reduceActions.push({
              symbol,
              count: childCount,
              dynamicPrecedence: lang.actC[a] as number,
              productionId: lang.actD[a] as number,
            });
          }
        }
      }
    }
    return hasShiftAction;
  }

  private doAllPotentialReductions(
    startingVersion: number,
    lookaheadSymbol: number,
  ): boolean {
    const lang = this.lang;
    const stack = this.stack;
    const initialVersionCount = stack.versionCount();
    let canShiftLookaheadSymbol = false;
    let version = startingVersion;
    for (let i = 0; ; i++) {
      const versionCount = stack.versionCount();
      if (version >= versionCount) break;
      let merged = false;
      for (let j = initialVersionCount; j < version; j++) {
        if (stack.merge(j, version)) {
          merged = true;
          break;
        }
      }
      if (merged) continue;
      const state = stack.state(version);
      let hasShiftAction = false;
      this.reduceActions = [];
      if (lookaheadSymbol !== 0) {
        hasShiftAction = this.addCandidateActions(
          tableEntry(lang, state, lookaheadSymbol),
        );
      } else {
        forEachTokenLookahead(lang, state, (entry) => {
          if (this.addCandidateActions(entry)) hasShiftAction = true;
        });
        // Stable insertion sort by symbol, descending.
        const actions = this.reduceActions;
        for (let j = 1; j < actions.length; j++) {
          const key = actions[j] as ReduceAction;
          let k = j - 1;
          while (k >= 0 && (actions[k] as ReduceAction).symbol < key.symbol) {
            actions[k + 1] = actions[k] as ReduceAction;
            k--;
          }
          actions[k + 1] = key;
        }
      }
      let reductionVersion = NO_VERSION;
      for (const action of this.reduceActions) {
        reductionVersion = this.reduce(
          version,
          action.symbol,
          action.count,
          action.dynamicPrecedence,
          action.productionId,
          true,
          false,
        );
      }
      if (hasShiftAction) {
        canShiftLookaheadSymbol = true;
      } else if (reductionVersion !== NO_VERSION && i < MAX_VERSION_COUNT) {
        stack.renumberVersion(reductionVersion, version);
        continue;
      } else if (lookaheadSymbol !== 0) {
        stack.removeVersion(version);
      }
      if (version === startingVersion) version = versionCount;
      else version++;
    }
    return canShiftLookaheadSymbol;
  }

  private recoverToState(
    version: number,
    depth: number,
    goalState: number,
  ): boolean {
    const lang = this.lang;
    const stack = this.stack;
    const pop = stack.popCount(version, depth);
    let previousVersion = NO_VERSION;
    for (let i = 0; i < pop.length; i++) {
      const slice = pop[i] as StackSlice;
      if (slice.version === previousVersion) {
        pop.splice(i--, 1);
        continue;
      }
      if (stack.state(slice.version) !== goalState) {
        stack.halt(slice.version);
        pop.splice(i--, 1);
        continue;
      }
      const errorTrees = stack.popError(slice.version);
      if (errorTrees.length > 0) {
        const errorTree = errorTrees[0] as Subtree;
        if (errorTree.children.length > 0) {
          slice.subtrees.unshift(
            newNode(lang, SYM_ERROR_REPEAT, errorTree.children.slice(), 0),
          );
        }
      }
      const trailingExtras = removeTrailingExtras(slice.subtrees);
      if (slice.subtrees.length > 0) {
        stack.push(
          slice.version,
          newErrorNode(lang, slice.subtrees, true),
          false,
          goalState,
        );
      }
      for (const tree of trailingExtras)
        stack.push(slice.version, tree, false, goalState);
      previousVersion = slice.version;
    }
    return previousVersion !== NO_VERSION;
  }

  private recover(version: number, lookahead: Subtree): void {
    const lang = this.lang;
    const stack = this.stack;
    let didRecover = false;
    const previousVersionCount = stack.versionCount();
    const position = stack.position(version);
    const row = stack.row(version);
    const summary = stack.summary(version);
    const nodeCountSinceError = stack.nodeCountSinceError(version);
    const currentErrorCost = stack.errorCost(version);

    if (summary !== null && lookahead.symbol !== SYM_ERROR) {
      for (const entry of summary) {
        if (entry.state === ERROR_STATE) continue;
        if (entry.position === position) continue;
        let depth = entry.depth;
        if (nodeCountSinceError > 0) depth++;
        let wouldMerge = false;
        for (let j = 0; j < previousVersionCount; j++) {
          if (
            stack.state(j) === entry.state &&
            stack.position(j) === position
          ) {
            wouldMerge = true;
            break;
          }
        }
        if (wouldMerge) continue;
        const newCost =
          currentErrorCost +
          entry.depth * COST_PER_SKIPPED_TREE +
          (position - entry.position) * 2 * COST_PER_SKIPPED_CHAR +
          (row - entry.row) * COST_PER_SKIPPED_LINE;
        if (this.betterVersionExists(version, false, newCost)) break;
        if (hasActions(lang, entry.state, lookahead.symbol)) {
          if (this.recoverToState(version, depth, entry.state)) {
            didRecover = true;
            break;
          }
        }
      }
    }

    for (let i = previousVersionCount; i < stack.versionCount(); i++) {
      if (!stack.isActive(i)) stack.removeVersion(i--);
    }

    if (lookahead.symbol === SYM_END) {
      stack.push(version, newErrorNode(lang, [], false), false, 1);
      this.accept(version, lookahead);
      return;
    }

    if (didRecover && stack.versionCount() > MAX_VERSION_COUNT) {
      stack.halt(version);
      return;
    }
    if (didRecover && lookahead.hasExternalScannerStateChange) {
      stack.halt(version);
      return;
    }

    const newCost =
      currentErrorCost +
      COST_PER_SKIPPED_TREE +
      totalSize(lookahead) * 2 * COST_PER_SKIPPED_CHAR +
      totalRows(lookahead) * COST_PER_SKIPPED_LINE;
    if (this.betterVersionExists(version, false, newCost)) {
      stack.halt(version);
      return;
    }

    let la = lookahead;
    const entry = tableEntry(lang, 1, la.symbol);
    const n = actionCount(lang, entry);
    if (
      n > 0 &&
      lang.actType[entry + n] === ACTION_SHIFT &&
      ((lang.actB[entry + n] as number) & 1) !== 0
    ) {
      la = cloneLeaf(la);
      la.extra = true;
    }

    let errorRepeat = newNode(lang, SYM_ERROR_REPEAT, [la], 0);
    if (nodeCountSinceError > 0) {
      const pop = stack.popCount(version, 1);
      const first = pop[0] as StackSlice;
      if (pop.length > 1) {
        while (stack.versionCount() > first.version + 1)
          stack.removeVersion(first.version + 1);
      }
      stack.renumberVersion(first.version, version);
      first.subtrees.push(errorRepeat);
      errorRepeat = newNode(lang, SYM_ERROR_REPEAT, first.subtrees, 0);
    }

    stack.push(version, errorRepeat, false, ERROR_STATE);
    if (la.hasExternalTokens)
      stack.setLastExternalToken(version, lastExternalToken(la));
  }

  private handleError(version: number, lookahead: Subtree | null): void {
    const lang = this.lang;
    const stack = this.stack;
    const previousVersionCount = stack.versionCount();
    this.doAllPotentialReductions(version, 0);
    const versionCount = stack.versionCount();
    const position = stack.position(version);
    const row = stack.row(version);
    // A paused version always holds a lookahead: only `advance` pauses, and only after lexing.
    const la = lookahead as Subtree;

    let didInsertMissingToken = false;
    for (let v = version; v < versionCount; ) {
      if (!didInsertMissingToken) {
        const state = stack.state(v);
        for (
          let missingSymbol = 1;
          missingSymbol < lang.tokenCount;
          missingSymbol++
        ) {
          const stateAfterMissing = nextState(lang, state, missingSymbol);
          if (stateAfterMissing === 0 || stateAfterMissing === state) continue;
          if (hasReduceAction(lang, stateAfterMissing, leafSymbol(la))) {
            this.lexer.reset(position, row);
            this.lexer.markEnd();
            const withMissing = stack.copyVersion(v);
            const missing = newMissingLeaf(lang, missingSymbol, state, 0, 0);
            stack.push(withMissing, missing, false, stateAfterMissing);
            if (this.doAllPotentialReductions(withMissing, leafSymbol(la))) {
              didInsertMissingToken = true;
              break;
            }
          }
        }
      }
      stack.push(v, null, false, ERROR_STATE);
      v = v === version ? previousVersionCount : v + 1;
    }

    for (let i = previousVersionCount; i < versionCount; i++) {
      if (!stack.merge(version, previousVersionCount))
        throw new Error("handle_error failed to merge a version it created");
    }

    stack.recordSummary(version, MAX_SUMMARY_DEPTH);
    this.recover(version, la);
  }

  private advance(version: number): void {
    const lang = this.lang;
    const stack = this.stack;
    let state = stack.state(version);
    const position = stack.position(version);
    const lastExternal = stack.lastExternalToken(version);
    let lookahead: Subtree | null = null;
    let entry = 0;
    const cached = this.getCachedToken(state, position, lastExternal);
    let needsLex = cached === null;
    if (cached !== null) {
      lookahead = cached.token;
      entry = cached.entry;
    }

    for (;;) {
      if (needsLex) {
        needsLex = false;
        lookahead = this.lex(version, state);
        if (lookahead !== null) {
          this.cacheToken = lookahead;
          this.cachePosition = position;
          this.cacheLastExternal = lastExternal;
          entry = tableEntry(lang, state, lookahead.symbol);
        } else {
          entry = tableEntry(lang, state, SYM_END);
        }
      }

      let didReduce = false;
      let lastReductionVersion = NO_VERSION;
      const count = actionCount(lang, entry);
      for (let a = entry + 1; a <= entry + count; a++) {
        const type = lang.actType[a];
        if (type === ACTION_SHIFT) {
          const flags = lang.actB[a] as number;
          if ((flags & 2) !== 0) continue;
          const extra = (flags & 1) !== 0;
          const next = extra ? state : (lang.actA[a] as number);
          this.shift(version, next, lookahead as Subtree, extra);
          return;
        }
        if (type === ACTION_REDUCE) {
          const isFragile = count > 1;
          const endOfNonTerminalExtra = lookahead === null;
          const reductionVersion = this.reduce(
            version,
            lang.actA[a] as number,
            lang.actB[a] as number,
            lang.actC[a] as number,
            lang.actD[a] as number,
            isFragile,
            endOfNonTerminalExtra,
          );
          didReduce = true;
          if (reductionVersion !== NO_VERSION)
            lastReductionVersion = reductionVersion;
        } else if (type === ACTION_ACCEPT) {
          this.accept(version, lookahead as Subtree);
          return;
        } else if (type === ACTION_RECOVER) {
          this.recover(version, lookahead as Subtree);
          return;
        }
      }

      if (lastReductionVersion !== NO_VERSION) {
        stack.renumberVersion(lastReductionVersion, version);
        state = stack.state(version);
        if (lookahead === null) needsLex = true;
        else entry = tableEntry(lang, state, leafSymbol(lookahead));
        continue;
      }

      if (didReduce) {
        stack.halt(version);
        return;
      }

      if (
        lookahead?.isKeyword &&
        lookahead.symbol !== lang.keywordCaptureToken &&
        !isReservedWord(lang, state, lookahead.symbol)
      ) {
        entry = tableEntry(lang, state, lang.keywordCaptureToken);
        if (actionCount(lang, entry) > 0) {
          lookahead = cloneLeaf(lookahead);
          setSymbol(lang, lookahead, lang.keywordCaptureToken);
          continue;
        }
      }

      if (state === ERROR_STATE) {
        this.recover(version, lookahead as Subtree);
        return;
      }

      if (this.breakdownTopOfStack(version)) {
        state = stack.state(version);
        needsLex = true;
        continue;
      }

      stack.pause(version, lookahead);
      return;
    }
  }

  private breakdownTopOfStack(version: number): boolean {
    const lang = this.lang;
    const stack = this.stack;
    let didBreakDown = false;
    let pending = false;
    do {
      const pop = stack.popPending(version);
      if (pop.length === 0) break;
      didBreakDown = true;
      pending = false;
      for (const slice of pop) {
        let state = stack.state(slice.version);
        const parent = slice.subtrees[0] as Subtree;
        for (const child of parent.children) {
          pending = child.children.length > 0;
          if (child.symbol === SYM_ERROR) state = ERROR_STATE;
          else if (!child.extra) state = nextState(lang, state, child.symbol);
          stack.push(slice.version, child, pending, state);
        }
        for (let j = 1; j < slice.subtrees.length; j++)
          stack.push(slice.version, slice.subtrees[j] as Subtree, false, state);
      }
    } while (pending);
    return didBreakDown;
  }

  private condenseStack(): number {
    const stack = this.stack;
    let minErrorCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stack.versionCount(); i++) {
      if (stack.isHalted(i)) {
        stack.removeVersion(i);
        i--;
        continue;
      }
      const statusI = this.versionStatus(i);
      if (!statusI.isInError && statusI.cost < minErrorCost)
        minErrorCost = statusI.cost;
      for (let j = 0; j < i; j++) {
        const statusJ = this.versionStatus(j);
        switch (compareVersions(statusJ, statusI)) {
          case TAKE_LEFT:
            stack.removeVersion(i);
            i--;
            j = i;
            break;
          case PREFER_LEFT:
          case COMPARISON_NONE:
            if (stack.merge(j, i)) {
              i--;
              j = i;
            }
            break;
          case PREFER_RIGHT:
            if (stack.merge(j, i)) {
              i--;
              j = i;
            } else {
              stack.swapVersions(i, j);
            }
            break;
          case TAKE_RIGHT:
            stack.removeVersion(j);
            i--;
            j--;
            break;
        }
      }
    }
    while (stack.versionCount() > MAX_VERSION_COUNT)
      stack.removeVersion(MAX_VERSION_COUNT);
    if (stack.versionCount() > 0) {
      let hasUnpausedVersion = false;
      for (let i = 0, n = stack.versionCount(); i < n; i++) {
        if (stack.isPaused(i)) {
          if (!hasUnpausedVersion && this.acceptCount < MAX_VERSION_COUNT) {
            minErrorCost = stack.errorCost(i);
            const lookahead = stack.resume(i);
            this.handleError(i, lookahead);
            hasUnpausedVersion = true;
          } else {
            stack.removeVersion(i);
            i--;
            n--;
          }
        } else {
          hasUnpausedVersion = true;
        }
      }
    }
    return minErrorCost;
  }
}

function rowsBetween(end: number, start: number): number {
  return end > start ? end - start : 0;
}

/** Calls `f` with the action entry of every terminal (other than end) valid in `state`, in C's iteration order. */
function forEachTokenLookahead(
  lang: Language,
  state: number,
  f: (entry: number) => void,
): void {
  const tokenCount = lang.tokenCount;
  if (state < lang.largeStateCount) {
    const row = state * lang.symbolCount;
    const table = lang.parseTable;
    for (let symbol = 1; symbol < tokenCount; symbol++) {
      const value = table[row + symbol] as number;
      if (value !== 0) f(value);
    }
    return;
  }
  const table = lang.smallTable;
  let i = lang.smallMap[state - lang.largeStateCount] as number;
  const groups = table[i++] as number;
  for (let g = 0; g < groups; g++) {
    const value = table[i++] as number;
    const count = table[i++] as number;
    for (let j = 0; j < count; j++) {
      const symbol = table[i++] as number;
      if (symbol !== SYM_END && symbol < tokenCount) f(value);
    }
  }
}
