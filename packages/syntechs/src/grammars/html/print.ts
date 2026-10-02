// Prettier 3.9.9's HTML printer (language-html: printer-html.js, print-preprocess.js, print/children.js,
// print/element.js, print/tag.js, utilities/index.js) with `htmlWhitespaceSensitivity: "css"`, over
// tree-sitter-html, writing onto the stream. It covers plain elements, text, comments, and a script's or style's
// content through the caller's `embed`; what it does not cover (a template script, the attributes prettier formats
// as code, a parse error) throws `Unsupported`, so a caller prints the source as it would without an HTML printer.

import { parseTree } from "../../core/index.js";
import { brokenNodes } from "../../fmt/format.js";
import {
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  open,
  openAlign,
  SOFT,
  sBreakParent,
  sHardline,
  sKeptText,
  sLine,
  sLiteral,
  sText,
} from "../../fmt/stream.js";
import { parseFrontMatter } from "../css/front-matter.js";
import { language } from "./index.js";

export class Unsupported extends Error {}

interface Node {
  kind:
    | "root"
    | "element"
    | "text"
    | "comment"
    | "docType"
    | "ieConditionalComment"
    | "ieConditionalStartComment"
    | "ieConditionalEndComment";
  /** A conditional comment's `[if ...]` condition, or an element's merged from the ones around its start tag. */
  condition?: string;
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
  /** Closed by an htm `<//>` (a JS template's, which print/embed.ts writes as an end tag ending in `\f>`). */
  htmClose?: boolean;
  /** The root's front matter, as its printed lines. */
  frontMatter?: string[];
}

