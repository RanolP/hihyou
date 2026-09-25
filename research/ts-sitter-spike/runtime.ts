// Minimal pure-TS LR runtime over tables that tree-sitter generated (see gen.ts).
// Deliberately skipped, so this measures the happy path only:
//   - GLR: when an entry holds several REDUCE actions only the first runs (no stack versions);
//     SHIFT_REPEAT is skipped exactly like tree-sitter's ts_parser__advance does.
//   - error recovery: any missing action or failed lex throws.
//   - external scanners, keyword lexing, aliases, fields, reserved words, included ranges,
//     incremental reuse, dynamic precedence, UTF-8/byte offsets (offsets are UTF-16 units,
//     matching web-tree-sitter's startIndex/endIndex).
// The output tree is struct-of-arrays with hidden nodes already spliced out, so walking it
// is plain typed-array reads.

export interface Language {
  SYMBOL_COUNT: number;
  LARGE_STATE_COUNT: number;
  symbolNames: string[];
  visible: Uint8Array;
  named: Uint8Array;
  parseTable: Uint16Array;
  smallTable: Uint16Array;
  smallMap: Uint32Array;
  actions: Int32Array;
  actionCount: Uint8Array;
  lexModes: Uint16Array;
  lex(L: Lexer, state: number): boolean;
}

export class Lexer {
  src = "";
  end = 0;
  pos = 0;
  lookahead = 0;
  tokenStart = 0;
  tokenEnd = 0;
  resultSymbol = 0;
  reset(pos: number): void {
    this.pos = pos;
    this.tokenStart = pos;
    this.tokenEnd = pos;
    this.lookahead = pos < this.end ? this.src.codePointAt(pos)! : 0;
  }
  advance(skip: boolean): void {
    if (this.pos >= this.end) return;
    this.pos += this.lookahead > 0xffff ? 2 : 1;
    this.lookahead = this.pos < this.end ? this.src.codePointAt(this.pos)! : 0;
    if (skip) this.tokenStart = this.pos;
  }
}

export class Tree {
  count = 0;
  type: Uint16Array;
  start: Int32Array;
  end: Int32Array;
  firstChild: Int32Array;
  lastChild: Int32Array;
  nextSibling: Int32Array;
  root = -1;
  constructor(capacity: number) {
    this.type = new Uint16Array(capacity);
    this.start = new Int32Array(capacity);
    this.end = new Int32Array(capacity);
    this.firstChild = new Int32Array(capacity);
    this.lastChild = new Int32Array(capacity);
    this.nextSibling = new Int32Array(capacity);
  }
  add(type: number, start: number, end: number): number {
    if (this.count === this.type.length) this.grow();
    const i = this.count++;
    this.type[i] = type;
    this.start[i] = start;
    this.end[i] = end;
    this.firstChild[i] = -1;
    this.lastChild[i] = -1;
    this.nextSibling[i] = -1;
    return i;
  }
  private grow(): void {
    const n = this.type.length * 2;
    const g = <T extends Uint16Array | Int32Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(n);
      b.set(a);
      return b;
    };
    this.type = g(this.type);
    this.start = g(this.start);
    this.end = g(this.end);
    this.firstChild = g(this.firstChild);
    this.lastChild = g(this.lastChild);
    this.nextSibling = g(this.nextSibling);
  }
}

const SHIFT = 1, REDUCE = 2, ACCEPT = 3;

export class ParseError extends Error {}

