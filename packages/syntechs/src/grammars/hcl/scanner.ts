// Port of tree-sitter-hcl 1.2.0 src/scanner.c: quoted and heredoc templates, and the `${` and `%{` sequences
// that open an interpolation or a directive inside them.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswspace } from "../../core/wctype.js";

const QUOTED_TEMPLATE_START = 0;
const QUOTED_TEMPLATE_END = 1;
const TEMPLATE_LITERAL_CHUNK = 2;
const TEMPLATE_INTERPOLATION_START = 3;
const TEMPLATE_INTERPOLATION_END = 4;
const TEMPLATE_DIRECTIVE_START = 5;
const TEMPLATE_DIRECTIVE_END = 6;
const HEREDOC_IDENTIFIER = 7;

const TEMPLATE_INTERPOLATION = 0;
const TEMPLATE_DIRECTIVE = 1;
const QUOTED_TEMPLATE = 2;
const HEREDOC_TEMPLATE = 3;

const SERIALIZATION_BUFFER_SIZE = 1024;

const NUL = 0;
const LF = 10;
const DOUBLE_QUOTE = 34;
const DOLLAR = 36;
const PERCENT = 37;
const DASH = 45;
const BACKSLASH = 92;
const UNDERSCORE = 95;
const LEFT_BRACE = 123;
const RIGHT_BRACE = 125;

// Read through a call so TypeScript does not keep a comparison's narrowing across `advance`.
const la = (lexer: Lexer): number => lexer.lookahead;

const iswxdigit = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

interface Context {
  type: number;
  /** Valid when `type` is HEREDOC_TEMPLATE: the identifier's code points. */
  heredocIdentifier: number[];
}

class HclScanner implements ExternalScanner {
  stack: Context[] = [];

  // Upstream gives up on a stack deeper than 127 or a heredoc identifier longer than 127 bytes, which drops the
  // state mid-heredoc and turns the rest of the file into errors; only the buffer bounds the state here. An
  // identifier keeps whole code points, four bytes each, so a non-ASCII one still finds its closing line.
  serialize(buffer: Uint8Array): number {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let size = 0;
    view.setUint32(size, this.stack.length, true);
    size += 4;
    for (const context of this.stack) {
      const id = context.heredocIdentifier;
      if (size + 4 + 4 + 4 * id.length > SERIALIZATION_BUFFER_SIZE) return 0;
      view.setUint32(size, context.type, true);
      size += 4;
      view.setUint32(size, id.length, true);
      size += 4;
      for (const c of id) {
        view.setUint32(size, c, true);
        size += 4;
      }
    }
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.stack = [];
    if (length === 0) return;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let size = 0;
    const count = view.getUint32(size, true);
    size += 4;
    for (let j = 0; j < count; j++) {
      const type = view.getUint32(size, true);
      size += 4;
      const len = view.getUint32(size, true);
      size += 4;
      const heredocIdentifier: number[] = [];
      for (let k = 0; k < len; k++) {
        heredocIdentifier.push(view.getUint32(size, true));
        size += 4;
      }
      this.stack.push({ type, heredocIdentifier });
    }
  }

