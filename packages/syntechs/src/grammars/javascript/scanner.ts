// Port of tree-sitter-javascript 0.25.0 src/scanner.c. Stateless.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswalpha, iswdigit, iswspace } from "../../core/wctype.js";

const AUTOMATIC_SEMICOLON = 0;
const TEMPLATE_CHARS = 1;
const TERNARY_QMARK = 2;
const HTML_COMMENT = 3;
const LOGICAL_OR = 4;
const ESCAPE_SEQUENCE = 5;
const REGEX_PATTERN = 6;
const JSX_TEXT = 7;
const STATEMENT_CONTINUES = 8;
const FOR_IN_AFTER_INITIALIZER = 9;
const ARROW_BODY_END = 10;

const LS = 0x2028;
const PS = 0x2029;
const NL = 10;
const ch = (s: string) => s.charCodeAt(0);
/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

function scanTemplateChars(lexer: Lexer): boolean {
  lexer.resultSymbol = TEMPLATE_CHARS;
  for (let hasContent = false; ; hasContent = true) {
    lexer.markEnd();
    switch (la(lexer)) {
      case 96: // `
        return hasContent;
      case 0:
        return false;
      case 36: // $
        lexer.advance(false);
        if (la(lexer) === 123) return hasContent;
        break;
      case 92: // \
        return hasContent;
      default:
        lexer.advance(false);
    }
  }
}

const REJECT = 0;
const NO_NEWLINE = 1;
const ACCEPT = 2;

/** `consume` false: stop as soon as a comment says whether a semicolon is legal. */
function scanWhitespaceAndComments(
  lexer: Lexer,
  scanned: { comment: boolean },
  consume: boolean,
): number {
  let sawBlockNewline = false;
  for (;;) {
    while (iswspace(la(lexer))) lexer.advance(true);
    if (la(lexer) !== 47) return ACCEPT;
    lexer.advance(true);
    if (la(lexer) === 47) {
      lexer.advance(true);
      while (
        la(lexer) !== 0 &&
        la(lexer) !== NL &&
        la(lexer) !== LS &&
        la(lexer) !== PS
      )
        lexer.advance(true);
      scanned.comment = true;
    } else if (la(lexer) === 42) {
      lexer.advance(true);
      while (la(lexer) !== 0) {
        if (la(lexer) === 42) {
          lexer.advance(true);
          if (la(lexer) === 47) {
            lexer.advance(true);
            scanned.comment = true;
            if (la(lexer) !== 47 && !consume)
              return sawBlockNewline ? ACCEPT : NO_NEWLINE;
            break;
          }
        } else if (la(lexer) === NL || la(lexer) === LS || la(lexer) === PS) {
          sawBlockNewline = true;
          lexer.advance(true);
        } else {
          lexer.advance(true);
        }
      }
    } else {
      return REJECT;
    }
  }
}

function scanAutomaticSemicolon(
  lexer: Lexer,
  commentCondition: boolean,
  statementContinues: boolean,
  arrowBodyEnd: boolean,
  scanned: { comment: boolean },
): boolean {
  lexer.resultSymbol = AUTOMATIC_SEMICOLON;
  lexer.markEnd();
  for (;;) {
    if (la(lexer) === 0) return true;
    if (la(lexer) === 47) {
      const result = scanWhitespaceAndComments(lexer, scanned, false);
      if (result === REJECT) return false;
      if (result === ACCEPT && commentCondition) {
        // A block comment spanning lines may still be followed by `=` on a later line.
        while (iswspace(la(lexer))) lexer.advance(true);
        if (la(lexer) !== 44 && la(lexer) !== 61) return true;
      }
    }
    if (la(lexer) === 125) return true;
    if (lexer.isAtIncludedRangeStart()) return true;
    if (la(lexer) === NL || la(lexer) === LS || la(lexer) === PS) break;
    if (!iswspace(la(lexer))) return false;
    lexer.advance(true);
  }
  lexer.advance(true);
  if (scanWhitespaceAndComments(lexer, scanned, true) === REJECT) return false;

  // `let` or `export` before a line break and a name or `{` starts a declaration, not a statement of its own.
  const next = la(lexer);
  if (
    statementContinues &&
    (next === 123 || next === 95 || next === 36 || next === 92 || iswalpha(next))
  )
    return false;

  // An arrow function's block body cannot be called, indexed or tagged: the next line starts a statement.
  if (arrowBodyEnd && (next === 40 || next === 91 || next === 96)) return true;

  switch (la(lexer)) {
    case 96: // `
    case 44: // ,
    case 58: // :
    case 59: // ;
    case 42: // *
    case 37: // %
    case 62: // >
    case 60: // <
    case 61: // =
    case 91: // [
    case 40: // (
    case 63: // ?
    case 94: // ^
    case 124: // |
    case 38: // &
    case 47: // /
      return false;
    // Before a decimal literal, but not a member access.
    case 46:
      lexer.advance(true);
      return iswdigit(la(lexer));
    // Before `++` and `--`, but not binary `+` or `-`.
    case 43:
      lexer.advance(true);
      return la(lexer) === 43;
    case 45:
      lexer.advance(true);
      return la(lexer) === 45;
    // Before a unary `!`, but not `!=`.
    case 33:
      lexer.advance(true);
      return la(lexer) !== 61;
    // Before an identifier, but not `in` or `instanceof`.
    case 105: {
      lexer.advance(true);
      if (la(lexer) !== ch("n")) return true;
      lexer.advance(true);
      if (!iswalpha(la(lexer))) return false;
      const rest = "stanceof";
      for (let i = 0; i < 8; i++) {
        if (la(lexer) !== rest.charCodeAt(i)) return true;
        lexer.advance(true);
      }
      if (!iswalpha(la(lexer))) return false;
      break;
    }
    default:
      break;
  }
  return true;
}