export function parse(lang: Language, src: string): Tree {
  const { SYMBOL_COUNT, LARGE_STATE_COUNT, parseTable, smallTable, smallMap, actions, actionCount, lexModes, visible } = lang;
  const lookup = (state: number, symbol: number): number => {
    if (state < LARGE_STATE_COUNT) return parseTable[state * SYMBOL_COUNT + symbol];
    let i = smallMap[state - LARGE_STATE_COUNT];
    const groups = smallTable[i++];
    for (let g = 0; g < groups; g++) {
      const value = smallTable[i++];
      const n = smallTable[i++];
      for (let j = 0; j < n; j++) if (smallTable[i + j] === symbol) return value;
      i += n;
    }
    return 0;
  };

  const tree = new Tree(Math.max(64, src.length >> 2));
  const L = new Lexer();
  L.src = src;
  L.end = src.length;

  let cap = 256;
  let stState = new Int32Array(cap);
  let stNode = new Int32Array(cap);
  let stExtra = new Uint8Array(cap);
  let sp = 0;
  const push = (state: number, node: number, extra: number): void => {
    if (sp === cap) {
      cap *= 2;
      const a = new Int32Array(cap); a.set(stState); stState = a;
      const b = new Int32Array(cap); b.set(stNode); stNode = b;
      const c = new Uint8Array(cap); c.set(stExtra); stExtra = c;
    }
    stState[sp] = state; stNode[sp] = node; stExtra[sp] = extra; sp++;
  };

  let tokSym = 0, tokStart = 0, tokEnd = 0, lastEnd = 0;
  const lexNext = (state: number): void => {
    L.reset(lastEnd);
    if (!lang.lex(L, lexModes[state])) throw new ParseError(`lex error at ${L.pos} in lex state ${lexModes[state]}`);
    tokSym = L.resultSymbol; tokStart = L.tokenStart; tokEnd = L.tokenEnd; lastEnd = tokEnd;
  };

  // Append `child` to `parent`'s child list, splicing through hidden nodes.
  const link = (parent: number, child: number): void => {
    const { firstChild, lastChild, nextSibling } = tree;
    let first = child, last = child;
    if (!visible[tree.type[child]]) {
      first = firstChild[child];
      if (first < 0) return;
      last = lastChild[child];
    }
    if (lastChild[parent] < 0) firstChild[parent] = first;
    else nextSibling[lastChild[parent]] = first;
    lastChild[parent] = last;
  };

  push(1, -1, 0);
  lexNext(1);
  for (;;) {
    const state = stState[sp - 1];
    const entry = lookup(state, tokSym);
    const n = actionCount[entry];
    if (n === 0) throw new ParseError(`no action for ${lang.symbolNames[tokSym]} in state ${state} at ${tokStart}`);
    let reduced = false;
    let shifted = false;
    for (let k = 0; k < n; k++) {
      const a = (entry + 1 + k) * 4;
      const kind = actions[a];
      if (kind === SHIFT) {
        const flags = actions[a + 2];
        if (flags & 2) continue; // SHIFT_REPEAT: tree-sitter skips it too
        if (reduced) break;
        const leaf = tree.add(tokSym, tokStart, tokEnd);
        push(flags & 1 ? state : actions[a + 1], leaf, flags & 1);
        lexNext(stState[sp - 1]);
        shifted = true;
        break;
      }
      if (kind === REDUCE) {
        if (reduced) continue; // GLR fork point: spike keeps only the first reduction
        reduced = true;
        const symbol = actions[a + 1];
        const childCount = actions[a + 2];
        // Trailing extras stay outside the new node, like ts_subtree_array_remove_trailing_extras.
        let top = sp;
        while (top > 1 && stExtra[top - 1]) top--;
        let lo = top, seen = 0;
        while (seen < childCount) { lo--; if (!stExtra[lo]) seen++; }
        const node = tree.add(symbol, lo < top ? tree.start[stNode[lo]] : lastEnd, lo < top ? tree.end[stNode[top - 1]] : lastEnd);
        if (lo === top) { tree.start[node] = tokStart; tree.end[node] = tokStart; }
        for (let i = lo; i < top; i++) link(node, stNode[i]);
        const goto = lookup(stState[lo - 1], symbol);
        const trailing = sp - top;
        const tNodes = trailing ? stNode.slice(top, sp) : null;
        sp = lo;
        push(goto, node, 0);
        for (let i = 0; i < trailing; i++) push(goto, tNodes![i], 1);
        continue;
      }
      if (kind === ACCEPT) {
        const root = tree.add(0, 0, 0);
        let main = -1;
        for (let i = 1; i < sp; i++) if (!stExtra[i]) main = stNode[i];
        tree.type[root] = tree.type[main];
        for (let i = 1; i < sp; i++) {
          const nd = stNode[i];
          if (nd === main) { for (let c = tree.firstChild[main]; c >= 0; ) { const nx = tree.nextSibling[c]; tree.nextSibling[c] = -1; link(root, c); c = nx; } }
          else link(root, nd);
        }
        tree.start[root] = Math.min(tree.start[main], tree.start[stNode[1]]);
        // The root also spans the end-of-input token's padding (trailing whitespace).
        tree.end[root] = Math.max(tree.end[main], tokEnd);
        tree.root = root;
        return tree;
      }
      throw new ParseError(`RECOVER action at ${tokStart}: error recovery not implemented`);
    }
    if (!reduced && !shifted) throw new ParseError(`stuck in state ${state} at ${tokStart}`);
  }
}
