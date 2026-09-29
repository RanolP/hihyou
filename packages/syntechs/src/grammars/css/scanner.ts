// Port of tree-sitter-css 0.25.0 src/scanner.c as patches/tree-sitter-css@0.25.0.patch leaves it. Its one byte of
// state: whether it is inside `@custom-selector ... ;`, whose selectors end in `;` rather than `{`.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswspace } from "../../core/wctype.js";

const DESCENDANT_OP = 0;
const PSEUDO_CLASS_SELECTOR_COLON = 1;
const ERROR_RECOVERY = 2;
const CUSTOM_SELECTOR_START = 3;
const CUSTOM_SELECTOR_END = 4;

const HASH = 35;
const DOT = 46;
const LBRACKET = 91;
const MINUS = 45;
const STAR = 42;
const AMP = 38;
const COLON = 58;
const SEMI = 59;
const LBRACE = 123;
const RBRACE = 125;
const SLASH = 47;
const AT = 64;
const EQUALS = 61;
const UNDERSCORE = 95;
const CUSTOM_SELECTOR = "custom-selector";

interface State {
  inCustomSelector: boolean;
}

function scanCustomSelectorEnd(lexer: Lexer, state: State): boolean {
  if (lexer.lookahead !== SEMI) return false;
  lexer.advance(false);
  lexer.markEnd();
  lexer.resultSymbol = CUSTOM_SELECTOR_END;
  state.inCustomSelector = false;
  return true;
}

function scan(lexer: Lexer, valid: Uint8Array, state: State): boolean {
  if (valid[ERROR_RECOVERY]) return false;

  if (iswspace(lexer.lookahead) && valid[DESCENDANT_OP]) {
    lexer.resultSymbol = DESCENDANT_OP;
    lexer.advance(true);
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    lexer.markEnd();
    const c = lexer.lookahead;
    // `[name *= value]`: a `*` before `=` is the attribute operator, not a universal selector.
    if (c === STAR) {
      lexer.advance(false);
      return lexer.lookahead !== EQUALS;
    }
    if (
      c === HASH ||
      c === DOT ||
      c === LBRACKET ||
      c === MINUS ||
      c === AMP ||
      iswalnum(c)
    )
      return true;
    if (valid[CUSTOM_SELECTOR_END] && state.inCustomSelector)
      return scanCustomSelectorEnd(lexer, state);
    if (c === COLON) {
      if (state.inCustomSelector) return true;
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

  const endValid = valid[CUSTOM_SELECTOR_END] && state.inCustomSelector;
  if (valid[CUSTOM_SELECTOR_START] || endValid) {
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    if (endValid && lexer.lookahead === SEMI)
      return scanCustomSelectorEnd(lexer, state);
    if (valid[CUSTOM_SELECTOR_START] && lexer.lookahead === AT) {
      lexer.advance(false);
      for (let i = 0; i < CUSTOM_SELECTOR.length; i++) {
        if (lexer.lookahead !== CUSTOM_SELECTOR.charCodeAt(i)) return false;
        lexer.advance(false);
      }
      const c: number = lexer.lookahead;
      if (iswalnum(c) || c === MINUS || c === UNDERSCORE) return false;
      lexer.markEnd();
      lexer.resultSymbol = CUSTOM_SELECTOR_START;
      state.inCustomSelector = true;
      return true;
    }
  }

  if (valid[PSEUDO_CLASS_SELECTOR_COLON]) {
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    if (lexer.lookahead === COLON) {
      lexer.advance(false);
      if (lexer.lookahead === COLON) return false;
      lexer.markEnd();
      lexer.resultSymbol = PSEUDO_CLASS_SELECTOR_COLON;
      if (state.inCustomSelector) return true;
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
  const state: State = { inCustomSelector: false };
  return {
    scan: (lexer, valid) => scan(lexer, valid, state),
    serialize: (buffer) => {
      buffer[0] = state.inCustomSelector ? 1 : 0;
      return 1;
    },
    deserialize: (buffer, length) => {
      state.inCustomSelector = length > 0 && buffer[0] !== 0;
    },
  };
}
