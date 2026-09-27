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
import type { Tree } from "./arena.js";
import { Stack, type StackSlice } from "./stack.js";
import { DirectTree } from "./tree.js";
import {
  bytesEqual,
  COST_PER_SKIPPED_CHAR,
  COST_PER_SKIPPED_LINE,
  COST_PER_SKIPPED_TREE,
  EMPTY_STATE,
  EXTRA,
  FRAGILE_LEFT,
  FRAGILE_RIGHT,
  HAS_EXTERNAL_SCANNER_STATE_CHANGE,
  HAS_EXTERNAL_TOKENS,
  IS_KEYWORD,
  NONE,
  type Subtree,
  Subtrees,
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

/**
 * Parses `text` from scratch and returns the root subtree, as `ts_parser_parse` would before balancing, and
 * `buildTree`'s tree of it where the parse could build that as it went (see `DirectTree`), else null.
 */
export function parseSubtree(
  lang: Language,
  text: string,
): { subtrees: Subtrees; root: Subtree; tree: Tree | null } {
  const parser = new Parser(lang, text);
  const root = parser.parse();
  return {
    subtrees: parser.subtrees,
    root,
    tree: parser.direct.finish(root),
  };
}

class Parser {
  private readonly lexer = new Lexer();
  readonly subtrees: Subtrees;
  private readonly stack: Stack;
  private readonly scanner: ExternalScanner | undefined;
  private readonly scanBuffer = new Uint8Array(1024);
  private readonly validTokens: Uint8Array[] = [];
  private finishedTree: Subtree = NONE;
  private acceptCount = 0;
  private cacheToken: Subtree = NONE;
  private cachePosition = 0;
  private cacheLastExternal: Subtree = NONE;
  private reduceActions: ReduceAction[] = [];
  readonly direct: DirectTree;

  constructor(
    private readonly lang: Language,
    text: string,
  ) {
    this.subtrees = new Subtrees(lang, text.length);
    this.stack = new Stack(this.subtrees);
    this.direct = new DirectTree(this.subtrees, text);
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
            // Condensing a lone active version, with no finished tree to weigh it against, changes nothing.
            if (
              this.finishedTree === NONE &&
              stack.versionCount() === 1 &&
              stack.isActive(0)
            )
              continue;
            break;
          }
        }
      }
      const minErrorCost = this.condenseStack();
      if (
        this.finishedTree !== NONE &&
        this.subtrees.errorCost(this.finishedTree) < minErrorCost
      ) {
        stack.clear();
        break;
      }
    } while (versionCount !== 0);
    if (this.finishedTree === NONE)
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
    if (
      this.finishedTree !== NONE &&
      this.subtrees.errorCost(this.finishedTree) <= cost
    )
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
    const subtrees = this.subtrees;
    const leafSym = subtrees.leafSymbol(tree);
    const leafState = subtrees.leafParseState(tree);
    const currentLexState = lang.lexState[state] as number;
    const currentExternal = lang.externalLexState[state] as number;
    if (currentLexState === STATE_NONE) return false;
    if (
      actionCount(lang, entry) > 0 &&
      lang.lexState[leafState] === currentLexState &&
      lang.externalLexState[leafState] === currentExternal &&
      (leafSym !== lang.keywordCaptureToken ||
        (!subtrees.flag(tree, IS_KEYWORD) &&
          subtrees.parseState(tree) === state))
    ) {
      return true;
    }
    if (subtrees.size(tree) === 0 && leafSym !== SYM_END) return false;
    return currentExternal === 0 && isReusable(lang, entry);
  }

  private lex(version: number, parseState: number): Subtree {
    const lang = this.lang;
    const subtrees = this.subtrees;
    const lexer = this.lexer;
    const stack = this.stack;
    let lexState = lang.lexState[parseState] as number;
    let externalLexState = lang.externalLexState[parseState] as number;
    if (lexState === STATE_NONE) return NONE;
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
        const previous = subtrees.externalStateOf(externalToken);
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
            subtrees.externalScannerState(externalToken),
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
      this.direct.fail();
      return subtrees.newError(
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
    const result = subtrees.newLeaf(
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
      subtrees.setExternalState(result, externalState);
      subtrees.setFlag(
        result,
        HAS_EXTERNAL_SCANNER_STATE_CHANGE,
        externalStateChanged,
      );
    }
    return result;
  }

  private getCachedToken(
    state: number,
    position: number,
    lastExternal: Subtree,
  ): { token: Subtree; entry: number } | null {
    const token = this.cacheToken;
    if (
      token !== NONE &&
      this.cachePosition === position &&
      this.subtrees.externalStateEq(this.cacheLastExternal, lastExternal)
    ) {
      const entry = tableEntry(this.lang, state, this.subtrees.symbol(token));
      if (this.canReuseFirstLeaf(state, token, entry)) return { token, entry };
    }
    return null;
  }

  // ---- actions ---------------------------------------------------------------------------------------------

  private selectTree(left: Subtree, right: Subtree): boolean {
    const subtrees = this.subtrees;
    if (left === NONE) return true;
    if (right === NONE) return false;
    if (subtrees.errorCost(right) < subtrees.errorCost(left)) return true;
    if (subtrees.errorCost(left) < subtrees.errorCost(right)) return false;
    if (
      subtrees.nodeDynamicPrecedence(right) >
      subtrees.nodeDynamicPrecedence(left)
    )
      return true;
    if (
      subtrees.nodeDynamicPrecedence(left) >
      subtrees.nodeDynamicPrecedence(right)
    )
      return false;
    if (subtrees.errorCost(left) > 0) return true;
    return subtrees.compare(left, right) === 1;
  }

  private selectChildren(left: Subtree, children: Subtree[]): boolean {
    const subtrees = this.subtrees;
    const scratch = subtrees.newNode(subtrees.symbol(left), children, 0);
    const selected = this.selectTree(left, scratch);
    subtrees.release(scratch);
    return selected;
  }

  private shift(
    version: number,
    state: number,
    lookahead: Subtree,
    extra: boolean,
  ): void {
    const subtrees = this.subtrees;
    const isLeaf = subtrees.childCount(lookahead) === 0;
    let subtree = lookahead;
    if (extra !== subtrees.flag(lookahead, EXTRA) && isLeaf) {
      subtree = subtrees.cloneLeaf(lookahead);
      subtrees.setFlag(subtree, EXTRA, extra);
    }
    this.direct.shift(
      subtree,
      this.stack.position(version),
      this.stack.versionCount(),
    );
    this.stack.push(version, subtree, !isLeaf, state);
    if (subtrees.flag(subtree, HAS_EXTERNAL_TOKENS))
      this.stack.setLastExternalToken(
        version,
        subtrees.lastExternalToken(subtree),
      );
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
    const subtrees = this.subtrees;
    const stack = this.stack;
    this.direct.defer();
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
      let trailingExtras = subtrees.removeTrailingExtras(children);
      let parent = subtrees.newNode(symbol, children, productionId);
      while (i + 1 < pop.length) {
        const next = pop[i + 1] as StackSlice;
        if (next.version !== slice.version) break;
        i++;
        const nextChildren = next.subtrees;
        const nextTrailingExtras = subtrees.removeTrailingExtras(nextChildren);
        if (this.selectChildren(parent, nextChildren)) {
          trailingExtras = nextTrailingExtras;
          parent = subtrees.newNode(symbol, nextChildren, productionId);
        }
      }
      const state = stack.state(sliceVersion);
      const next = nextState(lang, state, symbol);
      if (endOfNonTerminalExtra && next === state)
        subtrees.setFlag(parent, EXTRA, true);
      if (isFragile || pop.length > 1 || initialVersionCount > 1) {
        subtrees.setFlag(parent, FRAGILE_LEFT | FRAGILE_RIGHT, true);
        subtrees.setParseState(parent, STATE_NONE);
      } else {
        subtrees.setParseState(parent, state);
      }
      subtrees.addDynamicPrecedence(parent, dynamicPrecedence);
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

  /**
   * `reduce` for the only version's only effective action, when no stack node it pops through forks: one
   * slice, no new version, nothing to merge. False, with nothing changed, otherwise.
   */
  private reduceLinear(
    symbol: number,
    count: number,
    dynamicPrecedence: number,
    productionId: number,
    isFragile: boolean,
    endOfNonTerminalExtra: boolean,
  ): boolean {
    const stack = this.stack;
    const children = stack.popLinear(count);
    if (children === null) return false;
    const lang = this.lang;
    const subtrees = this.subtrees;
    const trailingExtras = subtrees.removeTrailingExtras(children);
    const parent = subtrees.newNode(symbol, children, productionId);
    const state = stack.state(0);
    const next = nextState(lang, state, symbol);
    if (endOfNonTerminalExtra && next === state)
      subtrees.setFlag(parent, EXTRA, true);
    if (isFragile) {
      subtrees.setFlag(parent, FRAGILE_LEFT | FRAGILE_RIGHT, true);
      subtrees.setParseState(parent, STATE_NONE);
    } else {
      subtrees.setParseState(parent, state);
    }
    subtrees.addDynamicPrecedence(parent, dynamicPrecedence);
    this.direct.reduce(parent, children, stack.position(0));
    stack.push(0, parent, false, next);
    for (let i = 0; i < trailingExtras.length; i++)
      stack.push(0, trailingExtras[i] as Subtree, false, next);
    return true;
  }

  private accept(version: number, lookahead: Subtree): void {
    const subtrees = this.subtrees;
    const stack = this.stack;
    stack.push(version, lookahead, false, 1);
    const pop = stack.popAll(version);
    for (const slice of pop) {
      const trees = slice.subtrees;
      let root = NONE;
      for (let j = trees.length - 1; j >= 0; j--) {
        const tree = trees[j] as Subtree;
        if (!subtrees.flag(tree, EXTRA)) {
          trees.splice(j, 1, ...subtrees.children(tree));
          root = subtrees.newNode(
            subtrees.symbol(tree),
            trees,
            subtrees.productionId(tree),
          );
          if (pop.length === 1) this.direct.accept(tree, root);
          else this.direct.defer();
          break;
        }
      }
      if (root === NONE) throw new Error("accepted a stack slice with no root");
      this.acceptCount++;
      if (this.finishedTree !== NONE) {
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
    const subtrees = this.subtrees;
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
        if (subtrees.childCount(errorTree) > 0) {
          slice.subtrees.unshift(
            subtrees.newNode(SYM_ERROR_REPEAT, subtrees.children(errorTree), 0),
          );
        }
      }
      const trailingExtras = subtrees.removeTrailingExtras(slice.subtrees);
      if (slice.subtrees.length > 0) {
        stack.push(
          slice.version,
          subtrees.newErrorNode(slice.subtrees, true),
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
    const subtrees = this.subtrees;
    const stack = this.stack;
    this.direct.fail();
    let didRecover = false;
    const previousVersionCount = stack.versionCount();
    const position = stack.position(version);
    const row = stack.row(version);
    const summary = stack.summary(version);
    const nodeCountSinceError = stack.nodeCountSinceError(version);
    const currentErrorCost = stack.errorCost(version);

    if (summary !== null && subtrees.symbol(lookahead) !== SYM_ERROR) {
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
        if (hasActions(lang, entry.state, subtrees.symbol(lookahead))) {
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

    if (subtrees.symbol(lookahead) === SYM_END) {
      stack.push(version, subtrees.newErrorNode([], false), false, 1);
      this.accept(version, lookahead);
      return;
    }

    if (didRecover && stack.versionCount() > MAX_VERSION_COUNT) {
      stack.halt(version);
      return;
    }
    if (
      didRecover &&
      subtrees.flag(lookahead, HAS_EXTERNAL_SCANNER_STATE_CHANGE)
    ) {
      stack.halt(version);
      return;
    }

    const newCost =
      currentErrorCost +
      COST_PER_SKIPPED_TREE +
      subtrees.totalSize(lookahead) * 2 * COST_PER_SKIPPED_CHAR +
      subtrees.totalRows(lookahead) * COST_PER_SKIPPED_LINE;
    if (this.betterVersionExists(version, false, newCost)) {
      stack.halt(version);
      return;
    }

    let la = lookahead;
    const entry = tableEntry(lang, 1, subtrees.symbol(la));
    const n = actionCount(lang, entry);
    if (
      n > 0 &&
      lang.actType[entry + n] === ACTION_SHIFT &&
      ((lang.actB[entry + n] as number) & 1) !== 0
    ) {
      la = subtrees.cloneLeaf(la);
      subtrees.setFlag(la, EXTRA, true);
    }

    let errorRepeat = subtrees.newNode(SYM_ERROR_REPEAT, [la], 0);
    if (nodeCountSinceError > 0) {
      const pop = stack.popCount(version, 1);
      const first = pop[0] as StackSlice;
      if (pop.length > 1) {
        while (stack.versionCount() > first.version + 1)
          stack.removeVersion(first.version + 1);
      }
      stack.renumberVersion(first.version, version);
      first.subtrees.push(errorRepeat);
      errorRepeat = subtrees.newNode(SYM_ERROR_REPEAT, first.subtrees, 0);
    }

    stack.push(version, errorRepeat, false, ERROR_STATE);
    if (subtrees.flag(la, HAS_EXTERNAL_TOKENS))
      stack.setLastExternalToken(version, subtrees.lastExternalToken(la));
  }

  private handleError(version: number, lookahead: Subtree): void {
    const lang = this.lang;
    const subtrees = this.subtrees;
    const stack = this.stack;
    const previousVersionCount = stack.versionCount();
    this.direct.fail();
    this.doAllPotentialReductions(version, 0);
    const versionCount = stack.versionCount();
    const position = stack.position(version);
    const row = stack.row(version);
    // A paused version always holds a lookahead: only `advance` pauses, and only after lexing.
    const la = lookahead;

    let didInsertMissingToken = false;
    for (let v = version; v < versionCount;) {
      if (!didInsertMissingToken) {
        const state = stack.state(v);
        for (
          let missingSymbol = 1;
          missingSymbol < lang.tokenCount;
          missingSymbol++
        ) {
          const stateAfterMissing = nextState(lang, state, missingSymbol);
          if (stateAfterMissing === 0 || stateAfterMissing === state) continue;
          if (
            hasReduceAction(lang, stateAfterMissing, subtrees.leafSymbol(la))
          ) {
            this.lexer.reset(position, row);
            this.lexer.markEnd();
            const withMissing = stack.copyVersion(v);
            const missing = subtrees.newMissingLeaf(missingSymbol, state, 0, 0);
            stack.push(withMissing, missing, false, stateAfterMissing);
            if (
              this.doAllPotentialReductions(
                withMissing,
                subtrees.leafSymbol(la),
              )
            ) {
              didInsertMissingToken = true;
              break;
            }
          }
        }
      }
      stack.push(v, NONE, false, ERROR_STATE);
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
    const subtrees = this.subtrees;
    const stack = this.stack;
    const direct = this.direct;
    const onlyHead = stack.versionCount() === 1 ? stack.heads[0] : undefined;
    if (direct.deferred && onlyHead !== undefined) direct.sync(onlyHead.node);
    let state = stack.state(version);
    const position = stack.position(version);
    const lastExternal = stack.lastExternalToken(version);
    let lookahead = NONE;
    let entry = 0;
    const cached = this.getCachedToken(state, position, lastExternal);
    let needsLex = cached === null;
    if (cached !== null) {
      lookahead = cached.token;
      entry = cached.entry;
    }

    outer: for (;;) {
      if (needsLex) {
        needsLex = false;
        lookahead = this.lex(version, state);
        if (lookahead !== NONE) {
          this.cacheToken = lookahead;
          this.cachePosition = position;
          this.cacheLastExternal = lastExternal;
          entry = tableEntry(lang, state, subtrees.symbol(lookahead));
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
          this.shift(version, next, lookahead, extra);
          return;
        }
        if (type === ACTION_REDUCE) {
          const endOfNonTerminalExtra = lookahead === NONE;
          if (
            stack.versionCount() === 1 &&
            (count === 1 || isSoleReduce(lang, entry, count)) &&
            this.reduceLinear(
              lang.actA[a] as number,
              lang.actB[a] as number,
              lang.actC[a] as number,
              lang.actD[a] as number,
              count > 1,
              endOfNonTerminalExtra,
            )
          ) {
            state = stack.state(version);
            if (lookahead === NONE) needsLex = true;
            else
              entry = tableEntry(lang, state, subtrees.leafSymbol(lookahead));
            continue outer;
          }
          const isFragile = count > 1;
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
          this.accept(version, lookahead);
          return;
        } else if (type === ACTION_RECOVER) {
          this.recover(version, lookahead);
          return;
        }
      }

      if (lastReductionVersion !== NO_VERSION) {
        stack.renumberVersion(lastReductionVersion, version);
        state = stack.state(version);
        if (lookahead === NONE) needsLex = true;
        else entry = tableEntry(lang, state, subtrees.leafSymbol(lookahead));
        continue;
      }

      if (didReduce) {
        stack.halt(version);
        return;
      }

      if (
        lookahead !== NONE &&
        subtrees.flag(lookahead, IS_KEYWORD) &&
        subtrees.symbol(lookahead) !== lang.keywordCaptureToken &&
        !isReservedWord(lang, state, subtrees.symbol(lookahead))
      ) {
        entry = tableEntry(lang, state, lang.keywordCaptureToken);
        if (actionCount(lang, entry) > 0) {
          lookahead = subtrees.cloneLeaf(lookahead);
          subtrees.setSymbol(lookahead, lang.keywordCaptureToken);
          continue;
        }
      }

      if (state === ERROR_STATE) {
        this.recover(version, lookahead);
        return;
      }

      if (this.breakdownTopOfStack(version)) {
        this.direct.fail();
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
    const subtrees = this.subtrees;
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
        for (let c = 0, n = subtrees.childCount(parent); c < n; c++) {
          const child = subtrees.child(parent, c);
          pending = subtrees.childCount(child) > 0;
          const childSymbol = subtrees.symbol(child);
          if (childSymbol === SYM_ERROR) state = ERROR_STATE;
          else if (!subtrees.flag(child, EXTRA))
            state = nextState(lang, state, childSymbol);
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

/** Whether `advance` runs exactly one action of this entry: one reduce, every other action a repetition shift. */
function isSoleReduce(lang: Language, entry: number, count: number): boolean {
  let reduces = 0;
  for (let a = entry + 1; a <= entry + count; a++) {
    const type = lang.actType[a];
    if (type === ACTION_REDUCE) reduces++;
    else if (type !== ACTION_SHIFT || ((lang.actB[a] as number) & 2) === 0)
      return false;
  }
  return reduces === 1;
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
