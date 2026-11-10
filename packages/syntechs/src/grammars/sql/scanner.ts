// Port of tree-sitter-sql 0.3.12 src/scanner.c: PostgreSQL's dollar-quoted strings, `$tag$ ... $tag$`.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswspace } from "../../core/wctype.js";

const DOLLAR_QUOTED_STRING_START_TAG = 0;
const DOLLAR_QUOTED_STRING_END_TAG = 1;
const DOLLAR_QUOTED_STRING = 2;

const SERIALIZATION_BUFFER_SIZE = 1024;

const NUL = 0;
const DOLLAR = 36;

// Read through a call so TypeScript does not keep a comparison's narrowing across `advance`.
const la = (lexer: Lexer): number => lexer.lookahead;

// The C scanner keeps a tag as a NUL-terminated `char` string and compares tags with strcmp: each stored byte
// is a code point truncated to `char`, and a tag ends at its first NUL byte. A tag here is those bytes up to
// that NUL.
type Tag = number[];

const cString = (bytes: number[]): Tag => {
  const nul = bytes.indexOf(NUL);
  return nul === -1 ? bytes : bytes.slice(0, nul);
};

const sameTag = (a: Tag, b: Tag): boolean =>
  a.length === b.length && a.every((c, i) => c === b[i]);

/** `$`, a run of anything but `$` and whitespace, then `$`; null (having consumed what it read) otherwise. */
function scanDollarStringTag(lexer: Lexer): Tag | null {
  if (la(lexer) !== DOLLAR) return null;
  const tag = [DOLLAR];
  lexer.advance(false);

  while (la(lexer) !== DOLLAR && !iswspace(la(lexer)) && !lexer.eof()) {
    tag.push(la(lexer) & 0xff);
    lexer.advance(false);
  }

  if (la(lexer) !== DOLLAR) return null;
  tag.push(DOLLAR);
  lexer.advance(false);
  return cString(tag);
}

class SqlScanner implements ExternalScanner {
  startTag: Tag | null = null;

  serialize(buffer: Uint8Array): number {
    if (this.startTag === null) return 0;
    // + 1 for the NUL.
    const length = this.startTag.length + 1;
    if (length >= SERIALIZATION_BUFFER_SIZE) return 0;
    buffer.set(this.startTag);
    buffer[this.startTag.length] = NUL;
    return length;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.startTag = null;
    // A length of 1 can't exist.
    if (length > 1) this.startTag = cString([...buffer.subarray(0, length)]);
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[DOLLAR_QUOTED_STRING_START_TAG] && this.startTag === null) {
      while (iswspace(la(lexer))) lexer.advance(true);

      const startTag = scanDollarStringTag(lexer);
      if (startTag === null) return false;
      this.startTag = startTag;
      lexer.resultSymbol = DOLLAR_QUOTED_STRING_START_TAG;
      return true;
    }

    if (valid[DOLLAR_QUOTED_STRING_END_TAG] && this.startTag !== null) {
      while (iswspace(la(lexer))) lexer.advance(true);

      const endTag = scanDollarStringTag(lexer);
      if (endTag !== null && sameTag(endTag, this.startTag)) {
        this.startTag = null;
        lexer.resultSymbol = DOLLAR_QUOTED_STRING_END_TAG;
        return true;
      }
      return false;
    }

    if (valid[DOLLAR_QUOTED_STRING]) {
      lexer.markEnd();
      while (iswspace(la(lexer))) lexer.advance(true);

      const startTag = scanDollarStringTag(lexer);
      if (startTag === null) return false;
      if (this.startTag !== null && sameTag(this.startTag, startTag))
        return false;

      for (;;) {
        if (lexer.eof()) return false;

        const endTag = scanDollarStringTag(lexer);
        if (endTag === null) {
          // As in C, a `$` run that formed no tag stays consumed, and one more character is skipped.
          lexer.advance(false);
          continue;
        }
        if (sameTag(endTag, startTag)) {
          lexer.markEnd();
          lexer.resultSymbol = DOLLAR_QUOTED_STRING;
          return true;
        }
      }
    }

    return false;
  }
}

export function createScanner(): ExternalScanner {
  return new SqlScanner();
}
