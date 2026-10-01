// YAML laid out as oxfmt 0.70.0 prints it with prettier's defaults (prettier 3.9.9's language-yaml printer).
// Every rule here was read off oxfmt's output over a matrix of variants. A construct the printer has no rule
// for yet throws `Unsupported`, so the file is refused rather than printed wrong.
//
// The printer covers block mappings and sequences of single-line scalars, comments, document markers and
// blank lines, anchors, tags, aliases and block scalars. Flow collections, multi-line flow scalars and explicit
// keys refuse.

import { NO_NODE } from "../../core/arena.js";
import { SYM_ERROR } from "../../core/language.js";
import { textWidth } from "../../fmt/width.js";
import type { PrettierOptions } from "../../fmt/options.js";
import { type FormatTree, firstLeaf } from "../../fmt/tree.js";

export class Unsupported extends Error {}

const unsupported = (what: string): never => {
  throw new Unsupported(what);
};

/** Whether the stream holds anything to print: a blank file prints as "", without a final line break. */
export const isBlank = (tree: FormatTree): boolean => tree.text(tree.root).trim() === "";

/**
 * A quoted scalar in the quote prettier picks: its own when the content has an escape the other quote would
 * change, single when the content holds a double quote, double when it holds a single one, else `preferred`.
 */
