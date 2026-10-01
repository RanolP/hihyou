// Prettier 3.9.9's HTML printer (language-html: printer-html.js, print-preprocess.js, print/children.js,
// print/element.js, print/tag.js, utilities/index.js) with `htmlWhitespaceSensitivity: "css"`, over
// tree-sitter-html, writing onto the stream. It covers plain elements, text and comments; what it does not cover
// (script and style content, the attributes prettier formats as code, a doctype, a parse error) throws
// `Unsupported`, so a caller prints the source as it would without an HTML printer.

import { parseTree } from "../../core/index.js";
import { brokenNodes } from "../../fmt/format.js";
import {
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  IF_FLAT,
  INDENT,
  open,
  openAlign,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sLiteral,
  sText,
} from "../../fmt/stream.js";
import { language } from "./index.js";

export class Unsupported extends Error {}

interface Node {
  kind: "root" | "element" | "text" | "comment" | "docType";
  parent: Node | undefined;
  prev: Node | undefined;
  next: Node | undefined;
  children: Node[];
  /** An element's lowercased tag name; its `rawName` as written. */
  name: string;
  rawName: string;
  attrs: Attr[];
  /** A text's value, or a comment's source. */
  value: string;
  start: number;
  end: number;
  /** An element's start tag end and end tag start (-1: none, as for a void or implicitly closed element). */
  startTagEnd: number;
  endTagStart: number;
  isVoid: boolean;
  isSelfClosing: boolean;
  cssDisplay: string;
  hasLeadingSpaces: boolean;
  hasTrailingSpaces: boolean;
  hasDanglingSpaces: boolean;
  isLeadingSpaceSensitive: boolean;
  isTrailingSpaceSensitive: boolean;
  isDanglingSpaceSensitive: boolean;
  isWhitespaceSensitive: boolean;
  isIndentationSensitive: boolean;
}

interface Attr {
  rawName: string;
  /** The value between its quotes, null when it has none. */
  value: string | null;
  /** A value prettier formats as code or a list: always double-quoted, a `"` in it escaped. */
  formatted?: boolean;
}

// Prettier's html-styles tables (constants.evaluate.js), for the tags a template holds.
const BLOCK = new Set(
  (
    "html body address blockquote center dialog div figure figcaption footer form header hr legend listing main p " +
    "plaintext pre search xmp article aside h1 h2 h3 h4 h5 h6 hgroup nav section dir dd dl dt menu ol ul fieldset " +
    "details summary option optgroup source track param script"
  ).split(" "),
);
const DISPLAY: Readonly<Record<string, string>> = {
  li: "list-item",
  table: "table",
  caption: "table-caption",
  colgroup: "table-column-group",
  col: "table-column",
  thead: "table-header-group",
  tbody: "table-row-group",
  tfoot: "table-footer-group",
  tr: "table-row",
  td: "table-cell",
  th: "table-cell",
  input: "inline-block",
  button: "inline-block",
  marquee: "inline-block",
  select: "inline-block",
  meter: "inline-block",
  progress: "inline-block",
  object: "inline-block",
  video: "inline-block",
  audio: "inline-block",
  area: "none",
  base: "none",
  basefont: "none",
  datalist: "none",
  head: "none",
  link: "none",
  meta: "none",
  noembed: "none",
  noframes: "none",
  rp: "none",
  style: "none",
  title: "none",
  template: "inline",
  slot: "contents",
  ruby: "ruby",
  rt: "ruby-text",
};
const WHITE_SPACE: Readonly<Record<string, string>> = {
  listing: "pre",
  plaintext: "pre",
  pre: "pre",
  xmp: "pre",
  nobr: "nowrap",
  table: "initial",
  textarea: "pre-wrap",
};
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const IGNORE_FIRST_LF = new Set(["pre", "textarea", "listing"]);
/** Attributes prettier formats as code or as a list, which this printer does not. */
const FORMATTED_ATTRIBUTE = /^(?:class|style|srcset|sizes|allow|on.*)$/i;

// --- The AST: prettier's, from tree-sitter-html's tree ---

