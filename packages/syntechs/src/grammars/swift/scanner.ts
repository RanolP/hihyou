// Port of tree-sitter-swift 0.7.3 src/scanner.c: nested block comments, raw strings (their `#` count is the
// state, serialized as the C scanner's four big-endian bytes), implicit semicolons, the operators and keywords
// that suppress a newline's semicolon, and compiler directives.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswspace } from "../../core/wctype.js";

const BLOCK_COMMENT = 0;
const RAW_STR_PART = 1;
const RAW_STR_CONTINUING_INDICATOR = 2;
const RAW_STR_END_PART = 3;
const IMPLICIT_SEMI = 4;
const EXPLICIT_SEMI = 5;
const ARROW_OPERATOR = 6;
const DOT_OPERATOR = 7;
const CONJUNCTION_OPERATOR = 8;
const DISJUNCTION_OPERATOR = 9;
const NIL_COALESCING_OPERATOR = 10;
const EQUAL_SIGN = 11;
const EQ_EQ = 12;
const PLUS_THEN_WS = 13;
const MINUS_THEN_WS = 14;
const BANG = 15;
const THROWS_KEYWORD = 16;
const RETHROWS_KEYWORD = 17;
const DEFAULT_KEYWORD = 18;
const WHERE_KEYWORD = 19;
const ELSE_KEYWORD = 20;
const CATCH_KEYWORD = 21;
const AS_KEYWORD = 22;
const AS_QUEST = 23;
const AS_BANG = 24;
const ASYNC_KEYWORD = 25;
const CUSTOM_OPERATOR = 26;
const HASH_SYMBOL = 27;
const DIRECTIVE_IF = 28;
const DIRECTIVE_ELSEIF = 29;
const DIRECTIVE_ELSE = 30;
const DIRECTIVE_ENDIF = 31;
const FAKE_TRY_BANG = 32;

const ALPHANUMERIC = 0;
const OPERATOR_SYMBOLS = 1;
const OPERATOR_OR_DOT = 2;
const NON_WHITESPACE = 3;

/** OPERATORS, OP_ILLEGAL_TERMINATORS, OP_SYMBOLS and OP_SYMBOL_SUPPRESSOR as one row each. */
type Operator = [
  text: string,
  illegalTerminators: number,
  symbol: number,
  suppressor: number | undefined,
];
const OPERATORS: Operator[] = [
  ["->", OPERATOR_SYMBOLS, ARROW_OPERATOR, undefined],
  [".", OPERATOR_OR_DOT, DOT_OPERATOR, undefined],
  ["&&", OPERATOR_SYMBOLS, CONJUNCTION_OPERATOR, undefined],
  ["||", OPERATOR_SYMBOLS, DISJUNCTION_OPERATOR, undefined],
  ["??", OPERATOR_SYMBOLS, NIL_COALESCING_OPERATOR, undefined],
  ["=", OPERATOR_SYMBOLS, EQUAL_SIGN, undefined],
  ["==", OPERATOR_SYMBOLS, EQ_EQ, undefined],
  ["+", NON_WHITESPACE, PLUS_THEN_WS, undefined],
  ["-", NON_WHITESPACE, MINUS_THEN_WS, undefined],
  ["!", OPERATOR_SYMBOLS, BANG, FAKE_TRY_BANG],
  ["throws", ALPHANUMERIC, THROWS_KEYWORD, undefined],
  ["rethrows", ALPHANUMERIC, RETHROWS_KEYWORD, undefined],
  ["default", ALPHANUMERIC, DEFAULT_KEYWORD, undefined],
  ["where", ALPHANUMERIC, WHERE_KEYWORD, undefined],
  ["else", ALPHANUMERIC, ELSE_KEYWORD, undefined],
  ["catch", ALPHANUMERIC, CATCH_KEYWORD, undefined],
  ["as", ALPHANUMERIC, AS_KEYWORD, undefined],
  ["as?", OPERATOR_SYMBOLS, AS_QUEST, undefined],
  ["as!", OPERATOR_SYMBOLS, AS_BANG, undefined],
  ["async", ALPHANUMERIC, ASYNC_KEYWORD, undefined],
];

