// Port of tree-sitter-markdown 0.5.4 tree-sitter-markdown/src/scanner.c: the whole block structure. It keeps a
// stack of open blocks (block quotes, list items by content indentation, code blocks), matches each line's
// prefix against it, and emits the tokens that open, continue and close blocks.
//
// Kept from the C scanner on purpose, since the parse tables were generated against it: its `uint8_t` fields
// wrap at 256, a list item's block is `LIST_ITEM` plus its indentation even past the enum's end (so a deep one
// reads as a fenced code block or an anonymous block), each block serializes as a 4-byte enum, and `(char)`
// casts keep only a code point's low byte.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswalpha } from "../../core/wctype.js";

/** The lookahead, read through a call so TypeScript does not keep a comparison's narrowing across `advance`. */
const la = (lexer: Lexer): number => lexer.lookahead;

const LINE_ENDING = 0;
const SOFT_LINE_ENDING = 1;
const BLOCK_CLOSE = 2;
const BLOCK_CONTINUATION = 3;
const BLOCK_QUOTE_START = 4;
const INDENTED_CHUNK_START = 5;
const ATX_H1_MARKER = 6;
const SETEXT_H1_UNDERLINE = 12;
const SETEXT_H2_UNDERLINE = 13;
const THEMATIC_BREAK = 14;
const LIST_MARKER_MINUS = 15;
const LIST_MARKER_PLUS = 16;
const LIST_MARKER_STAR = 17;
const LIST_MARKER_PARENTHESIS = 18;
const LIST_MARKER_DOT = 19;
const LIST_MARKER_MINUS_DONT_INTERRUPT = 20;
const LIST_MARKER_PLUS_DONT_INTERRUPT = 21;
const LIST_MARKER_STAR_DONT_INTERRUPT = 22;
const LIST_MARKER_PARENTHESIS_DONT_INTERRUPT = 23;
const LIST_MARKER_DOT_DONT_INTERRUPT = 24;
const FENCED_CODE_BLOCK_START_BACKTICK = 25;
const FENCED_CODE_BLOCK_START_TILDE = 26;
const BLANK_LINE_START = 27;
const FENCED_CODE_BLOCK_END_BACKTICK = 28;
const FENCED_CODE_BLOCK_END_TILDE = 29;
const HTML_BLOCK_1_START = 30;
const HTML_BLOCK_1_END = 31;
const HTML_BLOCK_2_START = 32;
const HTML_BLOCK_3_START = 33;
const HTML_BLOCK_4_START = 34;
const HTML_BLOCK_5_START = 35;
const HTML_BLOCK_6_START = 36;
const HTML_BLOCK_7_START = 37;
const CLOSE_BLOCK = 38;
const NO_INDENTED_CHUNK = 39;
const ERROR = 40;
const TRIGGER_ERROR = 41;
const TOKEN_EOF = 42;
const MINUS_METADATA = 43;
const PLUS_METADATA = 44;
const PIPE_TABLE_START = 45;
const PIPE_TABLE_LINE_ENDING = 46;
const NUM_TOKEN_TYPES = 47;

// The blocks on the stack. LIST_ITEM is a list item whose content starts at column 2; LIST_ITEM + k at 2 + k.
const BLOCK_QUOTE = 0;
const INDENTED_CODE_BLOCK = 1;
const LIST_ITEM = 2;
const LIST_ITEM_MAX_INDENTATION = 17;
const FENCED_CODE_BLOCK = 18;
const ANONYMOUS = 19;

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const BANG = 33;
const DOUBLE_QUOTE = 34;
const PLUS = 43;
const SINGLE_QUOTE = 39;
const STAR = 42;
const MINUS = 45;
const DOT = 46;
const SLASH = 47;
const ZERO = 48;
const NINE = 57;
const COLON = 58;
const LEFT_ANGLE = 60;
const EQUAL = 61;
const RIGHT_ANGLE = 62;
const QUESTION = 63;
const HASH = 35;
const UPPER_A = 65;
const UPPER_C = 67;
const UPPER_D = 68;
const UPPER_T = 84;
const UPPER_Z = 90;
const LEFT_BRACKET = 91;
const BACKSLASH = 92;
const UNDERSCORE = 95;
const BACKTICK = 96;
const PIPE = 124;
const TILDE = 126;
const RIGHT_PAREN = 41;

const BUFFER_SIZE = 1024;
/** Bytes per block in the serialized state: C's `sizeof(Block)`. */
const BLOCK_BYTES = 4;
/** No new blocks open once this many are open: the serialized state is 5 bytes and then the blocks. */
const MAX_OPEN_BLOCKS = Math.floor((BUFFER_SIZE - 5) / BLOCK_BYTES);

/** Currently matching open blocks, at the start of a line. */
const STATE_MATCHING = 0x1 << 0;
/** The last line break was inside a paragraph. */
const STATE_WAS_SOFT_LINE_BREAK = 0x1 << 1;
/** Close a block after the next line break. */
const STATE_CLOSE_BLOCK = 0x1 << 4;

const HTML_TAG_NAMES_RULE_1 = ["pre", "script", "style"];
const HTML_TAG_NAMES_RULE_7 = [
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col",
  "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html",
  "iframe", "legend", "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option",
  "p", "param", "section", "source", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr",
  "track", "ul",
];