interface Attr {
  rawName: string;
  /** The value between its quotes, null when it has none. */
  value: string | null;
  /** A value prettier formats as code or a list: always double-quoted, a `"` in it escaped. */
  formatted?: boolean;
  /** A `formatted` value as written. */
  written?: string;
  /** A `style` value, which prints as css declarations where the caller's `declarations` reads it as them. */
  style?: boolean;
  /** An iframe's `allow` value, which prints as its `;`-separated directives. */
  allow?: boolean;
  /** An img's or source's `srcset` candidates, each its url and descriptor ("" for none). */
  srcset?: { url: string; descriptor: string }[];
  /** An `on*` event handler's value, which prints as JS where the caller's `eventHandler` parses it. */
  eventHandler?: boolean;
  /** Written with no quotes. */
  unquoted?: boolean;
  /** A JS template's lit-html `${…}` value written unquoted, which prints unquoted. */
  bare?: boolean;
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
/**
 * print/attribute/event-handler.js's names, whose value prettier formats as JS; matched as written, so `onClick` is a
 * plain attribute.
 */
export const EVENT_HANDLERS = new Set(
  (
    "onabort onafterprint onauxclick onbeforeinput onbeforematch onbeforeprint onbeforetoggle onbeforeunload " +
    "onblur oncancel oncanplay oncanplaythrough onchange onclick onclose oncommand oncontextlost oncontextmenu " +
    "oncontextrestored oncopy oncuechange oncut ondblclick ondrag ondragend ondragenter ondragleave ondragover " +
    "ondragstart ondrop ondurationchange onemptied onended onerror onfocus onformdata onhashchange oninput " +
    "oninvalid onkeydown onkeypress onkeyup onlanguagechange onload onloadeddata onloadedmetadata onloadstart " +
    "onmessage onmessageerror onmousedown onmouseenter onmouseleave onmousemove onmouseout onmouseover onmouseup " +
    "onoffline ononline onpagehide onpagereveal onpageshow onpageswap onpaste onpause onplay onplaying " +
    "onpopstate onprogress onratechange onrejectionhandled onreset onresize onscroll onscrollend " +
    "onsecuritypolicyviolation onseeked onseeking onselect onslotchange onstalled onstorage onsubmit onsuspend " +
    "ontimeupdate ontoggle onunhandledrejection onunload onvolumechange onwaiting onwheel"
  ).split(" "),
);

// Prettier's html-tag-names and html-element-attributes tables: its parser lowercases a tag name in the first, and
// an attribute name an element's own list or `*` holds, but only on an element the second table lists.
const KNOWN_TAGS = new Set(
  (
    "a abbr acronym address applet area article aside audio b base basefont bdi bdo bgsound big blink blockquote " +
    "body br button canvas caption center cite code col colgroup command content data datalist dd del details dfn " +
    "dialog dir div dl dt em embed fencedframe fieldset figcaption figure font footer form frame frameset " +
    "geolocation h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe image img input ins isindex kbd keygen " +
    "label legend li link listing main map mark marquee math menu menuitem meta meter multicol nav nextid nobr " +
    "noembed noframes noscript object ol optgroup option output p param picture plaintext pre progress q rb rbc " +
    "rp rt rtc ruby s samp script search section select selectedcontent shadow slot small source spacer span " +
    "strike strong style sub summary sup svg table tbody td template textarea tfoot th thead time title tr track " +
    "tt u ul var video wbr xmp"
  ).split(" "),
);
const ELEMENT_ATTRIBUTES: Readonly<Record<string, string>> = {
  "*":
    "accesskey autocapitalize autocorrect autofocus class contenteditable dir draggable enterkeyhint exportparts " +
    "hidden id inert inputmode is itemid itemprop itemref itemscope itemtype lang nonce part popover slot " +
    "spellcheck style tabindex title translate writingsuggestions",
  a: "charset coords download href hreflang name ping referrerpolicy rel rev shape target type",
  applet: "align alt archive code codebase height hspace name object vspace width",
  area: "alt coords download href hreflang nohref ping referrerpolicy rel shape target type",
  audio: "autoplay controls crossorigin loop muted preload src",
  base: "href target",
  basefont: "color face size",
  blockquote: "cite",
  body: "alink background bgcolor link text vlink",
  br: "clear",
  button:
    "command commandfor disabled form formaction formenctype formmethod formnovalidate formtarget name " +
    "popovertarget popovertargetaction type value",
  canvas: "height width",
  caption: "align",
  col: "align char charoff span valign width",
  colgroup: "align char charoff span valign width",
  data: "value",
  del: "cite datetime",
  details: "name open",
  dialog: "closedby open",
  dir: "compact",
  div: "align",
  dl: "compact",
  embed: "height src type width",
  fieldset: "disabled form name",
  font: "color face size",
  form: "accept accept-charset action autocomplete enctype method name novalidate target",
  frame: "frameborder longdesc marginheight marginwidth name noresize scrolling src",
  frameset: "cols rows",
  h1: "align",
  h2: "align",
  h3: "align",
  h4: "align",
  h5: "align",
  h6: "align",
  head: "profile",
  hr: "align noshade size width",
  html: "manifest version",
  iframe:
    "align allow allowfullscreen allowpaymentrequest allowusermedia frameborder height loading longdesc " +
    "marginheight marginwidth name referrerpolicy sandbox scrolling src srcdoc width",
  img:
    "align alt border crossorigin decoding fetchpriority height hspace ismap loading longdesc name referrerpolicy " +
    "sizes src srcset usemap vspace width",
  input:
    "accept align alpha alt autocomplete checked colorspace dirname disabled form formaction formenctype " +
    "formmethod formnovalidate formtarget height ismap list max maxlength min minlength multiple name pattern " +
    "placeholder popovertarget popovertargetaction readonly required size src step type usemap value width",
  ins: "cite datetime",
  isindex: "prompt",
  label: "for form",
  legend: "align",
  li: "type value",
  link:
    "as blocking charset color crossorigin disabled fetchpriority href hreflang imagesizes imagesrcset integrity " +
    "media referrerpolicy rel rev sizes target type",
  map: "name",
  menu: "compact",
  meta: "charset content http-equiv media name scheme",
  meter: "high low max min optimum value",
  object:
    "align archive border classid codebase codetype data declare form height hspace name standby type " +
    "typemustmatch usemap vspace width",
  ol: "compact reversed start type",
  optgroup: "disabled label",
  option: "disabled label selected value",
  output: "for form name",
  p: "align",
  param: "name type value valuetype",
  pre: "width",
  progress: "max value",
  q: "cite",
  script: "async blocking charset crossorigin defer fetchpriority integrity language nomodule referrerpolicy src type",
  select: "autocomplete disabled form multiple name required size",
  slot: "name",
  source: "height media sizes src srcset type width",
  style: "blocking media type",
  table: "align bgcolor border cellpadding cellspacing frame rules summary width",
  tbody: "align char charoff valign",
  td: "abbr align axis bgcolor char charoff colspan headers height nowrap rowspan scope valign width",
  template:
    "shadowrootclonable shadowrootcustomelementregistry shadowrootdelegatesfocus shadowrootmode " +
    "shadowrootserializable",
  textarea: "autocomplete cols dirname disabled form maxlength minlength name placeholder readonly required rows wrap",
  tfoot: "align char charoff valign",
  th: "abbr align axis bgcolor char charoff colspan headers height nowrap rowspan scope valign width",
  thead: "align char charoff valign",
  time: "datetime",
  tr: "align bgcolor char charoff valign",
  track: "default kind label src srclang",
  ul: "compact type",
  video: "autoplay controls crossorigin height loop muted playsinline poster preload src width",
};

/** parser-html.js's normalized attribute name: lowercased when `element`'s list or the global one holds it. */
function attributeName(element: string, raw: string): string {
  const own = Object.hasOwn(ELEMENT_ATTRIBUTES, element) ? ELEMENT_ATTRIBUTES[element] : undefined;
  if (own === undefined || element === "*") return raw;
  const lower = raw.toLowerCase();
  const listed = (list: string | undefined) => list !== undefined && ` ${list} `.includes(` ${lower} `);
  return listed(ELEMENT_ATTRIBUTES["*"]) || listed(own) ? lower : raw;
}

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

/**
 * `text` as prettier's parser reads it, preprocessed; throws `Unsupported`, and for a non-blank script or style
 * unless the printer will get an `embed`. `atFileStart`: `text` starts the file, where a front matter may open it.
 */
export function parseHtml(
  text: string,
  embeds = false,
  atFileStart = false,
  sensitivity: WhitespaceSensitivity = "css",
  embeddedOff = false,
  inJs = false,
): Node {
  const tree = parseTree(language, text);
  if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) throw new Unsupported("parse error");
  const root = node("root", 0, text.length);
  const front = atFileStart ? frontMatter(text) : undefined;
  if (front !== undefined) {
    // The front matter is no HTML: a tag tree-sitter read inside it would be printed a second time.
    if (kids(tree, tree.root).some((c) => tree.start(c) < front.end && !["text", "entity"].includes(tree.kindName(c))))
      throw new Unsupported("front matter");
    root.frontMatter = front.lines;
  }
  fill(tree, text, root, tree.root, front?.end ?? 0, text.length);
  walk(root, (n) => {
    // embeddedLanguageFormatting "off" prints every attribute value as written, as no print/attribute/*.js runs.
    if (embeddedOff) n.attrs = n.attrs.map((a) => ({ rawName: a.rawName, value: a.written ?? a.value }));
    else if (embeddedLanguage(n) !== undefined && !embeds) throw new Unsupported(n.name);
    // A JS template's HTML (prettier's options.parentParser): embed/attributes.js prints a lit-html `${…}` written
    // unquoted as written, and print/attribute/{class-names,style,event-handler}.js leave the value as written.
    if (inJs && !embeddedOff)
      n.attrs = n.attrs.map((a) =>
        a.unquoted && a.value !== null && /^PRETTIER_HTML_PLACEHOLDER_\d+_\d+_IN_JS$/.test(a.value)
          ? { rawName: a.rawName, value: a.value, bare: true }
          : a.formatted || a.style || a.eventHandler
            ? { rawName: a.rawName, value: a.written ?? a.value }
            : a,
      );
  });
  preprocess(root, sensitivity);
  return root;
}