function node(kind: Node["kind"], start: number, end: number): Node {
  return {
    kind,
    parent: undefined,
    prev: undefined,
    next: undefined,
    children: [],
    name: "",
    rawName: "",
    attrs: [],
    value: "",
    start,
    end,
    startTagEnd: -1,
    endTagStart: -1,
    isVoid: false,
    isSelfClosing: false,
    cssDisplay: "inline",
    hasLeadingSpaces: false,
    hasTrailingSpaces: false,
    hasDanglingSpaces: false,
    isLeadingSpaceSensitive: false,
    isTrailingSpaceSensitive: false,
    isDanglingSpaceSensitive: false,
    isWhitespaceSensitive: false,
    isIndentationSensitive: false,
  };
}

type TsTree = ReturnType<typeof parseTree>;

/** `text` as prettier's parser reads it, preprocessed; throws `Unsupported`. */
export function parseHtml(text: string): Node {
  const tree = parseTree(language, text);
  if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) throw new Unsupported("parse error");
  const root = node("root", 0, text.length);
  fill(tree, text, root, tree.root, 0, text.length);
  preprocess(root);
  return root;
}

function kids(tree: TsTree, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < tree.count(n); i++) out.push(tree.child(n, i));
  return out;
}

/** Fills `into`'s children from the tree node `ts`'s, the text between them the source in [from, to). */
function fill(tree: TsTree, text: string, into: Node, ts: number, from: number, to: number): void {
  let at = from;
  const add = (n: Node) => {
    if (n.start > at) addText(at, n.start);
    push(n);
    at = n.end;
  };
  const addText = (s: number, e: number) => {
    const t = node("text", s, e);
    t.isSelfClosing = true;
    t.value = text.slice(s, e);
    push(t);
  };
  const push = (n: Node) => {
    n.parent = into;
    into.children.push(n);
  };
  for (const c of kids(tree, ts)) {
    const k = tree.kindName(c);
    if (tree.start(c) < from || tree.end(c) > to) continue;
    if (k === "text" || k === "entity") continue;
    if (k === "element") {
      const e = element(tree, text, c);
      add(e);
      // tree-sitter-html runs a void element written without `/>` to its parent's end; what follows it is a sibling.
      if (e.end < tree.end(c)) {
        fill(tree, text, into, c, e.end, tree.end(c));
        at = tree.end(c);
      }
    }
    else if (k === "comment") {
      const n = node("comment", tree.start(c), tree.end(c));
      n.isSelfClosing = true;
      n.value = tree.text(c);
      const inner = n.value.slice(4, -3).trim();
      // A prettier-ignore or a `display:` comment changes how its next sibling prints.
      if (inner.startsWith("prettier-ignore") || inner.startsWith("display:")) throw new Unsupported(inner);
      add(n);
    } else if (k === "doctype") add(docType(tree.text(c), tree.start(c), tree.end(c)));
    else throw new Unsupported(k);
  }
  if (to > at) addText(at, to);
}

/**
 * printer-html.js's docType: `<!doctype` lowercase only before a bare `html` (the file is `.html`), else the
 * marker as written; the value's gaps one space each and a leading `html` lowercased. `rawName` holds the marker
 * past its `<`, which a text before it borrows as an opening tag's.
 */
function docType(source: string, start: number, end: number): Node {
  const n = node("docType", start, end);
  n.isSelfClosing = true;
  const value = source.slice("<!doctype".length, -1).trim();
  n.rawName = value === "html" ? "!doctype" : source.slice(1, "<!doctype".length);
  n.value = value.replace(/^html\b/i, "html").replaceAll(/\s+/g, " ");
  return n;
}