/** The tokens that may interrupt a paragraph: what the scanner tries after a line break inside one. */
const PARAGRAPH_INTERRUPT_SYMBOLS = new Uint8Array(NUM_TOKEN_TYPES);
for (const t of [
  BLOCK_QUOTE_START, ATX_H1_MARKER, ATX_H1_MARKER + 1, ATX_H1_MARKER + 2, ATX_H1_MARKER + 3,
  ATX_H1_MARKER + 4, ATX_H1_MARKER + 5, SETEXT_H1_UNDERLINE, SETEXT_H2_UNDERLINE, THEMATIC_BREAK,
  LIST_MARKER_MINUS, LIST_MARKER_PLUS, LIST_MARKER_STAR, LIST_MARKER_PARENTHESIS, LIST_MARKER_DOT,
  FENCED_CODE_BLOCK_START_BACKTICK, FENCED_CODE_BLOCK_START_TILDE, BLANK_LINE_START, HTML_BLOCK_1_START,
  HTML_BLOCK_2_START, HTML_BLOCK_3_START, HTML_BLOCK_4_START, HTML_BLOCK_5_START, HTML_BLOCK_6_START,
  PIPE_TABLE_START,
])
  PARAGRAPH_INTERRUPT_SYMBOLS[t] = 1;

/** Whether the token pushes onto the open blocks. */
const opensBlock = (t: number) =>
  t === BLOCK_QUOTE_START ||
  t === INDENTED_CHUNK_START ||
  (t >= LIST_MARKER_MINUS && t <= FENCED_CODE_BLOCK_START_TILDE) ||
  t === HTML_BLOCK_1_START ||
  (t >= HTML_BLOCK_2_START && t <= HTML_BLOCK_7_START);

/** Punctuation as the markdown spec defines it, of C's `(char)` cast: a code point's low byte, signed. */
const isPunctuation = (codePoint: number) => {
  const c = codePoint & 0xff;
  return (
    (c >= 33 && c <= 47) ||
    (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) ||
    (c >= 123 && c <= 126)
  );
};

const isAsciiDigit = (c: number) => c >= ZERO && c <= NINE;
const isLineEnd = (c: number) => c === LF || c === CR;
const isBlank = (c: number) => c === SPACE || c === TAB;

class Scanner implements ExternalScanner {
  openBlocks: number[] = [];
  state = 0;
  /** Open blocks matched so far on this line; reset at every line ending. */
  matched = 0;
  /** Consumed but unused indentation: a tab may be split across tokens. */
  indentation = 0;
  /** The column modulo 4, for how many spaces a tab is worth. */
  column = 0;
  fencedCodeBlockDelimiterLength = 0;
  simulate = false;

  serialize(buffer: Uint8Array): number {
    let size = 0;
    buffer[size++] = this.state;
    buffer[size++] = this.matched;
    buffer[size++] = this.indentation;
    buffer[size++] = this.column;
    buffer[size++] = this.fencedCodeBlockDelimiterLength;
    const count = Math.min(
      this.openBlocks.length,
      Math.floor((BUFFER_SIZE - size) / BLOCK_BYTES),
    );
    for (let i = 0; i < count; i++) {
      const b = this.openBlocks[i] as number;
      buffer[size++] = b & 0xff;
      buffer[size++] = (b >>> 8) & 0xff;
      buffer[size++] = (b >>> 16) & 0xff;
      buffer[size++] = (b >>> 24) & 0xff;
    }
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.openBlocks = [];
    this.state = 0;
    this.matched = 0;
    this.indentation = 0;
    this.column = 0;
    this.fencedCodeBlockDelimiterLength = 0;
    if (length > 0) {
      let size = 0;
      this.state = buffer[size++] as number;
      this.matched = buffer[size++] as number;
      this.indentation = buffer[size++] as number;
      this.column = buffer[size++] as number;
      this.fencedCodeBlockDelimiterLength = buffer[size++] as number;
      const count = Math.floor((length - size) / BLOCK_BYTES);
      for (let i = 0; i < count; i++, size += BLOCK_BYTES)
        this.openBlocks.push(
          ((buffer[size] as number) |
            ((buffer[size + 1] as number) << 8) |
            ((buffer[size + 2] as number) << 16) |
            ((buffer[size + 3] as number) << 24)) >>>
            0,
        );
    }
  }

  private push(block: number): void {
    if (!this.simulate) this.openBlocks.push(block);
  }

  private markEnd(lexer: Lexer): void {
    if (!this.simulate) lexer.markEnd();
  }

  /** Advances one character, tracking the column with tab stops of 4; returns the columns it spanned. */
  private advance(lexer: Lexer): number {
    let size = 1;
    if (la(lexer) === TAB) {
      size = 4 - this.column;
      this.column = 0;
    } else this.column = (this.column + 1) % 4;
    lexer.advance(false);
    return size;
  }

  private indent(by: number): void {
    this.indentation = (this.indentation + by) & 0xff;
  }

  /** Consumes the prefix that continues `block` on this line: indentation, or a block quote's `>`. */
  private match(lexer: Lexer, block: number): boolean {
    if (block === INDENTED_CODE_BLOCK) {
      while (this.indentation < 4) {
        if (isBlank(la(lexer))) this.indent(this.advance(lexer));
        else break;
      }
      if (this.indentation >= 4 && !isLineEnd(la(lexer))) {
        this.indentation -= 4;
        return true;
      }
      return false;
    }
    if (block >= LIST_ITEM && block <= LIST_ITEM_MAX_INDENTATION) {
      const need = block & 0xff;
      while (this.indentation < need) {
        if (isBlank(la(lexer))) this.indent(this.advance(lexer));
        else break;
      }
      if (this.indentation >= need) {
        this.indentation -= need;
        return true;
      }
      if (isLineEnd(la(lexer))) {
        this.indentation = 0;
        return true;
      }
      return false;
    }
    if (block === BLOCK_QUOTE) {
      while (isBlank(la(lexer))) this.indent(this.advance(lexer));
      if (la(lexer) === RIGHT_ANGLE) {
        this.advance(lexer);
        this.indentation = 0;
        if (isBlank(la(lexer))) this.indent(this.advance(lexer) - 1);
        return true;
      }
      return false;
    }
    return block === FENCED_CODE_BLOCK || block === ANONYMOUS;
  }

