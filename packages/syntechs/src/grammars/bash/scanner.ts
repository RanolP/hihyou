// Port of tree-sitter-bash 0.25.1 src/scanner.c: heredocs, word concatenation, test operators, regexes,
// extglob patterns and the words inside parameter expansions.
//
// Kept from the C scanner on purpose, since the parse tables were generated against it: a heredoc delimiter is
// stored as C `char`s (each code point cut to its low byte, compared sign-extended) with its trailing NUL, and
// `deserialize` reuses the heredoc array without shrinking it, so a stale heredoc past the serialized count stays.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswalpha, iswdigit, iswspace } from "../../core/wctype.js";

const HEREDOC_START = 0;
const SIMPLE_HEREDOC_BODY = 1;
const HEREDOC_BODY_BEGINNING = 2;
const HEREDOC_CONTENT = 3;
const HEREDOC_END = 4;
const FILE_DESCRIPTOR = 5;
const EMPTY_VALUE = 6;
const CONCAT = 7;
const VARIABLE_NAME = 8;
const TEST_OPERATOR = 9;
const REGEX = 10;
const REGEX_NO_SLASH = 11;
const REGEX_NO_SPACE = 12;
const EXPANSION_WORD = 13;
const EXTGLOB_PATTERN = 14;
const BARE_DOLLAR = 15;
const BRACE_START = 16;
const IMMEDIATE_DOUBLE_HASH = 17;
const EXTERNAL_EXPANSION_SYM_HASH = 18;
const EXTERNAL_EXPANSION_SYM_BANG = 19;
const EXTERNAL_EXPANSION_SYM_EQUAL = 20;
const CLOSING_BRACE = 21;
const CLOSING_BRACKET = 22;
const HEREDOC_ARROW = 23;
const HEREDOC_ARROW_DASH = 24;
const NEWLINE = 25;
const OPENING_PAREN = 26;
const ERROR_RECOVERY = 28;

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
const UNDERSCORE = 95;
const BACKTICK = 96;
const LOWER_A = 97;
const LOWER_C = 99;
const LOWER_E = 101;
const LOWER_S = 115;
const LEFT_BRACE = 123;
const PIPE = 124;
const RIGHT_BRACE = 125;
const ZERO = 48;

const BUFFER_SIZE = 1024;

interface Heredoc {
  isRaw: boolean;
  started: boolean;
  allowsIndent: boolean;
  /** C `char`s, each a code point's low byte, ending in the NUL `advanceWord` pushes. */
  delimiter: number[];
}

const newHeredoc = (): Heredoc => ({
  isRaw: false,
  started: false,
  allowsIndent: false,
  delimiter: [],
});

function resetHeredoc(heredoc: Heredoc): void {
  heredoc.isRaw = false;
  heredoc.started = false;
  heredoc.allowsIndent = false;
  heredoc.delimiter = [];
}

/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

const advance = (lexer: Lexer): void => lexer.advance(false);
const skip = (lexer: Lexer): void => lexer.advance(true);

/** A code point stored as a C `char`: its low byte. */
const toChar = (c: number): number => c & 0xff;
/** A stored `char` widened back to `int32_t` for a comparison with the lookahead, sign-extended as C does. */
const fromChar = (c: number): number => (c << 24) >> 24;

/**
 * Consume a "word" in POSIX parlance, and return it unquoted. Approximate: no POSIX-mandated substitution,
 * and the default IFS.
 */
function advanceWord(lexer: Lexer, unquotedWord: number[]): boolean {
  let empty = true;

  let quote = 0;
  if (la(lexer) === SINGLE_QUOTE || la(lexer) === DOUBLE_QUOTE) {
    quote = la(lexer);
    advance(lexer);
  }

  while (
    la(lexer) !== NUL &&
    !(quote
      ? la(lexer) === quote || la(lexer) === CR || la(lexer) === LF
      : iswspace(la(lexer)))
  ) {
    if (la(lexer) === BACKSLASH) {
      advance(lexer);
      if (la(lexer) === NUL) return false;
    }
    empty = false;
    unquotedWord.push(toChar(la(lexer)));
    advance(lexer);
  }
  unquotedWord.push(NUL);

  if (quote && la(lexer) === quote) advance(lexer);

  return !empty;
}

function scanBareDollar(lexer: Lexer): boolean {
  while (iswspace(la(lexer)) && la(lexer) !== LF && !lexer.eof()) skip(lexer);

  if (la(lexer) === DOLLAR) {
    advance(lexer);
    lexer.resultSymbol = BARE_DOLLAR;
    lexer.markEnd();
    return iswspace(la(lexer)) || lexer.eof() || la(lexer) === DOUBLE_QUOTE;
  }

  return false;
}

