// Port of tree-sitter-ruby 0.23.1 src/scanner.c: line breaks, literals, heredocs and whitespace-sensitive tokens.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswalpha, iswdigit, iswspace } from "../../core/wctype.js";

const LINE_BREAK = 0;
const NO_LINE_BREAK = 1;
const SIMPLE_SYMBOL = 2;
const STRING_START = 3;
const SYMBOL_START = 4;
const SUBSHELL_START = 5;
const REGEX_START = 6;
const STRING_ARRAY_START = 7;
const SYMBOL_ARRAY_START = 8;
const HEREDOC_BODY_START = 9;
const STRING_CONTENT = 10;
const HEREDOC_CONTENT = 11;
const STRING_END = 12;
const HEREDOC_BODY_END = 13;
const HEREDOC_START = 14;
const FORWARD_SLASH = 15;
const BLOCK_AMPERSAND = 16;
const SPLAT_STAR = 17;
const UNARY_MINUS = 18;
const UNARY_MINUS_NUM = 19;
const BINARY_MINUS = 20;
const BINARY_STAR = 21;
const SINGLETON_CLASS_LEFT_ANGLE_LEFT_ANGLE = 22;
const HASH_KEY_SYMBOL = 23;
const IDENTIFIER_SUFFIX = 24;
const CONSTANT_SUFFIX = 25;
const HASH_SPLAT_STAR_STAR = 26;
const BINARY_STAR_STAR = 27;
const ELEMENT_REFERENCE_BRACKET = 28;
const SHORT_INTERPOLATION = 29;
const NONE = 30;

const NUL = 0;
const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const BANG = 33;
const DOUBLE_QUOTE = 34;
const HASH = 35;
const DOLLAR = 36;
const PERCENT = 37;
const AMPERSAND = 38;
const SINGLE_QUOTE = 39;
const LEFT_PAREN = 40;
const RIGHT_PAREN = 41;
const STAR = 42;
const PLUS = 43;
const COMMA = 44;
const MINUS = 45;
const DOT = 46;
const SLASH = 47;
const COLON = 58;
const SEMICOLON = 59;
const LEFT_ANGLE = 60;
const EQUAL = 61;
const RIGHT_ANGLE = 62;
const QUESTION = 63;
const AT = 64;
const LEFT_BRACKET = 91;
const BACKSLASH = 92;
const RIGHT_BRACKET = 93;
const CARET = 94;
const UNDERSCORE = 95;
const BACKTICK = 96;
const LEFT_BRACE = 123;
const PIPE = 124;
const RIGHT_BRACE = 125;
const TILDE = 126;

interface Literal {
  type: number;
  openDelimiter: number;
  closeDelimiter: number;
  nestingDepth: number;
  allowsInterpolation: boolean;
}

interface Heredoc {
  word: number[];
  endWordIndentationAllowed: boolean;
  allowsInterpolation: boolean;
  started: boolean;
}

const NON_IDENTIFIER_CHARS = new Set([
  NUL,
  LF,
  CR,
  TAB,
  SPACE,
  COLON,
  SEMICOLON,
  BACKTICK,
  DOUBLE_QUOTE,
  SINGLE_QUOTE,
  AT,
  DOLLAR,
  HASH,
  DOT,
  COMMA,
  PIPE,
  CARET,
  AMPERSAND,
  LEFT_ANGLE,
  EQUAL,
  RIGHT_ANGLE,
  PLUS,
  MINUS,
  STAR,
  SLASH,
  BACKSLASH,
  PERCENT,
  QUESTION,
  BANG,
  TILDE,
  LEFT_PAREN,
  RIGHT_PAREN,
  LEFT_BRACKET,
  RIGHT_BRACKET,
  LEFT_BRACE,
  RIGHT_BRACE,
]);

/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

const iswlower = (c: number): boolean => {
  if (!iswalpha(c)) return false;
  const s = String.fromCodePoint(c);
  return s.toLowerCase() === s && s.toUpperCase() !== s;
};