  private parseFencedCodeBlock(
    delimiter: number,
    lexer: Lexer,
    valid: Uint8Array,
  ): boolean {
    const backtick = delimiter === BACKTICK;
    const start = backtick
      ? FENCED_CODE_BLOCK_START_BACKTICK
      : FENCED_CODE_BLOCK_START_TILDE;
    const end = backtick
      ? FENCED_CODE_BLOCK_END_BACKTICK
      : FENCED_CODE_BLOCK_END_TILDE;
    // Nothing to emit for this delimiter: bail before counting a long run, quadratic across a paragraph.
    if (!valid[start] && !valid[end]) return false;
    let level = 0;
    while (la(lexer) === delimiter) {
      this.advance(lexer);
      level = (level + 1) & 0xff;
    }
    this.markEnd(lexer);
    // A closing fence is the only reading where one can close: as long as the opening, indented under 4.
    if (
      valid[end] &&
      this.indentation < 4 &&
      level >= this.fencedCodeBlockDelimiterLength
    ) {
      while (isBlank(la(lexer))) this.advance(lexer);
      const isEof = lexer.eof();
      // A closing fence may end the input without a line ending; its trailing whitespace joins the token.
      if (isEof) this.markEnd(lexer);
      if (isLineEnd(la(lexer)) || isEof) {
        this.fencedCodeBlockDelimiterLength = 0;
        lexer.resultSymbol = end;
        return true;
      }
    }
    // An opening fence, unless a backtick fence's info string has a backtick.
    if (valid[start] && level >= 3) {
      let infoStringHasBacktick = false;
      if (backtick) {
        while (!isLineEnd(la(lexer)) && !lexer.eof()) {
          if (la(lexer) === BACKTICK) {
            infoStringHasBacktick = true;
            break;
          }
          this.advance(lexer);
        }
      }
      if (!infoStringHasBacktick) {
        lexer.resultSymbol = start;
        this.push(FENCED_CODE_BLOCK);
        this.fencedCodeBlockDelimiterLength = level;
        this.indentation = 0;
        return true;
      }
    }
    return false;
  }

  /**
   * After a list marker: the content's indentation is the marker's plus the spaces after it less one, unless
   * those are over 3, when the item starts with an indented code block and they are kept for it.
   */
  private listItem(extraIndentation: number, extra = 0): void {
    let extraIndent = (extraIndentation - 1) & 0xff;
    if (extraIndent <= 3) {
      extraIndent = (extraIndent + this.indentation) & 0xff;
      this.indentation = 0;
    } else {
      const temp = this.indentation;
      this.indentation = extraIndent;
      extraIndent = temp;
    }
    this.push(LIST_ITEM + extraIndent + extra);
  }

  private parseStar(lexer: Lexer, valid: Uint8Array): boolean {
    // Nothing to emit: bail before scanning a long run of `*`, quadratic across a paragraph.
    if (
      !valid[THEMATIC_BREAK] &&
      !valid[LIST_MARKER_STAR] &&
      !valid[LIST_MARKER_STAR_DONT_INTERRUPT]
    )
      return false;
    this.advance(lexer);
    this.markEnd(lexer);
    // Stars, whitespace allowed between them; and how many spaces follow the first.
    let starCount = 1;
    let extraIndentation = 0;
    for (;;) {
      if (la(lexer) === STAR) {
        // The token is at least this long if it turns out to be a list marker.
        if (starCount === 1 && extraIndentation >= 1 && valid[LIST_MARKER_STAR])
          this.markEnd(lexer);
        starCount++;
        this.advance(lexer);
      } else if (isBlank(la(lexer))) {
        if (starCount === 1)
          extraIndentation = (extraIndentation + this.advance(lexer)) & 0xff;
        else this.advance(lexer);
      } else break;
    }
    const lineEnd = isLineEnd(la(lexer));
    let dontInterrupt = false;
    if (starCount === 1 && lineEnd) {
      extraIndentation = 1;
      // An empty item does not interrupt a paragraph.
      dontInterrupt = this.matched === this.openBlocks.length;
    }
    const thematicBreak = starCount >= 3 && lineEnd;
    const listMarkerStar = starCount >= 1 && extraIndentation >= 1;
    if (valid[THEMATIC_BREAK] && thematicBreak && this.indentation < 4) {
      lexer.resultSymbol = THEMATIC_BREAK;
      this.markEnd(lexer);
      this.indentation = 0;
      return true;
    }
    if (
      (dontInterrupt
        ? valid[LIST_MARKER_STAR_DONT_INTERRUPT]
        : valid[LIST_MARKER_STAR]) &&
      listMarkerStar
    ) {
      // With more stars `markEnd` already ran at the right point.
      if (starCount === 1) this.markEnd(lexer);
      this.listItem(extraIndentation);
      lexer.resultSymbol = dontInterrupt
        ? LIST_MARKER_STAR_DONT_INTERRUPT
        : LIST_MARKER_STAR;
      return true;
    }
    return false;
  }