function element(tree: TsTree, text: string, ts: number): Node {
  const n = node("element", tree.start(ts), tree.end(ts));
  const parts = kids(tree, ts);
  const startTag = parts[0];
  if (startTag === undefined) throw new Unsupported("element");
  const selfClosing = tree.kindName(startTag) === "self_closing_tag";
  for (const c of kids(tree, startTag)) {
    const k = tree.kindName(c);
    if (k === "tag_name") n.rawName = tree.text(c);
    else if (k === "attribute") n.attrs.push(attribute(tree, c));
  }
  n.name = n.rawName.toLowerCase();
  if (n.name === "svg" || n.name === "math") throw new Unsupported(n.name);
  n.startTagEnd = tree.end(startTag);
  n.isVoid = VOID.has(n.name);
  n.isSelfClosing = selfClosing || n.isVoid;
  const last = parts[parts.length - 1];
  const endTag = last !== undefined && tree.kindName(last) === "end_tag" ? last : undefined;
  if (endTag !== undefined) n.endTagStart = tree.start(endTag);
  if (n.isVoid) n.end = n.startTagEnd;
  else if (!selfClosing) fill(tree, text, n, ts, n.startTagEnd, endTag === undefined ? n.end : n.endTagStart);
  return n;
}

function attribute(tree: TsTree, ts: number): Attr {
  let rawName = "";
  let value: string | null = null;
  for (const c of kids(tree, ts)) {
    const k = tree.kindName(c);
    if (k === "attribute_name") rawName = tree.text(c);
    else if (k === "attribute_value") value = tree.text(c);
    else if (k === "quoted_attribute_value") value = tree.text(c).slice(1, -1);
  }
  if (rawName === "class" && value !== null && value.trim() !== "" && !value.includes("{{"))
    return { rawName, value: classNames(value), formatted: true };
  if (rawName === "class") return { rawName, value };
  // An uppercase `CLASS` prints lowercased and formatted only on an element prettier knows the attributes of.
  if (FORMATTED_ATTRIBUTE.test(rawName)) throw new Unsupported(rawName);
  return { rawName, value };
}

/** print/class-names.js: the names one space apart, split on any JS whitespace (a no-break space too). */
function classNames(value: string): string {
  return unescapeQuotes(value).trim().split(/\s+/).join(" ");
}

function unescapeQuotes(value: string): string {
  return value.replaceAll("&apos;", "'").replaceAll("&quot;", '"');
}

// --- print-preprocess.js ---

function walk(n: Node, fn: (n: Node) => void): void {
  fn(n);
  for (const c of n.children) walk(c, fn);
}

function link(n: Node): void {
  n.children.forEach((c, i) => {
    c.prev = n.children[i - 1];
    c.next = n.children[i + 1];
  });
}

const HTML_SPACE = /[\t\n\f\r ]/;
const isHtmlSpaceOnly = (s: string) => /^[\t\n\f\r ]*$/.test(s);
const hasChildren = (n: Node) => n.kind === "root" || (n.kind === "element" && !n.isSelfClosing);

function preprocess(root: Node): void {
  walk(root, (n) => {
    if (n.kind === "element" && IGNORE_FIRST_LF.has(n.name)) {
      const first = n.children[0];
      if (first?.kind === "text" && first.value.startsWith("\n")) {
        if (first.value.length === 1) n.children.shift();
        else first.value = first.value.slice(1);
      }
    }
    link(n);
  });
  walk(root, extractWhitespaces);
  walk(root, (n) => {
    n.cssDisplay = cssDisplay(n);
  });
  walk(root, addIsSpaceSensitive);
  walk(root, mergeSimpleElementIntoText);
}

function extractWhitespaces(n: Node): void {
  if (!hasChildren(n)) return;
  const children = n.children;
  if (children.length === 0 || (children.length === 1 && children[0]?.kind === "text" && isHtmlSpaceOnly(children[0].value))) {
    n.hasDanglingSpaces = children.length > 0;
    n.children = [];
    return;
  }
  const whitespaceSensitive = isIndentationSensitive(n);
  if (!whitespaceSensitive) {
    const kept: Node[] = [];
    for (const child of children) {
      if (child.kind !== "text") {
        kept.push(child);
        continue;
      }
      const lead = /^[\t\n\f\r ]*/.exec(child.value)?.[0] ?? "";
      const body = child.value.slice(lead.length);
      const trail = /[\t\n\f\r ]*$/.exec(body)?.[0] ?? "";
      const value = body.slice(0, body.length - trail.length);
      if (value === "") {
        if (lead !== "" || trail !== "") {
          if (child.prev) child.prev.hasTrailingSpaces = true;
          if (child.next) child.next.hasLeadingSpaces = true;
        }
        continue;
      }
      child.value = value;
      child.start += lead.length;
      child.end -= trail.length;
      if (lead !== "") {
        if (child.prev) child.prev.hasTrailingSpaces = true;
        child.hasLeadingSpaces = true;
      }
      if (trail !== "") {
        child.hasTrailingSpaces = true;
        if (child.next) child.next.hasLeadingSpaces = true;
      }
      kept.push(child);
    }
    n.children = kept;
    link(n);
  }
  n.isWhitespaceSensitive = whitespaceSensitive;
  n.isIndentationSensitive = whitespaceSensitive;
}