function scanHeredocStart(heredoc: Heredoc, lexer: Lexer): boolean {
  while (iswspace(la(lexer))) skip(lexer);

  lexer.resultSymbol = HEREDOC_START;
  heredoc.isRaw =
    la(lexer) === SINGLE_QUOTE ||
    la(lexer) === DOUBLE_QUOTE ||
    la(lexer) === BACKSLASH;

  const foundDelimiter = advanceWord(lexer, heredoc.delimiter);
  if (!foundDelimiter) {
    heredoc.delimiter = [];
    return false;
  }
  return foundDelimiter;
}

/** Whether this line starts with the heredoc's delimiter, consuming the matching prefix. */
function scanHeredocEndIdentifier(heredoc: Heredoc, lexer: Lexer): boolean {
  const delimiter = heredoc.delimiter;
  let size = 0;
  if (delimiter.length > 0) {
    while (
      la(lexer) !== NUL &&
      la(lexer) !== LF &&
      size < delimiter.length &&
      fromChar(delimiter[size] as number) === la(lexer)
    ) {
      advance(lexer);
      size++;
    }
  }
  if (delimiter.length === 0) return false;
  // strcmp of the matched prefix against the delimiter up to its NUL.
  const end = delimiter.indexOf(NUL);
  return size === (end < 0 ? delimiter.length : end);
}

class BashScanner implements ExternalScanner {
  lastGlobParenDepth = 0;
  extWasInDoubleQuote = false;
  extSawOutsideQuote = false;
  heredocs: Heredoc[] = [];

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    const inErrorRecovery = !!valid[ERROR_RECOVERY];

    if (valid[CONCAT] && !inErrorRecovery) {
      const c = la(lexer);
      if (
        !(
          c === NUL ||
          iswspace(c) ||
          c === RIGHT_ANGLE ||
          c === LEFT_ANGLE ||
          c === RIGHT_PAREN ||
          c === LEFT_PAREN ||
          c === SEMICOLON ||
          c === AMPERSAND ||
          c === PIPE ||
          (c === RIGHT_BRACE && valid[CLOSING_BRACE]) ||
          (c === RIGHT_BRACKET && valid[CLOSING_BRACKET])
        )
      ) {
        lexer.resultSymbol = CONCAT;
        // For a`b`, return a concat when the second backtick is followed by whitespace.
        if (la(lexer) === BACKTICK) {
          lexer.markEnd();
          advance(lexer);
          while (la(lexer) !== BACKTICK && !lexer.eof()) advance(lexer);
          if (lexer.eof()) return false;
          if (la(lexer) === BACKTICK) advance(lexer);
          return iswspace(la(lexer)) || lexer.eof();
        }
        // A string with expansions that holds escaped quotes or backslashes needs a concat.
        if (la(lexer) === BACKSLASH) {
          lexer.markEnd();
          advance(lexer);
          if (
            la(lexer) === DOUBLE_QUOTE ||
            la(lexer) === SINGLE_QUOTE ||
            la(lexer) === BACKSLASH
          )
            return true;
          if (lexer.eof()) return false;
        } else {
          return true;
        }
      }
      if (
        iswspace(la(lexer)) &&
        valid[CLOSING_BRACE] &&
        !valid[EXPANSION_WORD]
      ) {
        lexer.resultSymbol = CONCAT;
        return true;
      }
    }

    if (valid[IMMEDIATE_DOUBLE_HASH] && !inErrorRecovery) {
      // Two #s not followed by }.
      if (la(lexer) === HASH) {
        lexer.markEnd();
        advance(lexer);
        if (la(lexer) === HASH) {
          advance(lexer);
          if (la(lexer) !== RIGHT_BRACE) {
            lexer.resultSymbol = IMMEDIATE_DOUBLE_HASH;
            lexer.markEnd();
            return true;
          }
        }
      }
    }

    if (valid[EXTERNAL_EXPANSION_SYM_HASH] && !inErrorRecovery) {
      if (la(lexer) === HASH || la(lexer) === EQUAL || la(lexer) === BANG) {
        lexer.resultSymbol =
          la(lexer) === HASH
            ? EXTERNAL_EXPANSION_SYM_HASH
            : la(lexer) === BANG
              ? EXTERNAL_EXPANSION_SYM_BANG
              : EXTERNAL_EXPANSION_SYM_EQUAL;
        advance(lexer);
        lexer.markEnd();
        while (la(lexer) === HASH || la(lexer) === EQUAL || la(lexer) === BANG)
          advance(lexer);
        while (iswspace(la(lexer))) skip(lexer);
        return la(lexer) === RIGHT_BRACE;
      }
    }

    if (valid[EMPTY_VALUE]) {
      if (
        iswspace(la(lexer)) ||
        lexer.eof() ||
        la(lexer) === SEMICOLON ||
        la(lexer) === AMPERSAND
      ) {
        lexer.resultSymbol = EMPTY_VALUE;
        return true;
      }
    }