const RESERVED_OPS = [
  "/", "=", "-", "+", "!", "*", "%", "<", ">", "&", "|", "^", "?", "~", ".", "..", "->", "/*", "*/", "+=", "-=",
  "*=", "/=", "%=", ">>", "<<", "++", "--", "===", "...", "..<",
];

const DIRECTIVES: [string, number][] = [
  ["if", DIRECTIVE_IF],
  ["elseif", DIRECTIVE_ELSEIF],
  ["else", DIRECTIVE_ELSE],
  ["endif", DIRECTIVE_ENDIF],
];

const CONTINUE_PARSING_NOTHING_FOUND = 0;
const CONTINUE_PARSING_TOKEN_FOUND = 1;
const CONTINUE_PARSING_SLASH_CONSUMED = 2;
const STOP_PARSING_NOTHING_FOUND = 3;
const STOP_PARSING_TOKEN_FOUND = 4;
const STOP_PARSING_END_OF_FILE = 5;

/** A C string's character at `i`, 0 past its end. */
const at = (s: string, i: number): number =>
  i < s.length ? s.charCodeAt(i) : 0;

/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

const SEMI = 59;
const SLASH = 47;
const STAR = 42;
const HASH = 35;
const QUOTE = 34;
const BACKSLASH = 92;
const NEWLINE = 10;
const CR = 13;

function isCrossSemiToken(op: number): boolean {
  return op !== BANG && op >= ARROW_OPERATOR && op <= CUSTOM_OPERATOR;
}

function isLegalCustomOperator(
  charIdx: number,
  firstChar: number,
  c: number,
): boolean {
  const isFirstChar = charIdx === 0;
  switch (c) {
    case 61: // =
    case 45: // -
    case 43: // +
    case 33: // !
    case 37: // %
    case 60: // <
    case 62: // >
    case 38: // &
    case 124: // |
    case 94: // ^
    case 63: // ?
    case 126: // ~
      return true;
    case 46: // .
      return isFirstChar || firstChar === 46;
    case STAR:
    case SLASH:
      return charIdx !== 1 || firstChar !== SLASH;
    default:
      if (
        (c >= 0xa1 && c <= 0xa7) ||
        c === 0xa9 ||
        c === 0xab ||
        c === 0xac ||
        c === 0xae ||
        (c >= 0xb0 && c <= 0xb1) ||
        c === 0xb6 ||
        c === 0xbb ||
        c === 0xbf ||
        c === 0xd7 ||
        c === 0xf7 ||
        (c >= 0x2016 && c <= 0x2017) ||
        (c >= 0x2020 && c <= 0x2027) ||
        (c >= 0x2030 && c <= 0x203e) ||
        (c >= 0x2041 && c <= 0x2053) ||
        (c >= 0x2055 && c <= 0x205e) ||
        (c >= 0x2190 && c <= 0x23ff) ||
        (c >= 0x2500 && c <= 0x2775) ||
        (c >= 0x2794 && c <= 0x2bff) ||
        (c >= 0x2e00 && c <= 0x2e7f) ||
        (c >= 0x3001 && c <= 0x3003) ||
        (c >= 0x3008 && c <= 0x3020) ||
        c === 0x3030
      )
        return true;
      if (
        (c >= 0x0300 && c <= 0x036f) ||
        (c >= 0x1dc0 && c <= 0x1dff) ||
        (c >= 0x20d0 && c <= 0x20ff) ||
        (c >= 0xfe00 && c <= 0xfe0f) ||
        (c >= 0xfe20 && c <= 0xfe2f) ||
        (c >= 0xe0100 && c <= 0xe01ef)
      )
        return !isFirstChar;
      return false;
  }
}