/**
 * utils/front-matter/parse.js's front matter at the file's start, as oxfmt prints it: a non-yaml one as written, a
 * yaml one through a yaml formatter. With none here, a yaml body prints only when it is `key: value` lines whose
 * formatting is just the gap after the `:`; any other throws `Unsupported`.
 */
function frontMatter(text: string): { end: number; lines: string[] } | undefined {
  const fm = parseFrontMatter(text);
  if (fm === undefined) return undefined;
  const end = fm.raw.length;
  if (fm.language !== "yaml") return { end, lines: fm.raw.split("\n") };
  const body: string[] = [];
  for (const line of fm.value.trim() === "" ? [] : fm.value.split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]+(.*?)[ \t]*$/.exec(line);
    const v = kv?.[2] ?? "";
    const plain = /^[^\s#'"[\]{}&*!|>%@`,?:-][^#]*$/.test(v) && !/\s\s|: |:$/.test(v);
    if (kv === null || !(plain || /^"(?:[^"\\]|\\.)*"$/.test(v))) throw new Unsupported("yaml front matter");
    body.push(`${kv[1]}: ${v}`);
  }
  return { end, lines: [fm.startDelimiter + (fm.explicitLanguage ?? ""), ...body, fm.endDelimiter] };
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
    if (k === "element" || k === "script_element" || k === "style_element") {
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
      // A `prettier-ignore` comment keeps its next sibling as written (the printer's `ignored`); a
      // `prettier-ignore-attribute` keeps the next element's attributes, which this printer does not do.
      if (inner.startsWith("prettier-ignore") && inner !== "prettier-ignore") throw new Unsupported(inner);
      add(conditionalComment(text, n));
    } else if (k === "doctype") add(docType(tree.text(c), tree.start(c), tree.end(c)));
    else if (k === "processing_instruction") {
      // angular-html-parser reads `<?` as a bogus comment only where a tag could start; inside a text run
      // (`a <?x?>`, or after the whitespace that opens one) it is more of the text.
      if (tree.start(c) > at) continue;
      const n = node("comment", tree.start(c), tree.end(c));
      n.isSelfClosing = true;
      n.value = tree.text(c);
      add(n);
    } else throw new Unsupported(k);
  }
  if (to > at) addText(at, to);
}

/**
 * parser-html.js's parseIeConditionalComment over a comment `c`: `<!--[if x]>...<![endif]-->` holds its content as
 * HTML children, `<!--[if x]><!-->` and `<!--<![endif]-->` open and close a downlevel-revealed one. A content that
 * does not parse, or whose last element is left open, prints as written, which `c` as a comment does too.
 */
function conditionalComment(text: string, c: Node): Node {
  const inner = c.value.slice(4, -3);
  const condition = (s: string) => s.trim().replaceAll(/\s+/g, " ");
  const whole = /^(\[if([^\]]*)\]>)(.*?)<!\s*\[endif\]$/s.exec(inner);
  if (whole !== null) {
    const from = c.start + 4 + (whole[1] as string).length;
    const to = from + (whole[3] as string).length;
    // Padded so the content's offsets are the file's.
    const tree = parseTree(language, " ".repeat(from) + text.slice(from, to));
    if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) return c;
    const n = node("ieConditionalComment", c.start, c.end);
    n.condition = condition(whole[2] as string);
    n.startTagEnd = from;
    n.endTagStart = to;
    fill(tree, text, n, tree.root, from, to);
    const last = n.children[n.children.length - 1];
    if (last?.kind === "element" && !last.isSelfClosing && last.endTagStart === -1) return c;
    return n;
  }
  const start = /^\[if([^\]]*)\]><!$/.exec(inner);
  const end = /^<!\s*\[endif\]$/.test(inner);
  if (start === null && !end) return c;
  const n = node(end ? "ieConditionalEndComment" : "ieConditionalStartComment", c.start, c.end);
  n.isSelfClosing = true;
  if (start !== null) n.condition = condition(start[1] as string);
  return n;
}