    if (
      (valid[HEREDOC_BODY_BEGINNING] || valid[SIMPLE_HEREDOC_BODY]) &&
      this.heredocs.length > 0 &&
      !(this.heredocs.at(-1) as Heredoc).started &&
      !inErrorRecovery
    )
      return this.scanHeredocContent(
        lexer,
        HEREDOC_BODY_BEGINNING,
        SIMPLE_HEREDOC_BODY,
      );

    if (valid[HEREDOC_END] && this.heredocs.length > 0) {
      const heredoc = this.heredocs.at(-1) as Heredoc;
      if (scanHeredocEndIdentifier(heredoc, lexer)) {
        this.heredocs.pop();
        lexer.resultSymbol = HEREDOC_END;
        return true;
      }
    }

    if (
      valid[HEREDOC_CONTENT] &&
      this.heredocs.length > 0 &&
      (this.heredocs.at(-1) as Heredoc).started &&
      !inErrorRecovery
    )
      return this.scanHeredocContent(lexer, HEREDOC_CONTENT, HEREDOC_END);

    if (valid[HEREDOC_START] && !inErrorRecovery && this.heredocs.length > 0)
      return scanHeredocStart(this.heredocs.at(-1) as Heredoc, lexer);

    if (valid[TEST_OPERATOR] && !valid[EXPANSION_WORD]) {
      while (iswspace(la(lexer)) && la(lexer) !== LF) skip(lexer);

      if (la(lexer) === BACKSLASH) {
        if (valid[EXTGLOB_PATTERN]) return this.scanExtglobPattern(lexer, valid);
        if (valid[REGEX_NO_SPACE]) return this.scanRegex(lexer, valid);
        skip(lexer);

        if (lexer.eof()) return false;

        if (la(lexer) === CR) {
          skip(lexer);
          if (la(lexer) === LF) skip(lexer);
        } else if (la(lexer) === LF) {
          skip(lexer);
        } else {
          return false;
        }

        while (iswspace(la(lexer))) skip(lexer);
      }

      if (la(lexer) === LF && !valid[NEWLINE]) {
        skip(lexer);
        while (iswspace(la(lexer))) skip(lexer);
      }

      if (la(lexer) === MINUS) {
        advance(lexer);

        let advancedOnce = false;
        while (iswalpha(la(lexer))) {
          advancedOnce = true;
          advance(lexer);
        }

        if (iswspace(la(lexer)) && advancedOnce) {
          lexer.markEnd();
          advance(lexer);
          if (la(lexer) === RIGHT_BRACE && valid[CLOSING_BRACE]) {
            if (valid[EXPANSION_WORD]) {
              lexer.markEnd();
              lexer.resultSymbol = EXPANSION_WORD;
              return true;
            }
            return false;
          }
          lexer.resultSymbol = TEST_OPERATOR;
          return true;
        }
        if (iswspace(la(lexer)) && valid[EXTGLOB_PATTERN]) {
          lexer.resultSymbol = EXTGLOB_PATTERN;
          return true;
        }
      }

      if (valid[BARE_DOLLAR] && !inErrorRecovery && scanBareDollar(lexer))
        return true;
    }