function cssDisplay(n: Node): string {
  if (n.kind !== "element") return "inline";
  if (BLOCK.has(n.name)) return "block";
  return (Object.hasOwn(DISPLAY, n.name) && DISPLAY[n.name]) || "inline";
}
// `Object.hasOwn`: a tag named `constructor` or `toString` would otherwise read Object.prototype's.
const whiteSpace = (n: Node) =>
  (n.kind === "element" && Object.hasOwn(WHITE_SPACE, n.name) && WHITE_SPACE[n.name]) || "normal";
const isPreLike = (n: Node) => whiteSpace(n).startsWith("pre");
const isIndentationSensitive = isPreLike;
const isBlockLike = (d: string) => d === "block" || d === "list-item" || d.startsWith("table");
const isInnerSensitive = (d: string) => !isBlockLike(d) && d !== "inline-block";

function isLeadingSpaceSensitive(n: Node): boolean {
  const result = ((): boolean => {
    if (n.kind === "text" && n.prev?.kind === "text") return true;
    const parent = n.parent;
    if (parent === undefined || parent.cssDisplay === "none") return false;
    if (isPreLike(parent)) return true;
    if (!n.prev && (parent.kind === "root" || isPreLike(n) || !isInnerSensitive(parent.cssDisplay))) return false;
    if (n.prev && isBlockLike(n.prev.cssDisplay)) return false;
    return true;
  })();
  if (result && !n.prev && n.parent !== undefined && IGNORE_FIRST_LF.has(n.parent.name)) return false;
  return result;
}

function isTrailingSpaceSensitive(n: Node): boolean {
  if (n.kind === "text" && n.next?.kind === "text") return true;
  const parent = n.parent;
  if (parent === undefined || parent.cssDisplay === "none") return false;
  if (isPreLike(parent)) return true;
  if (!n.next && (parent.kind === "root" || isPreLike(n) || !isInnerSensitive(parent.cssDisplay))) return false;
  if (n.next && isBlockLike(n.next.cssDisplay)) return false;
  return true;
}

function addIsSpaceSensitive(n: Node): void {
  if (!hasChildren(n)) return;
  const children = n.children;
  if (children.length === 0) {
    n.isDanglingSpaceSensitive = isInnerSensitive(n.cssDisplay);
    return;
  }
  for (const c of children) {
    c.isLeadingSpaceSensitive = isLeadingSpaceSensitive(c);
    c.isTrailingSpaceSensitive = isTrailingSpaceSensitive(c);
  }
  children.forEach((c, i) => {
    if (i > 0) c.isLeadingSpaceSensitive = (c.prev as Node).isTrailingSpaceSensitive && c.isLeadingSpaceSensitive;
    if (i < children.length - 1)
      c.isTrailingSpaceSensitive = (c.next as Node).isLeadingSpaceSensitive && c.isTrailingSpaceSensitive;
  });
}