/** `eat_operators`: the operator symbol found, or -1. */
function eatOperators(
  lexer: Lexer,
  valid: Uint8Array,
  markEnd: boolean,
  priorChar: number,
): number {
  const possible = OPERATORS.map(
    ([text, , symbol]) =>
      valid[symbol] !== 0 && (!priorChar || at(text, 0) === priorChar),
  );
  // 0: ruled out, 1: a prefix so far, 2: matched whole.
  const reserved = RESERVED_OPS.map((text): number =>
    !priorChar || at(text, 0) === priorChar ? 1 : 0,
  );
  let possibleCustom = valid[CUSTOM_OPERATOR] !== 0;
  const firstChar = priorChar ? priorChar : la(lexer);
  let lastExamined = firstChar;
  let strIdx = priorChar ? 1 : 0;
  let fullMatch = -1;
  for (;;) {
    for (let i = 0; i < OPERATORS.length; i++) {
      if (!possible[i]) continue;
      const [text, illegal] = OPERATORS[i] as Operator;
      const expected = at(text, strIdx);
      if (expected === 0) {
        const c = la(lexer);
        let blocked = false;
        switch (c) {
          case SLASH:
          case 61:
          case 45:
          case 43:
          case 33:
          case STAR:
          case 37:
          case 60:
          case 62:
          case 38:
          case 124:
          case 94:
          case 63:
          case 126:
            if (illegal === OPERATOR_SYMBOLS) {
              blocked = true;
              break;
            }
          // falls through
          case 46:
            if (illegal === OPERATOR_OR_DOT) {
              blocked = true;
              break;
            }
          // falls through
          default:
            if (iswalnum(c) && illegal === ALPHANUMERIC) {
              blocked = true;
              break;
            }
            if (!iswspace(c) && illegal === NON_WHITESPACE) {
              blocked = true;
              break;
            }
        }
        if (!blocked) {
          fullMatch = i;
          if (markEnd) lexer.markEnd();
        }
        possible[i] = false;
        continue;
      }
      if (expected !== la(lexer)) possible[i] = false;
    }

    for (let i = 0; i < RESERVED_OPS.length; i++) {
      if (!reserved[i]) continue;
      const text = RESERVED_OPS[i] as string;
      if (at(text, strIdx) === 0 || at(text, strIdx) !== la(lexer)) {
        reserved[i] = 0;
        continue;
      }
      if (at(text, strIdx + 1) === 0) reserved[i] = 2;
    }

    possibleCustom =
      possibleCustom && isLegalCustomOperator(strIdx, firstChar, la(lexer));

    const encountered = possible.filter(Boolean).length;
    if (encountered === 0) {
      if (!possibleCustom) break;
      if (markEnd && fullMatch === -1) lexer.markEnd();
    }

    lastExamined = la(lexer);
    lexer.advance(false);
    strIdx++;

    if (
      encountered === 0 &&
      !isLegalCustomOperator(strIdx, firstChar, la(lexer))
    )
      break;
  }

  if (fullMatch !== -1) {
    // `try!`: the `!` stays the parser's own immediate token when FAKE_TRY_BANG is valid.
    const [, , symbol, suppressor] = OPERATORS[fullMatch] as Operator;
    if (suppressor !== undefined && valid[suppressor]) return -1;
    return symbol;
  }

  if (possibleCustom && !reserved.includes(2)) {
    if ((lastExamined !== 60 || iswspace(la(lexer))) && markEnd)
      lexer.markEnd();
    return CUSTOM_OPERATOR;
  }
  return -1;
}

/** `eat_comment`: a directive, with the comment's symbol in `out[0]` when one is found. */
function eatComment(lexer: Lexer, markEnd: boolean, out: number[]): number {
  if (la(lexer) !== SLASH) return CONTINUE_PARSING_NOTHING_FOUND;
  lexer.advance(false);
  if (la(lexer) !== STAR) return CONTINUE_PARSING_SLASH_CONSUMED;
  lexer.advance(false);
  let afterStar = false;
  let depth = 1;
  for (;;) {
    switch (la(lexer)) {
      case 0:
        return STOP_PARSING_END_OF_FILE;
      case STAR:
        lexer.advance(false);
        afterStar = true;
        break;
      case SLASH:
        if (afterStar) {
          lexer.advance(false);
          afterStar = false;
          if (--depth === 0) {
            if (markEnd) lexer.markEnd();
            out[0] = BLOCK_COMMENT;
            return STOP_PARSING_TOKEN_FOUND;
          }
        } else {
          lexer.advance(false);
          afterStar = false;
          if (la(lexer) === STAR) {
            depth++;
            lexer.advance(false);
          }
        }
        break;
      default:
        lexer.advance(false);
        afterStar = false;
    }
  }
}

