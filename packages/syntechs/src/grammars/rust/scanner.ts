// Port of tree-sitter-rust 0.24.2 src/scanner.c: strings, floats, nested block comments and doc comments.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalpha, iswdigit, iswspace } from "../../core/wctype.js";

const STRING_CONTENT = 0;
const STRING_CLOSE = 1;
const RAW_STRING_LITERAL_START = 2;
const RAW_STRING_LITERAL_CONTENT = 3;
const RAW_STRING_LITERAL_END = 4;
const FLOAT_LITERAL = 5;
const BLOCK_OUTER_DOC_MARKER = 6;
const BLOCK_INNER_DOC_MARKER = 7;
const BLOCK_COMMENT_CONTENT = 8;
const LINE_DOC_CONTENT = 9;
const ERROR_SENTINEL = 10;

const QUOTE = 34;
const HASH = 35;
const STAR = 42;
const SLASH = 47;
const BACKSLASH = 92;

/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

const isNumChar = (c: number): boolean => c === 95 || iswdigit(c);

function processString(lexer: Lexer): boolean {
  let hasContent = false;
  for (;;) {
    if (la(lexer) === QUOTE || la(lexer) === BACKSLASH) break;
    if (lexer.eof()) return false;
    hasContent = true;
    lexer.advance(false);
  }
  lexer.resultSymbol = STRING_CONTENT;
  lexer.markEnd();
  return hasContent;
}

const LEFT_FORWARD_SLASH = 0;
const LEFT_ASTERISK = 1;
const CONTINUING = 2;

function processBlockComment(lexer: Lexer, valid: Uint8Array): boolean {
  let first = la(lexer) & 0xff;
  if (valid[BLOCK_INNER_DOC_MARKER] && first === 33) {
    lexer.resultSymbol = BLOCK_INNER_DOC_MARKER;
    lexer.advance(false);
    return true;
  }
  if (valid[BLOCK_OUTER_DOC_MARKER] && first === STAR) {
    lexer.advance(false);
    lexer.markEnd();
    if (la(lexer) === SLASH) return false;
    if (la(lexer) !== STAR) {
      lexer.resultSymbol = BLOCK_OUTER_DOC_MARKER;
      return true;
    }
  } else {
    lexer.advance(false);
  }

  if (!valid[BLOCK_COMMENT_CONTENT]) return false;

  let state = CONTINUING;
  let nestingDepth = 1;
  if (first === STAR) {
    state = LEFT_ASTERISK;
    if (la(lexer) === SLASH) return false;
  } else if (first === SLASH) {
    state = LEFT_FORWARD_SLASH;
  }

  while (!lexer.eof() && nestingDepth !== 0) {
    first = la(lexer) & 0xff;
    if (state === LEFT_FORWARD_SLASH) {
      if (first === STAR) nestingDepth++;
      state = CONTINUING;
    } else if (state === LEFT_ASTERISK) {
      if (first === STAR) {
        lexer.markEnd();
        state = LEFT_ASTERISK;
      } else {
        if (first === SLASH) nestingDepth--;
        state = CONTINUING;
      }
    } else {
      lexer.markEnd();
      if (first === SLASH) state = LEFT_FORWARD_SLASH;
      else if (first === STAR) state = LEFT_ASTERISK;
    }
    lexer.advance(false);
    if (first === SLASH && nestingDepth !== 0) lexer.markEnd();
  }
  lexer.resultSymbol = BLOCK_COMMENT_CONTENT;
  return true;
}

class RustScanner implements ExternalScanner {
  openingHashCount = 0;

  private scanRawStringStart(lexer: Lexer): boolean {
    if (la(lexer) === 98 || la(lexer) === 99) lexer.advance(false);
    if (la(lexer) !== 114) return false;
    lexer.advance(false);

    let openingHashCount = 0;
    while (la(lexer) === HASH) {
      lexer.advance(false);
      openingHashCount = (openingHashCount + 1) & 0xff;
    }
    if (la(lexer) !== QUOTE) return false;
    lexer.advance(false);
    this.openingHashCount = openingHashCount;
    lexer.resultSymbol = RAW_STRING_LITERAL_START;
    return true;
  }