  private parseThematicBreakUnderscore(
    lexer: Lexer,
    valid: Uint8Array,
  ): boolean {
    if (!valid[THEMATIC_BREAK]) return false;
    this.advance(lexer);
    this.markEnd(lexer);
    let count = 1;
    for (;;) {
      if (la(lexer) === UNDERSCORE) {
        count++;
        this.advance(lexer);
      } else if (isBlank(la(lexer))) this.advance(lexer);
      else break;
    }
    if (count >= 3 && isLineEnd(la(lexer))) {
      lexer.resultSymbol = THEMATIC_BREAK;
      this.markEnd(lexer);
      this.indentation = 0;
      return true;
    }
    return false;
  }

  private parseBlockQuote(lexer: Lexer, valid: Uint8Array): boolean {
    if (!valid[BLOCK_QUOTE_START]) return false;
    this.advance(lexer);
    this.indentation = 0;
    if (isBlank(la(lexer))) this.indent(this.advance(lexer) - 1);
    lexer.resultSymbol = BLOCK_QUOTE_START;
    this.push(BLOCK_QUOTE);
    return true;
  }

  private parseAtxHeading(lexer: Lexer, valid: Uint8Array): boolean {
    if (!valid[ATX_H1_MARKER] || this.indentation > 3) return false;
    this.markEnd(lexer);
    let level = 0;
    while (la(lexer) === HASH && level <= 6) {
      this.advance(lexer);
      level++;
    }
    if (level <= 6 && (isBlank(la(lexer)) || isLineEnd(la(lexer)))) {
      lexer.resultSymbol = ATX_H1_MARKER + (level - 1);
      this.indentation = 0;
      this.markEnd(lexer);
      return true;
    }
    return false;
  }

  private parseSetextUnderline(lexer: Lexer, valid: Uint8Array): boolean {
    if (
      !valid[SETEXT_H1_UNDERLINE] ||
      this.matched !== this.openBlocks.length
    )
      return false;
    this.markEnd(lexer);
    while (la(lexer) === EQUAL) this.advance(lexer);
    while (isBlank(la(lexer))) this.advance(lexer);
    if (isLineEnd(la(lexer))) {
      lexer.resultSymbol = SETEXT_H1_UNDERLINE;
      this.markEnd(lexer);
      return true;
    }
    return false;
  }

  /** Steps over one line ending, CRLF as one. */
  private newline(lexer: Lexer): void {
    if (la(lexer) === CR) {
      this.advance(lexer);
      if (la(lexer) === LF) this.advance(lexer);
    } else this.advance(lexer);
  }

  /**
   * The rest of a metadata block after its opening `+++` or `---` line: up to a line of exactly three of
   * `fence`, which with its line ending ends the token. False when the input ends first.
   */
  private metadata(lexer: Lexer, fence: number, token: number): boolean {
    for (;;) {
      this.newline(lexer);
      let count = 0;
      while (la(lexer) === fence) {
        count++;
        this.advance(lexer);
      }
      if (count === 3) {
        while (isBlank(la(lexer))) this.advance(lexer);
        if (isLineEnd(la(lexer))) {
          this.newline(lexer);
          this.markEnd(lexer);
          lexer.resultSymbol = token;
          return true;
        }
      }
      while (!isLineEnd(la(lexer)) && !lexer.eof()) this.advance(lexer);
      if (lexer.eof()) return false;
    }
  }

  private parsePlus(lexer: Lexer, valid: Uint8Array): boolean {
    if (
      this.indentation > 3 ||
      !(
        valid[LIST_MARKER_PLUS] ||
        valid[LIST_MARKER_PLUS_DONT_INTERRUPT] ||
        valid[PLUS_METADATA]
      )
    )
      return false;
    this.advance(lexer);
    if (valid[PLUS_METADATA] && la(lexer) === PLUS) {
      this.advance(lexer);
      if (la(lexer) !== PLUS) return false;
      this.advance(lexer);
      while (isBlank(la(lexer))) this.advance(lexer);
      if (!isLineEnd(la(lexer))) return false;
      return this.metadata(lexer, PLUS, PLUS_METADATA);
    }
    let extraIndentation = 0;
    while (isBlank(la(lexer)))
      extraIndentation = (extraIndentation + this.advance(lexer)) & 0xff;
    let dontInterrupt = false;
    if (isLineEnd(la(lexer))) {
      extraIndentation = 1;
      dontInterrupt = true;
    }
    dontInterrupt = dontInterrupt && this.matched === this.openBlocks.length;
    if (
      extraIndentation >= 1 &&
      (dontInterrupt
        ? valid[LIST_MARKER_PLUS_DONT_INTERRUPT]
        : valid[LIST_MARKER_PLUS])
    ) {
      lexer.resultSymbol = dontInterrupt
        ? LIST_MARKER_PLUS_DONT_INTERRUPT
        : LIST_MARKER_PLUS;
      this.listItem(extraIndentation);
      return true;
    }
    return false;
  }

