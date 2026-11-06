// Port of tree-sitter-markdown 0.5.4 tree-sitter-markdown-inline/src/scanner.c: code and LaTeX span delimiters,
// and the delimiter runs of emphasis (`*`, `_`) and strikethrough (`~`). The C scanner spells out the three
// runs as three copies of one function; they differ only in the character and the two tokens, so this port
// keeps one.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";

const ERROR = 0;
const TRIGGER_ERROR = 1;
const CODE_SPAN_START = 2;
const CODE_SPAN_CLOSE = 3;
const EMPHASIS_OPEN_STAR = 4;
const EMPHASIS_OPEN_UNDERSCORE = 5;
const EMPHASIS_CLOSE_STAR = 6;
const EMPHASIS_CLOSE_UNDERSCORE = 7;
const LAST_TOKEN_WHITESPACE = 8;
const LAST_TOKEN_PUNCTUATION = 9;
const STRIKETHROUGH_OPEN = 10;
const STRIKETHROUGH_CLOSE = 11;
const LATEX_SPAN_START = 12;
const LATEX_SPAN_CLOSE = 13;
const UNCLOSED_SPAN = 14;

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const DOLLAR = 36;
const STAR = 42;
const UNDERSCORE = 95;
const BACKTICK = 96;
const TILDE = 126;

/** The current delimiter run is opening. */
const STATE_EMPHASIS_DELIMITER_IS_OPEN = 0x1 << 2;

/** Punctuation as the markdown spec defines it: ASCII only. */
const isPunctuation = (c: number) =>
  (c >= 33 && c <= 47) ||
  (c >= 58 && c <= 64) ||
  (c >= 91 && c <= 96) ||
  (c >= 123 && c <= 126);

class Scanner implements ExternalScanner {
  state = 0;
  codeSpanDelimiterLength = 0;
  latexSpanDelimiterLength = 0;
  /** The characters left in the current emphasis delimiter run. */
  numEmphasisDelimitersLeft = 0;

  serialize(buffer: Uint8Array): number {
    buffer[0] = this.state;
    buffer[1] = this.codeSpanDelimiterLength;
    buffer[2] = this.latexSpanDelimiterLength;
    buffer[3] = this.numEmphasisDelimitersLeft;
    return 4;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.state = 0;
    this.codeSpanDelimiterLength = 0;
    this.latexSpanDelimiterLength = 0;
    this.numEmphasisDelimitersLeft = 0;
    if (length > 0) {
      this.state = buffer[0] as number;
      this.codeSpanDelimiterLength = buffer[1] as number;
      this.latexSpanDelimiterLength = buffer[2] as number;
      this.numEmphasisDelimitersLeft = buffer[3] as number;
    }
  }

  /** A code span's backticks or a LaTeX span's dollars; `length` is the open span's run, 0 for none. */
  private parseLeafDelimiter(
    lexer: Lexer,
    length: number,
    valid: Uint8Array,
    delimiter: number,
    open: number,
    close: number,
  ): { ok: boolean; length: number } {
    let level = 0;
    while (lexer.lookahead === delimiter) {
      lexer.advance(false);
      level = (level + 1) & 0xff;
    }
    lexer.markEnd();
    if (level === length && valid[close]) {
      lexer.resultSymbol = close;
      return { ok: true, length: 0 };
    }
    if (valid[open]) {
      // Parse ahead to check if there is a closing delimiter.
      let closeLevel = 0;
      while (!lexer.eof()) {
        if (lexer.lookahead === delimiter) closeLevel++;
        else {
          if (closeLevel === level) break;
          closeLevel = 0;
        }
        lexer.advance(false);
      }
      if (closeLevel === level) {
        lexer.resultSymbol = open;
        return { ok: true, length: level };
      }
      if (valid[UNCLOSED_SPAN]) {
        lexer.resultSymbol = UNCLOSED_SPAN;
        return { ok: true, length };
      }
    }
    return { ok: false, length };
  }