const iswupper = (c: number): boolean => {
  if (!iswalpha(c)) return false;
  const s = String.fromCodePoint(c);
  return s.toUpperCase() === s && s.toLowerCase() !== s;
};

function isIdentifierChar(c: number): boolean {
  return !NON_IDENTIFIER_CHARS.has(c & 0xff);
}

function scanOperator(lexer: Lexer): boolean {
  switch (la(lexer)) {
    case LEFT_ANGLE:
      lexer.advance(false);
      if (la(lexer) === LEFT_ANGLE) {
        lexer.advance(false);
      } else if (la(lexer) === EQUAL) {
        lexer.advance(false);
        if (la(lexer) === RIGHT_ANGLE) lexer.advance(false);
      }
      return true;
    case RIGHT_ANGLE:
      lexer.advance(false);
      if (la(lexer) === RIGHT_ANGLE || la(lexer) === EQUAL)
        lexer.advance(false);
      return true;
    case EQUAL:
      lexer.advance(false);
      if (la(lexer) === TILDE) {
        lexer.advance(false);
        return true;
      }
      if (la(lexer) === EQUAL) {
        lexer.advance(false);
        if (la(lexer) === EQUAL) lexer.advance(false);
        return true;
      }
      return false;
    case PLUS:
    case MINUS:
    case TILDE:
      lexer.advance(false);
      if (la(lexer) === AT) lexer.advance(false);
      return true;
    case DOT:
      lexer.advance(false);
      if (la(lexer) === DOT) {
        lexer.advance(false);
        return true;
      }
      return false;
    case AMPERSAND:
    case CARET:
    case PIPE:
    case SLASH:
    case PERCENT:
    case BACKTICK:
      lexer.advance(false);
      return true;
    case BANG:
      lexer.advance(false);
      if (la(lexer) === EQUAL || la(lexer) === TILDE) lexer.advance(false);
      return true;
    case STAR:
      lexer.advance(false);
      if (la(lexer) === STAR) lexer.advance(false);
      return true;
    case LEFT_BRACKET:
      lexer.advance(false);
      if (la(lexer) !== RIGHT_BRACKET) return false;
      lexer.advance(false);
      if (la(lexer) === EQUAL) lexer.advance(false);
      return true;
    default:
      return false;
  }
}

function scanSymbolIdentifier(lexer: Lexer): boolean {
  if (la(lexer) === AT) {
    lexer.advance(false);
    if (la(lexer) === AT) lexer.advance(false);
  } else if (la(lexer) === DOLLAR) {
    lexer.advance(false);
  }

  if (isIdentifierChar(la(lexer))) lexer.advance(false);
  else if (!scanOperator(lexer)) return false;

  while (isIdentifierChar(la(lexer))) lexer.advance(false);

  if (la(lexer) === QUESTION || la(lexer) === BANG) lexer.advance(false);

  if (la(lexer) === EQUAL) {
    lexer.markEnd();
    lexer.advance(false);
    if (la(lexer) !== RIGHT_ANGLE) lexer.markEnd();
  }

  return true;
}

function scanShortInterpolation(
  lexer: Lexer,
  hasContent: boolean,
  contentSymbol: number,
): boolean {
  const start = la(lexer) & 0xff;
  if (start !== AT && start !== DOLLAR) return false;
  if (hasContent) {
    lexer.resultSymbol = contentSymbol;
    return true;
  }

  lexer.markEnd();
  lexer.advance(false);
  let short = false;
  if (start === DOLLAR) {
    if (`!@&\`'+~=/\\,;.<>*$?:"`.includes(String.fromCodePoint(la(lexer)))) {
      short = true;
    } else if (la(lexer) === MINUS) {
      lexer.advance(false);
      short = iswalpha(la(lexer)) || la(lexer) === UNDERSCORE;
    } else {
      short = iswalnum(la(lexer)) || la(lexer) === UNDERSCORE;
    }
  } else {
    if (la(lexer) === AT) lexer.advance(false);
    short = isIdentifierChar(la(lexer)) && !iswdigit(la(lexer));
  }

  if (!short) return false;
  lexer.resultSymbol = SHORT_INTERPOLATION;
  return true;
}