  private inContext(type: number): boolean {
    return this.stack.at(-1)?.type === type;
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    let newlineBefore = false;
    while (iswspace(la(lexer))) {
      if (la(lexer) === LF) newlineBefore = true;
      lexer.advance(true);
    }
    if (la(lexer) === NUL) return false;

    const accept = (token: number): boolean => {
      lexer.resultSymbol = token;
      return true;
    };
    const acceptAndAdvance = (token: number): boolean => {
      lexer.advance(false);
      return accept(token);
    };
    const push = (type: number, heredocIdentifier: number[] = []) =>
      this.stack.push({ type, heredocIdentifier });

    // manage quoted context
    if (valid[QUOTED_TEMPLATE_START] && !this.inContext(QUOTED_TEMPLATE) && la(lexer) === DOUBLE_QUOTE) {
      push(QUOTED_TEMPLATE);
      return acceptAndAdvance(QUOTED_TEMPLATE_START);
    }
    if (valid[QUOTED_TEMPLATE_END] && this.inContext(QUOTED_TEMPLATE) && la(lexer) === DOUBLE_QUOTE) {
      this.stack.pop();
      return acceptAndAdvance(QUOTED_TEMPLATE_END);
    }

    // manage template interpolations
    if (
      valid[TEMPLATE_INTERPOLATION_START] &&
      valid[TEMPLATE_LITERAL_CHUNK] &&
      !this.inContext(TEMPLATE_INTERPOLATION) &&
      la(lexer) === DOLLAR
    ) {
      lexer.advance(false);
      if (la(lexer) === LEFT_BRACE) {
        push(TEMPLATE_INTERPOLATION);
        return acceptAndAdvance(TEMPLATE_INTERPOLATION_START);
      }
      // `$${` escapes an interpolation.
      if (la(lexer) === DOLLAR) {
        lexer.advance(false);
        if (la(lexer) === LEFT_BRACE) return acceptAndAdvance(TEMPLATE_LITERAL_CHUNK);
      }
      return accept(TEMPLATE_LITERAL_CHUNK);
    }
    if (valid[TEMPLATE_INTERPOLATION_END] && this.inContext(TEMPLATE_INTERPOLATION) && la(lexer) === RIGHT_BRACE) {
      this.stack.pop();
      return acceptAndAdvance(TEMPLATE_INTERPOLATION_END);
    }

    // manage template directives
    if (
      valid[TEMPLATE_DIRECTIVE_START] &&
      valid[TEMPLATE_LITERAL_CHUNK] &&
      !this.inContext(TEMPLATE_DIRECTIVE) &&
      la(lexer) === PERCENT
    ) {
      lexer.advance(false);
      if (la(lexer) === LEFT_BRACE) {
        push(TEMPLATE_DIRECTIVE);
        return acceptAndAdvance(TEMPLATE_DIRECTIVE_START);
      }
      // `%%{` escapes a directive.
      if (la(lexer) === PERCENT) {
        lexer.advance(false);
        if (la(lexer) === LEFT_BRACE) return acceptAndAdvance(TEMPLATE_LITERAL_CHUNK);
      }
      return accept(TEMPLATE_LITERAL_CHUNK);
    }
    if (valid[TEMPLATE_DIRECTIVE_END] && this.inContext(TEMPLATE_DIRECTIVE) && la(lexer) === RIGHT_BRACE) {
      this.stack.pop();
      return acceptAndAdvance(TEMPLATE_DIRECTIVE_END);
    }

    // manage heredoc context
    if (valid[HEREDOC_IDENTIFIER] && !this.inContext(HEREDOC_TEMPLATE)) {
      const identifier: number[] = [];
      while (iswalnum(la(lexer)) || la(lexer) === UNDERSCORE || la(lexer) === DASH) {
        identifier.push(la(lexer));
        lexer.advance(false);
      }
      push(HEREDOC_TEMPLATE, identifier);
      return accept(HEREDOC_IDENTIFIER);
    }
    if (valid[HEREDOC_IDENTIFIER] && this.inContext(HEREDOC_TEMPLATE) && newlineBefore) {
      const expected = (this.stack.at(-1) as Context).heredocIdentifier;
      for (const c of expected) {
        if (la(lexer) === c) lexer.advance(false);
        else return accept(TEMPLATE_LITERAL_CHUNK);
      }
      // check if the identifier is on a line of its own
      lexer.markEnd();
      while (iswspace(la(lexer)) && la(lexer) !== LF) lexer.advance(false);
      if (la(lexer) === LF) {
        this.stack.pop();
        return accept(HEREDOC_IDENTIFIER);
      }
      lexer.advance(false);
      lexer.markEnd();
      return accept(TEMPLATE_LITERAL_CHUNK);
    }

    // A quoted template's literal chunks hold no newline and may hold escape sequences.
    if (valid[TEMPLATE_LITERAL_CHUNK] && this.inContext(QUOTED_TEMPLATE) && la(lexer) === BACKSLASH) {
      lexer.advance(false);
      switch (la(lexer)) {
        case DOUBLE_QUOTE:
        case 110: // n
        case 114: // r
        case 116: // t
        case BACKSLASH:
          return acceptAndAdvance(TEMPLATE_LITERAL_CHUNK);
        case 117: // u
        case 85: {
          // U
          const digits = la(lexer) === 117 ? 4 : 8;
          for (let i = 0; i < digits; i++) {
            lexer.advance(false);
            if (!iswxdigit(la(lexer))) return false;
          }
          return acceptAndAdvance(TEMPLATE_LITERAL_CHUNK);
        }
        default:
          return false;
      }
    }

    // any other quoted template or heredoc character
    if (
      valid[TEMPLATE_LITERAL_CHUNK] &&
      (this.inContext(QUOTED_TEMPLATE) || this.inContext(HEREDOC_TEMPLATE))
    )
      return acceptAndAdvance(TEMPLATE_LITERAL_CHUNK);

    // probably not handled by the external scanner
    return false;
  }
}

export function createScanner(): ExternalScanner {
  return new HclScanner();
}
