// Port of tree-sitter-xml 0.7.0 (5000ae8f) xml/src/scanner.c and common/scanner.h, with grammar.patch's change:
// a processing instruction's target and content, a comment, character data (without the spaces around it, which
// the content holds as `_S`), a CDATA section, and the stack of open elements, which decides whether an end tag
// closes the element on top (else its name is an erroneous one). Each name is kept as scanner.c's chars, the low
// byte of each code point, and the state serializes byte for byte as its does, the 255-byte name and the
// 1024-byte buffer caps included.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswalpha } from "../../core/wctype.js";

const PI_TARGET = 0;
const PI_CONTENT = 1;
const COMMENT = 2;
const CHAR_DATA = 3;
const CDATA = 4;
const XML_MODEL = 5;
const XML_STYLESHEET = 6;
const START_TAG_NAME = 7;
const END_TAG_NAME = 8;
const ERRONEOUS_END_NAME = 9;
const SELF_CLOSING_TAG_DELIMITER = 10;

const SERIALIZATION_BUFFER_SIZE = 1024;

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const BANG = 33;
const AMPERSAND = 38;
const HYPHEN = 45;
const DOT = 46;
const SLASH = 47;
const COLON = 58;
const LESS = 60;
const GREATER = 62;
const QUESTION = 63;
const RIGHT_BRACKET = 93;
const UNDERSCORE = 95;

// Read through a call so TypeScript does not keep a comparison's narrowing across `advance`.
const la = (lexer: Lexer): number => lexer.lookahead;

const advance = (lexer: Lexer): void => lexer.advance(false);

/** scanner.h's advance_if_eq, whose failure returns false from the caller: here the caller tests the result. */
function advanceIfEq(lexer: Lexer, chr: number): boolean {
  if (lexer.eof() || la(lexer) !== chr) return false;
  advance(lexer);
  return true;
}

function isValidNameChar(chr: number): boolean {
  return iswalnum(chr) || chr === UNDERSCORE || chr === COLON || chr === DOT || chr === HYPHEN || chr === 0xb7;
}

function isValidNameStartChar(chr: number): boolean {
  return iswalpha(chr) || chr === UNDERSCORE || chr === COLON;
}

function checkWord(lexer: Lexer, word: string): boolean {
  for (let j = 0; j < word.length; j++) {
    if (!advanceIfEq(lexer, word.charCodeAt(j))) return false;
  }
  return true;
}

/** A PI's target, except `xml-model` and `xml-stylesheet` where those keywords are valid. */
function scanPiTarget(lexer: Lexer, valid: Uint8Array): boolean {
  let advancedOnce = false;
  let foundXFirst = false;

  if (isValidNameStartChar(la(lexer))) {
    if (la(lexer) === 0x78 || la(lexer) === 0x58) {
      foundXFirst = true;
      lexer.markEnd();
    }
    advancedOnce = true;
    advance(lexer);
  }

  if (!advancedOnce) return false;

  while (isValidNameChar(la(lexer))) {
    if (foundXFirst && (la(lexer) === 0x6d || la(lexer) === 0x4d)) {
      advance(lexer);
      if (la(lexer) === 0x6c || la(lexer) === 0x4c) {
        advance(lexer);
        if (isValidNameChar(la(lexer))) {
          foundXFirst = false;
          const lastCharHyphen = la(lexer) === HYPHEN;
          advance(lexer);
          if (lastCharHyphen) {
            if (valid[XML_MODEL] && checkWord(lexer, "model")) return false;
            if (valid[XML_STYLESHEET] && checkWord(lexer, "stylesheet")) return false;
          }
        } else {
          return false;
        }
      }
    }
    foundXFirst = false;
    advance(lexer);
  }

  lexer.markEnd();
  lexer.resultSymbol = PI_TARGET;
  return true;
}

