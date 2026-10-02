// Port of tree-sitter-css 0.25.0 src/scanner.c as packages/syntechs/grammars/tree-sitter-css/grammar.patch leaves it. Its one byte of
// state: whether it is inside `@custom-selector ... ;`, whose selectors end in `;` rather than `{`.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswspace } from "../../core/wctype.js";

const DESCENDANT_OP = 0;
const PSEUDO_CLASS_SELECTOR_COLON = 1;
const ERROR_RECOVERY = 2;
const CUSTOM_SELECTOR_START = 3;
const CUSTOM_SELECTOR_END = 4;
const CUSTOM_PROPERTY_SET_NAME = 5;
const CUSTOM_PROPERTY_RAW_NAME = 6;
const CUSTOM_PROPERTY_RAW_VALUE = 7;
const URL_RAW = 8;
const CUSTOM_PROPERTY_BRACE_NAME = 9;
const CUSTOM_PROPERTY_BLOCK = 10;

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
const LPAREN = 40;
const RPAREN = 41;
const RBRACKET = 93;
const DQUOTE = 34;
const SQUOTE = 39;
const BACKSLASH = 92;
const BANG = 33;
const NEWLINE = 10;
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

/** The lookahead, read afresh where TypeScript would keep it narrowed across an `advance`. */
const peek = (lexer: Lexer): number => lexer.lookahead;

/**
 * Past one piece of a raw value: a string, a `/* *\/` comment, or a character, counting open brackets in
 * `depth.n`. Which it was: whitespace (0, falsy), a comment, or anything else.
 */
const PIECE_SPACE = 0;
const PIECE_TEXT = 1;
const PIECE_COMMENT = 2;
function advancePiece(lexer: Lexer, depth: { n: number }): number {
  const c = lexer.lookahead;
  lexer.advance(false);
  if (c === DQUOTE || c === SQUOTE) {
    while (!lexer.eof() && lexer.lookahead !== c && lexer.lookahead !== NEWLINE) {
      if (lexer.lookahead === BACKSLASH) lexer.advance(false);
      lexer.advance(false);
    }
    if (lexer.lookahead === c) lexer.advance(false);
  } else if (c === SLASH && lexer.lookahead === STAR) {
    lexer.advance(false);
    while (!lexer.eof()) {
      if (lexer.lookahead !== STAR) {
        lexer.advance(false);
        continue;
      }
      lexer.advance(false);
      if (peek(lexer) === SLASH) {
        lexer.advance(false);
        break;
      }
    }
    return PIECE_COMMENT;
  } else if (c === LBRACE || c === LPAREN || c === LBRACKET) depth.n++;
  else if (c === RBRACE || c === RPAREN || c === RBRACKET) depth.n--;
  return iswspace(c) ? PIECE_SPACE : PIECE_TEXT;
}

/**
 * Past whitespace and `/* *\/` comments, which postcss reads between a declaration's name, its colon and its value
 * (`--name/* c *\/ : {`); false at a lone `/` or an unclosed comment.
 */
function advanceGap(lexer: Lexer): boolean {
  for (;;) {
    if (iswspace(lexer.lookahead)) lexer.advance(false);
    else if (lexer.lookahead === SLASH) {
      lexer.advance(false);
      if (peek(lexer) !== STAR) return false;
      lexer.advance(false);
      for (;;) {
        if (lexer.eof()) return false;
        const c = peek(lexer);
        lexer.advance(false);
        if (c === STAR && peek(lexer) === SLASH) {
          lexer.advance(false);
          break;
        }
      }
    } else return true;
  }
}

/**
 * `--name: {`: postcss 8 reads a declaration whose value runs to the `;` outside brackets, and prettier lays it
 * out as a rule's block only when that value is one `{...}` group. The name's token says which; the colon and the
 * value are left to the grammar.
 */
function scanCustomPropertyName(lexer: Lexer, valid: Uint8Array): boolean {
  lexer.advance(false);
  if (lexer.lookahead !== MINUS) return false;
  lexer.advance(false);
  for (;;) {
    const c: number = lexer.lookahead;
    if (!(iswalnum(c) || c === MINUS || c === UNDERSCORE || c >= 0xa0)) break;
    lexer.advance(false);
  }
  lexer.markEnd();
  if (!advanceGap(lexer) || peek(lexer) !== COLON) return false;
  lexer.advance(false);
  if (!advanceGap(lexer)) return false;
  const depth = { n: 0 };
  if (peek(lexer) !== LBRACE) {
    // A `{...}` group later in the value, which only a custom property's value reads.
    let brace = false;
    while (!lexer.eof() && !(depth.n <= 0 && (peek(lexer) === SEMI || peek(lexer) === RBRACE))) {
      brace ||= peek(lexer) === LBRACE;
      advancePiece(lexer, depth);
    }
    // Ending the block (`a{--a: x {a:b}}`), the value is raw, which oxfmt keeps as written.
    lexer.resultSymbol = peek(lexer) === SEMI ? CUSTOM_PROPERTY_BRACE_NAME : CUSTOM_PROPERTY_RAW_NAME;
    return brace && valid[lexer.resultSymbol] !== 0;
  }
  // A group nested in the block (`{a: {b}}`) makes the value raw, as oxfmt keeps it.
  let nested = false;
  do {
    nested ||= depth.n > 0 && peek(lexer) === LBRACE;
    advancePiece(lexer, depth);
  } while (depth.n > 0 && !lexer.eof());
  if (depth.n > 0) return false;
  // Comments after the block (`{a: b} /*c*/;`), which oxfmt prints after it; a lone `/` makes the value raw.
  if (!advanceGap(lexer)) {
    lexer.resultSymbol = CUSTOM_PROPERTY_RAW_NAME;
    return valid[CUSTOM_PROPERTY_RAW_NAME] !== 0;
  }
  // A trailing `!important` (`{a: b} !important;`), which oxfmt prints after the block, and comments after it.
  if (peek(lexer) === BANG) {
    lexer.advance(false);
    while (iswspace(lexer.lookahead)) lexer.advance(false);
    for (const ch of "important") {
      if ((lexer.lookahead | 0x20) !== ch.charCodeAt(0)) return false;
      lexer.advance(false);
    }
    if (!advanceGap(lexer)) return false;
  }
  const c: number = lexer.lookahead;
  const oneGroup = !nested && (c === SEMI || c === RBRACE || lexer.eof());
  lexer.resultSymbol = oneGroup ? CUSTOM_PROPERTY_SET_NAME : CUSTOM_PROPERTY_RAW_NAME;
  return valid[lexer.resultSymbol] !== 0;
}