function mergeSimpleElementIntoText(n: Node): void {
  const isSimple = (c: Node) =>
    c.kind === "element" &&
    c.attrs.length === 0 &&
    c.children.length === 1 &&
    c.children[0]?.kind === "text" &&
    !HTML_SPACE.test(c.children[0].value) &&
    !c.children[0].hasLeadingSpaces &&
    !c.children[0].hasTrailingSpaces &&
    c.isLeadingSpaceSensitive &&
    !c.hasLeadingSpaces &&
    c.isTrailingSpaceSensitive &&
    !c.hasTrailingSpaces &&
    c.prev?.kind === "text" &&
    c.next?.kind === "text";
  for (let i = 0; i < n.children.length; i++) {
    const c = n.children[i] as Node;
    if (!isSimple(c)) continue;
    const prev = c.prev as Node;
    const next = c.next as Node;
    prev.value += `<${c.rawName}>${(c.children[0] as Node).value}</${c.rawName}>${next.value}`;
    prev.end = next.end;
    prev.isTrailingSpaceSensitive = next.isTrailingSpaceSensitive;
    prev.hasTrailingSpaces = next.hasTrailingSpaces;
    n.children.splice(i, 2);
    link(n);
    i--;
  }
}

// --- utilities/index.js ---

const isTextLike = (n: Node) => n.kind === "text" || n.kind === "comment";
const firstChild = (n: Node) => n.children[0];
const lastChild = (n: Node) => n.children[n.children.length - 1];
const lastDescendant = (n: Node): Node => {
  const last = lastChild(n);
  return last ? lastDescendant(last) : n;
};
const hasNonTextChild = (n: Node) => n.children.some((c) => c.kind !== "text");