/** A PI's content, up to its `?>` on the same line; the spaces and line ending after it go with the token. */
function scanPiContent(lexer: Lexer): boolean {
  while (!lexer.eof() && la(lexer) !== LF && la(lexer) !== QUESTION) advance(lexer);

  if (la(lexer) !== QUESTION) return false;

  lexer.markEnd();
  advance(lexer);

  if (la(lexer) === GREATER) {
    advance(lexer);
    while (la(lexer) === SPACE) advance(lexer);
    if (!advanceIfEq(lexer, LF)) return false;
    lexer.resultSymbol = PI_CONTENT;
    return true;
  }

  return false;
}

/** A comment after its `<!`, through its `-->`. */
function scanComment(lexer: Lexer): boolean {
  if (!advanceIfEq(lexer, HYPHEN)) return false;
  if (!advanceIfEq(lexer, HYPHEN)) return false;

  while (!lexer.eof()) {
    if (la(lexer) === HYPHEN) {
      advance(lexer);
      if (la(lexer) === HYPHEN) {
        advance(lexer);
        break;
      }
    } else {
      advance(lexer);
    }
  }

  if (la(lexer) === GREATER) {
    advance(lexer);
    lexer.markEnd();
    lexer.resultSymbol = COMMENT;
    return true;
  }

  return false;
}

/** One of the characters the grammar's `_S` matches. */
function isSpace(chr: number): boolean {
  return chr === SPACE || chr === TAB || chr === CR || chr === LF;
}

function inCharData(lexer: Lexer): boolean {
  return !lexer.eof() && la(lexer) !== LESS && la(lexer) !== AMPERSAND;
}

/** Past one character of character data, which ends after its last character that is not a space. */
function advanceCharData(lexer: Lexer): void {
  const space = isSpace(la(lexer));
  advance(lexer);
  if (!space) lexer.markEnd();
}

/** Character data: text up to a `<` or `&`, without the spaces around it; a `]]>` in it is an error. */
function scanCharData(lexer: Lexer): boolean {
  let advancedOnce = false;

  if (isSpace(la(lexer))) return false;

  while (inCharData(lexer)) {
    if (la(lexer) === RIGHT_BRACKET) {
      advanceCharData(lexer);
      if (la(lexer) === RIGHT_BRACKET) {
        advanceCharData(lexer);
        if (la(lexer) === GREATER) {
          advanceCharData(lexer);
          if (advancedOnce) {
            lexer.resultSymbol = CHAR_DATA;
            return false;
          }
        }
      }
    }
    advancedOnce = true;
    if (inCharData(lexer)) advanceCharData(lexer);
  }

  if (advancedOnce) {
    lexer.resultSymbol = CHAR_DATA;
    return true;
  }
  return false;
}

/** A CDATA section's text, up to its `]]>`. */
function scanCdata(lexer: Lexer): boolean {
  let advancedOnce = false;

  while (!lexer.eof()) {
    if (la(lexer) === RIGHT_BRACKET) {
      lexer.markEnd();
      advance(lexer);
      if (la(lexer) === RIGHT_BRACKET) {
        advance(lexer);
        if (la(lexer) === GREATER && advancedOnce) {
          lexer.resultSymbol = CDATA;
          return true;
        }
      }
    }
    advancedOnce = true;
    advance(lexer);
  }

  return false;
}

/** A name as scanner.c keeps it: each code point cast to a char. */
function scanTagName(lexer: Lexer): number[] {
  const name: number[] = [];
  if (isValidNameStartChar(la(lexer))) {
    name.push(la(lexer) & 0xff);
    advance(lexer);
  }
  while (isValidNameChar(la(lexer))) {
    name.push(la(lexer) & 0xff);
    advance(lexer);
  }
  return name;
}

