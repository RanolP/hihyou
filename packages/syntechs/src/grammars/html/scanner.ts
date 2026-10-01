// Port of tree-sitter-html 0.23.2 src/scanner.c and src/tag.h: the stack of open elements, which decides a start
// tag's kind (script and style hold raw text), whether an end tag closes the element on top (else it is an
// erroneous one), and where an element ends implicitly (a void element, `<li>` after `<li>`, `<p>` before a block).
// The state serializes byte for byte as scanner.c's does, name truncation and the 1024-byte cap included.

import type { ExternalScanner, Lexer } from "../../core/lexer.js";
import { iswalnum, iswspace } from "../../core/wctype.js";

const START_TAG_NAME = 0;
const SCRIPT_START_TAG_NAME = 1;
const STYLE_START_TAG_NAME = 2;
const END_TAG_NAME = 3;
const ERRONEOUS_END_TAG_NAME = 4;
const SELF_CLOSING_TAG_DELIMITER = 5;
const IMPLICIT_END_TAG = 6;
const RAW_TEXT = 7;
const COMMENT = 8;

const SERIALIZATION_BUFFER_SIZE = 1024;

// tag.h's TagType, in its order: the void elements, END_OF_VOID_TAGS, the others, CUSTOM, END_.
const VOID_NAMES = [
  "AREA", "BASE", "BASEFONT", "BGSOUND", "BR", "COL", "COMMAND", "EMBED", "FRAME", "HR", "IMAGE", "IMG", "INPUT",
  "ISINDEX", "KEYGEN", "LINK", "MENUITEM", "META", "NEXTID", "PARAM", "SOURCE", "TRACK", "WBR",
];
const END_OF_VOID_TAGS = VOID_NAMES.length;
const OTHER_NAMES = [
  "A", "ABBR", "ADDRESS", "ARTICLE", "ASIDE", "AUDIO", "B", "BDI", "BDO", "BLOCKQUOTE", "BODY", "BUTTON", "CANVAS",
  "CAPTION", "CITE", "CODE", "COLGROUP", "DATA", "DATALIST", "DD", "DEL", "DETAILS", "DFN", "DIALOG", "DIV", "DL",
  "DT", "EM", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEAD",
  "HEADER", "HGROUP", "HTML", "I", "IFRAME", "INS", "KBD", "LABEL", "LEGEND", "LI", "MAIN", "MAP", "MARK", "MATH",
  "MENU", "METER", "NAV", "NOSCRIPT", "OBJECT", "OL", "OPTGROUP", "OPTION", "OUTPUT", "P", "PICTURE", "PRE",
  "PROGRESS", "Q", "RB", "RP", "RT", "RTC", "RUBY", "S", "SAMP", "SCRIPT", "SECTION", "SELECT", "SLOT", "SMALL",
  "SPAN", "STRONG", "STYLE", "SUB", "SUMMARY", "SUP", "SVG", "TABLE", "TBODY", "TD", "TEMPLATE", "TEXTAREA",
  "TFOOT", "TH", "THEAD", "TIME", "TITLE", "TR", "U", "UL", "VAR", "VIDEO", "CUSTOM",
];
const TYPE_BY_NAME = new Map<string, number>([
  ...VOID_NAMES.map((n, i) => [n, i] as const),
  ...OTHER_NAMES.map((n, i) => [n, END_OF_VOID_TAGS + 1 + i] as const),
]);
const type = (name: string) => TYPE_BY_NAME.get(name) as number;
const CUSTOM = type("CUSTOM");
const END_ = CUSTOM + 1;
const [SCRIPT, STYLE, LI, DT, DD, P, COLGROUP, COL, RB, RT, RP, OPTGROUP, TR, TD, TH] = [
  "SCRIPT", "STYLE", "LI", "DT", "DD", "P", "COLGROUP", "COL", "RB", "RT", "RP", "OPTGROUP", "TR", "TD", "TH",
].map(type) as number[] as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
const NOT_ALLOWED_IN_PARAGRAPHS = new Set(
  [
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DETAILS", "DIV", "DL", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER",
    "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
  ].map(type),
);

/** A tag: its type, and for a custom one its name as scan_tag_name stores it, one `char` per character. */
interface Tag {
  type: number;
  name: number[];
}