  /** One character of a `*`, `_` or `~` delimiter run. */
  private parseRun(
    lexer: Lexer,
    valid: Uint8Array,
    delimiter: number,
    open: number,
    close: number,
  ): boolean {
    lexer.advance(false);
    // A run already decided on: the rest of its characters open or close as its first did.
    if (this.numEmphasisDelimitersLeft > 0) {
      if ((this.state & STATE_EMPHASIS_DELIMITER_IS_OPEN) !== 0 && valid[open]) {
        this.state &= ~STATE_EMPHASIS_DELIMITER_IS_OPEN & 0xff;
        lexer.resultSymbol = open;
        this.numEmphasisDelimitersLeft--;
        return true;
      }
      if (valid[close]) {
        lexer.resultSymbol = close;
        this.numEmphasisDelimitersLeft--;
        return true;
      }
    }
    lexer.markEnd();
    let count = 1;
    while (lexer.lookahead === delimiter) {
      count = (count + 1) & 0xff;
      lexer.advance(false);
    }
    const lineEnd =
      lexer.lookahead === LF || lexer.lookahead === CR || lexer.eof();
    if (valid[open] || valid[close]) {
      this.numEmphasisDelimitersLeft = (count - 1) & 0xff;
      const nextWhitespace =
        lineEnd || lexer.lookahead === SPACE || lexer.lookahead === TAB;
      const nextPunctuation = isPunctuation(lexer.lookahead);
      // The grammar tells what the last token was through these two tokens' validity.
      if (
        valid[close] &&
        !valid[LAST_TOKEN_WHITESPACE] &&
        (!valid[LAST_TOKEN_PUNCTUATION] || nextPunctuation || nextWhitespace)
      ) {
        // Closing delimiters take precedence.
        this.state &= ~STATE_EMPHASIS_DELIMITER_IS_OPEN & 0xff;
        lexer.resultSymbol = close;
        return true;
      }
      if (
        !nextWhitespace &&
        (!nextPunctuation ||
          valid[LAST_TOKEN_PUNCTUATION] ||
          valid[LAST_TOKEN_WHITESPACE])
      ) {
        this.state |= STATE_EMPHASIS_DELIMITER_IS_OPEN;
        lexer.resultSymbol = open;
        return true;
      }
    }
    return false;
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    // A grammar rule decided this branch is invalid and asks for an error to stop it.
    if (valid[TRIGGER_ERROR]) {
      lexer.resultSymbol = ERROR;
      return true;
    }
    switch (lexer.lookahead) {
      case BACKTICK: {
        const r = this.parseLeafDelimiter(
          lexer,
          this.codeSpanDelimiterLength,
          valid,
          BACKTICK,
          CODE_SPAN_START,
          CODE_SPAN_CLOSE,
        );
        this.codeSpanDelimiterLength = r.length;
        return r.ok;
      }
      case DOLLAR: {
        const r = this.parseLeafDelimiter(
          lexer,
          this.latexSpanDelimiterLength,
          valid,
          DOLLAR,
          LATEX_SPAN_START,
          LATEX_SPAN_CLOSE,
        );
        this.latexSpanDelimiterLength = r.length;
        return r.ok;
      }
      case STAR:
        return this.parseRun(
          lexer,
          valid,
          STAR,
          EMPHASIS_OPEN_STAR,
          EMPHASIS_CLOSE_STAR,
        );
      case UNDERSCORE:
        return this.parseRun(
          lexer,
          valid,
          UNDERSCORE,
          EMPHASIS_OPEN_UNDERSCORE,
          EMPHASIS_CLOSE_UNDERSCORE,
        );
      case TILDE:
        return this.parseRun(
          lexer,
          valid,
          TILDE,
          STRIKETHROUGH_OPEN,
          STRIKETHROUGH_CLOSE,
        );
    }
    return false;
  }
}

export function createScanner(): ExternalScanner {
  return new Scanner();
}