/**
 * A custom property's `{...}` group, one token: postcss and oxfmt read it as text, items JSON-like or not
 * (`--a: {"a": 1, "b": [1, 2]}`), which the rules of a rule's block would read into errors.
 */
function scanCustomPropertyBlock(lexer: Lexer): boolean {
  while (iswspace(lexer.lookahead)) lexer.advance(true);
  if (lexer.lookahead !== LBRACE) return false;
  const depth = { n: 0 };
  do advancePiece(lexer, depth);
  while (depth.n > 0 && !lexer.eof());
  if (depth.n > 0) return false;
  lexer.markEnd();
  lexer.resultSymbol = CUSTOM_PROPERTY_BLOCK;
  return true;
}

/**
 * The raw value itself, as written up to the `;` or the block's `}` outside brackets, less trailing whitespace and
 * comments, which postcss and oxfmt print after the value (`--a: x {a:b} /*c*\/}` is `--a: x {a:b}; /*c*\/`).
 */
function scanCustomPropertyRawValue(lexer: Lexer): boolean {
  while (iswspace(lexer.lookahead)) lexer.advance(true);
  const depth = { n: 0 };
  let any = false;
  while (
    !lexer.eof() &&
    !(depth.n <= 0 && (lexer.lookahead === SEMI || lexer.lookahead === RBRACE))
  ) {
    if (advancePiece(lexer, depth) === PIECE_TEXT) {
      lexer.markEnd();
      any = true;
    }
  }
  lexer.resultSymbol = CUSTOM_PROPERTY_RAW_VALUE;
  return any;
}

/**
 * An unquoted `url()`'s content, which postcss-value-parser reads as one word: up to the `)`, a `\` escaping the
 * character after it, less the whitespace around it. A `(` or a quote makes it no such word, so the arguments parse
 * as any function's (`url(var(--a))`).
 */
function scanUrlRaw(lexer: Lexer): boolean {
  while (iswspace(lexer.lookahead)) lexer.advance(true);
  let any = false;
  while (lexer.lookahead !== RPAREN) {
    const c = lexer.lookahead;
    if (lexer.eof() || c === LPAREN || c === DQUOTE || c === SQUOTE) return false;
    lexer.advance(false);
    if (c === BACKSLASH) {
      if (lexer.eof() || lexer.lookahead === NEWLINE) return false;
      lexer.advance(false);
    } else if (iswspace(c)) continue;
    lexer.markEnd();
    any = true;
  }
  lexer.resultSymbol = URL_RAW;
  return any;
}

function scan(lexer: Lexer, valid: Uint8Array, state: State): boolean {
  if (valid[ERROR_RECOVERY]) return false;

  if (valid[URL_RAW]) return scanUrlRaw(lexer);

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
      // postcss reads a quoted string as a selector part (`one "two" three`).
      c === DQUOTE ||
      c === SQUOTE ||
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

  if (valid[CUSTOM_PROPERTY_RAW_VALUE]) return scanCustomPropertyRawValue(lexer);

  if (valid[CUSTOM_PROPERTY_BLOCK]) return scanCustomPropertyBlock(lexer);

  if (
    valid[CUSTOM_PROPERTY_SET_NAME] ||
    valid[CUSTOM_PROPERTY_RAW_NAME] ||
    valid[CUSTOM_PROPERTY_BRACE_NAME]
  ) {
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    if (lexer.lookahead === MINUS) return scanCustomPropertyName(lexer, valid);
  }

  if (valid[PSEUDO_CLASS_SELECTOR_COLON]) {
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    if (lexer.lookahead === COLON) {
      lexer.advance(false);
      if (lexer.lookahead === COLON) return false;
      lexer.markEnd();
      lexer.resultSymbol = PSEUDO_CLASS_SELECTOR_COLON;
      if (state.inCustomSelector) return true;
      // `font: {` and `font: 20px fantasy {` are postcss-nested-props, rules whose selector ends in the colon.
      const next: number = lexer.lookahead;
      if (iswspace(next) || next === LBRACE) return false;
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