const tagEq = (a: Tag, b: Tag): boolean =>
  a.type === b.type && (a.type !== CUSTOM || (a.name.length === b.name.length && a.name.every((c, i) => c === b.name[i])));

function tagCanContain(self: Tag, other: Tag): boolean {
  const child = other.type;
  switch (self.type) {
    case LI:
      return child !== LI;
    case DT:
    case DD:
      return child !== DT && child !== DD;
    case P:
      return !NOT_ALLOWED_IN_PARAGRAPHS.has(child);
    case COLGROUP:
      return child === COL;
    case RB:
    case RT:
    case RP:
      return child !== RB && child !== RT && child !== RP;
    case OPTGROUP:
      return child !== OPTGROUP;
    case TR:
      return child !== TR;
    case TD:
    case TH:
      return child !== TD && child !== TH && child !== TR;
    default:
      return true;
  }
}

/** towupper: a character's single-character upper case, or itself. */
function towupper(c: number): number {
  const u = String.fromCodePoint(c).toUpperCase();
  const cp = u.codePointAt(0) as number;
  return u.length === (cp > 0xffff ? 2 : 1) ? cp : c;
}

/** scan_tag_name: the upper-cased name, each character truncated to the `char` scanner.c pushes it as. */
function scanTagName(lexer: Lexer): number[] {
  const name: number[] = [];
  while (iswalnum(lexer.lookahead) || lexer.lookahead === 45 || lexer.lookahead === 58) {
    name.push(towupper(lexer.lookahead) & 0xff);
    lexer.advance(false);
  }
  return name;
}

function tagForName(name: number[]): Tag {
  const t = TYPE_BY_NAME.get(String.fromCharCode(...name)) ?? CUSTOM;
  return { type: t, name: t === CUSTOM ? name : [] };
}

/** The lookahead, read afresh where TypeScript would keep it narrowed across an `advance`. */
const peek = (lexer: Lexer): number => lexer.lookahead;

function scanComment(lexer: Lexer): boolean {
  if (lexer.lookahead !== 45) return false;
  lexer.advance(false);
  if (peek(lexer) !== 45) return false;
  lexer.advance(false);
  let dashes = 0;
  while (peek(lexer) !== 0) {
    const c = peek(lexer);
    if (c === 45) dashes++;
    else if (c === 62 && dashes >= 2) {
      lexer.resultSymbol = COMMENT;
      lexer.advance(false);
      lexer.markEnd();
      return true;
    } else dashes = 0;
    lexer.advance(false);
  }
  return false;
}

class HtmlScanner implements ExternalScanner {
  tags: Tag[] = [];

  scanRawText(lexer: Lexer): boolean {
    if (this.tags.length === 0) return false;
    lexer.markEnd();
    const end = (this.tags.at(-1) as Tag).type === SCRIPT ? "</SCRIPT" : "</STYLE";
    let index = 0;
    while (lexer.lookahead !== 0) {
      if (towupper(lexer.lookahead) === end.charCodeAt(index)) {
        index++;
        if (index === end.length) break;
        lexer.advance(false);
      } else {
        index = 0;
        lexer.advance(false);
        lexer.markEnd();
      }
    }
    lexer.resultSymbol = RAW_TEXT;
    return true;
  }

  scanImplicitEndTag(lexer: Lexer): boolean {
    const parent = this.tags.at(-1);
    let closing = false;
    if (lexer.lookahead === 47) {
      closing = true;
      lexer.advance(false);
    } else if (parent && parent.type < END_OF_VOID_TAGS) {
      this.tags.pop();
      lexer.resultSymbol = IMPLICIT_END_TAG;
      return true;
    }
    const name = scanTagName(lexer);
    if (name.length === 0 && !lexer.eof()) return false;
    const next = tagForName(name);
    if (closing) {
      // The tag correctly closes the topmost element on the stack.
      if (parent && tagEq(parent, next)) return false;
      // Otherwise dig deeper and queue implicit end tags, for malformed HTML.
      for (let i = this.tags.length; i > 0; i--) {
        if ((this.tags[i - 1] as Tag).type === next.type) {
          this.tags.pop();
          lexer.resultSymbol = IMPLICIT_END_TAG;
          return true;
        }
      }
    } else if (
      parent &&
      // The end of file closes every open element (scanner.c's patch).
      (!tagCanContain(parent, next) || lexer.eof())
    ) {
      this.tags.pop();
      lexer.resultSymbol = IMPLICIT_END_TAG;
      return true;
    }
    return false;
  }

