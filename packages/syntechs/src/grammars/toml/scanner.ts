// Port of tree-sitter-toml 0.7.0 src/scanner.c: the line ending that closes a pair or a table header, and the
// end of a multiline string, whose closing `"""` or `'''` may follow up to two quotes of the content. Stateless.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";

const LINE_ENDING_OR_EOF = 0;
const MULTILINE_BASIC_STRING_CONTENT = 1;
const MULTILINE_BASIC_STRING_END = 2;
const MULTILINE_LITERAL_STRING_CONTENT = 3;
const MULTILINE_LITERAL_STRING_END = 4;

const NUL = 0;
const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;

// Read through a call so TypeScript does not keep a comparison's narrowing across `advance`.
const la = (lexer: Lexer): number => lexer.lookahead;

/**
 * At a `delimiter`: one or two of them are content, three end the string, and a fourth makes the first content
 * so that the string ends at the last three (`""""` is a `"` and the end).
 */
function scanMultilineStringEnd(
  lexer: Lexer,
  valid: Uint8Array,
  delimiter: number,
  contentSymbol: number,
  endSymbol: number,
): boolean {
  if (!valid[endSymbol] || la(lexer) !== delimiter) return false;

  lexer.advance(false);
  lexer.markEnd();

  if (la(lexer) !== delimiter) {
    lexer.resultSymbol = contentSymbol;
    return true;
  }

  lexer.advance(false);

  if (la(lexer) !== delimiter) {
    lexer.markEnd();
    lexer.resultSymbol = contentSymbol;
    return true;
  }

  lexer.advance(false);

  if (la(lexer) !== delimiter) {
    lexer.markEnd();
    lexer.resultSymbol = endSymbol;
    return true;
  }

  lexer.resultSymbol = contentSymbol;
  return true;
}

function scan(lexer: Lexer, valid: Uint8Array): boolean {
  if (
    scanMultilineStringEnd(
      lexer,
      valid,
      DOUBLE_QUOTE,
      MULTILINE_BASIC_STRING_CONTENT,
      MULTILINE_BASIC_STRING_END,
    ) ||
    scanMultilineStringEnd(
      lexer,
      valid,
      SINGLE_QUOTE,
      MULTILINE_LITERAL_STRING_CONTENT,
      MULTILINE_LITERAL_STRING_END,
    )
  )
    return true;

  if (valid[LINE_ENDING_OR_EOF]) {
    lexer.resultSymbol = LINE_ENDING_OR_EOF;

    while (la(lexer) === SPACE || la(lexer) === TAB) lexer.advance(true);

    if (la(lexer) === NUL || la(lexer) === LF) return true;

    if (la(lexer) === CR) {
      lexer.advance(true);
      if (la(lexer) === LF) return true;
    }
  }

  return false;
}

export function createScanner(): ExternalScanner {
  return { scan, serialize: () => 0, deserialize: () => {} };
}
