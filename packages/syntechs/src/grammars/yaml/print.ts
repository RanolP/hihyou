// YAML laid out as oxfmt 0.70.0 prints it with prettier's defaults (prettier 3.9.9's language-yaml printer).
// Every rule here was read off oxfmt's output over a matrix of variants. A construct the printer has no rule
// for yet throws `Unsupported`, so the file is refused rather than printed wrong.
//
// The printer covers block mappings and sequences of single-line scalars, comments, document markers and
// blank lines. Flow collections, block scalars, multi-line scalars, anchors, tags, aliases and explicit keys
// refuse.

import { SYM_ERROR } from "../../core/language.js";
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

class Printer {
  readonly lines: string[] = [];
  /** Every comment, in source order, and the next one not yet printed. */
  readonly comments: number[] = [];
  next = 0;

  constructor(
    readonly tree: FormatTree,
    readonly tab: number,
    readonly quote: string,
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
  }

  append(text: string): void {
    this.lines[this.lines.length - 1] += text;
  }

  blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== "") this.lines.push("");
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
      if (v === undefined) return;
      if (this.kind(v) === "block_node") {
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
          if (this.tree.lf(c) >= 2 && this.lines.length > 0) this.blank();
          this.line(this.tree.text(c));
          break;
        case "block_node": {
          if (this.tree.lf(firstLeaf(this.tree, c)) >= 2 && this.lines.length > 0 && !this.afterMarker()) this.blank();
          if (this.lines.length > 0 && this.tree.lf(firstLeaf(this.tree, c)) === 0) unsupported("content on a marker line");
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
  const p = new Printer(tree, options.tabWidth, singleQuote ? "'" : '"');
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
  const lines = p.lines.map((l) => l.trimEnd());
  // proseWrap other than "preserve" refolds plain scalars and turns a long key explicit (`? key`).
  if (proseWrap !== "preserve" && lines.some((l) => l.length > options.printWidth))
    unsupported("a line past printWidth under proseWrap");
  return lines.join("\n");
}