/**
 * printer-html.js's docType:`<!doctype` lowercase only before a bare `html` (the file is `.html`), else the
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
  for (const c of kids(tree, startTag)) if (tree.kindName(c) === "tag_name") n.rawName = tree.text(c);
  n.name = n.rawName.toLowerCase();
  if (KNOWN_TAGS.has(n.name)) n.rawName = n.name;
  for (const c of kids(tree, startTag)) if (tree.kindName(c) === "attribute") n.attrs.push(attribute(tree, c, n.name));
  n.startTagEnd = tree.end(startTag);
  n.isVoid = VOID.has(n.name);
  n.isSelfClosing = selfClosing || n.isVoid;
  const last = parts[parts.length - 1];
  const endTag = last !== undefined && tree.kindName(last) === "end_tag" ? last : undefined;
  if (endTag !== undefined) n.endTagStart = tree.start(endTag);
  if (endTag !== undefined && tree.text(endTag).endsWith("\f>")) n.htmClose = true;
  const raw = parts.find((p) => tree.kindName(p) === "raw_text");
  if (raw !== undefined) n.value = tree.text(raw);
  else if (n.isVoid) n.end = n.startTagEnd;
  else if (!selfClosing) fill(tree, text, n, ts, n.startTagEnd, endTag === undefined ? n.end : n.endTagStart);
  return n;
}

function attribute(tree: TsTree, ts: number, element: string): Attr {
  const a = attributeOf(tree, ts, element);
  if (kids(tree, ts).some((c) => tree.kindName(c) === "attribute_value")) a.unquoted = true;
  return a;
}

function attributeOf(tree: TsTree, ts: number, element: string): Attr {
  let rawName = "";
  let value: string | null = null;
  for (const c of kids(tree, ts)) {
    const k = tree.kindName(c);
    if (k === "attribute_name") rawName = attributeName(element, tree.text(c));
    else if (k === "attribute_value") value = tree.text(c);
    else if (k === "quoted_attribute_value") value = tree.text(c).slice(1, -1);
  }
  if (rawName === "class" && value !== null && value.trim() !== "" && !value.includes("{{"))
    return { rawName, value: classNames(value), formatted: true, written: value };
  if (rawName === "class") return { rawName, value };
  if (rawName === "style") return value !== null && !value.includes("{{") ? { rawName, value, style: true } : { rawName, value };
  // print/attribute/*.js formats these only on their elements, and none holding a `{{`.
  if (value === null || value.includes("{{")) return { rawName, value };
  if (rawName === "allow" && element === "iframe") return { rawName, value, allow: true };
  if (rawName === "srcset" && (element === "img" || element === "source")) {
    const srcset = srcsetCandidates(unescapeQuotes(value));
    return srcset === undefined ? { rawName, value } : { rawName, value, srcset };
  }
  if (EVENT_HANDLERS.has(rawName)) return { rawName, value, eventHandler: true };
  return { rawName, value };
}

const SRCSET_UNITS = { width: "w", height: "h", density: "x" } as const;

/**
 * print/attribute/srcset.js's candidates, each its url and its descriptor's number and unit: undefined where
 * prettier's parser (parse-srcset) throws, or the candidates mix descriptor kinds, and the value prints as written.
 */