  private parseOrderedListMarker(lexer: Lexer, valid: Uint8Array): boolean {
    if (
      this.indentation > 3 ||
      !(
        valid[LIST_MARKER_PARENTHESIS] ||
        valid[LIST_MARKER_DOT] ||
        valid[LIST_MARKER_PARENTHESIS_DONT_INTERRUPT] ||
        valid[LIST_MARKER_DOT_DONT_INTERRUPT]
      )
    )
      return false;
    let digits = 1;
    this.advance(lexer);
    while (isAsciiDigit(la(lexer))) {
      digits++;
      this.advance(lexer);
    }
    let dontInterrupt = digits > 1;
    if (digits > 9) return false;
    let dot = false;
    let parenthesis = false;
    if (la(lexer) === DOT) {
      this.advance(lexer);
      dot = true;
    } else if (la(lexer) === RIGHT_PAREN) {
      this.advance(lexer);
      parenthesis = true;
    }
    if (!dot && !parenthesis) return false;
    let extraIndentation = 0;
    while (isBlank(la(lexer)))
      extraIndentation = (extraIndentation + this.advance(lexer)) & 0xff;
    if (isLineEnd(la(lexer))) {
      extraIndentation = 1;
      dontInterrupt = true;
    }
    dontInterrupt = dontInterrupt && this.matched === this.openBlocks.length;
    const marker = dot
      ? dontInterrupt
        ? LIST_MARKER_DOT_DONT_INTERRUPT
        : LIST_MARKER_DOT
      : dontInterrupt
        ? LIST_MARKER_PARENTHESIS_DONT_INTERRUPT
        : LIST_MARKER_PARENTHESIS;
    if (extraIndentation >= 1 && valid[marker]) {
      lexer.resultSymbol = marker;
      this.listItem(extraIndentation, digits);
      return true;
    }
    return false;
  }

  private parseMinus(lexer: Lexer, valid: Uint8Array): boolean {
    if (
      this.indentation > 3 ||
      !(
        valid[LIST_MARKER_MINUS] ||
        valid[LIST_MARKER_MINUS_DONT_INTERRUPT] ||
        valid[SETEXT_H2_UNDERLINE] ||
        valid[THEMATIC_BREAK] ||
        valid[MINUS_METADATA]
      )
    )
      return false;
    this.markEnd(lexer);
    let whitespaceAfterMinus = false;
    let minusAfterWhitespace = false;
    let minusCount = 0;
    let extraIndentation = 0;
    for (;;) {
      if (la(lexer) === MINUS) {
        if (minusCount === 1 && extraIndentation >= 1) this.markEnd(lexer);
        minusCount++;
        this.advance(lexer);
        minusAfterWhitespace = whitespaceAfterMinus;
      } else if (isBlank(la(lexer))) {
        if (minusCount === 1)
          extraIndentation = (extraIndentation + this.advance(lexer)) & 0xff;
        else this.advance(lexer);
        whitespaceAfterMinus = true;
      } else break;
    }
    const lineEnd = isLineEnd(la(lexer));
    let dontInterrupt = false;
    if (minusCount === 1 && lineEnd) {
      extraIndentation = 1;
      dontInterrupt = true;
    }
    dontInterrupt = dontInterrupt && this.matched === this.openBlocks.length;
    const thematicBreak = minusCount >= 3 && lineEnd;
    // A setext heading cannot break a lazy continuation.
    const underline =
      minusCount >= 1 &&
      !minusAfterWhitespace &&
      lineEnd &&
      this.matched === this.openBlocks.length;
    const listMarkerMinus = minusCount >= 1 && extraIndentation >= 1;
    let success = false;
    if (valid[SETEXT_H2_UNDERLINE] && underline) {
      lexer.resultSymbol = SETEXT_H2_UNDERLINE;
      this.markEnd(lexer);
      this.indentation = 0;
      success = true;
    } else if (valid[THEMATIC_BREAK] && thematicBreak) {
      lexer.resultSymbol = THEMATIC_BREAK;
      this.markEnd(lexer);
      this.indentation = 0;
      success = true;
    } else if (
      (dontInterrupt
        ? valid[LIST_MARKER_MINUS_DONT_INTERRUPT]
        : valid[LIST_MARKER_MINUS]) &&
      listMarkerMinus
    ) {
      if (minusCount === 1) this.markEnd(lexer);
      this.listItem(extraIndentation);
      lexer.resultSymbol = dontInterrupt
        ? LIST_MARKER_MINUS_DONT_INTERRUPT
        : LIST_MARKER_MINUS;
      return true;
    }
    if (
      minusCount === 3 &&
      !minusAfterWhitespace &&
      lineEnd &&
      valid[MINUS_METADATA] &&
      this.metadata(lexer, MINUS, MINUS_METADATA)
    )
      return true;
    return success;
  }

