// Port of tree-sitter-python 0.25.0 src/scanner.c: the indent stack and the open string delimiters,
// serialized byte for byte as the C scanner does so the parser's state comparisons agree.

import type { ExternalScanner, Lexer } from "../lexer.js";

const NEWLINE = 0;
const INDENT = 1;
const DEDENT = 2;
const STRING_START = 3;
const STRING_CONTENT = 4;
const ESCAPE_INTERPOLATION = 5;
const STRING_END = 6;
const CLOSE_PAREN = 8;
const CLOSE_BRACKET = 9;
const CLOSE_BRACE = 10;
const EXCEPT = 11;

const SINGLE_QUOTE = 1;
const DOUBLE_QUOTE = 2;
const BACK_QUOTE = 4;
const RAW = 8;
const FORMAT = 16;
const TRIPLE = 32;
const BYTES = 64;

const BUFFER_SIZE = 1024;

function endCharacter(flags: number): number {
  if (flags & SINGLE_QUOTE) return 39;
  if (flags & DOUBLE_QUOTE) return 34;
  if (flags & BACK_QUOTE) return 96;
  return 0;
}

/** Read through a call so TypeScript does not keep a narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

class PythonScanner implements ExternalScanner {
  indents: number[] = [0];
  /** Each open string's flags. */
  delimiters: number[] = [];
  insideInterpolatedString = false;

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    const errorRecoveryMode =
      valid[STRING_CONTENT] !== 0 && valid[INDENT] !== 0;
    const withinBrackets =
      valid[CLOSE_BRACE] || valid[CLOSE_PAREN] || valid[CLOSE_BRACKET];

    let advancedOnce = false;
    if (
      valid[ESCAPE_INTERPOLATION] &&
      this.delimiters.length > 0 &&
      (la(lexer) === 123 || la(lexer) === 125) &&
      !errorRecoveryMode
    ) {
      const delimiter = this.delimiters.at(-1) as number;
      if (delimiter & FORMAT) {
        lexer.markEnd();
        const isLeftBrace = la(lexer) === 123;
        lexer.advance(false);
        advancedOnce = true;
        if (
          (la(lexer) === 123 && isLeftBrace) ||
          (la(lexer) === 125 && !isLeftBrace)
        ) {
          lexer.advance(false);
          lexer.markEnd();
          lexer.resultSymbol = ESCAPE_INTERPOLATION;
          return true;
        }
        return false;
      }
    }

    if (
      valid[STRING_CONTENT] &&
      this.delimiters.length > 0 &&
      !errorRecoveryMode
    ) {
      const delimiter = this.delimiters.at(-1) as number;
      const endChar = endCharacter(delimiter);
      let hasContent = advancedOnce;
      while (la(lexer) !== 0) {
        if (
          (advancedOnce || la(lexer) === 123 || la(lexer) === 125) &&
          delimiter & FORMAT
        ) {
          lexer.markEnd();
          lexer.resultSymbol = STRING_CONTENT;
          return hasContent;
        }
        if (la(lexer) === 92) {
          if (delimiter & RAW) {
            lexer.advance(false);
            if (la(lexer) === endChar || la(lexer) === 92) lexer.advance(false);
            if (la(lexer) === 13) {
              lexer.advance(false);
              if (la(lexer) === 10) lexer.advance(false);
            } else if (la(lexer) === 10) lexer.advance(false);
            continue;
          }
          if (delimiter & BYTES) {
            lexer.markEnd();
            lexer.advance(false);
            // \N{...}, \uXXXX and \UXXXXXXXX are not escapes in a bytes literal.
            if (la(lexer) === 78 || la(lexer) === 117 || la(lexer) === 85)
              lexer.advance(false);
            else {
              lexer.resultSymbol = STRING_CONTENT;
              return hasContent;
            }
          } else {
            lexer.markEnd();
            lexer.resultSymbol = STRING_CONTENT;
            return hasContent;
          }
        } else if (la(lexer) === endChar) {
          if (delimiter & TRIPLE) {
            lexer.markEnd();
            lexer.advance(false);
            if (la(lexer) === endChar) {
              lexer.advance(false);
              if (la(lexer) === endChar) {
                if (hasContent) lexer.resultSymbol = STRING_CONTENT;
                else {
                  lexer.advance(false);
                  lexer.markEnd();
                  this.delimiters.pop();
                  lexer.resultSymbol = STRING_END;
                  this.insideInterpolatedString = false;
                }
                return true;
              }
              lexer.markEnd();
              lexer.resultSymbol = STRING_CONTENT;
              return true;
            }
            lexer.markEnd();
            lexer.resultSymbol = STRING_CONTENT;
            return true;
          }
          if (hasContent) lexer.resultSymbol = STRING_CONTENT;
          else {
            lexer.advance(false);
            this.delimiters.pop();
            lexer.resultSymbol = STRING_END;
            this.insideInterpolatedString = false;
          }
          lexer.markEnd();
          return true;
        } else if (la(lexer) === 10 && hasContent && !(delimiter & TRIPLE)) {
          return false;
        }
        lexer.advance(false);
        hasContent = true;
      }
    }

    lexer.markEnd();

    let foundEndOfLine = false;
    let indentLength = 0;
    let firstCommentIndentLength = -1;
    for (;;) {
      const c = la(lexer);
      if (c === 10) {
        foundEndOfLine = true;
        indentLength = 0;
        lexer.advance(true);
      } else if (c === 32) {
        indentLength = (indentLength + 1) & 0xffff;
        lexer.advance(true);
      } else if (c === 13 || c === 12) {
        indentLength = 0;
        lexer.advance(true);
      } else if (c === 9) {
        indentLength = (indentLength + 8) & 0xffff;
        lexer.advance(true);
      } else if (
        c === 35 &&
        (valid[INDENT] || valid[DEDENT] || valid[NEWLINE] || valid[EXCEPT])
      ) {
        // A comment after an expression on the same line yields no indent or dedent.
        if (!foundEndOfLine) return false;
        if (firstCommentIndentLength === -1)
          firstCommentIndentLength = indentLength;
        while (la(lexer) !== 0 && la(lexer) !== 10) lexer.advance(true);
        lexer.advance(true);
        indentLength = 0;
      } else if (c === 92) {
        lexer.advance(true);
        if (la(lexer) === 13) lexer.advance(true);
        if (la(lexer) === 10 || lexer.eof()) lexer.advance(true);
        else return false;
      } else if (lexer.eof()) {
        indentLength = 0;
        foundEndOfLine = true;
        break;
      } else break;
    }

    if (foundEndOfLine) {
      if (this.indents.length > 0) {
        const currentIndentLength = this.indents.at(-1) as number;
        if (valid[INDENT] && indentLength > currentIndentLength) {
          this.indents.push(indentLength);
          lexer.resultSymbol = INDENT;
          return true;
        }
        const nextIsStringStart =
          la(lexer) === 34 || la(lexer) === 39 || la(lexer) === 96;
        if (
          (valid[DEDENT] ||
            (!valid[NEWLINE] &&
              !(valid[STRING_START] && nextIsStringStart) &&
              !withinBrackets)) &&
          indentLength < currentIndentLength &&
          !this.insideInterpolatedString &&
          // Dedent only after the comments indented at the current block's level.
          firstCommentIndentLength < currentIndentLength
        ) {
          this.indents.pop();
          lexer.resultSymbol = DEDENT;
          return true;
        }
      }
      if (valid[NEWLINE] && !errorRecoveryMode) {
        lexer.resultSymbol = NEWLINE;
        return true;
      }
    }

    if (firstCommentIndentLength === -1 && valid[STRING_START]) {
      let delimiter = 0;
      let hasFlags = false;
      while (la(lexer) !== 0) {
        const c = la(lexer);
        if (c === 102 || c === 70 || c === 116 || c === 84) delimiter |= FORMAT;
        else if (c === 114 || c === 82) delimiter |= RAW;
        else if (c === 98 || c === 66) delimiter |= BYTES;
        else if (c !== 117 && c !== 85) break;
        hasFlags = true;
        lexer.advance(false);
      }
      const quote = la(lexer);
      if (quote === 96) {
        delimiter |= BACK_QUOTE;
        lexer.advance(false);
        lexer.markEnd();
      } else if (quote === 39 || quote === 34) {
        delimiter |= quote === 39 ? SINGLE_QUOTE : DOUBLE_QUOTE;
        lexer.advance(false);
        lexer.markEnd();
        if (la(lexer) === quote) {
          lexer.advance(false);
          if (la(lexer) === quote) {
            lexer.advance(false);
            lexer.markEnd();
            delimiter |= TRIPLE;
          }
        }
      }
      if (endCharacter(delimiter)) {
        this.delimiters.push(delimiter);
        lexer.resultSymbol = STRING_START;
        this.insideInterpolatedString = (delimiter & FORMAT) !== 0;
        return true;
      }
      if (hasFlags) return false;
    }
    return false;
  }

  serialize(buffer: Uint8Array): number {
    let size = 0;
    buffer[size++] = this.insideInterpolatedString ? 1 : 0;
    const delimiterCount = Math.min(this.delimiters.length, 255);
    buffer[size++] = delimiterCount;
    for (let i = 0; i < delimiterCount; i++)
      buffer[size++] = this.delimiters[i] as number;
    for (let i = 1; i < this.indents.length && size < BUFFER_SIZE; i++) {
      const indent = this.indents[i] as number;
      buffer[size++] = indent & 0xff;
      buffer[size++] = (indent >> 8) & 0xff;
    }
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.delimiters = [];
    this.indents = [0];
    // An empty state keeps insideInterpolatedString as it was, as the C scanner does.
    if (length === 0) return;
    let size = 0;
    this.insideInterpolatedString = buffer[size++] !== 0;
    const delimiterCount = buffer[size++] as number;
    for (let i = 0; i < delimiterCount; i++)
      this.delimiters.push(buffer[size++] as number);
    for (; size + 1 < length; size += 2)
      this.indents.push(
        (buffer[size] as number) | ((buffer[size + 1] as number) << 8),
      );
  }
}

export function createScanner(): ExternalScanner {
  return new PythonScanner();
}