    if (
      (valid[VARIABLE_NAME] || valid[FILE_DESCRIPTOR] || valid[HEREDOC_ARROW]) &&
      !valid[REGEX_NO_SLASH] &&
      !inErrorRecovery
    ) {
      for (;;) {
        if (
          (la(lexer) === SPACE ||
            la(lexer) === TAB ||
            la(lexer) === CR ||
            (la(lexer) === LF && !valid[NEWLINE])) &&
          !valid[EXPANSION_WORD]
        ) {
          skip(lexer);
        } else if (la(lexer) === BACKSLASH) {
          skip(lexer);

          if (lexer.eof()) {
            lexer.markEnd();
            lexer.resultSymbol = VARIABLE_NAME;
            return true;
          }

          if (la(lexer) === CR) skip(lexer);
          if (la(lexer) === LF) {
            skip(lexer);
          } else {
            if (la(lexer) === BACKSLASH && valid[EXPANSION_WORD])
              return this.scanExpansionWord(lexer, valid);
            return false;
          }
        } else {
          break;
        }
      }

      // no '*', '@', '?', '-', '$', '0', '_'
      if (
        !valid[EXPANSION_WORD] &&
        (la(lexer) === STAR ||
          la(lexer) === AT ||
          la(lexer) === QUESTION ||
          la(lexer) === MINUS ||
          la(lexer) === ZERO ||
          la(lexer) === UNDERSCORE)
      ) {
        lexer.markEnd();
        advance(lexer);
        if (
          la(lexer) === EQUAL ||
          la(lexer) === LEFT_BRACKET ||
          la(lexer) === COLON ||
          la(lexer) === MINUS ||
          la(lexer) === PERCENT ||
          la(lexer) === HASH ||
          la(lexer) === SLASH
        )
          return false;
        if (valid[EXTGLOB_PATTERN] && iswspace(la(lexer))) {
          lexer.markEnd();
          lexer.resultSymbol = EXTGLOB_PATTERN;
          return true;
        }
      }

      if (valid[HEREDOC_ARROW] && la(lexer) === LEFT_ANGLE) {
        advance(lexer);
        if (la(lexer) === LEFT_ANGLE) {
          advance(lexer);
          if (la(lexer) === MINUS) {
            advance(lexer);
            const heredoc = newHeredoc();
            heredoc.allowsIndent = true;
            this.heredocs.push(heredoc);
            lexer.resultSymbol = HEREDOC_ARROW_DASH;
          } else if (la(lexer) === LEFT_ANGLE || la(lexer) === EQUAL) {
            return false;
          } else {
            this.heredocs.push(newHeredoc());
            lexer.resultSymbol = HEREDOC_ARROW;
          }
          return true;
        }
        return false;
      }

      let isNumber = true;
      if (iswdigit(la(lexer))) {
        advance(lexer);
      } else if (iswalpha(la(lexer)) || la(lexer) === UNDERSCORE) {
        isNumber = false;
        advance(lexer);
      } else {
        if (la(lexer) === LEFT_BRACE) return this.scanBraceStart(lexer, valid);
        if (valid[EXPANSION_WORD]) return this.scanExpansionWord(lexer, valid);
        if (valid[EXTGLOB_PATTERN]) return this.scanExtglobPattern(lexer, valid);
        return false;
      }

      for (;;) {
        if (iswdigit(la(lexer))) {
          advance(lexer);
        } else if (iswalpha(la(lexer)) || la(lexer) === UNDERSCORE) {
          isNumber = false;
          advance(lexer);
        } else {
          break;
        }
      }

      if (
        isNumber &&
        valid[FILE_DESCRIPTOR] &&
        (la(lexer) === RIGHT_ANGLE || la(lexer) === LEFT_ANGLE)
      ) {
        lexer.resultSymbol = FILE_DESCRIPTOR;
        return true;
      }

      if (valid[VARIABLE_NAME]) {
        if (la(lexer) === PLUS) {
          lexer.markEnd();
          advance(lexer);
          if (la(lexer) === EQUAL || la(lexer) === COLON || valid[CLOSING_BRACE]) {
            lexer.resultSymbol = VARIABLE_NAME;
            return true;
          }
          return false;
        }
        if (la(lexer) === SLASH) return false;
        if (
          la(lexer) === EQUAL ||
          la(lexer) === LEFT_BRACKET ||
          (la(lexer) === COLON &&
            !valid[CLOSING_BRACE] &&
            !valid[OPENING_PAREN]) ||
          la(lexer) === PERCENT ||
          (la(lexer) === HASH && !isNumber) ||
          la(lexer) === AT ||
          (la(lexer) === MINUS && valid[CLOSING_BRACE])
        ) {
          lexer.markEnd();
          lexer.resultSymbol = VARIABLE_NAME;
          return true;
        }

        if (la(lexer) === QUESTION) {
          lexer.markEnd();
          advance(lexer);
          lexer.resultSymbol = VARIABLE_NAME;
          return iswalpha(la(lexer));
        }
      }

      return false;
    }

    if (valid[BARE_DOLLAR] && !inErrorRecovery && scanBareDollar(lexer))
      return true;