/** `eat_whitespace`: a directive, with the semicolon or comment symbol in `out[0]`. */
function eatWhitespace(lexer: Lexer, valid: Uint8Array, out: number[]): number {
  let directive = CONTINUE_PARSING_NOTHING_FOUND;
  const semiIsValid = valid[IMPLICIT_SEMI] !== 0 && valid[EXPLICIT_SEMI] !== 0;
  let lookahead: number;
  while (iswspace((lookahead = la(lexer))) || lookahead === SEMI) {
    if (lookahead === SEMI) {
      if (semiIsValid) {
        directive = STOP_PARSING_TOKEN_FOUND;
        lexer.advance(false);
      }
      break;
    }
    lexer.advance(true);
    lexer.markEnd();
    if (
      directive === CONTINUE_PARSING_NOTHING_FOUND &&
      (lookahead === NEWLINE || lookahead === CR)
    )
      directive = CONTINUE_PARSING_TOKEN_FOUND;
  }

  if (directive === CONTINUE_PARSING_TOKEN_FOUND && lookahead === SLASH) {
    let seenSingle = false;
    while (la(lexer) === SLASH) {
      const comment: number[] = [];
      let anyComment = eatComment(lexer, false, comment);
      if (anyComment === STOP_PARSING_TOKEN_FOUND) {
        if (!seenSingle) {
          lexer.markEnd();
          out[0] = comment[0] as number;
          return STOP_PARSING_TOKEN_FOUND;
        }
      } else if (anyComment === STOP_PARSING_END_OF_FILE) {
        return STOP_PARSING_END_OF_FILE;
      } else if (anyComment === CONTINUE_PARSING_SLASH_CONSUMED) {
        return CONTINUE_PARSING_SLASH_CONSUMED;
      } else if (la(lexer) === SLASH) {
        seenSingle = true;
        while (la(lexer) !== NEWLINE && la(lexer) !== 0) lexer.advance(true);
      } else if (iswspace(la(lexer))) {
        return STOP_PARSING_NOTHING_FOUND;
      }
      while (iswspace(la(lexer))) {
        anyComment = CONTINUE_PARSING_NOTHING_FOUND;
        lexer.advance(true);
      }
    }
    if (eatOperators(lexer, valid, false, 0) !== -1)
      return STOP_PARSING_NOTHING_FOUND;
    out[0] = IMPLICIT_SEMI;
    directive = STOP_PARSING_TOKEN_FOUND;
  }

  // `?`, `:` and `{` suppress the semicolon without being consumed.
  if (
    directive === CONTINUE_PARSING_TOKEN_FOUND &&
    (lookahead === 63 || lookahead === 58 || lookahead === 123)
  )
    return CONTINUE_PARSING_NOTHING_FOUND;

  if (semiIsValid && directive !== CONTINUE_PARSING_NOTHING_FOUND) {
    out[0] = lookahead === SEMI ? EXPLICIT_SEMI : IMPLICIT_SEMI;
    return directive;
  }
  return CONTINUE_PARSING_NOTHING_FOUND;
}

function findPossibleCompilerDirective(lexer: Lexer): number {
  const possible = DIRECTIVES.map(() => true);
  let strIdx = 0;
  let fullMatch = -1;
  for (;;) {
    for (let i = 0; i < DIRECTIVES.length; i++) {
      if (!possible[i]) continue;
      const expected = at((DIRECTIVES[i] as [string, number])[0], strIdx);
      if (expected === 0) {
        fullMatch = i;
        lexer.markEnd();
      }
      if (expected !== la(lexer)) possible[i] = false;
    }
    if (!possible.includes(true)) break;
    lexer.advance(false);
    strIdx++;
  }
  return fullMatch === -1
    ? HASH_SYMBOL
    : (DIRECTIVES[fullMatch] as [string, number])[1];
}