class RubyScanner implements ExternalScanner {
  hasLeadingWhitespace = false;
  literalStack: Literal[] = [];
  openHeredocs: Heredoc[] = [];

  private skip(lexer: Lexer): void {
    this.hasLeadingWhitespace = true;
    lexer.advance(true);
  }

  private scanWhitespace(lexer: Lexer, valid: Uint8Array): boolean {
    const heredocBodyStartIsValid =
      this.openHeredocs.length > 0 &&
      !(this.openHeredocs[0] as Heredoc).started &&
      !!valid[HEREDOC_BODY_START];
    let crossedNewline = false;

    for (;;) {
      if (
        !valid[NO_LINE_BREAK] &&
        valid[LINE_BREAK] &&
        lexer.isAtIncludedRangeStart()
      ) {
        lexer.markEnd();
        lexer.resultSymbol = LINE_BREAK;
        return true;
      }

      switch (la(lexer)) {
        case SPACE:
        case TAB:
          this.skip(lexer);
          break;
        case CR:
          if (heredocBodyStartIsValid) {
            lexer.resultSymbol = HEREDOC_BODY_START;
            (this.openHeredocs[0] as Heredoc).started = true;
            return true;
          }
          this.skip(lexer);
          break;
        case LF:
          if (heredocBodyStartIsValid) {
            lexer.resultSymbol = HEREDOC_BODY_START;
            (this.openHeredocs[0] as Heredoc).started = true;
            return true;
          }
          if (!valid[NO_LINE_BREAK] && valid[LINE_BREAK] && !crossedNewline) {
            lexer.markEnd();
            lexer.advance(false);
            crossedNewline = true;
          } else {
            this.skip(lexer);
          }
          break;
        case BACKSLASH:
          lexer.advance(false);
          if (la(lexer) === CR) this.skip(lexer);
          if (iswspace(la(lexer))) this.skip(lexer);
          else return false;
          break;
        default:
          if (crossedNewline) {
            if (
              la(lexer) !== DOT &&
              la(lexer) !== AMPERSAND &&
              la(lexer) !== HASH
            ) {
              lexer.resultSymbol = LINE_BREAK;
            } else if (la(lexer) === DOT) {
              lexer.advance(false);
              if (!lexer.eof() && la(lexer) === DOT)
                lexer.resultSymbol = LINE_BREAK;
              else return false;
            }
          }
          return true;
      }
    }
  }