    return this.scanRegex(lexer, valid);
  }

  private scanHeredocContent(
    lexer: Lexer,
    middleType: number,
    endType: number,
  ): boolean {
    let didAdvance = false;
    const heredoc = this.heredocs.at(-1) as Heredoc;

    for (;;) {
      switch (la(lexer)) {
        case NUL: {
          if (lexer.eof() && didAdvance) {
            resetHeredoc(heredoc);
            lexer.resultSymbol = endType;
            return true;
          }
          return false;
        }

        case BACKSLASH: {
          didAdvance = true;
          advance(lexer);
          advance(lexer);
          break;
        }

        case DOLLAR: {
          if (heredoc.isRaw) {
            didAdvance = true;
            advance(lexer);
            break;
          }
          if (didAdvance) {
            lexer.markEnd();
            lexer.resultSymbol = middleType;
            heredoc.started = true;
            advance(lexer);
            if (
              iswalpha(la(lexer)) ||
              la(lexer) === LEFT_BRACE ||
              la(lexer) === LEFT_PAREN
            )
              return true;
            break;
          }
          if (middleType === HEREDOC_BODY_BEGINNING && lexer.getColumn() === 0) {
            lexer.resultSymbol = middleType;
            heredoc.started = true;
            return true;
          }
          return false;
        }

        case LF: {
          if (!didAdvance) skip(lexer);
          else advance(lexer);
          didAdvance = true;
          if (heredoc.allowsIndent) {
            while (iswspace(la(lexer))) advance(lexer);
          }
          lexer.resultSymbol = heredoc.started ? middleType : endType;
          lexer.markEnd();
          if (scanHeredocEndIdentifier(heredoc, lexer)) {
            if (lexer.resultSymbol === HEREDOC_END) this.heredocs.pop();
            return true;
          }
          break;
        }

        default: {
          if (lexer.getColumn() === 0) {
            // An alternative is to track the heredoc body's starting column statefully.
            while (iswspace(la(lexer))) {
              if (didAdvance) advance(lexer);
              else skip(lexer);
            }
            if (endType !== SIMPLE_HEREDOC_BODY) {
              lexer.resultSymbol = middleType;
              if (scanHeredocEndIdentifier(heredoc, lexer)) return true;
            }
            if (endType === SIMPLE_HEREDOC_BODY) {
              lexer.resultSymbol = endType;
              lexer.markEnd();
              if (scanHeredocEndIdentifier(heredoc, lexer)) return true;
            }
          }
          didAdvance = true;
          advance(lexer);
          break;
        }
      }
    }
  }

  /** The C scanner's `regex:` label, which falls through to `extglob_pattern:`. */
  private scanRegex(lexer: Lexer, valid: Uint8Array): boolean {
    if (
      (valid[REGEX] || valid[REGEX_NO_SLASH] || valid[REGEX_NO_SPACE]) &&
      !valid[ERROR_RECOVERY]
    ) {
      if (valid[REGEX] || valid[REGEX_NO_SPACE]) {
        while (iswspace(la(lexer))) skip(lexer);
      }

      if (
        (la(lexer) !== DOUBLE_QUOTE && la(lexer) !== SINGLE_QUOTE) ||
        ((la(lexer) === DOLLAR || la(lexer) === SINGLE_QUOTE) &&
          valid[REGEX_NO_SLASH]) ||
        (la(lexer) === SINGLE_QUOTE && valid[REGEX_NO_SPACE])
      ) {
        if (la(lexer) === DOLLAR && valid[REGEX_NO_SLASH]) {
          lexer.markEnd();
          advance(lexer);
          if (la(lexer) === LEFT_PAREN) return false;
        }

        lexer.markEnd();

        let done = false;
        let advancedOnce = false;
        let foundNonAlnumDollarUnderDash = false;
        let lastWasEscape = false;
        let inSingleQuote = false;
        let parenDepth = 0;
        let bracketDepth = 0;
        let braceDepth = 0;
        while (!done) {
          if (inSingleQuote) {
            if (la(lexer) === SINGLE_QUOTE) {
              inSingleQuote = false;
              advance(lexer);
              lexer.markEnd();
            }
          }
          switch (la(lexer)) {
            case BACKSLASH:
              lastWasEscape = true;
              break;
            case NUL:
              return false;
            case LEFT_PAREN:
              parenDepth++;
              lastWasEscape = false;
              break;
            case LEFT_BRACKET:
              bracketDepth++;
              lastWasEscape = false;
              break;
            case LEFT_BRACE:
              if (!lastWasEscape) braceDepth++;
              lastWasEscape = false;
              break;
            case RIGHT_PAREN:
              if (parenDepth === 0) done = true;
              parenDepth = (parenDepth - 1) >>> 0;
              lastWasEscape = false;
              break;
            case RIGHT_BRACKET:
              if (bracketDepth === 0) done = true;
              bracketDepth = (bracketDepth - 1) >>> 0;
              lastWasEscape = false;
              break;
            case RIGHT_BRACE:
              if (braceDepth === 0) done = true;
              braceDepth = (braceDepth - 1) >>> 0;
              lastWasEscape = false;
              break;
            case SINGLE_QUOTE:
              // Enter or exit a single-quoted string.
              inSingleQuote = !inSingleQuote;
              advance(lexer);
              advancedOnce = true;
              lastWasEscape = false;
              continue;
            default:
              lastWasEscape = false;
              break;
          }

          if (!done) {
            if (valid[REGEX]) {
              const wasSpace = !inSingleQuote && iswspace(la(lexer));
              advance(lexer);
              advancedOnce = true;
              if (!wasSpace || parenDepth > 0) lexer.markEnd();
            } else if (valid[REGEX_NO_SLASH]) {
              if (la(lexer) === SLASH) {
                lexer.markEnd();
                lexer.resultSymbol = REGEX_NO_SLASH;
                return advancedOnce;
              }
              if (la(lexer) === BACKSLASH) {
                advance(lexer);
                advancedOnce = true;
                if (
                  !lexer.eof() &&
                  la(lexer) !== LEFT_BRACKET &&
                  la(lexer) !== SLASH
                ) {
                  advance(lexer);
                  lexer.markEnd();
                }
              } else {
                const wasSpace = !inSingleQuote && iswspace(la(lexer));
                advance(lexer);
                advancedOnce = true;
                if (!wasSpace) lexer.markEnd();
              }
            } else if (valid[REGEX_NO_SPACE]) {
              if (la(lexer) === BACKSLASH) {
                foundNonAlnumDollarUnderDash = true;
                advance(lexer);
                if (!lexer.eof()) advance(lexer);
              } else if (la(lexer) === DOLLAR) {
                lexer.markEnd();
                advance(lexer);
                // Not a command substitution.
                if (la(lexer) === LEFT_PAREN) return false;
                // A trailing $ always means a regex, as in 99999999$.
                if (iswspace(la(lexer))) {
                  lexer.resultSymbol = REGEX_NO_SPACE;
                  lexer.markEnd();
                  return true;
                }
              } else {
                const wasSpace = !inSingleQuote && iswspace(la(lexer));
                if (wasSpace && parenDepth === 0) {
                  lexer.markEnd();
                  lexer.resultSymbol = REGEX_NO_SPACE;
                  return foundNonAlnumDollarUnderDash;
                }
                if (
                  !iswalnum(la(lexer)) &&
                  la(lexer) !== DOLLAR &&
                  la(lexer) !== MINUS &&
                  la(lexer) !== UNDERSCORE
                )
                  foundNonAlnumDollarUnderDash = true;
                advance(lexer);
              }
            }
          }
        }

        lexer.resultSymbol = valid[REGEX_NO_SLASH]
          ? REGEX_NO_SLASH
          : valid[REGEX_NO_SPACE]
            ? REGEX_NO_SPACE
            : REGEX;
        if (valid[REGEX] && !advancedOnce) return false;
        return true;
      }
    }
    return this.scanExtglobPattern(lexer, valid);
  }

  /** The C scanner's `extglob_pattern:` label, which falls through to `expansion_word:`. */
  private scanExtglobPattern(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[EXTGLOB_PATTERN] && !valid[ERROR_RECOVERY]) {
      // First skip whitespace, then look for ? * + @ !
      while (iswspace(la(lexer))) skip(lexer);

      const c = la(lexer);
      if (
        c === QUESTION ||
        c === STAR ||
        c === PLUS ||
        c === AT ||
        c === BANG ||
        c === MINUS ||
        c === RIGHT_PAREN ||
        c === BACKSLASH ||
        c === DOT ||
        c === LEFT_BRACKET ||
        iswalpha(c)
      ) {
        if (la(lexer) === BACKSLASH) {
          advance(lexer);
          if (
            (iswspace(la(lexer)) || la(lexer) === DOUBLE_QUOTE) &&
            la(lexer) !== CR &&
            la(lexer) !== LF
          ) {
            advance(lexer);
          } else {
            return false;
          }
        }

        if (la(lexer) === RIGHT_PAREN && this.lastGlobParenDepth === 0) {
          lexer.markEnd();
          advance(lexer);
          if (iswspace(la(lexer))) return false;
        }

        lexer.markEnd();
        const wasNonAlpha = !iswalpha(la(lexer));
        if (la(lexer) !== LEFT_BRACKET) {
          // no esac
          if (la(lexer) === LOWER_E) {
            lexer.markEnd();
            advance(lexer);
            if (la(lexer) === LOWER_S) {
              advance(lexer);
              if (la(lexer) === LOWER_A) {
                advance(lexer);
                if (la(lexer) === LOWER_C) {
                  advance(lexer);
                  if (iswspace(la(lexer))) return false;
                }
              }
            }
          } else {
            advance(lexer);
          }
        }

        // -\w is just a word, find something else special
        if (la(lexer) === MINUS) {
          lexer.markEnd();
          advance(lexer);
          while (iswalnum(la(lexer))) advance(lexer);

          if (
            la(lexer) === RIGHT_PAREN ||
            la(lexer) === BACKSLASH ||
            la(lexer) === DOT
          )
            return false;
          lexer.markEnd();
        }

        // case item -) or *)
        if (la(lexer) === RIGHT_PAREN && this.lastGlobParenDepth === 0) {
          lexer.markEnd();
          advance(lexer);
          if (iswspace(la(lexer))) {
            lexer.resultSymbol = EXTGLOB_PATTERN;
            return wasNonAlpha;
          }
        }

        if (iswspace(la(lexer))) {
          lexer.markEnd();
          lexer.resultSymbol = EXTGLOB_PATTERN;
          this.lastGlobParenDepth = 0;
          return true;
        }

        if (la(lexer) === DOLLAR) {
          lexer.markEnd();
          advance(lexer);
          if (la(lexer) === LEFT_BRACE || la(lexer) === LEFT_PAREN) {
            lexer.resultSymbol = EXTGLOB_PATTERN;
            return true;
          }
        }

        if (la(lexer) === PIPE) {
          lexer.markEnd();
          advance(lexer);
          lexer.resultSymbol = EXTGLOB_PATTERN;
          return true;
        }

        if (
          !iswalnum(la(lexer)) &&
          la(lexer) !== LEFT_PAREN &&
          la(lexer) !== DOUBLE_QUOTE &&
          la(lexer) !== LEFT_BRACKET &&
          la(lexer) !== QUESTION &&
          la(lexer) !== SLASH &&
          la(lexer) !== BACKSLASH &&
          la(lexer) !== UNDERSCORE &&
          la(lexer) !== STAR
        )
          return false;

        let done = false;
        let sawNonAlphaDot = wasNonAlpha;
        let parenDepth = this.lastGlobParenDepth;
        let bracketDepth = 0;
        let braceDepth = 0;
        while (!done) {
          switch (la(lexer)) {
            case NUL:
              return false;
            case LEFT_PAREN:
              parenDepth = (parenDepth + 1) >>> 0;
              break;
            case LEFT_BRACKET:
              bracketDepth++;
              break;
            case LEFT_BRACE:
              braceDepth++;
              break;
            case RIGHT_PAREN:
              if (parenDepth === 0) done = true;
              parenDepth = (parenDepth - 1) >>> 0;
              break;
            case RIGHT_BRACKET:
              if (bracketDepth === 0) done = true;
              bracketDepth = (bracketDepth - 1) >>> 0;
              break;
            case RIGHT_BRACE:
              if (braceDepth === 0) done = true;
              braceDepth = (braceDepth - 1) >>> 0;
              break;
          }

          if (la(lexer) === PIPE) {
            lexer.markEnd();
            advance(lexer);
            if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
              lexer.resultSymbol = EXTGLOB_PATTERN;
              return true;
            }
          }

          if (!done) {
            const wasSpace = iswspace(la(lexer));
            if (la(lexer) === DOLLAR) {
              lexer.markEnd();
              if (
                !iswalpha(la(lexer)) &&
                la(lexer) !== DOT &&
                la(lexer) !== BACKSLASH
              )
                sawNonAlphaDot = true;
              advance(lexer);
              if (la(lexer) === LEFT_PAREN || la(lexer) === LEFT_BRACE) {
                lexer.resultSymbol = EXTGLOB_PATTERN;
                // A uint8_t in the C scanner.
                this.lastGlobParenDepth = parenDepth & 0xff;
                return sawNonAlphaDot;
              }
            }
            if (wasSpace) {
              lexer.markEnd();
              lexer.resultSymbol = EXTGLOB_PATTERN;
              this.lastGlobParenDepth = 0;
              return sawNonAlphaDot;
            }
            if (la(lexer) === DOUBLE_QUOTE) {
              lexer.markEnd();
              lexer.resultSymbol = EXTGLOB_PATTERN;
              this.lastGlobParenDepth = 0;
              return sawNonAlphaDot;
            }
            if (la(lexer) === BACKSLASH) {
              if (
                !iswalpha(la(lexer)) &&
                la(lexer) !== DOT &&
                la(lexer) !== BACKSLASH
              )
                sawNonAlphaDot = true;
              advance(lexer);
              if (iswspace(la(lexer)) || la(lexer) === DOUBLE_QUOTE)
                advance(lexer);
            } else {
              if (
                !iswalpha(la(lexer)) &&
                la(lexer) !== DOT &&
                la(lexer) !== BACKSLASH
              )
                sawNonAlphaDot = true;
              advance(lexer);
            }
            if (!wasSpace) lexer.markEnd();
          }
        }

        lexer.resultSymbol = EXTGLOB_PATTERN;
        this.lastGlobParenDepth = 0;
        return sawNonAlphaDot;
      }
      this.lastGlobParenDepth = 0;

      return false;
    }
    return this.scanExpansionWord(lexer, valid);
  }

  /** The C scanner's `expansion_word:` label, which falls through to `brace_start:`. */
  private scanExpansionWord(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[EXPANSION_WORD]) {
      let advancedOnce = false;
      let advanceOnceSpace = false;
      for (;;) {
        if (la(lexer) === DOUBLE_QUOTE) return false;
        if (la(lexer) === DOLLAR) {
          lexer.markEnd();
          advance(lexer);
          if (
            la(lexer) === LEFT_BRACE ||
            la(lexer) === LEFT_PAREN ||
            la(lexer) === SINGLE_QUOTE ||
            iswalnum(la(lexer))
          ) {
            lexer.resultSymbol = EXPANSION_WORD;
            return advancedOnce;
          }
          advancedOnce = true;
        }

        if (la(lexer) === RIGHT_BRACE) {
          lexer.markEnd();
          lexer.resultSymbol = EXPANSION_WORD;
          return advancedOnce || advanceOnceSpace;
        }

        if (la(lexer) === LEFT_PAREN && !(advancedOnce || advanceOnceSpace)) {
          lexer.markEnd();
          advance(lexer);
          while (la(lexer) !== RIGHT_PAREN && !lexer.eof()) {
            // A $( or ${ here is taken as a weird word concatenated with an expansion.
            if (la(lexer) === DOLLAR) {
              lexer.markEnd();
              advance(lexer);
              if (
                la(lexer) === LEFT_BRACE ||
                la(lexer) === LEFT_PAREN ||
                la(lexer) === SINGLE_QUOTE ||
                iswalnum(la(lexer))
              ) {
                lexer.resultSymbol = EXPANSION_WORD;
                return advancedOnce;
              }
              advancedOnce = true;
            } else {
              advancedOnce = advancedOnce || !iswspace(la(lexer));
              advanceOnceSpace = advanceOnceSpace || iswspace(la(lexer));
              advance(lexer);
            }
          }
          lexer.markEnd();
          if (la(lexer) === RIGHT_PAREN) {
            advancedOnce = true;
            advance(lexer);
            lexer.markEnd();
            if (la(lexer) === RIGHT_BRACE) return false;
          } else {
            return false;
          }
        }

        if (la(lexer) === SINGLE_QUOTE) return false;

        if (lexer.eof()) return false;
        advancedOnce = advancedOnce || !iswspace(la(lexer));
        advanceOnceSpace = advanceOnceSpace || iswspace(la(lexer));
        advance(lexer);
      }
    }
    return this.scanBraceStart(lexer, valid);
  }

  /** The C scanner's `brace_start:` label: `{1..9}`. */
  private scanBraceStart(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[BRACE_START] && !valid[ERROR_RECOVERY]) {
      while (iswspace(la(lexer))) skip(lexer);

      if (la(lexer) !== LEFT_BRACE) return false;

      advance(lexer);
      lexer.markEnd();

      while (iswdigit(la(lexer))) advance(lexer);

      if (la(lexer) !== DOT) return false;
      advance(lexer);

      if (la(lexer) !== DOT) return false;
      advance(lexer);

      while (iswdigit(la(lexer))) advance(lexer);

      if (la(lexer) !== RIGHT_BRACE) return false;

      lexer.resultSymbol = BRACE_START;
      return true;
    }

    return false;
  }

  serialize(buffer: Uint8Array): number {
    let size = 0;

    buffer[size++] = this.lastGlobParenDepth;
    buffer[size++] = Number(this.extWasInDoubleQuote);
    buffer[size++] = Number(this.extSawOutsideQuote);
    buffer[size++] = this.heredocs.length & 0xff;

    for (const heredoc of this.heredocs) {
      if (size + 3 + 4 + heredoc.delimiter.length >= BUFFER_SIZE) return 0;

      buffer[size++] = Number(heredoc.isRaw);
      buffer[size++] = Number(heredoc.started);
      buffer[size++] = Number(heredoc.allowsIndent);

      // A uint32_t copied with memcpy: little-endian on every host web-tree-sitter runs on.
      const length = heredoc.delimiter.length;
      buffer[size++] = length & 0xff;
      buffer[size++] = (length >>> 8) & 0xff;
      buffer[size++] = (length >>> 16) & 0xff;
      buffer[size++] = (length >>> 24) & 0xff;
      for (const c of heredoc.delimiter) buffer[size++] = c;
    }
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    if (length === 0) {
      for (const heredoc of this.heredocs) resetHeredoc(heredoc);
      return;
    }
    let size = 0;
    this.lastGlobParenDepth = buffer[size++] as number;
    this.extWasInDoubleQuote = !!buffer[size++];
    this.extSawOutsideQuote = !!buffer[size++];
    const heredocCount = buffer[size++] as number;
    for (let i = 0; i < heredocCount; i++) {
      let heredoc = this.heredocs[i];
      if (!heredoc) {
        heredoc = newHeredoc();
        this.heredocs.push(heredoc);
      }

      heredoc.isRaw = !!buffer[size++];
      heredoc.started = !!buffer[size++];
      heredoc.allowsIndent = !!buffer[size++];

      const delimiterLength =
        ((buffer[size] as number) |
          ((buffer[size + 1] as number) << 8) |
          ((buffer[size + 2] as number) << 16) |
          ((buffer[size + 3] as number) << 24)) >>>
        0;
      size += 4;
      heredoc.delimiter = Array.from(
        buffer.subarray(size, size + delimiterLength),
      );
      size += delimiterLength;
    }
    if (size !== length)
      throw new Error(`bash scanner state used ${size} of ${length} bytes`);
  }
}

export function createScanner(): ExternalScanner {
  return new BashScanner();
}
