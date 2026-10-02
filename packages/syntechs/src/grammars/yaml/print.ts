// YAML laid out as oxfmt 0.70.0 prints it with prettier's defaults (prettier 3.9.9's language-yaml printer).
// Every rule here was read off oxfmt's output over a matrix of variants. A construct the printer has no rule
// for yet throws `Unsupported`, so the file is refused rather than printed wrong.
//
// The printer covers block mappings and sequences of single-line scalars, comments, document markers and
// blank lines, anchors, tags, aliases, block scalars, flow collections and the comments inside them, explicit keys
// and multi-line plain and quoted scalars outside flow collections. Multi-line scalars inside flow collections
// refuse.

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
function quoted(text: string, double: boolean, preferred: string): { quote: string; raw: string } {
  const raw = text.slice(1, -1);
  const own = { quote: text[0]!, raw };
  if ((!double && raw.includes("\\")) || (double && /\\[^"]/.test(raw))) return own;
  if (raw.includes('"'))
    return double ? { quote: "'", raw: raw.replaceAll('\\"', '"').replaceAll("'", "''") } : own;
  if (raw.includes("'")) return double ? own : { quote: '"', raw: raw.replaceAll("''", "'") };
  return { quote: preferred, raw };
}

/**
 * A plain or quoted scalar's paragraphs of words as prettier fills them (its `getFlowScalarLineContents`): source
 * lines trimmed at their breaks; under proseWrap `preserve` each line its own paragraph, else a line joins the one
 * before it unless either is blank or (in a double-quoted scalar) the paragraph ends in an escaped break, and
 * under `never` a paragraph is one word.
 */
function flowParagraphs(raw: string, double: boolean, prose: string): string[][] {
  const lines = raw
    .split("\n")
    .map((l, i, a) => (a.length === 1 ? l : i === 0 ? l.trimEnd() : i === a.length - 1 ? l.trimStart() : l.trim()));
  if (prose === "preserve") return lines.map((l) => (l ? [l] : []));
  const paras: string[][] = [];
  for (const [i, line] of lines.entries()) {
    const ws = words(line);
    const last = paras[paras.length - 1];
    if (i > 0 && lines[i - 1]!.length > 0 && ws.length > 0 && !(double && last![last!.length - 1]!.endsWith("\\")))
      paras[paras.length - 1] = [...last!, ...ws];
    else paras.push(ws);
  }
  return prose === "never" ? paras.map((p) => [p.join(" ")]) : paras;
}

/**
 * A flow scalar's text with its line breaks folded as YAML reads them: a break between two lines is a space, each
 * blank line one line feed, and the whitespace at a break goes. The printer refills a scalar's words across
 * lines, and prettier reads this value to judge a scalar surely one line.
 */
export function fold(text: string): string {
  if (!text.includes("\n")) return text;
  const lines = text.split("\n").map((l, i, a) => (i === 0 ? l.trimEnd() : i === a.length - 1 ? l.trimStart() : l.trim()));
  let out = lines[0]!;
  for (let i = 1; i < lines.length; i++) out += lines[i] === "" ? "\n" : lines[i - 1] === "" && i > 1 ? lines[i] : ` ${lines[i]}`;
  return out;
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
  /** Lines a flow scalar was filled on, which may pass printWidth by a word too long to break. */
  readonly filled = new Set<number>();
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
    readonly bracketSpacing: boolean,
    readonly trailingComma: boolean,
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
    this.noPropsComment(n, s);
    const text = this.content(s);
    return props === "" ? text : `${props} ${text}`;
  }

  /**
   * Refuses a comment between node `n`'s properties and its content `s`. A comment before `n` is no concern here:
   * a flow collection measures its flat text before it places the comments between its items.
   */
  noPropsComment(n: number, s: number): void {
    const c = this.pending(this.start(s));
    if (c !== undefined && this.tree.ord(c) > this.start(n)) unsupported("a comment after properties");
  }

  content(s: number): string {
    const { head, paras, tail } = this.parts(s);
    if (paras.length > 1 || this.tree.text(s).includes("\n")) return unsupported(`a multi-line ${this.kind(s).replace("_", " ")}`);
    return head + (paras[0] ?? []).join(" ") + tail;
  }

  /** A scalar's paragraphs (an alias is one word), with the quote before and after them. */
  parts(s: number): { head: string; paras: string[][]; tail: string } {
    const kind = this.kind(s);
    if (kind === "alias") return { head: "", paras: [[this.tree.text(s)]], tail: "" };
    if (kind === "plain_scalar") return { head: "", paras: flowParagraphs(this.tree.text(s), false, this.prose), tail: "" };
    if (kind !== "double_quote_scalar" && kind !== "single_quote_scalar") return unsupported(`a ${kind}`);
    const double = kind === "double_quote_scalar";
    const { quote, raw } = quoted(this.tree.text(s), double, this.quote);
    return { head: quote, paras: flowParagraphs(raw, double, this.prose), tail: quote };
  }

  /** A plain, quoted or alias flow node with its properties, as its words and the text around them. */
  scalarParts(n: number, bare = false): { head: string; paras: string[][]; tail: string } {
    if (this.kind(n) !== "flow_node") return unsupported(`a ${this.kind(n)} value`);
    const { props, content: s } = this.properties(n);
    if (s === undefined) return unsupported("properties without content");
    this.noPropsComment(n, s);
    const p = this.parts(s);
    return props === "" || bare ? p : { ...p, head: `${props} ${p.head}` };
  }

  /** A scalar flow node on one line when it is one paragraph (prettier's flat fill), else undefined. */
  flatScalar(n: number): string | undefined {
    const { head, paras, tail } = this.scalarParts(n);
    return paras.length > 1 ? undefined : head + (paras[0] ?? []).join(" ") + tail;
  }

  /**
   * A scalar flow node filled as prettier's `fill` does, from the end of the current line: a word goes on the
   * line when it fits beside the one before it, else on a new line at `indent`; each paragraph after the first
   * starts a new line. The closing quote does not count toward the fit.
   */
  fill(n: number, indent: number, bare = false): void {
    const { head, paras, tail } = this.scalarParts(n, bare);
    paras.forEach((p, k) => {
      if (k > 0) this.line(" ".repeat(indent));
      this.filled.add(this.lines.length - 1);
      p.forEach((w0, j) => {
        const w = k === 0 && j === 0 ? head + w0 : w0;
        if (j > 0 && textWidth(this.lines[this.lines.length - 1]!) + 1 + textWidth(w) > this.width) {
          this.line(" ".repeat(indent) + w);
          this.filled.add(this.lines.length - 1);
        } else this.append(j > 0 ? ` ${w}` : w);
      });
      if (k === 0 && p.length === 0) this.append(head);
    });
    this.append(tail);
  }

  /** The flow mapping or sequence a flow node holds after its properties, if any. */
  flowCollection(n: number): number | undefined {
    if (this.kind(n) !== "flow_node") return undefined;
    const c = this.properties(n).content;
    return c !== undefined && (this.kind(c) === "flow_mapping" || this.kind(c) === "flow_sequence") ? c : undefined;
  }

  /** A flow collection's items, each with the `,` after it (NO_NODE for none). */
  flowItems(c: number): { item: number; comma: number }[] {
    const out: { item: number; comma: number }[] = [];
    for (let i = 0; i < this.tree.count(c); i++) {
      const k = this.tree.child(c, i);
      const kind = this.kind(k);
      if (kind === ",") {
        const last = out[out.length - 1];
        if (last === undefined || last.comma !== NO_NODE) unsupported("an empty flow entry");
        else last.comma = k;
      } else if (kind === "flow_node" || kind === "flow_pair") out.push({ item: k, comma: NO_NODE });
      else if (kind !== "[" && kind !== "]" && kind !== "{" && kind !== "}" && kind !== "comment") unsupported(`a flow ${kind}`);
    }
    return out;
  }

  /** A flow node on one line: a scalar, or a collection with its items `, `-separated (`bare`: without properties). */
  flat(n: number, bare = false): string {
    const c = this.flowCollection(n);
    if (c === undefined) return this.scalar(n);
    const { props } = this.properties(n);
    const seq = this.kind(c) === "flow_sequence";
    const items = this.flowItems(c).map(({ item }) => this.flatItem(item, seq));
    const pad = !seq && items.length > 0 && this.bracketSpacing ? " " : "";
    // A last pair with neither key nor value (`: `) takes the closing pad's place.
    const end = items[items.length - 1] === ": " ? "" : pad;
    const text = seq ? `[${items.join(", ")}]` : `{${pad}${items.join(", ")}${end}}`;
    return props === "" || bare ? text : `${props} ${text}`;
  }

  /**
   * A flow pair's key text (alias keys keep a space before the colon) and node, and its value, any absent. A `?`
   * drops: prettier prints the pair as an implicit key would. A pair with no value prints its key alone in a
   * mapping (`{b, c: }` → `{ b, c }`); in a sequence prettier makes it `? b`, which this grammar cannot read back,
   * so it refuses.
   */
  pairParts(pair: number, seq: boolean): { key: string | undefined; keyNode: number | undefined; value: number | undefined } {
    let key: number | undefined;
    let value: number | undefined;
    for (let i = 0; i < this.tree.count(pair); i++) {
      const k = this.tree.child(pair, i);
      if (this.tree.fieldName(k) === "key") key = k;
      else if (this.tree.fieldName(k) === "value") value = k;
      else if (this.kind(k) !== ":" && this.kind(k) !== "?" && this.kind(k) !== "comment") unsupported(`a flow pair ${this.kind(k)}`);
    }
    if (key === undefined && value === undefined) return { key: undefined, keyNode: undefined, value: undefined };
    if (value === undefined && seq) return unsupported("a flow sequence pair without a value");
    if (key === undefined) {
      if (this.flowCollection(value as number) !== undefined) unsupported("a flow collection after an empty key");
      return { key: undefined, keyNode: undefined, value };
    }
    const alias = this.named(key).some((k) => this.kind(k) === "alias");
    return { key: this.flat(key) + (alias ? " " : ""), keyNode: key, value };
  }

  flatItem(item: number, seq: boolean): string {
    if (this.kind(item) === "flow_node") return this.flat(item);
    const { key, value } = this.pairParts(item, seq);
    if (key === undefined && value === undefined) return ": ";
    if (value === undefined) return key as string;
    return `${key ?? ""}: ${this.flat(value)}`;
  }

  /**
   * Flow node `n` laid out as prettier's group does: on one line when it fits from column `col` with `trail`
   * columns after it (the `,` of an enclosing broken collection), else one item per line at `indent` plus
   * tabWidth with a trailing comma, the closing bracket at `indent`, and a blank line kept between items where
   * the source has one after the earlier item. The first line continues the current one; later lines carry their
   * indent. A comment inside breaks the collection and every one around it: a comment on an item's line trails
   * that item's comma, any other sits on its own line at the items' indent (`bare`: properties already printed).
   */
  layout(n: number, col: number, indent: number, trail: number, bare = false): string[] {
    const flat = this.flat(n, bare);
    const c = this.flowCollection(n);
    if (c === undefined || (!this.flowComment(n) && col + textWidth(flat) + trail <= this.width)) return [flat];
    const items = this.flowItems(c);
    if (items.length === 0) return unsupported("an empty flow collection past printWidth");
    // proseWrap other than "preserve" would fill a broken collection's multi-word scalars.
    if (this.prose !== "preserve" && /\s/.test(flat.replace(/[,:] /g, ""))) unsupported("a broken flow collection under proseWrap");
    const { props } = this.properties(n);
    const seq = this.kind(c) === "flow_sequence";
    if (/(?:^|, ): $/.test(flat.slice(1, -1))) unsupported("a broken flow collection ending in an empty pair");
    const lines = [(props === "" || bare ? "" : `${props} `) + (seq ? "[" : "{")];
    const inner = indent + this.tab;
    items.forEach(({ item }, i) => {
      const before = items[i - 1]?.comma;
      const trailed = this.flowComments(lines, this.start(item), inner, i > 0);
      if (trailed === undefined && before !== undefined && before !== NO_NODE) {
        const lf = this.tree.lf(before);
        if (lf >= 2 || (lf === 0 && this.tree.lf(firstLeaf(this.tree, item)) >= 2)) lines.push("");
      } else if (trailed !== undefined && this.tree.lf(firstLeaf(this.tree, item)) >= 2) {
        // oxfmt moves a trailing comment that a blank line follows to column 0, a layout with no rule here.
        if (trailed) unsupported("a blank line after a trailing comment in a flow collection");
        lines.push("");
      }
      const comma = i < items.length - 1 || this.trailingComma ? "," : "";
      const sub =
        this.kind(item) === "flow_node"
          ? this.layout(item, inner, inner, comma.length)
          : this.pairLayout(item, seq, inner, comma.length);
      sub[0] = " ".repeat(inner) + sub[0];
      sub[sub.length - 1] += comma;
      lines.push(...sub);
    });
    const close = this.tree.child(c, this.tree.count(c) - 1);
    this.flowComments(lines, this.tree.ord(close), inner, true, false);
    lines.push(" ".repeat(indent) + (seq ? "]" : "}"));
    return lines;
  }

  /**
   * The comments before ordinal `before` in a broken flow collection, pushed onto `lines`: one on the line of an
   * item (`trail`) after that item's comma, else on a line of its own at `indent`, after a blank line where the
   * source has one and `blankOk`. Whether the last of them trailed, undefined for none.
   */
  flowComments(lines: string[], before: number, indent: number, trail: boolean, blankOk = true): boolean | undefined {
    let c: number | undefined;
    let trailed: boolean | undefined;
    while ((c = this.pending(before)) !== undefined) {
      trailed = trail && this.tree.lf(c) === 0;
      if (trailed) lines[lines.length - 1] += ` ${this.tree.text(c)}`;
      else {
        if (blankOk && trail && this.tree.lf(c) >= 2) lines.push("");
        lines.push(" ".repeat(indent) + this.tree.text(c));
      }
      this.next++;
    }
    return trailed;
  }

  /** The last leaf of `n`. */
  lastLeaf(n: number): number {
    while (this.tree.count(n) > 0) n = this.tree.child(n, this.tree.count(n) - 1);
    return n;
  }

  /** Whether a comment not yet printed sits inside `n`. */
  flowComment(n: number): boolean {
    const c = this.comments[this.next];
    return c !== undefined && this.tree.ord(c) < this.tree.ord(this.lastLeaf(n));
  }

  /**
   * A flow pair at column `col` (its own indent): `key: value` on one line when the whole fits or key and value
   * are scalars; else a flow key too wide for `key:` breaks after `? `, two columns in, with `: value` on the line
   * after it; else a collection value moves to the next line, one tabWidth in, and lays out from there.
   */
  pairLayout(pair: number, seq: boolean, col: number, trail: number): string[] {
    const { key, keyNode, value } = this.pairParts(pair, seq);
    const flat = this.flatItem(pair, seq);
    if (this.flowComment(pair)) return this.commentedPair(pair, key, keyNode, value, col, trail);
    if (col + textWidth(flat) + trail <= this.width) return [flat];
    const flowKey = keyNode !== undefined && this.flowCollection(keyNode) !== undefined;
    if (flowKey && value !== undefined && col + textWidth(key as string) + 1 > this.width) {
      const k = this.layout(keyNode, col + 2, col + 2, 0);
      const v = this.layout(value, col + 2, col + 2, trail);
      return [`? ${k[0]}`, ...k.slice(1), `${" ".repeat(col)}: ${v[0]}`, ...v.slice(1)];
    }
    if (value === undefined || this.flowCollection(value) === undefined) {
      if (flowKey) unsupported("a flow key past printWidth");
      return [flat];
    }
    if (key === undefined) return unsupported("a flow value past printWidth after an empty key");
    return [`${key}:`, ...this.moved(value, col + this.tab, trail)];
  }

  /**
   * A flow pair with comments between its key and value, at column `col`. `? key` written explicit with comments on
   * their own lines before `:` keeps its `?`, the comments and `: value` at `col`; any other prints `key:`, the first
   * comment trailing it when it trails in the source, and the rest and the value on lines one tabWidth in.
   */
  commentedPair(pair: number, key: string | undefined, keyNode: number | undefined, value: number | undefined, col: number, trail: number): string[] {
    if (key === undefined || keyNode === undefined || value === undefined) return unsupported("a comment in a flow pair with no key or value");
    if (this.flowComment(keyNode)) unsupported("a comment inside a flow key");
    const lines = [`${key}:`];
    const first = this.pending(this.start(value));
    // oxfmt keeps the pair on the key's line and lays out the value's items off its column, or drops the key.
    if (first === undefined) return unsupported("a comment inside a flow pair's collection value");
    let colon = NO_NODE;
    for (let i = 0; i < this.tree.count(pair); i++) if (this.kind(this.tree.child(pair, i)) === ":") colon = this.tree.child(pair, i);
    const explicit = this.kind(this.tree.child(pair, 0)) === "?";
    if (explicit && this.tree.lf(first) !== 0 && colon !== NO_NODE && this.tree.ord(first) < this.tree.ord(colon)) {
      if (this.flowCollection(keyNode) !== undefined || this.flowCollection(value) !== undefined) unsupported("a commented explicit flow pair of collections");
      const out = [`? ${key.trimEnd()}`];
      this.flowComments(out, this.tree.ord(colon), col, false);
      if (this.pending(this.start(value)) !== undefined) unsupported("a comment after an explicit flow pair's colon");
      out.push(`${" ".repeat(col)}: ${this.flat(value)}`);
      return out;
    }
    this.flowComments(lines, this.start(value), col + this.tab, true, false);
    if (this.flowComment(value)) unsupported("comments around and inside a flow value");
    return [...lines, ...this.moved(value, col + this.tab, trail)];
  }

  /** A collection value on the lines after its key, at `indent`. */
  moved(value: number, indent: number, trail: number): string[] {
    const c = this.flowCollection(value);
    if (c !== undefined && this.flowItems(c).length === 0) unsupported("an empty flow collection past printWidth");
    const ls = this.layout(value, indent, indent, trail);
    ls[0] = " ".repeat(indent) + ls[0];
    return ls;
  }

  /** Refuses a comment inside flow node `n`: prettier lays those out in ways this printer has no rule for. */
  noFlowComment(n: number): void {
    let last = n;
    while (this.tree.count(last) > 0) last = this.tree.child(last, this.tree.count(last) - 1);
    const c = this.comments[this.next];
    if (c !== undefined && this.tree.ord(c) < this.tree.ord(last)) unsupported("a comment inside a flow collection");
  }

  /**
   * Appends flow node `n`'s lines, the first continuing the current line at its column, the rest at `indent`.
   * Comments between its properties and the collection move the collection to a line of its own at `indent`.
   */
  putFlow(n: number, indent: number): void {
    const { props, content } = this.properties(n);
    const bare = props !== "" && content !== undefined && this.pending(this.start(content)) !== undefined;
    if (bare) {
      this.propsComments(props, content, indent);
      this.line(" ".repeat(indent));
    }
    const [first, ...rest] = this.layout(n, textWidth(this.lines[this.lines.length - 1]!), indent, 0, bare);
    this.append(first as string);
    for (const l of rest) this.line(l);
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
        // A scalar's or directive's text is more than its leaves (a block scalar's content, a quoted scalar's
        // between its quotes, a directive's `%YAML`): its first leaf stands for the whole of it.
        const parent = this.tree.parent(leaf);
        const scalar = /(?:_scalar|_directive)$/.test(this.kind(parent));
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
    // At the root, comments after the properties print as after a collection's, the header on the line after them.
    const commented = props !== "" && this.pending(this.start(s)) !== undefined;
    if (commented && lead !== undefined) unsupported("a comment after a block scalar value's properties");
    const m = /^([|>])([+-]?)([1-9]?)([+-]?)$/.exec(this.tree.text(this.tree.child(s, 0)));
    if (m === null || (m[2] !== "" && m[4] !== "")) return unsupported("a block scalar header");
    const [, style, , explicit, ] = m;
    const chomp = m[2] || m[4];
    let header = `${style}${explicit}${chomp}`;
    if (commented) {
      this.line("");
      this.propsComments(props, s, 0);
    } else if (props !== "") header = `${props} ${header}`;
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
      // Ending the stream, prettier keeps a trailing line more indented than the content, spaces and all.
      if (this.lastDescendant(n) && paras.slice(paras.length - u).some((p) => p.length > 0))
        unsupported("a whitespace line past the content indent ending the stream");
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
   * Properties `props` on the current line and the comments between them and `content`: one trails them wherever
   * the source has it (`!!map⏎# c` prints `!!map # c`); more each take a line of their own at `indent`. Blank lines
   * among them drop.
   */
  propsComments(props: string, content: number, indent: number): void {
    const cs: number[] = [];
    let c: number | undefined;
    while ((c = this.pending(this.start(content))) !== undefined) {
      cs.push(c);
      this.next++;
    }
    this.append(props);
    if (cs.length === 1) this.append(` ${this.tree.text(cs[0]!)}`);
    else
      for (const k of cs) this.line(" ".repeat(indent) + this.tree.text(k));
  }

  /** A value collection's properties on the current line, and the comments after them (`propsComments`). */
  valueProps(props: string, coll: number, indent: number): void {
    if (props === "") return;
    this.append(" ");
    this.propsComments(props, coll, indent);
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
      this.marked(v, indent, until);
      return;
    }
    if (this.kind(item) !== "block_mapping_pair") unsupported(`a ${this.kind(item)}`);
    let key: number | undefined;
    let colon: number | undefined;
    let value: number | undefined;
    for (let i = 0; i < this.tree.count(item); i++) {
      const c = this.tree.child(item, i);
      if (this.tree.fieldName(c) === "key") key = c;
      else if (this.tree.fieldName(c) === "value") value = c;
      else if (this.kind(c) === ":") colon = c;
    }
    this.pair(item, key, colon, value, indent, until);
  }

  /** A node after a one-column marker (`-`, `?`, `:`) on the current line, its content two columns past it. */
  marked(v: number, indent: number, until: number): void {
    if (this.isBlockScalar(v)) this.blockScalar(v, indent + this.tab, " ");
    else if (this.kind(v) === "block_node") {
      // `- &a⏎  b: 1`: a collection with properties starts on the line after them.
      const { props, coll } = this.collection(v);
      this.valueProps(props, coll, indent + 2);
      this.block(coll, indent + 2, props === "", until);
    } else if (this.flowCollection(v) !== undefined) {
      this.append(" ");
      this.putFlow(v, indent + 2);
    } else {
      this.append(" ");
      this.fill(v, indent + 2);
    }
  }

  /**
   * Whether prettier counts node `n` as printed on one line for sure: an alias, or a plain or quoted scalar on one
   * source line under proseWrap `preserve`, else whose value has no line break (under `always`, no space either)
   * and no line ending in a backslash.
   */
  singleLine(n: number): boolean {
    if (this.kind(n) !== "flow_node") return false;
    const s = this.properties(n).content;
    if (s === undefined) return false;
    const k = this.kind(s);
    if (k === "alias") return true;
    if (k !== "plain_scalar" && k !== "double_quote_scalar" && k !== "single_quote_scalar") return false;
    const text = this.tree.text(s);
    if (this.prose === "preserve") return !text.includes("\n");
    if (/\\$/m.test(text)) return false;
    const value = fold(k === "plain_scalar" ? text : text.slice(1, -1));
    return this.prose === "never" ? !value.includes("\n") : !/[\n ]/.test(value);
  }

  /**
   * A block mapping pair as prettier prints it, written with `?` or not: `key:` for a key alone that is surely one
   * line, `? key` for any other key alone, `: value` with no key; `? key⏎: value` when the key is a block node, a
   * comment stands before it or between it and `:` (those print at the pair's indent, blank lines dropped), or it
   * is a flow collection too wide for `key:`; otherwise `key: value` as an implicit key prints.
   */
  pair(pair: number, key: number | undefined, colon: number | undefined, value: number | undefined, indent: number, until: number): void {
    const colonAt = colon === undefined ? until : this.tree.ord(colon);
    if (key === undefined) {
      if (this.pending(colonAt) !== undefined) unsupported("a comment in a pair with no key");
      this.append(":");
      if (value === undefined) return;
      if (this.pending(this.start(value)) !== undefined) unsupported("a comment before a value with no key");
      this.marked(value, indent, until);
      return;
    }
    if (this.flowCollection(key) !== undefined) this.noFlowComment(key);
    const lead = this.pending(this.start(key));
    if (lead !== undefined) {
      const second = this.comments[this.next + 1];
      if (this.tree.lf(lead) !== 0 || (second !== undefined && this.tree.ord(second) < this.start(key)))
        unsupported("comments before an explicit key");
      if (this.kind(key) !== "flow_node" || this.flowCollection(key) !== undefined || value === undefined)
        unsupported("a comment before an explicit key that is no scalar");
    }
    // The comments after the key and before `:` (before the next item for a pair with no `:`).
    const after: number[] = [];
    for (let i = this.next; i < this.comments.length; i++) {
      const c = this.comments[i]!;
      if (this.tree.ord(c) >= colonAt) break;
      if (this.tree.ord(c) > this.tree.ord(key)) after.push(c);
    }
    const trail = after[0] !== undefined && this.tree.lf(after[0]) === 0 ? after[0] : undefined;
    // `? k⏎: # c⏎  v` prints `k:⏎  # c⏎  v`, where `k: # c⏎  v` keeps the comment on the key's line.
    if (value !== undefined && colon !== undefined && this.kind(this.tree.child(pair, 0)) === "?") {
      const c = this.comments.slice(this.next).find((k) => this.tree.ord(k) > colonAt);
      if (c !== undefined && this.tree.ord(c) < this.start(value))
        unsupported("a comment after an explicit pair's colon");
    }
    if (value === undefined) {
      if (colon !== undefined && after.length > 0) unsupported("a comment before the `:` of an empty value");
      // A `!!set` keeps its keys explicit.
      const holder = this.tree.parent(this.tree.parent(pair));
      const set = this.named(holder).some((k) => this.kind(k) === "tag" && this.tree.text(k) === "!!set");
      if (lead === undefined && trail === undefined && !set && this.singleLine(key)) return this.implicitPair(key, undefined, indent, until);
      this.append("?");
      this.marked(key, indent, colonAt);
      return;
    }
    if (trail !== undefined) unsupported("a trailing comment on an explicit key with a value");
    const flowKey = this.flowCollection(key) !== undefined;
    // prettier's `? ` group breaks when the flat key and its colon pass printWidth.
    const alias = this.named(key).some((k) => this.kind(k) === "alias") ? 1 : 0;
    // A key prettier cannot be sure prints on one line goes explicit when its flat text and colon do not fit.
    const surely = this.kind(key) !== "flow_node" || (!flowKey && this.singleLine(key));
    const keyFlat = surely ? "" : flowKey ? this.flat(key) : this.flatScalar(key);
    const wide = !surely && (keyFlat === undefined || textWidth(this.lines[this.lines.length - 1]!) + textWidth(keyFlat) + alias + 1 > this.width);
    if (this.kind(key) === "flow_node" && lead === undefined && after.length === 0 && !wide)
      return this.implicitPair(key, value, indent, until);
    this.append("?");
    if (lead !== undefined) {
      this.trailing(lead);
      this.line(" ".repeat(indent + 2) + this.scalar(key));
    } else this.marked(key, indent, colonAt);
    while (this.pending(colonAt) !== undefined) this.ownLine(this.comments[this.next]!, indent, false);
    this.line(`${" ".repeat(indent)}:`);
    if (this.pending(this.start(value)) !== undefined) unsupported("a comment before an explicit pair's value");
    this.marked(value, indent, until);
  }

  /** A pair whose key prints implicit (`key: value`), its first line already started at `indent`. */
  implicitPair(key: number, value: number | undefined, indent: number, until: number): void {
    // An alias key keeps a space before the colon, which would otherwise read as part of its name.
    const flowKey = this.flowCollection(key) !== undefined;
    if (flowKey) this.noFlowComment(key);
    const keyText = flowKey ? this.flat(key) : (this.flatScalar(key) ?? unsupported("a multi-line implicit key"));
    this.append(this.named(key).some((k) => this.kind(k) === "alias") ? `${keyText} :` : `${keyText}:`);
    const keyLine = this.lines.length - 1;
    if (value === undefined) return;
    if (this.flowCollection(value) !== undefined) {
      if (this.pending(this.start(value)) !== undefined) unsupported("a comment before a flow value");
      // A comment breaks the collection, which then opens on the key's line with its items two tabWidths in.
      if (this.flowComment(value)) {
        this.append(" ");
        this.putFlow(value, indent + this.tab);
        return;
      }
      // prettier's conditionalGroup: the pair on one line when it fits, else the value one tabWidth in below.
      const flat = ` ${this.flat(value)}`;
      if (textWidth(this.lines[keyLine]!) + textWidth(flat) <= this.width) this.append(flat);
      else for (const l of this.moved(value, indent + this.tab, 0)) this.line(l);
      return;
    }
    if (this.isBlockScalar(value)) return this.blockScalar(value, indent + this.tab, " ");
    if (this.kind(value) === "block_node") {
      const { props, coll } = this.collection(value);
      this.valueProps(props, coll, indent + this.tab);
      this.block(coll, indent + this.tab, false, until);
      return;
    }
    if (this.pending(this.start(value)) !== undefined) unsupported("a comment before a scalar value");
    // prettier prints `key: value` as is when both are surely one line and the key is one source line; else its
    // conditionalGroup keeps the pair on one line when it fits flat, or fills the value one tabWidth in below.
    if (this.singleLine(key) && this.singleLine(value) && !this.tree.text(key).includes("\n")) {
      this.append(" ");
      this.fill(value, indent + this.tab);
      return;
    }
    // A value of several paragraphs holds a hard line break, which breaks the group around it: prettier's fits
    // check then stops at its first word's line, so only that word has to fit beside the key.
    const { head, paras, tail } = this.scalarParts(value);
    const first = paras.length === 1 ? head + paras[0]!.join(" ") + tail : head + (paras[0]![0] ?? "");
    if (textWidth(this.lines[keyLine]!) + 1 + textWidth(first) <= this.width) this.append(" ");
    else this.line(" ".repeat(indent + this.tab));
    this.fill(value, indent + this.tab);
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
          this.onMarkerLine(c);
          if (this.isBlockScalar(c)) {
            this.blockScalar(c, this.tab, undefined);
            break;
          }
          const { props, coll } = this.collection(c);
          const first = this.lines.length === 0 || this.afterMarker();
          if (props !== "") {
            this.line("");
            this.propsComments(props, coll, 0);
          }
          this.block(coll, 0, false, limit, first);
          break;
        }
        case "flow_node": {
          this.onMarkerLine(c);
          if (this.tree.lf(firstLeaf(this.tree, c)) >= 2 && this.lines.length > 0 && !this.afterMarker()) this.blank();
          if (this.flowCollection(c) !== undefined) {
            this.line("");
            this.putFlow(c, 0);
          } else {
            this.line("");
            // Comments after a root scalar's properties print as after a collection's, the scalar after them.
            const { props, content } = this.properties(c);
            const bare = props !== "" && content !== undefined && this.pending(this.start(content)) !== undefined;
            if (bare) {
              this.propsComments(props, content, 0);
              this.line("");
            }
            this.fill(c, 0, bare);
          }
          break;
        }
        default:
          unsupported(`a document ${k}`);
      }
    }
    if (last) this.loose(limit);
  }

  afterMarker = () => this.lines[this.lines.length - 1] === "---";

  /**
   * Root content on the line of what precedes it: after `---` (`--- a`, `--- |`, `--- !t`) it moves to a line of
   * its own, which printing it as a new line does; after anything else it refuses.
   */
  onMarkerLine(c: number): void {
    if (this.lines.length > 0 && this.tree.lf(firstLeaf(this.tree, c)) === 0 && !this.afterMarker())
      unsupported("content on the line of a non-marker");
  }

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
  const { singleQuote = false, proseWrap = "preserve", trailingComma = "all" } = options as {
    singleQuote?: boolean;
    proseWrap?: string;
    trailingComma?: string;
  };
  const p = new Printer(
    tree,
    options.tabWidth,
    singleQuote ? "'" : '"',
    proseWrap,
    options.printWidth,
    options.bracketSpacing,
    trailingComma !== "none",
  );
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
  if (proseWrap !== "preserve" && lines.some((l, i) => !p.verbatim.has(i) && !p.filled.has(i) && l.length > options.printWidth))
    unsupported("a line past printWidth under proseWrap");
  return lines.join("\n");
}
