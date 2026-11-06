// Port of tree-sitter-dockerfile 0.2.0 src/scanner.c: heredoc markers, lines and ends.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswspace } from "../../core/wctype.js";

const HEREDOC_MARKER = 0;
const HEREDOC_LINE = 1;
const HEREDOC_END = 2;
const HEREDOC_NL = 3;
const ERROR_SENTINEL = 4;

const MAX_HEREDOCS = 10;
const DEL_SPACE = 512;

const NUL = 0;
const LF = 10;
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;
const DASH = 45;
const LEFT_ANGLE = 60;
const BACKSLASH = 92;
const SPACE = 32;

// Read through a call so TypeScript does not keep a comparison's narrowing across `advance`.
const la = (lexer: Lexer): number => lexer.lookahead;

// The C scanner keeps each delimiter as a NUL-terminated `char` string: index 0
// holds '-' for a stripping heredoc or ' ' otherwise, then the word. A stored
// byte is a code point truncated to `char`, and comparing it with the lookahead
// sign-extends it, so a non-ASCII delimiter never matches, as in C.
const toChar = (c: number): number => c & 0xff;
const fromChar = (c: number): number => (c << 24) >> 24;

class DockerfileScanner implements ExternalScanner {
  inHeredoc = false;
  strippingHeredoc = false;
  /** Each delimiter's bytes up to (not including) its first NUL. */
  heredocs: number[][] = [];

  serialize(buffer: Uint8Array): number {
    let pos = 0;
    buffer[pos++] = Number(this.inHeredoc);
    buffer[pos++] = Number(this.strippingHeredoc);

    for (const heredoc of this.heredocs) {
      // The word plus its NUL, and room for the final NUL after it.
      const len = heredoc.length + 1;
      if (pos + len + 1 > buffer.length) break;
      for (const c of heredoc) buffer[pos++] = c;
      buffer[pos++] = NUL;
    }

    buffer[pos++] = NUL;
    return pos;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.heredocs = [];
    if (length === 0) {
      this.inHeredoc = false;
      this.strippingHeredoc = false;
      return;
    }

    let pos = 0;
    this.inHeredoc = !!buffer[pos++];
    this.strippingHeredoc = !!buffer[pos++];
    for (let i = 0; i < MAX_HEREDOCS; i++) {
      const heredoc: number[] = [];
      while (buffer[pos] !== NUL) heredoc.push(buffer[pos++] as number);
      if (heredoc.length === 0) break;
      pos++;
      this.heredocs.push(heredoc);
    }
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[ERROR_SENTINEL]) {
      return this.inHeredoc ? this.scanContent(lexer, valid) : this.scanMarker(lexer);
    }

    // HEREDOC_NL only matches a line break while heredocs are open, which keeps
    // it apart from the line break that ends an instruction.
    if (valid[HEREDOC_NL]) {
      if (this.heredocs.length > 0 && la(lexer) === LF) {
        lexer.resultSymbol = HEREDOC_NL;
        lexer.advance(false);
        return true;
      }
    }

    if (valid[HEREDOC_MARKER]) return this.scanMarker(lexer);

    if (valid[HEREDOC_LINE] || valid[HEREDOC_END]) return this.scanContent(lexer, valid);

    return false;
  }

  private skipWhitespace(lexer: Lexer): void {
    while (la(lexer) !== NUL && la(lexer) !== LF && iswspace(la(lexer)))
      lexer.advance(true);
  }

  private scanMarker(lexer: Lexer): boolean {
    this.skipWhitespace(lexer);

    if (la(lexer) !== LEFT_ANGLE) return false;
    lexer.advance(false);
    if (la(lexer) !== LEFT_ANGLE) return false;
    lexer.advance(false);

    let stripping = false;
    if (la(lexer) === DASH) {
      stripping = true;
      lexer.advance(false);
    }

    let quote = 0;
    if (la(lexer) === DOUBLE_QUOTE || la(lexer) === SINGLE_QUOTE) {
      quote = la(lexer);
      lexer.advance(false);
    }

    // Recording starts at index 1; index 0 holds the strip indicator.
    const delimiter: number[] = [0];
    let delIdx = 1;

    while (
      la(lexer) !== NUL &&
      (quote ? la(lexer) !== quote : !iswspace(la(lexer)))
    ) {
      if (la(lexer) === BACKSLASH) {
        lexer.advance(false);
        if (la(lexer) === NUL) return false;
      }

      if (delIdx > 0) delimiter[delIdx++] = toChar(la(lexer));
      lexer.advance(false);

      // Out of space: stop recording but keep consuming the marker.
      if (delIdx >= DEL_SPACE - 2) delIdx = 0;
    }

    if (quote) {
      if (la(lexer) !== quote) return false;
      lexer.advance(false);
    }

    if (delIdx === 0) {
      lexer.resultSymbol = HEREDOC_MARKER;
      return true;
    }

    delimiter[0] = stripping ? DASH : SPACE;
    // The C copy is read as a C string, so it ends at the first NUL byte.
    const nul = delimiter.indexOf(NUL, 1);
    const copy = delimiter.slice(0, nul === -1 ? delIdx : Math.min(nul, delIdx));

    if (this.heredocs.length === 0) {
      this.heredocs = [copy];
      this.strippingHeredoc = stripping;
    } else if (this.heredocs.length < MAX_HEREDOCS) {
      this.heredocs.push(copy);
    }

    lexer.resultSymbol = HEREDOC_MARKER;
    return true;
  }

  private scanContent(lexer: Lexer, valid: Uint8Array): boolean {
    if (this.heredocs.length === 0) {
      this.inHeredoc = false;
      return false;
    }

    this.inHeredoc = true;

    if (this.strippingHeredoc) this.skipWhitespace(lexer);

    if (valid[HEREDOC_END]) {
      const current = this.heredocs[0] as number[];
      let delimIdx = 1;
      while (
        delimIdx < current.length &&
        la(lexer) !== NUL &&
        la(lexer) === fromChar(current[delimIdx] as number)
      ) {
        lexer.advance(false);
        delimIdx++;
      }

      if (delimIdx >= current.length) {
        lexer.resultSymbol = HEREDOC_END;
        this.heredocs.shift();
        if (this.heredocs.length > 0) {
          this.strippingHeredoc = (this.heredocs[0] as number[])[0] === DASH;
        } else {
          this.inHeredoc = false;
        }
        return true;
      }
    }

    if (!valid[HEREDOC_LINE]) return false;

    lexer.resultSymbol = HEREDOC_LINE;

    for (;;) {
      if (la(lexer) === NUL) {
        if (lexer.eof()) {
          this.inHeredoc = false;
          return true;
        }
        lexer.advance(false);
      } else if (la(lexer) === LF) {
        return true;
      } else {
        lexer.advance(false);
      }
    }
  }
}

export function createScanner(): ExternalScanner {
  return new DockerfileScanner();
}