  private scanRawStringContent(lexer: Lexer): boolean {
    for (;;) {
      if (lexer.eof()) return false;
      if (la(lexer) === QUOTE) {
        lexer.markEnd();
        lexer.advance(false);
        let hashCount = 0;
        while (la(lexer) === HASH && hashCount < this.openingHashCount) {
          lexer.advance(false);
          hashCount++;
        }
        if (hashCount === this.openingHashCount) {
          lexer.resultSymbol = RAW_STRING_LITERAL_CONTENT;
          return true;
        }
      } else {
        lexer.advance(false);
      }
    }
  }

  private scanRawStringEnd(lexer: Lexer): boolean {
    lexer.advance(false);
    for (let i = 0; i < this.openingHashCount; i++) lexer.advance(false);
    lexer.resultSymbol = RAW_STRING_LITERAL_END;
    return true;
  }

  private processFloatLiteral(lexer: Lexer): boolean {
    lexer.resultSymbol = FLOAT_LITERAL;
    lexer.advance(false);
    while (isNumChar(la(lexer))) lexer.advance(false);

    let hasFraction = false;
    let hasExponent = false;
    if (la(lexer) === 46) {
      hasFraction = true;
      lexer.advance(false);
      if (iswalpha(la(lexer))) return false;
      if (la(lexer) === 46) return false;
      while (isNumChar(la(lexer))) lexer.advance(false);
    }
    lexer.markEnd();

    if (la(lexer) === 101 || la(lexer) === 69) {
      hasExponent = true;
      lexer.advance(false);
      if (la(lexer) === 43 || la(lexer) === 45) lexer.advance(false);
      if (!isNumChar(la(lexer))) return true;
      lexer.advance(false);
      while (isNumChar(la(lexer))) lexer.advance(false);
      lexer.markEnd();
    }

    if (!hasExponent && !hasFraction) return false;
    if (la(lexer) !== 117 && la(lexer) !== 105 && la(lexer) !== 102)
      return true;
    lexer.advance(false);
    if (!iswdigit(la(lexer))) return true;
    while (iswdigit(la(lexer))) lexer.advance(false);
    lexer.markEnd();
    return true;
  }

  private processLineDocContent(lexer: Lexer): boolean {
    lexer.resultSymbol = LINE_DOC_CONTENT;
    for (;;) {
      if (lexer.eof()) return true;
      if (la(lexer) === 10) {
        lexer.advance(false);
        return true;
      }
      lexer.advance(false);
    }
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[ERROR_SENTINEL]) return false;

    if (
      valid[BLOCK_COMMENT_CONTENT] ||
      valid[BLOCK_INNER_DOC_MARKER] ||
      valid[BLOCK_OUTER_DOC_MARKER]
    )
      return processBlockComment(lexer, valid);

    if (valid[STRING_CONTENT] && !valid[FLOAT_LITERAL]) {
      if (processString(lexer)) return true;
    }

    if (valid[STRING_CLOSE] && la(lexer) === QUOTE) {
      lexer.advance(false);
      lexer.resultSymbol = STRING_CLOSE;
      lexer.markEnd();
      return true;
    }

    if (valid[LINE_DOC_CONTENT]) return this.processLineDocContent(lexer);

    while (iswspace(la(lexer))) lexer.advance(true);

    if (
      valid[RAW_STRING_LITERAL_START] &&
      (la(lexer) === 114 || la(lexer) === 98 || la(lexer) === 99)
    )
      return this.scanRawStringStart(lexer);

    if (valid[RAW_STRING_LITERAL_CONTENT])
      return this.scanRawStringContent(lexer);

    if (valid[RAW_STRING_LITERAL_END] && la(lexer) === QUOTE)
      return this.scanRawStringEnd(lexer);

    if (valid[FLOAT_LITERAL] && iswdigit(la(lexer)))
      return this.processFloatLiteral(lexer);

    return false;
  }

  serialize(buffer: Uint8Array): number {
    buffer[0] = this.openingHashCount;
    return 1;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.openingHashCount = 0;
    if (length === 1) this.openingHashCount = buffer[0] as number;
  }
}

export function createScanner(): ExternalScanner {
  return new RustScanner();
}