  private scanOpenDelimiter(
    lexer: Lexer,
    literal: Literal,
    valid: Uint8Array,
  ): boolean {
    switch (la(lexer)) {
      case DOUBLE_QUOTE:
        literal.type = STRING_START;
        literal.openDelimiter = DOUBLE_QUOTE;
        literal.closeDelimiter = DOUBLE_QUOTE;
        literal.allowsInterpolation = true;
        lexer.advance(false);
        return true;
      case SINGLE_QUOTE:
        literal.type = STRING_START;
        literal.openDelimiter = SINGLE_QUOTE;
        literal.closeDelimiter = SINGLE_QUOTE;
        literal.allowsInterpolation = false;
        lexer.advance(false);
        return true;
      case BACKTICK:
        if (!valid[SUBSHELL_START]) return false;
        literal.type = SUBSHELL_START;
        literal.openDelimiter = BACKTICK;
        literal.closeDelimiter = BACKTICK;
        literal.allowsInterpolation = true;
        lexer.advance(false);
        return true;
      case SLASH:
        if (!valid[REGEX_START]) return false;
        literal.type = REGEX_START;
        literal.openDelimiter = SLASH;
        literal.closeDelimiter = SLASH;
        literal.allowsInterpolation = true;
        lexer.advance(false);
        if (valid[FORWARD_SLASH]) {
          if (!this.hasLeadingWhitespace) return false;
          if (
            la(lexer) === SPACE ||
            la(lexer) === TAB ||
            la(lexer) === LF ||
            la(lexer) === CR ||
            la(lexer) === EQUAL
          )
            return false;
        }
        return true;
      case PERCENT:
        lexer.advance(false);
        switch (la(lexer)) {
          case 115: // s
            if (!valid[SIMPLE_SYMBOL]) return false;
            literal.type = SYMBOL_START;
            literal.allowsInterpolation = false;
            lexer.advance(false);
            break;
          case 114: // r
            if (!valid[REGEX_START]) return false;
            literal.type = REGEX_START;
            literal.allowsInterpolation = true;
            lexer.advance(false);
            break;
          case 120: // x
            if (!valid[SUBSHELL_START]) return false;
            literal.type = SUBSHELL_START;
            literal.allowsInterpolation = true;
            lexer.advance(false);
            break;
          case 113: // q
            if (!valid[STRING_START]) return false;
            literal.type = STRING_START;
            literal.allowsInterpolation = false;
            lexer.advance(false);
            break;
          case 81: // Q
            if (!valid[STRING_START]) return false;
            literal.type = STRING_START;
            literal.allowsInterpolation = true;
            lexer.advance(false);
            break;
          case 119: // w
            if (!valid[STRING_ARRAY_START]) return false;
            literal.type = STRING_ARRAY_START;
            literal.allowsInterpolation = false;
            lexer.advance(false);
            break;
          case 105: // i
            if (!valid[SYMBOL_ARRAY_START]) return false;
            literal.type = SYMBOL_ARRAY_START;
            literal.allowsInterpolation = false;
            lexer.advance(false);
            break;
          case 87: // W
            if (!valid[STRING_ARRAY_START]) return false;
            literal.type = STRING_ARRAY_START;
            literal.allowsInterpolation = true;
            lexer.advance(false);
            break;
          case 73: // I
            if (!valid[SYMBOL_ARRAY_START]) return false;
            literal.type = SYMBOL_ARRAY_START;
            literal.allowsInterpolation = true;
            lexer.advance(false);
            break;
          default:
            if (!valid[STRING_START]) return false;
            literal.type = STRING_START;
            literal.allowsInterpolation = true;
            break;
        }

        switch (la(lexer)) {
          case LEFT_PAREN:
            literal.openDelimiter = LEFT_PAREN;
            literal.closeDelimiter = RIGHT_PAREN;
            break;
          case LEFT_BRACKET:
            literal.openDelimiter = LEFT_BRACKET;
            literal.closeDelimiter = RIGHT_BRACKET;
            break;
          case LEFT_BRACE:
            literal.openDelimiter = LEFT_BRACE;
            literal.closeDelimiter = RIGHT_BRACE;
            break;
          case LEFT_ANGLE:
            literal.openDelimiter = LEFT_ANGLE;
            literal.closeDelimiter = RIGHT_ANGLE;
            break;
          case CR:
          case LF:
          case SPACE:
          case TAB:
            if (valid[FORWARD_SLASH]) return false;
            break;
          case PIPE:
          case BANG:
          case HASH:
          case SLASH:
          case BACKSLASH:
          case AT:
          case DOLLAR:
          case PERCENT:
          case CARET:
          case AMPERSAND:
          case STAR:
          case RIGHT_PAREN:
          case RIGHT_BRACKET:
          case RIGHT_BRACE:
          case RIGHT_ANGLE:
          case PLUS:
          case MINUS:
          case TILDE:
          case BACKTICK:
          case COMMA:
          case DOT:
          case QUESTION:
          case COLON:
          case SEMICOLON:
          case UNDERSCORE:
          case DOUBLE_QUOTE:
          case SINGLE_QUOTE:
            literal.openDelimiter = la(lexer);
            literal.closeDelimiter = la(lexer);
            break;
          default:
            return false;
        }

        lexer.advance(false);
        return true;
      default:
        return false;
    }
  }