/** Positions to line numbers of the text the tree was parsed from. */
class Lines {
  private readonly starts: number[] = [0];
  constructor(text: string) {
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) this.starts.push(i + 1);
  }
  at(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

// --- print/tag.js ---

function needsToBorrowPrevClosingTagEndMarker(n: Node): boolean {
  return n.prev !== undefined && !isTextLike(n.prev) && n.isLeadingSpaceSensitive && !n.hasLeadingSpaces;
}
function needsToBorrowLastChildClosingTagEndMarker(n: Node): boolean {
  const last = lastChild(n);
  return (
    last !== undefined &&
    last.isTrailingSpaceSensitive &&
    !last.hasTrailingSpaces &&
    !isTextLike(lastDescendant(last)) &&
    !isPreLike(n)
  );
}
function needsToBorrowParentClosingTagStartMarker(n: Node): boolean {
  return !n.next && !n.hasTrailingSpaces && n.isTrailingSpaceSensitive && isTextLike(lastDescendant(n));
}
function needsToBorrowNextOpeningTagStartMarker(n: Node): boolean {
  return (
    n.next !== undefined && !isTextLike(n.next) && isTextLike(n) && n.isTrailingSpaceSensitive && !n.hasTrailingSpaces
  );
}
function needsToBorrowParentOpeningTagEndMarker(n: Node): boolean {
  return !n.prev && n.isLeadingSpaceSensitive && !n.hasLeadingSpaces;
}

const closingTagStartMarker = (n: Node) => `</${n.rawName}`;
const closingTagEndMarker = (n: Node) => (n.kind === "element" && n.isSelfClosing ? "/>" : ">");
const openingTagStartMarker = (n: Node) => `<${n.rawName}`;

function closingTagSuffix(n: Node): string {
  if (needsToBorrowParentClosingTagStartMarker(n)) return closingTagStartMarker(n.parent as Node);
  if (needsToBorrowNextOpeningTagStartMarker(n)) return openingTagStartMarker(n.next as Node);
  return "";
}
function openingTagPrefix(n: Node): string {
  if (needsToBorrowParentOpeningTagEndMarker(n)) return ">";
  if (needsToBorrowPrevClosingTagEndMarker(n)) return closingTagEndMarker(n.prev as Node);
  return "";
}

// --- The printer ---

/** A doc line: prettier's `line`, `softline`, `hardline`, or a literal string ("" for none). */
type Line = "line" | "softline" | "hardline" | "" | " ";

export interface HtmlPrinter {
  /** Writes `s`, which may hold the caller's placeholders. */
  text(s: string): void;
  readonly tabWidth: number;
}

/** Prints `root` (from `parseHtml`) as prettier's `group(printChildren(root))`, without its final hardline. */
export function printHtml(root: Node, text: string, out: HtmlPrinter): void {
  new Printer(new Lines(text), out).root(root);
}

class Printer {
  constructor(
    private readonly lines: Lines,
    private readonly out: HtmlPrinter,
  ) {}

  private startLine = (n: Node) => this.lines.at(n.start);
  private endLine = (n: Node) => this.lines.at(n.end);

  root(root: Node): void {
    open(GROUP);
    this.children(root);
    close();
  }

  private line(l: Line): void {
    if (l === "line") sLine(0);
    else if (l === "softline") sLine(SOFT);
    else if (l === "hardline") sHardline();
    else if (l !== "") sText(l);
  }

  private text(s: string): void {
    if (s !== "") this.out.text(s);
  }

  /** Prettier's replaceEndOfLine: the lines of `s` joined by literal lines. */
  private literal(s: string): void {
    const parts = s.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) {
        sLiteral(0, "\n");
        sBreakParent();
      }
      this.text(p);
    });
  }

  // utilities/index.js's line-break predicates
  private hasLeadingLineBreak(n: Node): boolean {
    const parent = n.parent as Node;
    return (
      n.hasLeadingSpaces &&
      (n.prev
        ? this.endLine(n.prev) < this.startLine(n)
        : parent.kind === "root" || this.lines.at(parent.startTagEnd) < this.startLine(n))
    );
  }
  private hasTrailingLineBreak(n: Node): boolean {
    const parent = n.parent as Node;
    return (
      n.hasTrailingSpaces &&
      (n.next
        ? this.startLine(n.next) > this.endLine(n)
        : parent.kind === "root" || (parent.endTagStart !== -1 && this.lines.at(parent.endTagStart) > this.endLine(n)))
    );
  }
  private hasSurroundingLineBreak = (n: Node) => this.hasLeadingLineBreak(n) && this.hasTrailingLineBreak(n);
  private preferHardlineAsSurrounding = (n: Node) => n.kind === "comment" || (n.kind === "element" && n.name === "select");
  private preferHardlineAsTrailing = (n: Node) =>
    this.preferHardlineAsSurrounding(n) || (n.kind === "element" && n.name === "br") || this.hasSurroundingLineBreak(n);
  private preferHardlineAsLeading = (n: Node) =>
    this.preferHardlineAsSurrounding(n) ||
    (n.prev !== undefined && this.preferHardlineAsTrailing(n.prev)) ||
    this.hasSurroundingLineBreak(n);
  private forceNextEmptyLine = (n: Node) => n.next !== undefined && this.endLine(n) + 1 < this.startLine(n.next);

  private forceBreakChildren = (n: Node) =>
    n.kind === "element" &&
    n.children.length > 0 &&
    (["html", "head", "ul", "ol", "select"].includes(n.name) ||
      (n.cssDisplay.startsWith("table") && n.cssDisplay !== "table-cell"));

  private forceBreakContent(n: Node): boolean {
    const first = firstChild(n);
    return (
      this.forceBreakChildren(n) ||
      (n.kind === "element" &&
        n.children.length > 0 &&
        (["body", "script", "style"].includes(n.name) || n.children.some(hasNonTextChild))) ||
      (first !== undefined &&
        first === lastChild(n) &&
        first.kind !== "text" &&
        this.hasLeadingLineBreak(first) &&
        (!first.isTrailingSpaceSensitive || this.hasTrailingLineBreak(first)))
    );
  }

  // print/children.js
  private betweenLine(prev: Node, next: Node): Line {
    if (isTextLike(prev) && isTextLike(next)) {
      if (prev.isTrailingSpaceSensitive) {
        if (prev.hasTrailingSpaces) return this.preferHardlineAsLeading(next) ? "hardline" : "line";
        return "";
      }
      return this.preferHardlineAsLeading(next) ? "hardline" : "softline";
    }
    if (
      (needsToBorrowNextOpeningTagStartMarker(prev) &&
        (firstChild(next) !== undefined ||
          next.isSelfClosing ||
          (next.kind === "element" && next.attrs.length > 0))) ||
      (prev.kind === "element" && prev.isSelfClosing && needsToBorrowPrevClosingTagEndMarker(next))
    )
      return "";
    if (next.kind === "comment" && next.isLeadingSpaceSensitive && !next.hasLeadingSpaces) return "softline";
    const prevLast = lastChild(prev);
    const prevLastLast = prevLast && lastChild(prevLast);
    if (
      !next.isLeadingSpaceSensitive ||
      this.preferHardlineAsLeading(next) ||
      (needsToBorrowPrevClosingTagEndMarker(next) &&
        prevLast !== undefined &&
        needsToBorrowParentClosingTagStartMarker(prevLast) &&
        prevLastLast !== undefined &&
        needsToBorrowParentClosingTagStartMarker(prevLastLast))
    )
      return "hardline";
    return next.hasLeadingSpaces ? "line" : "softline";
  }

  private children(n: Node): void {
    if (this.forceBreakChildren(n)) {
      sBreakParent();
      for (const c of n.children) {
        const between = c.prev ? this.betweenLine(c.prev, c) : "";
        if (between !== "") {
          this.line(between);
          if (this.forceNextEmptyLine(c.prev as Node)) sHardline();
        }
        this.node(c);
      }
      return;
    }
    const groups: number[] = [];
    for (const c of n.children) {
      if (isTextLike(c)) {
        if (c.prev && isTextLike(c.prev)) {
          const between = this.betweenLine(c.prev, c);
          if (between !== "") {
            if (this.forceNextEmptyLine(c.prev)) {
              sHardline();
              sHardline();
            } else this.line(between);
          }
        }
        groups.push(-1);
        this.node(c);
        continue;
      }
      const prevBetween = c.prev ? this.betweenLine(c.prev, c) : "";
      const nextBetween = c.next ? this.betweenLine(c, c.next) : "";
      let leading: (() => void) | undefined;
      if (prevBetween !== "") {
        const prev = c.prev as Node;
        if (this.forceNextEmptyLine(prev)) {
          sHardline();
          sHardline();
        } else if (prevBetween === "hardline") sHardline();
        else if (isTextLike(prev)) leading = () => this.line(prevBetween);
        else {
          const ref = groups[groups.length - 1] as number;
          leading = () => {
            open(IF_FLAT, ref);
            sLine(SOFT);
            close();
          };
        }
      }
      let trailing: Line = "";
      let after: (() => void) | undefined;
      if (nextBetween !== "") {
        const next = c.next as Node;
        if (this.forceNextEmptyLine(c)) {
          if (isTextLike(next))
            after = () => {
              sHardline();
              sHardline();
            };
        } else if (nextBetween === "hardline") {
          if (isTextLike(next)) after = () => sHardline();
        } else trailing = nextBetween;
      }
      open(GROUP);
      leading?.();
      groups.push(open(GROUP));
      this.node(c);
      this.line(trailing);
      close();
      close();
      after?.();
    }
  }

  private node(n: Node): void {
    if (n.kind === "element") this.element(n);
    else if (n.kind === "text") this.textNode(n);
    else if (n.kind === "docType") {
      this.text(openingTagPrefix(n));
      if (!(n.prev && needsToBorrowNextOpeningTagStartMarker(n.prev))) this.text(openingTagStartMarker(n));
      this.text(` ${n.value}`);
      if (!(n.next && needsToBorrowPrevClosingTagEndMarker(n.next))) this.text(">");
      this.text(closingTagSuffix(n));
    } else {
      this.text(openingTagPrefix(n));
      this.literal(n.value);
      this.text(closingTagSuffix(n));
    }
  }

  // printer-html.js's text: fill(getTextValueParts), the tag prefix and suffix joined to its ends
  private textNode(n: Node): void {
    const parent = n.parent as Node;
    const literal = parent.isWhitespaceSensitive && parent.isIndentationSensitive;
    const words = literal ? n.value.split("\n") : n.value.split(/[\t\n\f\r ]+/);
    const prefix = openingTagPrefix(n);
    const suffix = closingTagSuffix(n);
    open(FILL);
    words.forEach((w, i) => {
      if (i > 0) {
        if (literal) {
          sLiteral(0, "\n");
          sBreakParent();
        } else sLine(0);
      }
      open(FILL_ITEM);
      if (i === 0) this.text(prefix);
      this.text(w);
      if (i === words.length - 1) this.text(suffix);
      close();
    });
    close();
  }

  // print/tag.js's opening and closing tags
  private openingTag(n: Node): void {
    if (!(n.prev && needsToBorrowNextOpeningTagStartMarker(n.prev))) {
      this.text(openingTagPrefix(n));
      this.text(openingTagStartMarker(n));
    }
    this.attributes(n);
    const first = firstChild(n);
    if (!n.isSelfClosing && !(first && needsToBorrowParentOpeningTagEndMarker(first))) this.text(">");
  }

  private attributes(n: Node): void {
    if (n.attrs.length === 0) {
      if (n.isSelfClosing) this.text(" ");
      return;
    }
    open(INDENT);
    n.attrs.forEach((a) => {
      sLine(0);
      this.attribute(a);
    });
    close();
    const first = firstChild(n);
    if (
      (first && needsToBorrowParentOpeningTagEndMarker(first)) ||
      (n.isSelfClosing && needsToBorrowLastChildClosingTagEndMarker(n.parent as Node))
    ) {
      if (n.isSelfClosing) this.text(" ");
    } else sLine(n.isSelfClosing ? 0 : SOFT);
  }

  private attribute(a: Attr): void {
    if (a.value === null) {
      this.text(a.rawName);
      return;
    }
    const value = a.formatted ? a.value : unescapeQuotes(a.value);
    const doubles = value.split('"').length;
    const singles = value.split("'").length;
    const quote = !a.formatted && doubles > singles ? "'" : '"';
    this.text(`${a.rawName}=${quote}`);
    this.literal(quote === '"' ? value.replaceAll('"', "&quot;") : value.replaceAll("'", "&apos;"));
    this.text(quote);
  }

  private closingTag(n: Node): void {
    if (!n.isSelfClosing) {
      const last = lastChild(n);
      if (!(last && needsToBorrowParentClosingTagStartMarker(last))) {
        if (needsToBorrowLastChildClosingTagEndMarker(n)) this.text(closingTagEndMarker(last as Node));
        this.text(closingTagStartMarker(n));
      }
    }
    const borrowed = n.next
      ? needsToBorrowPrevClosingTagEndMarker(n.next)
      : needsToBorrowLastChildClosingTagEndMarker(n.parent as Node);
    if (!borrowed) {
      this.text(closingTagEndMarker(n));
      this.text(closingTagSuffix(n));
    }
  }

  // print/element.js
  private element(n: Node): void {
    open(GROUP);
    open(GROUP);
    this.openingTag(n);
    close();
    const first = firstChild(n);
    const last = lastChild(n);
    if (first === undefined || last === undefined) {
      if (n.hasDanglingSpaces && n.isDanglingSpaceSensitive) sLine(0);
    } else {
      if (this.forceBreakContent(n)) sBreakParent();
      open(INDENT);
      if (first.hasLeadingSpaces && first.isLeadingSpaceSensitive) sLine(0);
      else if (first.kind === "text" && n.isWhitespaceSensitive && n.isIndentationSensitive) {
        openAlign(Number.NEGATIVE_INFINITY);
        sLine(SOFT);
        close();
      } else sLine(SOFT);
      this.children(n);
      close();
      this.line(this.lineAfterChildren(n, last));
    }
    this.closingTag(n);
    close();
  }

  private lineAfterChildren(n: Node, last: Node): Line {
    const borrowed = n.next
      ? needsToBorrowPrevClosingTagEndMarker(n.next)
      : needsToBorrowLastChildClosingTagEndMarker(n.parent as Node);
    if (borrowed) return last.hasTrailingSpaces && last.isTrailingSpaceSensitive ? " " : "";
    if (isPreLike(n) && needsToBorrowParentClosingTagStartMarker(last)) return "";
    if (last.hasTrailingSpaces && last.isTrailingSpaceSensitive) return "line";
    let depth = -1;
    for (let p = n.parent; p !== undefined; p = p.parent) depth++;
    if (
      (last.kind === "comment" || (last.kind === "text" && n.isWhitespaceSensitive && n.isIndentationSensitive)) &&
      new RegExp(`\\n[\\t ]{${this.out.tabWidth * depth}}$`).test(last.value)
    )
      return "";
    return "softline";
  }
}
