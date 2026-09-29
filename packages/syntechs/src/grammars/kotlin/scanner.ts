// Port of tree-sitter-kotlin 0.3.8 src/scanner.c: the stack of open string delimiters, serialized byte for
// byte as the C scanner does so the parser's state comparisons agree.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalpha, iswdigit, iswspace } from "../../core/wctype.js";

const AUTOMATIC_SEMICOLON = 0;
const IMPORT_LIST_DELIMITER = 1;
const SAFE_NAV = 2;
const MULTILINE_COMMENT = 3;
const STRING_START = 4;
const STRING_END = 5;
const STRING_CONTENT = 6;

const DELIMITER_LENGTH = 3;
const BUFFER_SIZE = 1024;
const QUOTE = 34;
/** The most `$`s a multi-dollar string's prefix may have, so its stack entry still fits a byte. */
const MAX_DOLLARS = 100;

/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

/** The C scanner's `scan_for_word`: skips the current character, then requires `word`, skipping it. */
function scanForWord(lexer: Lexer, word: string): boolean {
  lexer.advance(true);
  for (let i = 0; i < word.length; i++) {
    if (la(lexer) !== word.charCodeAt(i)) return false;
    lexer.advance(true);
  }
  return true;
}

function scanWhitespaceAndComments(lexer: Lexer): boolean {
  while (iswspace(la(lexer))) lexer.advance(true);
  return la(lexer) !== 47; // /
}

function scanMultilineComment(lexer: Lexer): boolean {
  if (la(lexer) !== 47) return false;
  lexer.advance(false);
  if (la(lexer) !== 42) return false;
  lexer.advance(false);
  let afterStar = false;
  let depth = 1;
  for (;;) {
    switch (la(lexer)) {
      case 42: // *
        lexer.advance(false);
        afterStar = true;
        break;
      case 47: // /
        lexer.advance(false);
        if (afterStar) {
          afterStar = false;
          if (--depth === 0) {
            lexer.resultSymbol = MULTILINE_COMMENT;
            lexer.markEnd();
            return true;
          }
        } else if (la(lexer) === 42) {
          depth++;
          lexer.advance(false);
        }
        break;
      case 0:
        return false;
      default:
        lexer.advance(false);
        afterStar = false;
    }
  }
}

const isWordChar = (c: number) => iswalpha(c) || iswdigit(c) || c === 95; // _

/**
 * Whether the text before the marked end is a class's name and its type parameters (`class Foo<T>`), past the
 * whitespace and block comments after them. A look back the C scanner cannot take: this port holds the whole input.
 */
function afterClassName(lexer: Lexer): boolean {
  const s = lexer.input;
  let i = lexer.tokenEnd;
  const skipBack = () => {
    for (;;) {
      while (i > 0 && iswspace(s.charCodeAt(i - 1))) i--;
      if (!s.startsWith("*/", i - 2)) return;
      const open = s.lastIndexOf("/*", i - 3);
      if (open < 0) return;
      i = open;
    }
  };
  skipBack();
  if (s.charCodeAt(i - 1) === 62) {
    // >
    let depth = 0;
    for (; i > 0; i--) {
      const c = s.charCodeAt(i - 1);
      if (c === 62 && s.charCodeAt(i - 2) !== 45) depth++;
      else if (c === 60 && --depth === 0) break;
    }
    if (i === 0) return false;
    i--;
    skipBack();
  }
  const nameEnd = i;
  while (i > 0 && isWordChar(s.charCodeAt(i - 1))) i--;
  if (i === nameEnd) return false;
  skipBack();
  return i >= 5 && s.startsWith("class", i - 5) && (i === 5 || !isWordChar(s.charCodeAt(i - 6)));
}

/** Whether annotations and modifier keywords, then `constructor`, come next; advances past them. */
function constructorAhead(lexer: Lexer): boolean {
  for (;;) {
    while (iswspace(la(lexer))) lexer.advance(true);
    if (la(lexer) === 64) {
      // @: the annotation's name, dotted, then its arguments.
      lexer.advance(true);
      while (isWordChar(la(lexer)) || la(lexer) === 46 || la(lexer) === 58) lexer.advance(true);
      if (la(lexer) === 40) {
        let depth = 0;
        do {
          if (la(lexer) === 40) depth++;
          else if (la(lexer) === 41) depth--;
          else if (lexer.eof()) return false;
          lexer.advance(true);
        } while (depth > 0);
      }
      continue;
    }
    let word = "";
    while (isWordChar(la(lexer))) {
      word += String.fromCharCode(la(lexer));
      lexer.advance(true);
    }
    if (word === "constructor") return true;
    if (!/^(public|protected|private|internal|expect|actual)$/.test(word)) return false;
  }
}