function quoted(text: string, double: boolean, preferred: string): string {
  const raw = text.slice(1, -1);
  if (raw.includes("\n")) return unsupported("a multi-line quoted scalar");
  if ((!double && raw.includes("\\")) || (double && /\\[^"]/.test(raw))) return text;
  if (raw.includes('"'))
    return double ? `'${raw.replaceAll('\\"', '"').replaceAll("'", "''")}'` : text;
  if (raw.includes("'")) return double ? text : `"${raw.replaceAll("''", "'")}"`;
  return preferred + raw + preferred;
}

/** Prettier's word split of a folded line: at a single space with neither a space nor the line's edge beside it. */
const words = (line: string): string[] => (line ? line.split(/(?<!^| ) (?! |$)/) : []);

/**
 * A folded scalar's lines as prettier refolds them under proseWrap `always` or `never`: a line joins the paragraph
 * before it unless either is blank or more indented, or the paragraph ends in a space; a word ending in a space
 * takes the next word along.
 */
function refold(lines: string[], never: boolean): string[][] {
  const paras: string[][] = [];
  for (const [i, line] of lines.entries()) {
    const ws = words(line);
    const last = paras[paras.length - 1];
    if (i > 0 && ws.length > 0 && lines[i - 1]!.length > 0 && !/^\s/.test(ws[0]!) && last && !/^\s|\s$/.test(String(last)))
      paras[paras.length - 1] = [...last, ...ws];
    else paras.push(ws);
  }
  const glued = paras.map((p) => {
    const out: string[] = [];
    for (const w of p)
      if (out.length > 0 && /\s$/.test(out[out.length - 1]!)) out[out.length - 1] += ` ${w}`;
      else out.push(w);
    return out;
  });
  return never ? glued.map((p) => (p.length === 0 ? p : [p.join(" ")])) : glued;
}

class Printer {
  readonly lines: string[] = [];
  /** Lines of block scalar content, printed with their trailing whitespace. */
  readonly verbatim = new Set<number>();
  /** Every comment, in source order, and the next one not yet printed. */
  readonly comments: number[] = [];
  next = 0;
  /**
   * Whether the last line printed ends a block scalar's content, whose blank line after it the source then says
   * (`scalarBlank`): the next token's `lf` counts the content's lines too.
   */
  scalarEnd = false;
  scalarBlank = false;
  /** The line count when a kept block scalar ended the stream: oxfmt prints no final line break after it. */
  keptLast?: number;
  /** Each leaf's source offset, read off the stream text on the first block scalar. */
  offsets?: Map<number, number>;

  constructor(
    readonly tree: FormatTree,
    readonly tab: number,
    readonly quote: string,
    readonly prose: string,
    readonly width: number,
  ) {}

  kind = (n: number) => this.tree.kindName(n);

  named(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.tree.count(n); i++) {
      const c = this.tree.child(n, i);
      if (this.tree.named(c) && this.kind(c) !== "comment") out.push(c);
    }
    return out;
  }

  line(text: string): void {
    this.lines.push(text);
    this.scalarEnd = false;
  }

  append(text: string): void {
    this.lines[this.lines.length - 1] += text;
  }

  blank(): void {
    // A block scalar's kept whitespace-only line already reads as the blank line.
    if ((!this.scalarEnd || this.scalarBlank) && this.lines.length > 0 && this.lines[this.lines.length - 1]!.trim() !== "") this.lines.push("");
  }

  /** The ordinal of the first leaf of `n`, by which comments are placed between nodes. */
  start = (n: number) => this.tree.ord(firstLeaf(this.tree, n));

  pending(before: number): number | undefined {
    const c = this.comments[this.next];
    return c !== undefined && this.tree.ord(c) < before ? c : undefined;
  }

  /** A comment on the line of what precedes it, one space after it. */
  trailing(c: number): void {
    if (this.lines.length === 0) unsupported("a trailing comment with no line");
    this.append(` ${this.tree.text(c)}`);
    this.next++;
  }

  /** A comment on its own line at `indent`, after one blank line when the source has one and `blankOk`. */
  ownLine(c: number, indent: number, blankOk: boolean): void {
    if (blankOk && this.tree.lf(c) >= 2) this.blank();
    this.line(" ".repeat(indent) + this.tree.text(c));
    this.next++;
  }

  /**
   * The comments before `before` that sit between the items of a block collection at source column `col`,
   * printed at `indent`. A comment deeper than the item before it, whose value is a scalar, goes one level in.
   */
  between(before: number, prev: number | undefined, col: number, indent: number, first: boolean): boolean {
    let c: number | undefined;
    while ((c = this.pending(before)) !== undefined) {
      if (this.tree.lf(c) === 0) {
        this.trailing(c);
        continue;
      }
      let at = indent;
      if (prev !== undefined && this.tree.col(c) > col) {
        if (this.nestedValue(prev) !== undefined) unsupported("a comment between a nested block and its parent");
        at = indent + this.tab;
      }
      this.ownLine(c, at, !first);
      first = false;
    }
    return first;
  }

  /** The block collection an item's value is, if any. */
  nestedValue(item: number): number | undefined {
    const v =
      this.kind(item) === "block_mapping_pair"
        ? this.tree.child(item, this.tree.count(item) - 1)
        : this.named(item)[0];
    if (v === undefined || this.kind(v) !== "block_node") return undefined;
    return v;
  }

  /**
   * A node's anchor and tag, in source order, one space apart, and what follows them. Properties may sit on the
   * line before a scalar (`a: !t⏎  1`); they print on the scalar's line.
   */
  properties(n: number): { props: string; content: number | undefined } {
    const props: string[] = [];
    let content: number | undefined;
    for (const k of this.named(n)) {
      const kind = this.kind(k);
      if (content === undefined && (kind === "anchor" || kind === "tag")) props.push(this.tree.text(k));
      else if (content === undefined) content = k;
      else unsupported("a node with two contents");
    }
    return { props: props.join(" "), content };
  }

  /** A scalar or alias flow node on one line, after its properties. */
  scalar(n: number): string {
    if (this.kind(n) !== "flow_node") return unsupported(`a ${this.kind(n)} value`);
    const { props, content: s } = this.properties(n);
    if (s === undefined) return unsupported("properties without content");
    if (this.pending(this.start(s)) !== undefined) unsupported("a comment after properties");
    const text = this.content(s);
    return props === "" ? text : `${props} ${text}`;
  }

  content(s: number): string {
    switch (this.kind(s)) {
      case "alias":
        return this.tree.text(s);
      case "plain_scalar": {
        const text = this.tree.text(s);
        if (text.includes("\n")) return unsupported("a multi-line plain scalar");
        return text;
      }
      case "double_quote_scalar":
        return quoted(this.tree.text(s), true, this.quote);
      case "single_quote_scalar":
        return quoted(this.tree.text(s), false, this.quote);
      default:
        return unsupported(`a ${this.kind(s)}`);
    }
  }

  isBlockScalar = (n: number) => this.kind(n) === "block_node" && this.named(n).some((k) => this.kind(k) === "block_scalar");

  /** The blank lines after `n`, up to the line of the next token: prettier's range of a block scalar takes them in. */
  blankAfter(n: number): string {
    const src = this.tree.text(this.tree.root);
    if (this.offsets === undefined) {
      this.offsets = new Map();
      let pos = 0;
      for (let o = 0; o < this.tree.nodeCount; o++) {
        const leaf = this.tree.at(o);
        if (this.tree.count(leaf) > 0) continue;
        // A block scalar's content is no leaf: its header leaf stands for the whole scalar, header comment included.
        const parent = this.tree.parent(leaf);
        const scalar = this.kind(parent) === "block_scalar";
        if (scalar && this.tree.child(parent, 0) !== leaf) continue;
        const t = this.tree.text(scalar ? parent : leaf);
        const at = src.indexOf(t, pos);
        if (at < 0 || src.slice(pos, at).trim() !== "") return unsupported("a token not found in the stream text");
        this.offsets.set(leaf, at);
        pos = at + t.length;
      }
    }
    const end = (this.offsets.get(firstLeaf(this.tree, n)) ?? unsupported("a block scalar off the stream")) + this.tree.text(n).length;
    return /^(?:[ \t]*\n)*/.exec(src.slice(end))![0];
  }

  /** Whether `n` is the last child all the way up: prettier then drops a clipped scalar's trailing blank lines. */
  lastDescendant(n: number): boolean {
    for (let c = n, p = this.tree.parent(c); p !== NO_NODE; c = p, p = this.tree.parent(p)) {
      const k = this.kind(p);
      if (k !== "block_mapping" && k !== "block_sequence" && k !== "stream") continue;
      const kids = this.named(p);
      if (kids[kids.length - 1] !== c) return false;
    }
    return true;
  }

  /**
   * A block scalar node `n`: its properties and header after `lead` on the current line (on a line of their own
   * when `lead` is undefined), then its content. Content with no indentation indicator moves to `indent`, the
   * enclosing collection's plus tabWidth; with one, prettier slices and prints it at the indicator less one plus
   * the count of block collections around it, from the root, whatever the printed nesting.
   */
  blockScalar(n: number, indent: number, lead: string | undefined): void {
    const { props, content: s } = this.properties(n);
    if (s === undefined || this.kind(s) !== "block_scalar") return unsupported("a block node with no block scalar");
    if (this.pending(this.start(s)) !== undefined) unsupported("a comment after properties");
    const m = /^([|>])([+-]?)([1-9]?)([+-]?)$/.exec(this.tree.text(this.tree.child(s, 0)));
    if (m === null || (m[2] !== "" && m[4] !== "")) return unsupported("a block scalar header");
    const [, style, , explicit, ] = m;
    const chomp = m[2] || m[4];
    let header = `${style}${explicit}${chomp}`;
    if (props !== "") header = `${props} ${header}`;
    if (lead === undefined) this.line(header);
    else this.append(lead + header);
    for (let i = 1; i < this.tree.count(s); i++) {
      const c = this.tree.child(s, i);
      if (this.kind(c) !== "comment" || this.comments[this.next] !== c) unsupported("a block scalar header part");
      this.trailing(c);
    }
    const text = this.tree.text(s);
    const nl = text.indexOf("\n");
    if (nl < 0) return;
    const body = text.slice(nl + 1) + this.blankAfter(s);
    let depth = 0;
    for (let p = this.tree.parent(n); p !== NO_NODE; p = this.tree.parent(p))
      if (this.kind(p) === "block_mapping" || this.kind(p) === "block_sequence") depth++;
    let cut: number;
    if (explicit === "") {
      const first = /^( *)[^\n\r ]/m.exec(body);
      cut = first ? first[1]!.length : Number.POSITIVE_INFINITY;
    } else {
      cut = Number(explicit) - 1 + depth;
      indent = cut;
    }
    const src = body.split("\n").map((l) => l.slice(cut));
    let paras =
      this.prose === "preserve" || style === "|" ? src.map((l) => (l ? [l] : [])) : refold(src, this.prose === "never");
    if (chomp === "+") {
      if (body.endsWith("\n") && paras[paras.length - 1]?.length === 0) paras = paras.slice(0, -1);
    } else {
      let u = 0;
      for (let f = paras.length - 1; f >= 0 && paras[f]!.every((w) => w.replace(/[ \t]+$/, "") === ""); f--) u++;
      if (u > 0) paras = u >= 2 && !this.lastDescendant(n) ? paras.slice(0, -(u - 1)) : paras.slice(0, -u);
    }
    const pad = " ".repeat(indent);
    const put = (l: string) => {
      this.verbatim.add(this.lines.length);
      this.lines.push(l);
    };
    for (const p of paras) {
      if (p.length === 0) {
        put("");
        continue;
      }
      // A fill: each word joins the line while it fits in printWidth; a break drops the line's trailing spaces.
      let cur = pad + p[0];
      for (const w of p.slice(1)) {
        if (textWidth(cur) + 1 + textWidth(w) <= this.width) cur += ` ${w}`;
        else {
          put(cur.trimEnd());
          cur = pad + w;
        }
      }
      put(cur);
    }
    this.scalarEnd = true;
    this.scalarBlank = /\n[ \t]*\n[ \t]*$/.test(body);
    if (chomp === "+" && this.lastDescendant(n)) this.keptLast = this.lines.length;
  }

  /** The block collection a block node holds, and its properties ("" for none). */
  collection(n: number): { props: string; coll: number } {
    const { props, content } = this.properties(n);
    if (content === undefined) return unsupported("properties without content");
    const k = this.kind(content);
    if (k !== "block_mapping" && k !== "block_sequence") return unsupported(`a ${k}`);
    return { props, coll: content };
  }

  /**
   * A value collection's properties on the current line. The one comment between them and the first item trails
   * them even when it sat on a line of its own (`key: &a⏎⏎  # c` prints `key: &a # c`); more refuse.
   */
  valueProps(props: string, coll: number): void {
    if (props === "") return;
    this.append(` ${props}`);
    const c = this.pending(this.start(coll));
    if (c === undefined) return;
    this.next++;
    if (this.pending(this.start(coll)) !== undefined) unsupported("comments after properties");
    this.append(` ${this.tree.text(c)}`);
  }

  /**
   * A block collection with items at `indent`. `inline` starts its first item on the current line (after a
   * sequence item's "- "); `limit` is the ordinal past which comments belong to an outer collection.
   */
  block(coll: number, indent: number, inline: boolean, limit: number, first = true): void {
    const items = this.named(coll);
    const col = this.tree.col(items[0] as number);
    let prev: number | undefined;
    for (const [i, item] of items.entries()) {
      if (this.pending(this.start(item)) !== undefined) inline = false;
      first = this.between(this.start(item), prev, col, indent, first);
      if (inline) {
        this.append(" ".repeat(Math.max(0, indent - this.lines[this.lines.length - 1]!.length)));
        inline = false;
      } else {
        if (!first && this.tree.lf(firstLeaf(this.tree, item)) >= 2) this.blank();
        this.line(" ".repeat(indent));
      }
      first = false;
      const after = items[i + 1];
      this.item(item, indent, after === undefined ? limit : this.start(after));
      prev = item;
    }
    // The comments after the last item that are no shallower than the items stay in this collection.
    let c: number | undefined;
    while ((c = this.pending(limit)) !== undefined) {
      if (this.tree.lf(c) !== 0 && this.tree.col(c) < col) break;
      this.between(this.tree.ord(c) + 1, prev, col, indent, false);
    }
  }

  /** One mapping pair or sequence item, its first line already started at `indent`. */
  item(item: number, indent: number, until: number): void {
    if (this.kind(item) === "block_sequence_item") {
      this.append("-");
      const v = this.named(item)[0];
      if (v === undefined) {
        // An empty item keeps the space its absent value would take before a trailing comment: `-  # c`.
        const c = this.pending(until);
        if (c !== undefined && this.tree.lf(c) === 0) this.append(" ");
        return;
      }
      if (this.isBlockScalar(v)) this.blockScalar(v, indent + this.tab, " ");
      else if (this.kind(v) === "block_node") {
        // `- &a⏎  b: 1`: a collection with properties starts on the line after them.
        const { props, coll } = this.collection(v);
        this.valueProps(props, coll);
        this.block(coll, indent + 2, props === "", until);
      } else this.append(` ${this.scalar(v)}`);
      return;
    }
    if (this.kind(item) !== "block_mapping_pair") unsupported(`a ${this.kind(item)}`);
    const key = this.tree.child(item, 0);
    if (this.tree.fieldName(key) !== "key") unsupported("a pair without a key");
    if (this.tree.kindName(key) === "?") unsupported("an explicit key");
    // An alias key keeps a space before the colon, which would otherwise read as part of its name.
    const keyText = this.scalar(key);
    this.append(this.named(key).some((k) => this.kind(k) === "alias") ? `${keyText} :` : `${keyText}:`);
    const value = this.tree.child(item, this.tree.count(item) - 1);
    if (this.tree.fieldName(value) !== "value") return;
    if (this.isBlockScalar(value)) return this.blockScalar(value, indent + this.tab, " ");
    if (this.kind(value) === "block_node") {
      const { props, coll } = this.collection(value);
      this.valueProps(props, coll);
      this.block(coll, indent + this.tab, false, until);
      return;
    }
    if (this.pending(this.start(value)) !== undefined) unsupported("a comment before a scalar value");
    this.append(` ${this.scalar(value)}`);
  }

  document(doc: number, last: boolean, limit: number): void {
    for (let i = 0; i < this.tree.count(doc); i++) {
      const c = this.tree.child(doc, i);
      const k = this.kind(c);
      if (this.pending(this.start(c)) !== undefined) this.loose(this.start(c));
      switch (k) {
        case "comment":
          break;
        case "yaml_directive":
        case "tag_directive":
        case "reserved_directive":
        case "---":
        case "...":
          // After a block scalar its chomping alone decides the blank line before a marker.
          if (this.tree.lf(c) >= 2 && this.lines.length > 0 && !this.scalarEnd) this.blank();
          this.line(this.tree.text(c));
          break;
        case "block_node": {
          if (this.tree.lf(firstLeaf(this.tree, c)) >= 2 && this.lines.length > 0 && !this.afterMarker()) this.blank();
          if (this.lines.length > 0 && this.tree.lf(firstLeaf(this.tree, c)) === 0) unsupported("content on a marker line");
          if (this.isBlockScalar(c)) {
            this.blockScalar(c, this.tab, undefined);
            break;
          }
          const { props, coll } = this.collection(c);
          const first = this.lines.length === 0 || this.afterMarker();
          if (props !== "") {
            // A root's `!!map # c` prints its comment on the next line: a layout this printer has no rule for.
            if (this.pending(this.start(coll)) !== undefined) unsupported("a comment after root properties");
            this.line(props);
          }
          this.block(coll, 0, false, limit, first);
          break;
        }
        case "flow_node": {
          if (this.lines.length > 0 && this.tree.lf(firstLeaf(this.tree, c)) === 0) unsupported("content on a marker line");
          if (this.tree.lf(firstLeaf(this.tree, c)) >= 2 && this.lines.length > 0 && !this.afterMarker()) this.blank();
          this.line(this.scalar(c));
          break;
        }
        default:
          unsupported(`a document ${k}`);
      }
    }
    if (last) this.loose(limit);
  }

  afterMarker = () => this.lines[this.lines.length - 1] === "---";

  /** Comments outside every collection, as written at column 0 or trailing their line. */
  loose(before: number): void {
    let c: number | undefined;
    while ((c = this.pending(before)) !== undefined) {
      if (this.tree.lf(c) === 0 && this.lines.length > 0) this.trailing(c);
      else {
        if (this.tree.col(c) !== 0) unsupported("an indented comment outside a collection");
        this.ownLine(c, 0, this.lines.length > 0 && !this.afterMarker());
      }
    }
  }
}

/** The stream `root` as printed, without its final line break. */
export function printYaml(tree: FormatTree, root: number, options: PrettierOptions): string {
  // Prettier options the shared PrettierOptions does not carry, which the conformance fixtures pass through.
  const { singleQuote = false, proseWrap = "preserve" } = options as {
    singleQuote?: boolean;
    proseWrap?: string;
  };
  const p = new Printer(tree, options.tabWidth, singleQuote ? "'" : '"', proseWrap, options.printWidth);
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if (tree.kind(n) === SYM_ERROR || tree.missing(n)) unsupported("a YAML parse error");
    if (tree.kindName(n) !== "comment") continue;
    if (/^#\s*prettier-ignore\b/.test(tree.text(n))) unsupported("a prettier-ignore comment");
    p.comments.push(n);
  }
  const docs: number[] = [];
  for (let i = 0; i < tree.count(root); i++) {
    const d = tree.child(root, i);
    if (tree.kindName(d) === "document") docs.push(d);
    else if (tree.kindName(d) !== "comment") unsupported(`a stream ${tree.kindName(d)}`);
  }
  docs.forEach((d, i) => {
    const next = docs[i + 1];
    p.document(d, next === undefined, next === undefined ? Number.POSITIVE_INFINITY : p.start(next));
  });
  p.loose(Number.POSITIVE_INFINITY);
  if (p.keptLast !== undefined && p.lines.length > p.keptLast) unsupported("a comment after a kept block scalar ending the stream");
  const lines = p.lines.map((l, i) => (p.verbatim.has(i) ? l : l.trimEnd()));
  // proseWrap other than "preserve" refolds plain scalars and turns a long key explicit (`? key`).
  if (proseWrap !== "preserve" && lines.some((l, i) => !p.verbatim.has(i) && l.length > options.printWidth))
    unsupported("a line past printWidth under proseWrap");
  return lines.join("\n");
}