function scanTernaryQmark(lexer: Lexer): boolean {
  while (iswspace(la(lexer))) lexer.advance(true);
  if (la(lexer) !== 63) return false;
  lexer.advance(false);
  if (la(lexer) === 63) return false;
  lexer.markEnd();
  lexer.resultSymbol = TERNARY_QMARK;
  if (la(lexer) === 46) {
    lexer.advance(false);
    return iswdigit(la(lexer));
  }
  return true;
}

function scanHtmlComment(lexer: Lexer): boolean {
  while (iswspace(la(lexer)) || la(lexer) === LS || la(lexer) === PS)
    lexer.advance(true);
  let delimiter: string;
  if (la(lexer) === 60) delimiter = "<!--";
  else if (la(lexer) === 45) delimiter = "-->";
  else return false;
  for (let i = 0; i < delimiter.length; i++) {
    if (la(lexer) !== delimiter.charCodeAt(i)) return false;
    lexer.advance(false);
  }
  while (
    la(lexer) !== 0 &&
    la(lexer) !== NL &&
    la(lexer) !== LS &&
    la(lexer) !== PS
  )
    lexer.advance(false);
  lexer.resultSymbol = HTML_COMMENT;
  lexer.markEnd();
  return true;
}

function scanJsxText(lexer: Lexer): boolean {
  // Text is anything but whitespace that starts at a line break (indentation between elements).
  let sawText = false;
  let atNewline = false;
  for (;;) {
    const c = la(lexer);
    if (c === 0 || c === 60 || c === 62 || c === 123 || c === 125 || c === 38)
      break;
    if (c === NL) atNewline = true;
    else {
      atNewline &&= iswspace(c);
      if (!atNewline) sawText = true;
    }
    lexer.advance(false);
  }
  lexer.resultSymbol = JSX_TEXT;
  return sawText;
}

export function scan(lexer: Lexer, valid: Uint8Array): boolean {
  if (valid[TEMPLATE_CHARS]) {
    if (valid[AUTOMATIC_SEMICOLON]) return false;
    return scanTemplateChars(lexer);
  }
  if (valid[JSX_TEXT] && scanJsxText(lexer)) return true;
  if (valid[FOR_IN_AFTER_INITIALIZER]) {
    while (iswspace(la(lexer))) lexer.advance(true);
    if (la(lexer) === 105) {
      lexer.advance(false);
      if (la(lexer) !== 110) return false;
      lexer.advance(false);
      const c = la(lexer);
      if (iswalnum(c) || c === 95 || c === 36 || c === 92 || c > 127)
        return false;
      lexer.markEnd();
      lexer.resultSymbol = FOR_IN_AFTER_INITIALIZER;
      return true;
    }
  }
  if (valid[AUTOMATIC_SEMICOLON]) {
    const scanned = { comment: false };
    const ret = scanAutomaticSemicolon(
      lexer,
      !valid[LOGICAL_OR],
      !!valid[STATEMENT_CONTINUES],
      !!valid[ARROW_BODY_END],
      scanned,
    );
    if (!ret && !scanned.comment && valid[TERNARY_QMARK] && la(lexer) === 63)
      return scanTernaryQmark(lexer);
    // As the C scanner: Annex B's `<!--` after an expression on its line opens a comment.
    if (!ret && !scanned.comment && la(lexer) === 60 && valid[HTML_COMMENT] && !valid[ESCAPE_SEQUENCE] && !valid[REGEX_PATTERN])
      return scanHtmlComment(lexer);
    return ret;
  }
  if (valid[TERNARY_QMARK]) return scanTernaryQmark(lexer);
  if (
    valid[HTML_COMMENT] &&
    !valid[LOGICAL_OR] &&
    !valid[ESCAPE_SEQUENCE] &&
    !valid[REGEX_PATTERN]
  )
    return scanHtmlComment(lexer);
  return false;
}

export function createScanner(): ExternalScanner {
  return { scan, serialize: () => 0, deserialize: () => {} };
}