function sameName(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

class XmlScanner implements ExternalScanner {
  private tags: number[][] = [];

  private scanStartTagName(lexer: Lexer): boolean {
    const name = scanTagName(lexer);
    if (name.length === 0) return false;
    lexer.resultSymbol = START_TAG_NAME;
    this.tags.push(name);
    return true;
  }

  private scanEndTagName(lexer: Lexer): boolean {
    const name = scanTagName(lexer);
    if (name.length === 0) return false;
    const top = this.tags[this.tags.length - 1];
    if (top !== undefined && sameName(top, name)) {
      this.tags.pop();
      lexer.resultSymbol = END_TAG_NAME;
    } else {
      lexer.resultSymbol = ERRONEOUS_END_NAME;
    }
    return lexer.resultSymbol === END_TAG_NAME;
  }

  private scanSelfClosingTagDelimiter(lexer: Lexer): boolean {
    advance(lexer);
    if (!advanceIfEq(lexer, GREATER)) return false;
    if (this.tags.length > 0) {
      this.tags.pop();
      lexer.resultSymbol = SELF_CLOSING_TAG_DELIMITER;
    }
    return true;
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    // Error recovery, where every token is valid.
    if (valid[PI_TARGET] && valid[PI_CONTENT] && valid[COMMENT] && valid[CHAR_DATA] && valid[CDATA]) return false;

    if (valid[PI_TARGET]) return scanPiTarget(lexer, valid);
    if (valid[PI_CONTENT]) return scanPiContent(lexer);
    if (valid[CHAR_DATA] && scanCharData(lexer)) return true;
    if (valid[CDATA] && scanCdata(lexer)) return true;

    switch (la(lexer)) {
      case LESS:
        lexer.markEnd();
        advance(lexer);
        if (la(lexer) === BANG) {
          advance(lexer);
          return scanComment(lexer);
        }
        break;
      case SLASH:
        if (valid[SELF_CLOSING_TAG_DELIMITER]) return this.scanSelfClosingTagDelimiter(lexer);
        break;
      case 0:
        break;
      default:
        if (valid[START_TAG_NAME]) return this.scanStartTagName(lexer);
        if (valid[END_TAG_NAME]) return this.scanEndTagName(lexer);
    }
    return false;
  }

  // scanner.c also frees each tag it writes; the parser deserializes before every scan, so that changes nothing.
  serialize(buffer: Uint8Array): number {
    const count = Math.min(this.tags.length, 0xffff);
    let serialized = 0;
    let size = 8;
    writeUint32(buffer, 4, count);
    for (; serialized < count; serialized++) {
      const tag = this.tags[serialized] as number[];
      const length = Math.min(tag.length, 0xff);
      if (size + 2 + length >= SERIALIZATION_BUFFER_SIZE) break;
      buffer[size++] = length;
      for (let i = 0; i < length; i++) buffer[size++] = tag[i] as number;
    }
    writeUint32(buffer, 0, serialized);
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.tags = [];
    if (length === 0) return;
    const serialized = readUint32(buffer, 0);
    const count = readUint32(buffer, 4);
    if (count === 0) return;
    let size = 8;
    let i = 0;
    for (; i < serialized; i++) {
      const n = buffer[size++] as number;
      this.tags.push(Array.from(buffer.subarray(size, size + n)));
      size += n;
    }
    // The tags the buffer had no room for, as empty ones.
    for (; i < count; i++) this.tags.push([]);
  }
}

function writeUint32(buffer: Uint8Array, at: number, value: number): void {
  buffer[at] = value & 0xff;
  buffer[at + 1] = (value >>> 8) & 0xff;
  buffer[at + 2] = (value >>> 16) & 0xff;
  buffer[at + 3] = (value >>> 24) & 0xff;
}

function readUint32(buffer: Uint8Array, at: number): number {
  return (
    ((buffer[at] as number) |
      ((buffer[at + 1] as number) << 8) |
      ((buffer[at + 2] as number) << 16) |
      ((buffer[at + 3] as number) << 24)) >>>
    0
  );
}

export function createScanner(): ExternalScanner {
  return new XmlScanner();
}