class SwiftScanner implements ExternalScanner {
  rawStrHashCount = 0;

  private eatRawStrPart(lexer: Lexer, valid: Uint8Array): number {
    let hashCount = this.rawStrHashCount;
    if (!valid[RAW_STR_PART]) return -1;
    if (hashCount === 0) {
      while (la(lexer) === HASH) {
        hashCount++;
        lexer.advance(false);
      }
      if (hashCount === 0) return -1;
      if (la(lexer) === QUOTE) lexer.advance(false);
      else if (hashCount === 1) {
        lexer.markEnd();
        return findPossibleCompilerDirective(lexer);
      } else return -1;
    } else if (!valid[RAW_STR_CONTINUING_INDICATOR]) return -1;

    while (la(lexer) !== 0) {
      // The C scanner keeps this in a uint8_t.
      let lastChar = 0;
      lexer.markEnd();
      while (la(lexer) !== HASH && la(lexer) !== 0) {
        lastChar = la(lexer) & 0xff;
        lexer.advance(false);
        if (lastChar !== BACKSLASH || la(lexer) === BACKSLASH) lexer.markEnd();
      }
      let current = 0;
      while (la(lexer) === HASH && current < hashCount) {
        current++;
        lexer.advance(false);
      }
      if (current === hashCount) {
        if (lastChar === BACKSLASH && la(lexer) === 40) {
          this.rawStrHashCount = hashCount;
          return RAW_STR_PART;
        }
        if (lastChar === QUOTE) {
          lexer.markEnd();
          this.rawStrHashCount = 0;
          return RAW_STR_END_PART;
        }
      }
    }
    return -1;
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    const ws: number[] = [];
    const wsDirective = eatWhitespace(lexer, valid, ws);
    if (wsDirective === STOP_PARSING_TOKEN_FOUND) {
      lexer.resultSymbol = ws[0] as number;
      return true;
    }
    if (
      wsDirective === STOP_PARSING_NOTHING_FOUND ||
      wsDirective === STOP_PARSING_END_OF_FILE
    )
      return false;
    const hasWsResult = wsDirective === CONTINUE_PARSING_TOKEN_FOUND;

    const commentOut: number[] = [];
    const comment =
      wsDirective === CONTINUE_PARSING_SLASH_CONSUMED
        ? wsDirective
        : eatComment(lexer, true, commentOut);
    if (comment === STOP_PARSING_TOKEN_FOUND) {
      lexer.markEnd();
      lexer.resultSymbol = commentOut[0] as number;
      return true;
    }
    if (comment === STOP_PARSING_END_OF_FILE) return false;

    const op = eatOperators(
      lexer,
      valid,
      !hasWsResult,
      comment === CONTINUE_PARSING_SLASH_CONSUMED ? SLASH : 0,
    );
    if (op !== -1 && (!hasWsResult || isCrossSemiToken(op))) {
      lexer.resultSymbol = op;
      if (hasWsResult) lexer.markEnd();
      return true;
    }
    if (hasWsResult) {
      lexer.resultSymbol = ws[0] as number;
      return true;
    }

    const raw = this.eatRawStrPart(lexer, valid);
    if (raw !== -1) {
      lexer.resultSymbol = raw;
      return true;
    }
    return false;
  }

  serialize(buffer: Uint8Array): number {
    const n = this.rawStrHashCount;
    buffer[0] = (n >>> 24) & 0xff;
    buffer[1] = (n >>> 16) & 0xff;
    buffer[2] = (n >>> 8) & 0xff;
    buffer[3] = n & 0xff;
    return 4;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    // As the C scanner: a short buffer (tree-sitter passes an empty one at a token with no state) keeps the state.
    if (length < 4) return;
    this.rawStrHashCount =
      (((buffer[0] as number) << 24) |
        ((buffer[1] as number) << 16) |
        ((buffer[2] as number) << 8) |
        (buffer[3] as number)) >>>
      0;
  }
}

export function createScanner(): ExternalScanner {
  return new SwiftScanner();
}
