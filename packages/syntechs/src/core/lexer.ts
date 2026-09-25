// Port of tree-sitter v0.27.0 lib/src/lexer.c for one in-memory UTF-16 string (no included ranges, no chunks).
// Positions are UTF-16 code units; tree-sitter's byte offsets for UTF-16 input are exactly twice these.

/** What a hand-ported external scanner implements; mirrors the C scanner's create/scan/serialize/deserialize. */
export interface ExternalScanner {
  scan(lexer: Lexer, valid: Uint8Array): boolean;
  /** Writes the state into `buffer` (1024 bytes) and returns how many bytes it used. */
  serialize(buffer: Uint8Array): number;
  deserialize(buffer: Uint8Array, length: number): void;
}

const BOM = 0xfeff;

export class Lexer {
  input = "";
  /** Current position and its row. */
  pos = 0;
  row = 0;
  lookahead = 0;
  private lookaheadSize = 0;
  tokenStart = 0;
  tokenStartRow = 0;
  /** -1 while the token's end is unmarked. */
  tokenEnd = -1;
  tokenEndRow = 0;
  resultSymbol = 0;

  setInput(input: string): void {
    this.input = input;
    this.reset(0, 0);
  }

  reset(pos: number, row: number): void {
    this.pos = pos;
    this.row = row;
    this.tokenStart = pos;
    this.tokenStartRow = row;
    this.tokenEnd = -1;
    this.readLookahead();
  }

  private readLookahead(): void {
    const input = this.input;
    const pos = this.pos;
    if (pos >= input.length) {
      this.lookahead = 0;
      this.lookaheadSize = 1;
      return;
    }
    const c = input.charCodeAt(pos);
    if (c >= 0xd800 && c <= 0xdbff && pos + 1 < input.length) {
      const d = input.charCodeAt(pos + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        this.lookahead = ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
        this.lookaheadSize = 2;
        return;
      }
    }
    this.lookahead = c;
    this.lookaheadSize = 1;
  }

  eof(): boolean {
    return this.pos >= this.input.length;
  }

  advance(skip: boolean): void {
    if (this.pos >= this.input.length) return;
    if (this.lookahead === 10) this.row++;
    this.pos += this.lookaheadSize;
    if (skip) {
      this.tokenStart = this.pos;
      this.tokenStartRow = this.row;
    }
    this.readLookahead();
  }

  /** The whole input is the one included range, so its only start is offset 0. */
  isAtIncludedRangeStart(): boolean {
    return this.pos === 0;
  }

  markEnd(): void {
    this.tokenEnd = this.pos;
    this.tokenEndRow = this.row;
  }

  /** Code points since the last line break, not counting a byte-order mark at offset 0. */
  getColumn(): number {
    const input = this.input;
    let start = this.pos;
    while (start > 0 && input.charCodeAt(start - 1) !== 10) start--;
    let column = 0;
    for (let i = start; i < this.pos; i++) {
      const c = input.charCodeAt(i);
      if (i === 0 && c === BOM) continue;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < this.pos) {
        const d = input.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) i++;
      }
      column++;
    }
    return column;
  }

  start(): void {
    this.tokenStart = this.pos;
    this.tokenStartRow = this.row;
    this.tokenEnd = -1;
    this.resultSymbol = 0;
    if (this.pos === 0 && this.lookahead === BOM && !this.eof())
      this.advance(true);
  }

  finish(): void {
    if (this.tokenEnd < 0) this.markEnd();
    if (this.tokenEnd < this.tokenStart) {
      this.tokenStart = this.tokenEnd;
      this.tokenStartRow = this.tokenEndRow;
    }
  }
}