  private parseHtmlBlock(lexer: Lexer, valid: Uint8Array): boolean {
    if (
      !(
        valid[HTML_BLOCK_1_START] ||
        valid[HTML_BLOCK_1_END] ||
        valid[HTML_BLOCK_2_START] ||
        valid[HTML_BLOCK_3_START] ||
        valid[HTML_BLOCK_4_START] ||
        valid[HTML_BLOCK_5_START] ||
        valid[HTML_BLOCK_6_START] ||
        valid[HTML_BLOCK_7_START]
      )
    )
      return false;
    this.advance(lexer);
    if (la(lexer) === QUESTION && valid[HTML_BLOCK_3_START]) {
      this.advance(lexer);
      lexer.resultSymbol = HTML_BLOCK_3_START;
      this.push(ANONYMOUS);
      return true;
    }
    if (la(lexer) === BANG) {
      // Could be block 2.
      this.advance(lexer);
      if (la(lexer) === MINUS) {
        // Block 2 ends at the first `-->`, which may overlap the opening `<!--` as in `<!-->` and `<!--->`:
        // for those the token ends after `<!`, leaving the `-->` to the block.
        this.markEnd(lexer);
        const column = this.column;
        this.advance(lexer);
        if (la(lexer) !== MINUS || !valid[HTML_BLOCK_2_START])
          return false;
        this.advance(lexer);
        if (la(lexer) === RIGHT_ANGLE || la(lexer) === MINUS)
          this.column = column;
        else this.markEnd(lexer);
        lexer.resultSymbol = HTML_BLOCK_2_START;
        this.push(ANONYMOUS);
        return true;
      }
      if (
        la(lexer) >= UPPER_A &&
        la(lexer) <= UPPER_Z &&
        valid[HTML_BLOCK_4_START]
      ) {
        this.advance(lexer);
        lexer.resultSymbol = HTML_BLOCK_4_START;
        this.push(ANONYMOUS);
        return true;
      }
      if (la(lexer) === LEFT_BRACKET) {
        this.advance(lexer);
        let matched = 0;
        for (const c of [UPPER_C, UPPER_D, UPPER_A, UPPER_T, UPPER_A]) {
          if (la(lexer) !== c) break;
          this.advance(lexer);
          matched++;
        }
        if (
          matched === 5 &&
          la(lexer) === LEFT_BRACKET &&
          valid[HTML_BLOCK_5_START]
        ) {
          this.advance(lexer);
          lexer.resultSymbol = HTML_BLOCK_5_START;
          this.push(ANONYMOUS);
          return true;
        }
      }
    }
    return this.parseHtmlTag(lexer, valid);
  }

  private parseHtmlTag(lexer: Lexer, valid: Uint8Array): boolean {
    const startingSlash = la(lexer) === SLASH;
    if (startingSlash) this.advance(lexer);
    let name = "";
    let nameLength = 0;
    while (iswalpha(la(lexer))) {
      if (nameLength < 10) {
        // C's `(char)towlower(c)`: the lowercase code point's low byte.
        const lower = String.fromCodePoint(la(lexer))
          .toLowerCase()
          .codePointAt(0) as number;
        name += String.fromCharCode(lower & 0xff);
        nameLength++;
      } else nameLength = 12;
      this.advance(lexer);
    }
    if (nameLength === 0) return false;
    let tagClosed = false;
    if (nameLength < 11) {
      const nextSymbolValid =
        isBlank(la(lexer)) ||
        isLineEnd(la(lexer)) ||
        la(lexer) === RIGHT_ANGLE;
      if (nextSymbolValid && HTML_TAG_NAMES_RULE_1.includes(name)) {
        if (startingSlash) {
          if (valid[HTML_BLOCK_1_END]) {
            lexer.resultSymbol = HTML_BLOCK_1_END;
            return true;
          }
        } else if (valid[HTML_BLOCK_1_START]) {
          lexer.resultSymbol = HTML_BLOCK_1_START;
          this.push(ANONYMOUS);
          return true;
        }
      }
      if (!nextSymbolValid && la(lexer) === SLASH) {
        this.advance(lexer);
        if (la(lexer) === RIGHT_ANGLE) {
          this.advance(lexer);
          tagClosed = true;
        }
      }
      if (
        (nextSymbolValid || tagClosed) &&
        HTML_TAG_NAMES_RULE_7.includes(name) &&
        valid[HTML_BLOCK_6_START]
      ) {
        lexer.resultSymbol = HTML_BLOCK_6_START;
        this.push(ANONYMOUS);
        return true;
      }
    }
    if (!valid[HTML_BLOCK_7_START]) return false;
    if (!tagClosed) {
      // The rest of the tag name.
      while (iswalnum(la(lexer)) || la(lexer) === MINUS)
        this.advance(lexer);
      if (!startingSlash) {
        // Attributes.
        let hadWhitespace = false;
        for (;;) {
          while (isBlank(la(lexer))) {
            hadWhitespace = true;
            this.advance(lexer);
          }
          if (la(lexer) === SLASH) {
            this.advance(lexer);
            break;
          }
          if (la(lexer) === RIGHT_ANGLE) break;
          // An attribute name.
          if (!hadWhitespace) return false;
          if (
            !iswalpha(la(lexer)) &&
            la(lexer) !== UNDERSCORE &&
            la(lexer) !== COLON
          )
            return false;
          hadWhitespace = false;
          this.advance(lexer);
          while (
            iswalnum(la(lexer)) ||
            la(lexer) === UNDERSCORE ||
            la(lexer) === DOT ||
            la(lexer) === COLON ||
            la(lexer) === MINUS
          )
            this.advance(lexer);
          while (isBlank(la(lexer))) {
            hadWhitespace = true;
            this.advance(lexer);
          }
          if (la(lexer) === EQUAL) {
            this.advance(lexer);
            hadWhitespace = false;
            while (isBlank(la(lexer))) this.advance(lexer);
            if (
              la(lexer) === SINGLE_QUOTE ||
              la(lexer) === DOUBLE_QUOTE
            ) {
              // C keeps the quote as a `char`: only its low byte.
              const delimiter = la(lexer) & 0xff;
              this.advance(lexer);
              while (
                la(lexer) !== delimiter &&
                !isLineEnd(la(lexer)) &&
                !lexer.eof()
              )
                this.advance(lexer);
              if (la(lexer) !== delimiter) return false;
              this.advance(lexer);
            } else {
              // An unquoted attribute value.
              let hadOne = false;
              while (
                !isBlank(la(lexer)) &&
                la(lexer) !== DOUBLE_QUOTE &&
                la(lexer) !== SINGLE_QUOTE &&
                la(lexer) !== EQUAL &&
                la(lexer) !== LEFT_ANGLE &&
                la(lexer) !== RIGHT_ANGLE &&
                la(lexer) !== BACKTICK &&
                !isLineEnd(la(lexer)) &&
                !lexer.eof()
              ) {
                this.advance(lexer);
                hadOne = true;
              }
              if (!hadOne) return false;
            }
          }
        }
      } else while (isBlank(la(lexer))) this.advance(lexer);
      if (la(lexer) !== RIGHT_ANGLE) return false;
      this.advance(lexer);
    }
    while (isBlank(la(lexer))) this.advance(lexer);
    if (isLineEnd(la(lexer))) {
      lexer.resultSymbol = HTML_BLOCK_7_START;
      this.push(ANONYMOUS);
      return true;
    }
    return false;
  }

