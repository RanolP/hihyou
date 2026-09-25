// Port of tree-sitter-css 0.25.0 src/scanner.c. Stateless.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswspace } from "../../core/wctype.js";

const DESCENDANT_OP = 0;
const PSEUDO_CLASS_SELECTOR_COLON = 1;
const ERROR_RECOVERY = 2;

const HASH = 35;
const DOT = 46;
const LBRACKET = 91;
const MINUS = 45;
const STAR = 42;
const COLON = 58;
const SEMI = 59;
const LBRACE = 123;
const RBRACE = 125;
const SLASH = 47;

function scan(lexer: Lexer, valid: Uint8Array): boolean {
  if (valid[ERROR_RECOVERY]) return false;

  if (iswspace(lexer.lookahead) && valid[DESCENDANT_OP]) {
    lexer.resultSymbol = DESCENDANT_OP;
    lexer.advance(true);
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    lexer.markEnd();
    const c = lexer.lookahead;
    if (
      c === HASH ||
      c === DOT ||
      c === LBRACKET ||
      c === MINUS ||
      c === STAR ||
      iswalnum(c)
    )
      return true;
    if (c === COLON) {
      lexer.advance(false);
      if (iswspace(lexer.lookahead)) return false;
      for (;;) {
        if (
          lexer.lookahead === SEMI ||
          lexer.lookahead === RBRACE ||
          lexer.eof()
        )
          return false;
        if (lexer.lookahead === LBRACE) return true;
        lexer.advance(false);
      }
    }
  }

  if (valid[PSEUDO_CLASS_SELECTOR_COLON]) {
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    if (lexer.lookahead === COLON) {
      lexer.advance(false);
      if (lexer.lookahead === COLON) return false;
      lexer.markEnd();
      lexer.resultSymbol = PSEUDO_CLASS_SELECTOR_COLON;
      // A `{` makes it a pseudo-class selector, a `;` a property, unless inside a comment.
      let inComment = false;
      while (
        lexer.lookahead !== SEMI &&
        lexer.lookahead !== RBRACE &&
        !lexer.eof()
      ) {
        lexer.advance(false);
        if (lexer.lookahead === LBRACE && !inComment) return true;
        if (lexer.lookahead === SLASH && !inComment) {
          lexer.advance(false);
          if (lexer.lookahead === STAR) inComment = true;
        } else if (lexer.lookahead === STAR && inComment) {
          lexer.advance(false);
          if (lexer.lookahead === SLASH) inComment = false;
        }
      }
      // At EOF without a `{`, still a pseudo-class selector: better recovery than an erroneous property.
      return lexer.eof();
    }
  }

  return false;
}

export function createScanner(): ExternalScanner {
  return { scan, serialize: () => 0, deserialize: () => {} };
}