function scanAutomaticSemicolon(lexer: Lexer): boolean {
  lexer.resultSymbol = AUTOMATIC_SEMICOLON;
  lexer.markEnd();
  let sameline = true;
  for (;;) {
    if (lexer.eof()) return true;
    if (la(lexer) === 59) {
      lexer.advance(false);
      lexer.markEnd();
      return true;
    }
    if (!iswspace(la(lexer))) break;
    if (la(lexer) === 10) {
      lexer.advance(true);
      sameline = false;
      break;
    }
    if (la(lexer) === 13) {
      lexer.advance(true);
      if (la(lexer) === 10) lexer.advance(true);
      sameline = false;
      break;
    }
    lexer.advance(true);
  }

  if (!scanWhitespaceAndComments(lexer)) return false;

  // Not before a `where` that continues a class or function header on its own line (`class Foo<T>()\n  where T :
  // Bar`). Any other word starting with `w` on a new line gets one, as the checks below would give it.
  if (!sameline && la(lexer) === 119) return !(scanForWord(lexer, "here") && iswspace(la(lexer)));

  // Not before a primary constructor written on the line after its class's name (`class Foo\n@Inject constructor(`),
  // which the C scanner would cut off from its class.
  if (!sameline && afterClassName(lexer) && (la(lexer) === 64 || iswalpha(la(lexer))))
    return !constructorAhead(lexer);

  if (sameline) {
    switch (la(lexer)) {
      // Upstream scanner.c returns `!scan_for_word("lse")` here, ending a statement before any other word starting
      // with `e` on the same line (`return emit(x)` as a bare `return`, then `emit(x)`); the pnpm patch drops it too.
      case 105: // i
        return scanForWord(lexer, "mport");
      case 59: // ;
        lexer.advance(false);
        lexer.markEnd();
        return true;
      default:
        return false;
    }
  }

  switch (la(lexer)) {
    case 44: // ,
    case 46: // .
    case 58: // :
    case 42: // *
    case 37: // %
    case 62: // >
    case 60: // <
    case 61: // =
    case 123: // {
    case 91: // [
    case 40: // (
    case 63: // ?
    case 124: // |
    case 38: // &
    case 47: // /
      return false;
    // Before `++`, `--` or a signed number, but not a binary `+` or `-`.
    case 43: // +
      lexer.advance(true);
      if (la(lexer) === 43) return true;
      return iswdigit(la(lexer));
    case 45: // -
      lexer.advance(true);
      if (la(lexer) === 45) return true;
      return iswdigit(la(lexer));
    // Before a unary `!`, but not `!=`.
    case 33:
      lexer.advance(true);
      return la(lexer) !== 61;
    case 101: // e
      return !scanForWord(lexer, "lse");
    // tree-sitter-kotlin 0.3.8 took JavaScript's exception here and inserted none before `in` or `instanceof`,
    // but Kotlin continues no expression with an `in` on the next line: it starts a `when` entry's condition.
    case 59: // ;
      lexer.advance(false);
      lexer.markEnd();
      return true;
    default:
      return true;
  }
}

function scanSafeNav(lexer: Lexer): boolean {
  lexer.resultSymbol = SAFE_NAV;
  lexer.markEnd();
  if (!scanWhitespaceAndComments(lexer)) return false;
  if (la(lexer) !== 63) return false;
  lexer.advance(false);
  if (!scanWhitespaceAndComments(lexer)) return false;
  if (la(lexer) !== 46) return false;
  lexer.advance(false);
  lexer.markEnd();
  return true;
}

/** One line separator (CR, LF or CRLF) after horizontal whitespace. */
function scanLineSep(lexer: Lexer): boolean {
  let sawCr = false;
  for (;;) {
    switch (la(lexer)) {
      case 32:
      case 9:
      case 11:
        lexer.advance(false);
        break;
      case 10:
        lexer.advance(false);
        return true;
      case 13:
        if (sawCr) return true;
        sawCr = true;
        lexer.advance(false);
        break;
      default:
        return sawCr;
    }
  }
}

/** An import list ends at an empty line or a line that is not an import. */
function scanImportListDelimiter(lexer: Lexer): boolean {
  lexer.resultSymbol = IMPORT_LIST_DELIMITER;
  lexer.markEnd();
  if (lexer.eof()) return true;
  if (!scanLineSep(lexer)) return false;
  if (scanLineSep(lexer)) {
    lexer.markEnd();
    return true;
  }
  switch (la(lexer)) {
    // The C scanner's loop returns false after one whitespace character: its `break` leaves only the switch.
    case 32:
    case 9:
    case 11:
      lexer.advance(false);
      return false;
    case 105: // i
      return !scanForWord(lexer, "mport");
    default:
      return true;
  }
}

class KotlinScanner implements ExternalScanner {
  /**
   * Each open string's delimiter: `"`, + 1 for a triple-quoted one, + 2 for each `$` past the first that its
   * interpolations take (a multi-dollar string, `$$"""`), so a plain string's entry stays the C scanner's byte.
   */
  stack: number[] = [];

  private push(triple: boolean, dollars: number): void {
    if (this.stack.length >= BUFFER_SIZE)
      throw new Error("kotlin scanner: string delimiter stack overflow");
    this.stack.push(QUOTE + (triple ? 1 : 0) + 2 * (dollars - 1));
  }

  private pop(): void {
    if (this.stack.pop() === undefined)
      throw new Error("kotlin scanner: string delimiter stack underflow");
  }