  private parsePipeTable(lexer: Lexer): boolean {
    // PIPE_TABLE_START is zero width.
    this.markEnd(lexer);
    // Count the cells, and whether the row starts and ends with a pipe: an empty header needs both.
    let cellCount = 0;
    let startingPipe = false;
    let endingPipe = false;
    if (la(lexer) === PIPE) {
      startingPipe = true;
      this.advance(lexer);
    }
    while (!isLineEnd(la(lexer)) && !lexer.eof()) {
      if (la(lexer) === PIPE) {
        cellCount++;
        endingPipe = true;
        this.advance(lexer);
      } else {
        if (!isBlank(la(lexer))) endingPipe = false;
        if (la(lexer) === BACKSLASH) {
          this.advance(lexer);
          if (isPunctuation(la(lexer))) this.advance(lexer);
        } else this.advance(lexer);
      }
    }
    if (cellCount === 0 && !(startingPipe && endingPipe)) return false;
    if (!endingPipe) cellCount++;

    // The next line must be a delimiter row.
    if (la(lexer) === LF) this.advance(lexer);
    else if (la(lexer) === CR) {
      this.advance(lexer);
      if (la(lexer) === LF) this.advance(lexer);
    } else return false;
    this.indentation = 0;
    this.column = 0;
    while (isBlank(la(lexer))) this.indent(this.advance(lexer));
    this.simulate = true;
    let matchedTemp = 0;
    while (matchedTemp < (this.openBlocks.length & 0xff)) {
      if (this.match(lexer, this.openBlocks[matchedTemp] as number))
        matchedTemp++;
      else return false;
    }

    // As many cells as the header, and at least one pipe.
    let delimiterCellCount = 0;
    if (la(lexer) === PIPE) this.advance(lexer);
    for (;;) {
      while (isBlank(la(lexer))) this.advance(lexer);
      if (la(lexer) === PIPE) {
        delimiterCellCount++;
        this.advance(lexer);
        continue;
      }
      if (la(lexer) === COLON) {
        this.advance(lexer);
        if (la(lexer) !== MINUS) return false;
      }
      let hadOneMinus = false;
      while (la(lexer) === MINUS) {
        hadOneMinus = true;
        this.advance(lexer);
      }
      if (hadOneMinus) delimiterCellCount++;
      if (la(lexer) === COLON) {
        if (!hadOneMinus) return false;
        this.advance(lexer);
      }
      while (isBlank(la(lexer))) this.advance(lexer);
      if (la(lexer) === PIPE) {
        if (!hadOneMinus) delimiterCellCount++;
        this.advance(lexer);
        continue;
      }
      if (!isLineEnd(la(lexer))) return false;
      break;
    }
    if (cellCount !== delimiterCellCount) return false;
    lexer.resultSymbol = PIPE_TABLE_START;
    return true;
  }