function srcsetCandidates(value: string): { url: string; descriptor: string }[] | undefined {
  const isSpace = (c: string) => c === "\t" || c === "\n" || c === "\f" || c === "\r" || c === " ";
  let at = 0;
  const take = (re: RegExp) => {
    const m = re.exec(value.slice(at));
    if (m) at += m[0].length;
    return m?.[0];
  };
  const candidates: { url: string; width: number | undefined; height: number | undefined; density: number | undefined }[] =
    [];
  let url = "";
  let descriptors: string[] = [];
  const commit = (): boolean => {
    let width: number | undefined;
    let height: number | undefined;
    let density: number | undefined;
    for (const d of descriptors) {
      const unit = d[d.length - 1];
      const num = d.slice(0, -1);
      if (/^\d+$/.test(num) && unit === "w") {
        if (width !== undefined || density !== undefined || Number.parseInt(num, 10) === 0) return false;
        width = Number.parseInt(num, 10);
      } else if (/^-?(?:[0-9]+|[0-9]*\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(num) && unit === "x") {
        if (width !== undefined || density !== undefined || height !== undefined || Number.parseFloat(num) < 0)
          return false;
        density = Number.parseFloat(num);
      } else if (/^\d+$/.test(num) && unit === "h") {
        if (height !== undefined || density !== undefined || Number.parseInt(num, 10) === 0) return false;
        height = Number.parseInt(num, 10);
      } else return false;
    }
    // parse-srcset keeps a descriptor only when it is truthy: a `0x` reads as none.
    candidates.push({ url, width, height, density: density || undefined });
    return true;
  };
  for (;;) {
    take(/^[, \t\n\r\f]+/);
    if (at >= value.length) break;
    url = take(/^[^ \t\n\r\f]+/) ?? "";
    descriptors = [];
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      if (!commit()) return undefined;
      continue;
    }
    take(/^[ \t\n\r\f]+/);
    let current = "";
    let state: "in descriptor" | "in parens" | "after descriptor" = "in descriptor";
    for (;;) {
      const c = value.charAt(at);
      if (state === "in descriptor") {
        if (isSpace(c)) {
          if (current) {
            descriptors.push(current);
            current = "";
            state = "after descriptor";
          }
        } else if (c === ",") {
          at++;
          if (current) descriptors.push(current);
          break;
        } else if (c === "(") {
          current += c;
          state = "in parens";
        } else if (c === "") {
          if (current) descriptors.push(current);
          break;
        } else current += c;
      } else if (state === "in parens") {
        if (c === ")") {
          current += c;
          state = "in descriptor";
        } else if (c === "") {
          descriptors.push(current);
          break;
        } else current += c;
      } else if (!isSpace(c)) {
        if (c === "") break;
        state = "in descriptor";
        at--;
      }
      at++;
    }
    if (!commit()) return undefined;
  }
  if (candidates.length === 0) return undefined;
  const kinds = (["width", "height", "density"] as const).filter((k) => candidates.some((c) => c[k] !== undefined));
  if (kinds.length > 1) return undefined;
  const kind = kinds[0];
  return candidates.map((c) => {
    const n = kind === undefined ? undefined : c[kind];
    return { url: c.url, descriptor: n === undefined || kind === undefined ? "" : `${n}${SRCSET_UNITS[kind]}` };
  });
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
const hasChildren = (n: Node) =>
  n.kind === "root" || n.kind === "ieConditionalComment" || (n.kind === "element" && !n.isSelfClosing);

function preprocess(root: Node, sensitivity: WhitespaceSensitivity): void {
  walk(root, (n) => {
    if (n.kind === "element" && IGNORE_FIRST_LF.has(n.name)) {
      const first = n.children[0];
      if (first?.kind === "text" && first.value.startsWith("\n")) {
        if (first.value.length === 1) n.children.shift();
        else first.value = first.value.slice(1);
      }
    }
    mergeIeConditionalStartEndCommentIntoElementOpeningTag(n);
    link(n);
  });
  walk(root, extractWhitespaces);
  walk(root, (n) => {
    n.cssDisplay = cssDisplay(n, sensitivity);
  });
  walk(root, addIsSpaceSensitive);
  walk(root, mergeSimpleElementIntoText);
}

/**
 * `<!--[if c]><!--><tag><!--<![endif]-->`, the two comments touching the start tag, reads as one element whose
 * opening tag carries the condition.
 */
function mergeIeConditionalStartEndCommentIntoElementOpeningTag(parent: Node): void {
  const children = parent.children;
  for (let i = 1; i < children.length; i++) {
    const n = children[i] as Node;
    const start = children[i - 1] as Node;
    const end = n.children[0];
    if (
      n.kind !== "element" ||
      start.kind !== "ieConditionalStartComment" ||
      start.condition === undefined ||
      start.end !== n.start ||
      end?.kind !== "ieConditionalEndComment" ||
      end.start !== n.startTagEnd
    )
      continue;
    n.condition = start.condition;
    n.start = start.start;
    n.startTagEnd = end.end;
    n.children.shift();
    children.splice(i - 1, 1);
    i--;
  }
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

/** Prettier's `htmlWhitespaceSensitivity`. */
export type WhitespaceSensitivity = "css" | "strict" | "ignore";

/**
 * utilities/index.js's getNodeCssStyleDisplay: a `<!-- display: x -->` comment right before sets `x`; else strict
 * reads every node as inline, ignore as block, and css by the tag's default display.
 */
function cssDisplay(n: Node, sensitivity: WhitespaceSensitivity): string {
  const magic = n.prev?.kind === "comment" ? /^\s*display:\s*([a-z]+)\s*$/.exec(n.prev.value.slice(4, -3)) : null;
  if (magic) return magic[1] as string;
  // An svg element lays out as a block (the svg itself inline-block) whatever the sensitivity, short of one in a
  // foreignObject, which lays out as HTML.
  for (let a: Node | undefined = n; a?.kind === "element"; a = a.parent) {
    if (a.name === "foreignobject") break;
    if (a.name === "svg") return n.name === "svg" ? "inline-block" : "block";
  }
  if (sensitivity === "strict") return "inline";
  if (sensitivity === "ignore") return "block";
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

const closingTagStartMarker = (n: Node) =>
  n.kind === "ieConditionalComment" ? "<!" : n.htmClose ? "<//" : `</${n.rawName}`;
function closingTagEndMarker(n: Node): string {
  if (n.kind === "ieConditionalComment" || n.kind === "ieConditionalEndComment") return "[endif]-->";
  if (n.kind === "ieConditionalStartComment") return "]><!-->";
  return n.kind === "element" && n.isSelfClosing ? "/>" : ">";
}
function openingTagStartMarker(n: Node): string {
  if (n.kind === "ieConditionalComment" || n.kind === "ieConditionalStartComment") return `<!--[if ${n.condition}`;
  if (n.kind === "ieConditionalEndComment") return "<!--<!";
  if (n.condition !== undefined) return `<!--[if ${n.condition}]><!--><${n.rawName}`;
  return `<${n.rawName}`;
}
function openingTagEndMarker(n: Node): string {
  if (n.kind === "ieConditionalComment") return "]>";
  if (n.condition !== undefined) return "><!--<![endif]-->";
  return ">";
}

function closingTagSuffix(n: Node): string {
  if (needsToBorrowParentClosingTagStartMarker(n)) return closingTagStartMarker(n.parent as Node);
  if (needsToBorrowNextOpeningTagStartMarker(n)) return openingTagStartMarker(n.next as Node);
  return "";
}
function openingTagPrefix(n: Node): string {
  if (needsToBorrowParentOpeningTagEndMarker(n)) return openingTagEndMarker(n.parent as Node);
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
  /** Prettier's options of the same names; off when left out. */
  readonly bracketSameLine?: boolean;
  readonly singleAttributePerLine?: boolean;
  /** Prints a script's or style's content `text` as `language`'s formatter does, throwing where it cannot. */
  readonly embed?: (language: EmbeddedLanguage, text: string) => void;
  /** embeddedLanguageFormatting "off": a script's or style's content prints as written. */
  readonly embeddedOff?: boolean;
  /**
   * A `style` value's css declarations, each its source with no `;` and whether a blank line precedes it: undefined
   * when it does not parse as them.
   */
  readonly declarations?: (value: string) => { text: string; blank: boolean }[] | undefined;
  /** Prints one css declaration from `declarations` as the css formatter does, its `;` only broken if `last`. */
  readonly declaration?: (text: string, last: boolean) => void;
  /** Prints an `on*` value `code` as the JS formatter does an inline event handler; undefined when it does not parse. */
  readonly eventHandler?: (code: string) => (() => void) | undefined;
}

export type EmbeddedLanguage = "babel" | "typescript" | "tsx" | "json" | "css" | "html";

const attr = (n: Node, name: string) => n.attrs.find((a) => a.rawName.toLowerCase() === name);

/**
 * utilities/index.js's inferScriptParser and inferStyleParser, for a non-blank script or style: undefined for any
 * other element, "raw" for a content oxfmt keeps as written (a `src` script's, an unknown type's or lang's). A
 * content oxfmt formats in a language no formatter here reads (scss, less, a handlebars template, markdown) throws
 * `Unsupported`.
 */
function embeddedLanguage(n: Node): EmbeddedLanguage | "raw" | undefined {
  if ((n.name !== "script" && n.name !== "style") || n.value.trim() === "") return undefined;
  const lang = attr(n, "lang")?.value?.toLowerCase();
  if (n.name === "style") {
    if (lang === undefined || lang === "css" || lang === "postcss") return "css";
    if (lang === "scss" || lang === "less") throw new Unsupported(`style lang ${lang}`);
    return "raw";
  }
  if (attr(n, "src") !== undefined) return "raw";
  // utilities/index.js's inferScriptParser matches the type as written: `Text/JavaScript` prints as written.
  const type = attr(n, "type")?.value ?? undefined;
  if (lang === "ts" || type === "application/x-typescript") return "typescript";
  if (lang === "tsx") return "tsx";
  if (lang !== undefined && lang !== "js" && lang !== "jsx") return "raw";
  // A module allows no legacy `<!--`/`-->` comment, so its parse fails and oxfmt keeps it as written.
  if (type === "module" && /(^|\n)[\t\f\r ]*(<!--|-->)/.test(n.value)) return "raw";
  if (
    type === undefined ||
    ["module", "text/javascript", "text/babel", "text/jsx", "application/javascript", "jsx"].includes(type)
  )
    return "babel";
  if (type.endsWith("json") || type.endsWith("importmap") || type === "speculationrules") return "json";
  if (type === "text/html") return "html";
  if (["text/x-handlebars-template", "text/markdown"].includes(type))
    throw new Unsupported(`script type ${type}`);
  return "raw";
}

/**
 * printer-html.js's text in a whitespace-sensitive script or style: htmlTrimPreserveIndentation (one leading blank
 * line and the trailing whitespace dropped), then dedentString's common indentation off each line.
 */
function rawLines(value: string): string[] {
  const lines = value.replace(/^[\t\f\r ]*\n/, "").replace(/[\t\n\f\r ]+$/, "").split("\n");
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line === "") continue;
    const lead = /^[\t\n\f\r ]*/.exec(line)?.[0].length ?? 0;
    if (lead === 0) return lines;
    if (lead < line.length) indent = Math.min(indent, lead);
  }
  return indent === Number.POSITIVE_INFINITY ? lines : lines.map((l) => l.slice(indent));
}

/** Prints `root` (from `parseHtml`) as prettier's `group(printChildren(root))`, without its final hardline. */
export function printHtml(root: Node, text: string, out: HtmlPrinter): void {
  new Printer(text, new Lines(text), out).root(root);
}

/** utilities/index.js's hasPrettierIgnore: the node right after a `<!-- prettier-ignore -->`. */
const hasPrettierIgnore = (n: Node) => n.prev?.kind === "comment" && n.prev.value.slice(4, -3).trim() === "prettier-ignore";

class Printer {
  constructor(
    private readonly source: string,
    private readonly lines: Lines,
    private readonly out: HtmlPrinter,
  ) {}

  private startLine = (n: Node) => this.lines.at(n.start);
  private endLine = (n: Node) => this.lines.at(n.end);

  root(root: Node): void {
    // printer-html.js's root: the front matter, then a blank line before the content.
    root.frontMatter?.forEach((l, i) => {
      if (i > 0) sHardline();
      // A non-yaml one keeps a line's trailing whitespace as written.
      if (l !== "") sKeptText(l);
    });
    if (root.frontMatter !== undefined && root.children.length > 0) {
      sHardline();
      sHardline();
    }
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
  private preferHardlineAsSurrounding = (n: Node) =>
    n.kind === "comment" || n.kind === "ieConditionalComment" || (n.kind === "element" && n.name === "select");
  private preferHardlineAsTrailing = (n: Node) =>
    this.preferHardlineAsSurrounding(n) || (n.kind === "element" && n.name === "br") || this.hasSurroundingLineBreak(n);
  private preferHardlineAsLeading = (n: Node) =>
    this.preferHardlineAsSurrounding(n) ||
    (n.prev !== undefined && this.preferHardlineAsTrailing(n.prev)) ||
    this.hasSurroundingLineBreak(n);
  // An implicitly closed element's source span is its start tag alone in angular-html-parser, so the blank line
  // after it counts from there: `<p>a\n<div>` has none, `<p>\na\n<div>` has one.
  private forceNextEmptyLine = (n: Node) =>
    n.next !== undefined &&
    (n.kind === "element" && !n.isSelfClosing && n.endTagStart === -1
      ? this.lines.at(n.startTagEnd)
      : this.endLine(n)) +
      1 <
      this.startLine(n.next);

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
        // Prettier's name drops a namespace: an `html:style` is a `style` here.
        (["body", "script", "style"].includes(n.name.replace(/^[^:]*:/, "")) || n.children.some(hasNonTextChild))) ||
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
        (hasPrettierIgnore(next) ||
          firstChild(next) !== undefined ||
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
    if (hasPrettierIgnore(n)) this.ignored(n);
    else if (n.kind === "element" || n.kind === "ieConditionalComment") this.element(n);
    else if (n.kind === "text") this.textNode(n);
    else if (n.kind === "ieConditionalStartComment" || n.kind === "ieConditionalEndComment") {
      if (!(n.prev && needsToBorrowNextOpeningTagStartMarker(n.prev))) {
        this.text(openingTagPrefix(n));
        this.text(openingTagStartMarker(n));
      }
      const borrowed = n.next
        ? needsToBorrowPrevClosingTagEndMarker(n.next)
        : needsToBorrowLastChildClosingTagEndMarker(n.parent as Node);
      if (!borrowed) {
        this.text(closingTagEndMarker(n));
        this.text(closingTagSuffix(n));
      }
    }
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

  // print/children.js's printChild for an ignored node: its source, trimmed at the end, less the markers its
  // neighbours borrow, between the markers it borrows.
  private ignored(n: Node): void {
    const start = n.start + (n.prev && needsToBorrowNextOpeningTagStartMarker(n.prev) ? openingTagStartMarker(n).length : 0);
    const end = n.end - (n.next && needsToBorrowPrevClosingTagEndMarker(n.next) ? closingTagEndMarker(n).length : 0);
    this.text(openingTagPrefix(n));
    this.literal(this.source.slice(start, end).trimEnd());
    this.text(closingTagSuffix(n));
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
    if (!n.isSelfClosing && !(first && needsToBorrowParentOpeningTagEndMarker(first))) this.text(openingTagEndMarker(n));
  }

  private attributes(n: Node): void {
    if (n.attrs.length === 0) {
      if (n.isSelfClosing) this.text(" ");
      return;
    }
    const perLine = this.out.singleAttributePerLine === true && n.attrs.length > 1;
    open(INDENT);
    n.attrs.forEach((a, i) => {
      if (i > 0 && perLine) sHardline();
      else sLine(0);
      this.attribute(a);
    });
    close();
    const first = firstChild(n);
    if (
      (first && needsToBorrowParentOpeningTagEndMarker(first)) ||
      (n.isSelfClosing && needsToBorrowLastChildClosingTagEndMarker(n.parent as Node))
    ) {
      if (n.isSelfClosing) this.text(" ");
    } else if (this.out.bracketSameLine) {
      if (n.isSelfClosing) this.text(" ");
    } else sLine(n.isSelfClosing ? 0 : SOFT);
  }

  private attribute(a: Attr): void {
    if (a.value === null) {
      this.text(a.rawName);
      return;
    }
    if (a.bare) {
      this.text(`${a.rawName}=${a.value}`);
      return;
    }
    if (a.style) {
      const { declarations, declaration } = this.out;
      if (declarations === undefined || declaration === undefined) throw new Unsupported("style");
      if (a.value.trim() === "") {
        this.text(`${a.rawName}=""`);
        return;
      }
      const decls = declarations(unescapeQuotes(a.value));
      if (decls !== undefined) {
        // print/style.js: printExpand of the declarations, a line apart, each ending in the `;` `declaration` prints.
        this.text(`${a.rawName}="`);
        open(GROUP);
        open(INDENT);
        sLine(SOFT);
        decls.forEach((d, i) => {
          if (i > 0) {
            sLine(0);
            if (d.blank) sHardline();
          }
          declaration(d.text, i === decls.length - 1);
        });
        close();
        sLine(SOFT);
        close();
        this.text('"');
        return;
      }
    }
    if (a.eventHandler && a.value.trim() !== "") {
      // print/attribute/event-handler.js: printExpand of the value as a babel program, as written where it does not parse.
      if (this.out.eventHandler === undefined) throw new Unsupported(a.rawName);
      const print = this.out.eventHandler(unescapeQuotes(a.value));
      if (print !== undefined) {
        this.text(`${a.rawName}="`);
        open(GROUP);
        open(INDENT);
        sLine(SOFT);
        print();
        close();
        sLine(SOFT);
        close();
        this.text('"');
        return;
      }
    }
    if (a.srcset) {
      // print/attribute/srcset.js: printExpand of the candidates `,`-and-line apart; broken, each descriptor
      // right-aligned on its integer part past the longest url.
      const candidates = a.srcset;
      const urlWidth = Math.max(...candidates.map((c) => c.url.length));
      const intWidth = (d: string) => (d.includes(".") ? d.indexOf(".") : d.length - 1);
      const maxInt = Math.max(...candidates.map((c) => intWidth(c.descriptor)));
      this.text(`${a.rawName}="`);
      open(GROUP);
      open(INDENT);
      sLine(SOFT);
      candidates.forEach((c, i) => {
        if (i > 0) {
          this.text(",");
          sLine(0);
        }
        this.text(c.url.replaceAll('"', "&quot;"));
        if (c.descriptor !== "") {
          open(IF_BROKEN);
          this.text(" ".repeat(urlWidth - c.url.length + 1 + maxInt - intWidth(c.descriptor)));
          close();
          open(IF_FLAT);
          this.text(" ");
          close();
          this.text(c.descriptor);
        }
      });
      close();
      sLine(SOFT);
      close();
      this.text('"');
      return;
    }
    if (a.allow) {
      // print/attribute/allow.js: each directive's words one space apart, printExpand'ed a line apart after a `;`.
      const directives = unescapeQuotes(a.value)
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d !== "")
        .map((d) => d.split(/[\t\n\f\r ]+/).join(" ").replaceAll('"', "&quot;"));
      this.text(`${a.rawName}="`);
      if (directives.length > 0) {
        open(GROUP);
        open(INDENT);
        sLine(SOFT);
        directives.forEach((d, i) => {
          this.text(d);
          if (i < directives.length - 1) {
            this.text(";");
            sLine(0);
          } else {
            open(IF_BROKEN);
            this.text(";");
            close();
          }
        });
        close();
        sLine(SOFT);
        close();
      }
      this.text('"');
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
    const embedded =
      this.out.embeddedOff && (n.name === "script" || n.name === "style") && n.value.trim() !== ""
        ? "raw"
        : embeddedLanguage(n);
    if (embedded !== undefined) {
      const embed = this.out.embed;
      if (embed === undefined && embedded !== "raw") throw new Unsupported(n.name);
      open(GROUP);
      open(GROUP);
      this.openingTag(n);
      close();
      sBreakParent();
      open(INDENT);
      sHardline();
      if (embedded === "raw")
        rawLines(n.value).forEach((l, i) => {
          if (i > 0) sHardline();
          this.text(l);
        });
      else embed?.(embedded, n.value);
      close();
      sHardline();
      this.closingTag(n);
      close();
      return;
    }
    const first = firstChild(n);
    const last = lastChild(n);
    // utilities/index.js's shouldPreserveContent: a pre-like element holding anything but text keeps its content as
    // written (getNodeContent), its own tags still printed.
    if (isPreLike(n) && n.children.some((c) => c.kind !== "text")) {
      open(GROUP);
      this.openingTag(n);
      close();
      if (n.endTagStart !== -1 && first !== undefined && last !== undefined) {
        let start = n.startTagEnd;
        if (needsToBorrowParentOpeningTagEndMarker(first)) start -= openingTagEndMarker(n).length;
        let end = n.endTagStart;
        if (needsToBorrowParentClosingTagStartMarker(last)) end += closingTagStartMarker(n).length;
        this.literal(this.source.slice(start, end));
      }
      this.closingTag(n);
      return;
    }
    open(GROUP);
    open(GROUP);
    this.openingTag(n);
    close();
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
      // Prettier's comment value is its text inside `<!--` and `-->`.
      new RegExp(`\\n[\\t ]{${this.out.tabWidth * depth}}$`).test(
        last.kind === "comment" ? last.value.slice(4, -3) : last.value,
      )
    )
      return "";
    return "softline";
  }
}