  private scanHeredocWord(lexer: Lexer, heredoc: Heredoc): void {
    let quote = 0;
    switch (la(lexer)) {
      case SINGLE_QUOTE:
      case DOUBLE_QUOTE:
      case BACKTICK:
        quote = la(lexer);
        lexer.advance(false);
        while (la(lexer) !== quote && !lexer.eof()) {
          heredoc.word.push(la(lexer));
          lexer.advance(false);
        }
        lexer.advance(false);
        break;
      default:
        if (iswalnum(la(lexer)) || la(lexer) === UNDERSCORE) {
          heredoc.word.push(la(lexer));
          lexer.advance(false);
          while (iswalnum(la(lexer)) || la(lexer) === UNDERSCORE) {
            heredoc.word.push(la(lexer));
            lexer.advance(false);
          }
        }
        break;
    }
    heredoc.allowsInterpolation = quote !== SINGLE_QUOTE;
  }

  private scanHeredocContent(lexer: Lexer): boolean {
    const heredoc = this.openHeredocs[0] as Heredoc;
    let positionInWord = 0;
    let lookForHeredocEnd = true;
    let hasContent = false;

    for (;;) {
      if (positionInWord === heredoc.word.length) {
        if (!hasContent) lexer.markEnd();
        while (la(lexer) === SPACE || la(lexer) === TAB) lexer.advance(false);
        if (la(lexer) === LF || la(lexer) === CR) {
          if (hasContent) {
            lexer.resultSymbol = HEREDOC_CONTENT;
          } else {
            this.openHeredocs.shift();
            lexer.resultSymbol = HEREDOC_BODY_END;
          }
          return true;
        }
        hasContent = true;
        positionInWord = 0;
      }

      if (lexer.eof()) {
        lexer.markEnd();
        if (hasContent) lexer.resultSymbol = HEREDOC_CONTENT;
        else {
          this.openHeredocs.shift();
          lexer.resultSymbol = HEREDOC_BODY_END;
        }
        return true;
      }

      if (la(lexer) === heredoc.word[positionInWord] && lookForHeredocEnd) {
        lexer.advance(false);
        positionInWord++;
      } else {
        positionInWord = 0;
        lookForHeredocEnd = false;

        if (heredoc.allowsInterpolation && la(lexer) === BACKSLASH) {
          if (hasContent) {
            lexer.resultSymbol = HEREDOC_CONTENT;
            return true;
          }
          return false;
        }

        if (heredoc.allowsInterpolation && la(lexer) === HASH) {
          lexer.markEnd();
          lexer.advance(false);
          if (la(lexer) === LEFT_BRACE) {
            if (hasContent) {
              lexer.resultSymbol = HEREDOC_CONTENT;
              return true;
            }
            return false;
          }
          if (scanShortInterpolation(lexer, hasContent, HEREDOC_CONTENT))
            return true;
        } else if (la(lexer) === CR || la(lexer) === LF) {
          if (la(lexer) === CR) {
            lexer.advance(false);
            if (la(lexer) === LF) lexer.advance(false);
          } else {
            lexer.advance(false);
          }
          hasContent = true;
          lookForHeredocEnd = true;
          while (la(lexer) === SPACE || la(lexer) === TAB) {
            lexer.advance(false);
            if (!heredoc.endWordIndentationAllowed) lookForHeredocEnd = false;
          }
          lexer.markEnd();
        } else {
          hasContent = true;
          lexer.advance(false);
          lexer.markEnd();
        }
      }
    }
  }