  scanBlock(lexer: Lexer, validSymbols: Uint8Array): boolean {
    let valid = validSymbols;
    // Once MAX_OPEN_BLOCKS blocks are open, block markers parse as text.
    if (this.openBlocks.length >= MAX_OPEN_BLOCKS) {
      valid = new Uint8Array(NUM_TOKEN_TYPES);
      for (let i = 0; i < NUM_TOKEN_TYPES; i++)
        valid[i] = validSymbols[i] && !opensBlock(i) ? 1 : 0;
    }
    // A grammar rule decided this branch is invalid and asks for an error to stop it.
    if (valid[TRIGGER_ERROR]) {
      lexer.resultSymbol = ERROR;
      return true;
    }
    // Close the innermost block after the next line break, as `$._close_block` asks.
    if (valid[CLOSE_BLOCK]) {
      this.state |= STATE_CLOSE_BLOCK;
      lexer.resultSymbol = CLOSE_BLOCK;
      return true;
    }
    // At the end of the input, close every block still open.
    if (lexer.eof()) {
      if (valid[TOKEN_EOF]) {
        lexer.resultSymbol = TOKEN_EOF;
        return true;
      }
      if (this.openBlocks.length > 0) {
        lexer.resultSymbol = BLOCK_CLOSE;
        if (!this.simulate) this.openBlocks.pop();
        return true;
      }
      return false;
    }

    if ((this.state & STATE_MATCHING) === 0) {
      // Not matching: the leading whitespace, then the tokens that start blocks.
      while (isBlank(la(lexer))) this.indent(this.advance(lexer));
      if (valid[INDENTED_CHUNK_START] && !valid[NO_INDENTED_CHUNK]) {
        if (this.indentation >= 4 && !isLineEnd(la(lexer))) {
          lexer.resultSymbol = INDENTED_CHUNK_START;
          this.push(INDENTED_CODE_BLOCK);
          this.indentation -= 4;
          return true;
        }
      }
      const c = la(lexer);
      switch (c) {
        case CR:
        case LF:
          if (valid[BLANK_LINE_START]) {
            // A blank line token is zero width.
            lexer.resultSymbol = BLANK_LINE_START;
            return true;
          }
          break;
        case BACKTICK:
          return this.parseFencedCodeBlock(BACKTICK, lexer, valid);
        case TILDE:
          return this.parseFencedCodeBlock(TILDE, lexer, valid);
        case STAR:
          return this.parseStar(lexer, valid);
        case UNDERSCORE:
          return this.parseThematicBreakUnderscore(lexer, valid);
        case RIGHT_ANGLE:
          return this.parseBlockQuote(lexer, valid);
        case HASH:
          return this.parseAtxHeading(lexer, valid);
        case EQUAL:
          return this.parseSetextUnderline(lexer, valid);
        case PLUS:
          return this.parsePlus(lexer, valid);
        case MINUS:
          return this.parseMinus(lexer, valid);
        case LEFT_ANGLE:
          return this.parseHtmlBlock(lexer, valid);
        default:
          if (isAsciiDigit(c)) return this.parseOrderedListMarker(lexer, valid);
      }
      if (!isLineEnd(la(lexer)) && valid[PIPE_TABLE_START])
        return this.parsePipeTable(lexer);
    } else {
      // Matching every currently open block.
      let partialSuccess = false;
      while (this.matched < (this.openBlocks.length & 0xff)) {
        if (
          this.matched === (this.openBlocks.length & 0xff) - 1 &&
          (this.state & STATE_CLOSE_BLOCK) !== 0
        ) {
          if (!partialSuccess) this.state &= ~STATE_CLOSE_BLOCK & 0xff;
          break;
        }
        if (this.match(lexer, this.openBlocks[this.matched] as number)) {
          partialSuccess = true;
          this.matched = (this.matched + 1) & 0xff;
        } else {
          if ((this.state & STATE_WAS_SOFT_LINE_BREAK) !== 0)
            this.state &= ~STATE_MATCHING & 0xff;
          break;
        }
      }
      if (partialSuccess) {
        if (this.matched === this.openBlocks.length)
          this.state &= ~STATE_MATCHING & 0xff;
        lexer.resultSymbol = BLOCK_CONTINUATION;
        return true;
      }
      if ((this.state & STATE_WAS_SOFT_LINE_BREAK) === 0) {
        lexer.resultSymbol = BLOCK_CLOSE;
        this.openBlocks.pop();
        if (this.matched === this.openBlocks.length)
          this.state &= ~STATE_MATCHING & 0xff;
        return true;
      }
    }

    // A line break: set the state up for the next line.
    if (
      (valid[LINE_ENDING] ||
        valid[SOFT_LINE_ENDING] ||
        valid[PIPE_TABLE_LINE_ENDING]) &&
      isLineEnd(la(lexer))
    ) {
      this.newline(lexer);
      this.indentation = 0;
      this.column = 0;
      if (
        (this.state & STATE_CLOSE_BLOCK) === 0 &&
        (valid[SOFT_LINE_ENDING] || valid[PIPE_TABLE_LINE_ENDING])
      ) {
        lexer.markEnd();
        while (isBlank(la(lexer))) this.indent(this.advance(lexer));
        this.simulate = true;
        const matchedTemp = this.matched;
        this.matched = 0;
        let oneWillBeMatched = false;
        while (this.matched < (this.openBlocks.length & 0xff)) {
          if (this.match(lexer, this.openBlocks[this.matched] as number)) {
            this.matched = (this.matched + 1) & 0xff;
            oneWillBeMatched = true;
          } else break;
        }
        const allWillBeMatched = this.matched === this.openBlocks.length;
        if (
          !lexer.eof() &&
          !this.scanBlock(lexer, PARAGRAPH_INTERRUPT_SYMBOLS)
        ) {
          // The line break ended no paragraph and opened no block, so it was a soft one.
          this.matched = 0;
          this.indentation = 0;
          this.column = 0;
          // With a block open, match it on the next line, so the soft line break's marker gets emitted.
          if (oneWillBeMatched) this.state |= STATE_MATCHING;
          else this.state &= ~STATE_MATCHING & 0xff;
          if (valid[PIPE_TABLE_LINE_ENDING]) {
            if (allWillBeMatched) {
              lexer.resultSymbol = PIPE_TABLE_LINE_ENDING;
              return true;
            }
          } else {
            lexer.resultSymbol = SOFT_LINE_ENDING;
            this.state |= STATE_WAS_SOFT_LINE_BREAK;
            return true;
          }
        } else this.matched = matchedTemp;
        this.indentation = 0;
        this.column = 0;
      }
      if (valid[LINE_ENDING]) {
        this.matched = 0;
        if (this.openBlocks.length > 0) this.state |= STATE_MATCHING;
        else this.state &= ~STATE_MATCHING & 0xff;
        this.state &= ~STATE_WAS_SOFT_LINE_BREAK & 0xff;
        lexer.resultSymbol = LINE_ENDING;
        return true;
      }
    }
    return false;
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    this.simulate = false;
    return this.scanBlock(lexer, valid);
  }
}

export function createScanner(): ExternalScanner {
  return new Scanner();
}