  scanStartTagName(lexer: Lexer): boolean {
    const name = scanTagName(lexer);
    if (name.length === 0) return false;
    const tag = tagForName(name);
    this.tags.push(tag);
    lexer.resultSymbol =
      tag.type === SCRIPT ? SCRIPT_START_TAG_NAME : tag.type === STYLE ? STYLE_START_TAG_NAME : START_TAG_NAME;
    return true;
  }

  scanEndTagName(lexer: Lexer): boolean {
    const name = scanTagName(lexer);
    if (name.length === 0) return false;
    const tag = tagForName(name);
    const top = this.tags.at(-1);
    if (top && tagEq(top, tag)) {
      this.tags.pop();
      lexer.resultSymbol = END_TAG_NAME;
    } else lexer.resultSymbol = ERRONEOUS_END_TAG_NAME;
    return true;
  }

  scanSelfClosingTagDelimiter(lexer: Lexer): boolean {
    lexer.advance(false);
    if (lexer.lookahead !== 62) return false;
    lexer.advance(false);
    if (this.tags.length > 0) {
      this.tags.pop();
      lexer.resultSymbol = SELF_CLOSING_TAG_DELIMITER;
    }
    return true;
  }

  scan(lexer: Lexer, valid: Uint8Array): boolean {
    if (valid[RAW_TEXT] && !valid[START_TAG_NAME] && !valid[END_TAG_NAME]) return this.scanRawText(lexer);
    while (iswspace(lexer.lookahead)) lexer.advance(true);
    switch (lexer.lookahead) {
      case 60:
        lexer.markEnd();
        lexer.advance(false);
        if (peek(lexer) === 33) {
          lexer.advance(false);
          return scanComment(lexer);
        }
        if (valid[IMPLICIT_END_TAG]) return this.scanImplicitEndTag(lexer);
        break;
      case 0:
        if (valid[IMPLICIT_END_TAG]) return this.scanImplicitEndTag(lexer);
        break;
      case 47:
        if (valid[SELF_CLOSING_TAG_DELIMITER]) return this.scanSelfClosingTagDelimiter(lexer);
        break;
      default:
        if ((valid[START_TAG_NAME] || valid[END_TAG_NAME]) && !valid[RAW_TEXT])
          return valid[START_TAG_NAME] ? this.scanStartTagName(lexer) : this.scanEndTagName(lexer);
    }
    return false;
  }

  serialize(buffer: Uint8Array): number {
    const count = Math.min(this.tags.length, 0xffff);
    let serialized = 0;
    let size = 4;
    buffer[2] = count & 0xff;
    buffer[3] = count >> 8;
    for (; serialized < count; serialized++) {
      const tag = this.tags[serialized] as Tag;
      if (tag.type === CUSTOM) {
        const length = Math.min(tag.name.length, 0xff);
        if (size + 2 + length >= SERIALIZATION_BUFFER_SIZE) break;
        buffer[size++] = tag.type;
        buffer[size++] = length;
        for (let i = 0; i < length; i++) buffer[size++] = tag.name[i] as number;
      } else {
        if (size + 1 >= SERIALIZATION_BUFFER_SIZE) break;
        buffer[size++] = tag.type;
      }
    }
    buffer[0] = serialized & 0xff;
    buffer[1] = serialized >> 8;
    return size;
  }

  deserialize(buffer: Uint8Array, length: number): void {
    this.tags.length = 0;
    if (length === 0) return;
    const serialized = (buffer[0] as number) | ((buffer[1] as number) << 8);
    const count = (buffer[2] as number) | ((buffer[3] as number) << 8);
    let size = 4;
    if (count === 0) return;
    let i = 0;
    for (; i < serialized; i++) {
      const t = buffer[size++] as number;
      const name: number[] = [];
      if (t === CUSTOM) {
        const n = buffer[size++] as number;
        for (let k = 0; k < n; k++) name.push(buffer[size++] as number);
      }
      this.tags.push({ type: t, name });
    }
    // The tags the buffer had no room for, as empty ones.
    for (; i < count; i++) this.tags.push({ type: END_, name: [] });
  }
}

export function createScanner(): ExternalScanner {
  return new HtmlScanner();
}