  private scanLiteralContent(lexer: Lexer): boolean {
    const literal = this.literalStack[this.literalStack.length - 1] as Literal;
    let hasContent = false;
    const stopOnSpace =
      literal.type === SYMBOL_ARRAY_START ||
      literal.type === STRING_ARRAY_START;

    for (;;) {
      if (stopOnSpace && iswspace(la(lexer))) {
        if (hasContent) {
          lexer.markEnd();
          lexer.resultSymbol = STRING_CONTENT;
          return true;
        }
        return false;
      }
      if (la(lexer) === literal.closeDelimiter) {
        lexer.markEnd();
        if (literal.nestingDepth === 1) {
          if (hasContent) {
            lexer.resultSymbol = STRING_CONTENT;
          } else {
            lexer.advance(false);
            if (literal.type === REGEX_START)
              while (iswlower(la(lexer))) lexer.advance(false);
            this.literalStack.pop();
            lexer.resultSymbol = STRING_END;
            lexer.markEnd();
          }
          return true;
        }
        literal.nestingDepth--;
        lexer.advance(false);
      } else if (la(lexer) === literal.openDelimiter) {
        literal.nestingDepth++;
        lexer.advance(false);
      } else if (literal.allowsInterpolation && la(lexer) === HASH) {
        lexer.markEnd();
        lexer.advance(false);
        if (la(lexer) === LEFT_BRACE) {
          if (hasContent) {
            lexer.resultSymbol = STRING_CONTENT;
            return true;
          }
          return false;
        }
        if (scanShortInterpolation(lexer, hasContent, STRING_CONTENT))
          return true;
      } else if (la(lexer) === BACKSLASH) {
        if (literal.allowsInterpolation) {
          if (hasContent) {
            lexer.markEnd();
            lexer.resultSymbol = STRING_CONTENT;
            return true;
          }
          return false;
        }
        lexer.advance(false);
        lexer.advance(false);
      } else if (lexer.eof()) {
        lexer.advance(false);
        lexer.markEnd();
        return false;
      } else {
        lexer.advance(false);
      }
      hasContent = true;
    }
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    this.hasLeadingWhitespace = false;

    if (!valid[STRING_START]) {
      if (
        (valid[STRING_CONTENT] || valid[STRING_END]) &&
        this.literalStack.length > 0
      )
        return this.scanLiteralContent(lexer);
      if (
        (valid[HEREDOC_CONTENT] || valid[HEREDOC_BODY_END]) &&
        this.openHeredocs.length > 0
      )
        return this.scanHeredocContent(lexer);
    }

    lexer.resultSymbol = NONE;
    if (!this.scanWhitespace(lexer, valid)) return false;
    if (lexer.resultSymbol !== NONE) return true;

    switch (la(lexer)) {
      case AMPERSAND:
        if (valid[BLOCK_AMPERSAND]) {
          lexer.advance(false);
          if (
            la(lexer) !== AMPERSAND &&
            la(lexer) !== DOT &&
            la(lexer) !== EQUAL &&
            !iswspace(la(lexer))
          ) {
            lexer.resultSymbol = BLOCK_AMPERSAND;
            return true;
          }
          return false;
        }
        break;
      case LEFT_ANGLE:
        if (valid[SINGLETON_CLASS_LEFT_ANGLE_LEFT_ANGLE]) {
          lexer.advance(false);
          if (la(lexer) === LEFT_ANGLE) {
            lexer.advance(false);
            lexer.resultSymbol = SINGLETON_CLASS_LEFT_ANGLE_LEFT_ANGLE;
            return true;
          }
          return false;
        }
        break;
      case STAR:
        if (
          valid[SPLAT_STAR] ||
          valid[BINARY_STAR] ||
          valid[HASH_SPLAT_STAR_STAR] ||
          valid[BINARY_STAR_STAR]
        ) {
          lexer.advance(false);
          if (la(lexer) === EQUAL) return false;
          if (la(lexer) === STAR) {
            if (valid[HASH_SPLAT_STAR_STAR] || valid[BINARY_STAR_STAR]) {
              lexer.advance(false);
              if (la(lexer) === EQUAL) return false;
              if (valid[BINARY_STAR_STAR] && !this.hasLeadingWhitespace) {
                lexer.resultSymbol = BINARY_STAR_STAR;
                return true;
              }
              if (valid[HASH_SPLAT_STAR_STAR] && !iswspace(la(lexer))) {
                lexer.resultSymbol = HASH_SPLAT_STAR_STAR;
                return true;
              }
              if (valid[BINARY_STAR_STAR]) {
                lexer.resultSymbol = BINARY_STAR_STAR;
                return true;
              }
              if (valid[HASH_SPLAT_STAR_STAR]) {
                lexer.resultSymbol = HASH_SPLAT_STAR_STAR;
                return true;
              }
            }
            return false;
          }
          if (valid[BINARY_STAR] && !this.hasLeadingWhitespace) {
            lexer.resultSymbol = BINARY_STAR;
            return true;
          }
          if (valid[SPLAT_STAR] && !iswspace(la(lexer))) {
            lexer.resultSymbol = SPLAT_STAR;
            return true;
          }
          if (valid[BINARY_STAR]) {
            lexer.resultSymbol = BINARY_STAR;
            return true;
          }
          if (valid[SPLAT_STAR]) {
            lexer.resultSymbol = SPLAT_STAR;
            return true;
          }
          return false;
        }
        break;
      case MINUS:
        if (
          valid[UNARY_MINUS] ||
          valid[UNARY_MINUS_NUM] ||
          valid[BINARY_MINUS]
        ) {
          lexer.advance(false);
          if (la(lexer) === EQUAL || la(lexer) === RIGHT_ANGLE) return false;
          if (
            valid[UNARY_MINUS_NUM] &&
            (!valid[BINARY_STAR] || this.hasLeadingWhitespace) &&
            iswdigit(la(lexer))
          ) {
            lexer.resultSymbol = UNARY_MINUS_NUM;
            return true;
          }
          if (
            valid[UNARY_MINUS] &&
            this.hasLeadingWhitespace &&
            !iswspace(la(lexer))
          )
            lexer.resultSymbol = UNARY_MINUS;
          else if (valid[BINARY_MINUS]) lexer.resultSymbol = BINARY_MINUS;
          else lexer.resultSymbol = UNARY_MINUS;
          return true;
        }
        break;
      case COLON:
        if (valid[SYMBOL_START]) {
          const literal: Literal = {
            type: SYMBOL_START,
            openDelimiter: 0,
            closeDelimiter: 0,
            nestingDepth: 1,
            allowsInterpolation: false,
          };
          lexer.advance(false);
          switch (la(lexer)) {
            case DOUBLE_QUOTE:
              lexer.advance(false);
              literal.openDelimiter = DOUBLE_QUOTE;
              literal.closeDelimiter = DOUBLE_QUOTE;
              literal.allowsInterpolation = true;
              this.literalStack.push(literal);
              lexer.resultSymbol = SYMBOL_START;
              return true;
            case SINGLE_QUOTE:
              lexer.advance(false);
              literal.openDelimiter = SINGLE_QUOTE;
              literal.closeDelimiter = SINGLE_QUOTE;
              this.literalStack.push(literal);
              lexer.resultSymbol = SYMBOL_START;
              return true;
            default:
              if (scanSymbolIdentifier(lexer)) {
                lexer.resultSymbol = SIMPLE_SYMBOL;
                return true;
              }
          }
          return false;
        }
        break;
      case LEFT_BRACKET:
        if (
          valid[ELEMENT_REFERENCE_BRACKET] &&
          (!this.hasLeadingWhitespace || !valid[STRING_START])
        ) {
          lexer.advance(false);
          lexer.resultSymbol = ELEMENT_REFERENCE_BRACKET;
          return true;
        }
        break;
    }

    if (
      ((valid[HASH_KEY_SYMBOL] || valid[IDENTIFIER_SUFFIX]) &&
        (iswalpha(la(lexer)) || la(lexer) === UNDERSCORE)) ||
      (valid[CONSTANT_SUFFIX] && iswupper(la(lexer)))
    ) {
      const validIdentifierSymbol = iswupper(la(lexer))
        ? CONSTANT_SUFFIX
        : IDENTIFIER_SUFFIX;
      while (iswalnum(la(lexer)) || la(lexer) === UNDERSCORE)
        lexer.advance(false);

      if (valid[HASH_KEY_SYMBOL] && la(lexer) === COLON) {
        lexer.markEnd();
        lexer.advance(false);
        if (la(lexer) !== COLON) {
          lexer.resultSymbol = HASH_KEY_SYMBOL;
          return true;
        }
      } else if (valid[validIdentifierSymbol] && la(lexer) === BANG) {
        lexer.advance(false);
        if (la(lexer) !== EQUAL) {
          lexer.resultSymbol = validIdentifierSymbol;
          return true;
        }
      }
      return false;
    }

    if (valid[STRING_START]) {
      const literal: Literal = {
        type: 0,
        openDelimiter: 0,
        closeDelimiter: 0,
        nestingDepth: 1,
        allowsInterpolation: false,
      };

      if (la(lexer) === LEFT_ANGLE) {
        lexer.advance(false);
        if (la(lexer) !== LEFT_ANGLE) return false;
        lexer.advance(false);

        const heredoc: Heredoc = {
          word: [],
          endWordIndentationAllowed: false,
          allowsInterpolation: false,
          started: false,
        };
        if (la(lexer) === MINUS || la(lexer) === TILDE) {
          lexer.advance(false);
          heredoc.endWordIndentationAllowed = true;
        }

        this.scanHeredocWord(lexer, heredoc);
        if (heredoc.word.length === 0) return false;
        this.openHeredocs.push(heredoc);
        lexer.resultSymbol = HEREDOC_START;
        return true;
      }

      if (this.scanOpenDelimiter(lexer, literal, valid)) {
        this.literalStack.push(literal);
        lexer.resultSymbol = literal.type;
        return true;
      }
      return false;
    }

    return false;
  }