  private scanStringStart(lexer: Lexer): boolean {
    // A multi-dollar string's `$`s: each interpolation in it takes as many.
    let dollars = 1;
    if (la(lexer) === 36) {
      for (dollars = 0; la(lexer) === 36 && dollars < MAX_DOLLARS; dollars++) lexer.advance(false);
      if (dollars < 2) return false;
    }
    if (la(lexer) !== QUOTE) return false;
    lexer.advance(false);
    lexer.markEnd();
    for (let count = 1; count < DELIMITER_LENGTH; count++) {
      if (la(lexer) !== QUOTE) {
        this.push(false, dollars);
        return true;
      }
      lexer.advance(false);
    }
    lexer.markEnd();
    this.push(true, dollars);
    return true;
  }

  private scanStringContent(lexer: Lexer): boolean {
    if (this.stack.length === 0) return false;
    const entry = (this.stack.at(-1) as number) - QUOTE;
    const isTriple = (entry & 1) !== 0;
    const dollars = (entry >> 1) + 1;
    const endChar = QUOTE;
    let hasContent = false;
    while (la(lexer) !== 0) {
      if (la(lexer) === 36) {
        // $
        // Stop before a `$` so it can start an interpolated identifier.
        if (hasContent) {
          lexer.resultSymbol = STRING_CONTENT;
          return true;
        }
        // The grammar lexes an interpolation's last `$` with the `{` or name after it, so a run of `$`s long
        // enough to start one is content up to that last `$`, which a later call leaves to the grammar (counting
        // the run's `$`s before it, which are content by then); a shorter run, or one no `{` or name follows, is
        // all content.
        const s = lexer.input;
        let ahead = lexer.pos;
        while (s.charCodeAt(ahead) === 36) ahead++;
        let behind = lexer.pos;
        while (behind > 0 && s.charCodeAt(behind - 1) === 36) behind--;
        const next = s.charCodeAt(ahead);
        const interpolates = ahead - behind >= dollars && (iswalpha(next) || next === 123);
        if (interpolates && ahead - lexer.pos === 1) return false;
        while (lexer.pos < ahead - (interpolates ? 1 : 0)) lexer.advance(false);
        lexer.resultSymbol = STRING_CONTENT;
        lexer.markEnd();
        return true;
      }
      if (la(lexer) === 92) {
        // \ : an escaped `$` is content, and one right before the closing quote ends the string.
        lexer.advance(false);
        if (la(lexer) === 36) {
          lexer.advance(false);
          if (la(lexer) === endChar) {
            this.pop();
            lexer.advance(false);
            lexer.markEnd();
            lexer.resultSymbol = STRING_END;
            return true;
          }
        }
      } else if (la(lexer) === endChar) {
        if (isTriple) {
          lexer.markEnd();
          for (let count = 1; count < DELIMITER_LENGTH; count++) {
            lexer.advance(false);
            if (la(lexer) !== endChar) {
              lexer.markEnd();
              lexer.resultSymbol = STRING_CONTENT;
              return true;
            }
          }
          // Content before the closing quotes is its own token, so the end does not absorb it.
          if (hasContent && la(lexer) === endChar) {
            lexer.resultSymbol = STRING_CONTENT;
            return true;
          }
          // Quotes beyond three all belong to the end.
          lexer.resultSymbol = STRING_END;
          lexer.markEnd();
          while (la(lexer) === endChar) {
            lexer.advance(false);
            lexer.markEnd();
          }
          this.pop();
          return true;
        }
        if (hasContent) {
          lexer.markEnd();
          lexer.resultSymbol = STRING_CONTENT;
          return true;
        }
        this.pop();
        lexer.advance(false);
        lexer.markEnd();
        lexer.resultSymbol = STRING_END;
        return true;
      }
      lexer.advance(false);
      hasContent = true;
    }
    return false;
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[AUTOMATIC_SEMICOLON]) {
      const ret = scanAutomaticSemicolon(lexer);
      if (!ret && valid[SAFE_NAV] && la(lexer) === 63)
        return scanSafeNav(lexer);
      // No semicolon: a string or a comment may still follow.
      if (ret) return true;
    }
    if (valid[IMPORT_LIST_DELIMITER]) return scanImportListDelimiter(lexer);
    if (valid[STRING_CONTENT] && this.scanStringContent(lexer)) return true;
    while (iswspace(la(lexer))) lexer.advance(true);
    if (valid[STRING_START] && this.scanStringStart(lexer)) {
      lexer.resultSymbol = STRING_START;
      return true;
    }
    if (valid[MULTILINE_COMMENT] && scanMultilineComment(lexer)) return true;
    if (valid[SAFE_NAV]) return scanSafeNav(lexer);
    return false;
  }

  serialize(buffer: Uint8Array): number {
    const size = this.stack.length;
    for (let i = 0; i < size; i++) buffer[i] = this.stack[i] as number;
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    // Emptied in place: this runs before every scan, and nothing else holds the array.
    this.stack.length = 0;
    for (let i = 0; i < length; i++) this.stack.push(buffer[i] as number);
  }
}

export function createScanner(): ExternalScanner {
  return new KotlinScanner();
}