  serialize(buffer: Uint8Array): number {
    let size = 0;
    if (this.literalStack.length * 5 + 2 >= buffer.length) return 0;

    buffer[size++] = this.literalStack.length;
    for (const literal of this.literalStack) {
      buffer[size++] = literal.type;
      buffer[size++] = literal.openDelimiter;
      buffer[size++] = literal.closeDelimiter;
      buffer[size++] = literal.nestingDepth;
      buffer[size++] = Number(literal.allowsInterpolation);
    }

    buffer[size++] = this.openHeredocs.length;
    for (const heredoc of this.openHeredocs) {
      if (size + 2 + heredoc.word.length >= buffer.length) return 0;
      buffer[size++] = Number(heredoc.endWordIndentationAllowed);
      buffer[size++] = Number(heredoc.allowsInterpolation);
      buffer[size++] = Number(heredoc.started);
      buffer[size++] = heredoc.word.length;
      for (const c of heredoc.word) buffer[size++] = c;
    }
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    let size = 0;
    this.hasLeadingWhitespace = false;
    this.literalStack = [];
    this.openHeredocs = [];
    if (length === 0) return;

    const literalDepth = buffer[size++] as number;
    for (let i = 0; i < literalDepth; i++) {
      this.literalStack.push({
        type: buffer[size++] as number,
        openDelimiter: buffer[size++] as number,
        closeDelimiter: buffer[size++] as number,
        nestingDepth: buffer[size++] as number,
        allowsInterpolation: !!buffer[size++],
      });
    }

    const openHeredocCount = buffer[size++] as number;
    for (let i = 0; i < openHeredocCount; i++) {
      const heredoc: Heredoc = {
        word: [],
        endWordIndentationAllowed: !!buffer[size++],
        allowsInterpolation: !!buffer[size++],
        started: !!buffer[size++],
      };
      const wordLength = buffer[size++] as number;
      for (let j = 0; j < wordLength; j++)
        heredoc.word.push(buffer[size++] as number);
      this.openHeredocs.push(heredoc);
    }
    if (size !== length)
      throw new Error(`ruby scanner state used ${size} of ${length} bytes`);
  }
}

export function createScanner(): ExternalScanner {
  return new RubyScanner();
}
