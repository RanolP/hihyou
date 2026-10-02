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
  /**
   * The line count when a kept block scalar ended the stream's content: its kept line breaks end the file, so oxfmt
   * prints no final line break after a `...` or comment that follows it.
   */
  keptLast?: number;
  /** The line and indent of the last own-line comment printed. */
  ownComment?: { line: number; at: number };
  /** The `# prettier-ignore` comments, and those a block item was kept as written after. */
  readonly ignores = new Set<number>();
  readonly ignored = new Set<number>();
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
    this.ownComment = { line: this.lines.length - 1, at: indent };
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
      let at = prev !== undefined && this.tree.col(c) > col ? this.pastItem(prev, indent, c) : indent;
      // A comment right below another prints no deeper than it.
      if (this.ownComment?.line === this.lines.length - 1) at = Math.min(at, this.ownComment.at);
      this.ownLine(c, at, !first);
      first = false;
    }
    return first;
  }

  /**
   * The indent of comment `c`, deeper in the source than `item` of a collection at `indent`: past a scalar value one
   * level in (a sequence item's content two past the dash), past a mapping's block scalar at `indent`, and past a nested
   * collection in it, at its indent or deeper as the comment is deeper than its items.
   */
  pastItem(item: number, indent: number, c: number): number {
    const seq = this.kind(item) === "block_sequence_item";
    const v = this.nestedValue(item);
    if (v === undefined) return indent + (seq ? 2 : this.tab);
    // Past a sequence item's block scalar oxfmt prints the comment at the content's column, into the content.
    if (this.isBlockScalar(v)) return seq ? unsupported("a comment past a sequence item's block scalar") : indent;
    let inner = indent + 2;
    if (!seq) {
      // oxfmt's indent past an explicit pair's nested block differs from its print's under tabWidth other than 2.
      if (this.kind(this.tree.child(item, 0)) === "?" && this.tab !== 2) unsupported("a comment past an explicit pair's nested block");
      if (this.tree.fieldName(v) === "value") inner = indent + this.tab;
    }
    const items = this.named(this.collection(v).coll);
    const last = items[items.length - 1] as number;
    return this.tree.col(c) > this.tree.col(items[0] as number) ? this.pastItem(last, inner, c) : inner;
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
    if (s === undefined) return props === "" ? unsupported("an empty flow node") : props;
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
    // proseWrap other than "preserve" joins a one-paragraph scalar's lines.
    if (paras.length > 1 || (this.prose === "preserve" && this.tree.text(s).includes("\n")))
      return unsupported(`a multi-line ${this.kind(s).replace("_", " ")}`);
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
    if (s === undefined) return props === "" || bare ? unsupported("an empty flow node") : { head: props, paras: [[]], tail: "" };
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
    // Properties alone keep a space after them in a flow collection: `[!!str , a]`.
    if (c === undefined) return this.properties(n).content === undefined ? `${this.scalar(n)} ` : this.scalar(n);
    const { props } = this.properties(n);
    const seq = this.kind(c) === "flow_sequence";
    const items = this.flowItems(c).map(({ item }) => this.flatItem(item, seq));
    const pad = !seq && items.length > 0 && this.bracketSpacing ? " " : "";
    // A last item ending in a space (`: `, `!!str `) takes the closing pad's place.
    const end = items[items.length - 1]?.endsWith(" ") ? "" : pad;
    const text = seq ? `[${items.join(", ")}]` : `{${pad}${items.join(", ")}${end}}`;
    return props === "" || bare ? text : `${props} ${text}`;
  }

  /**
   * A flow pair's key text (alias keys keep a space before the colon) and node, and its value, any absent. A `?`
   * drops: prettier prints the pair as an implicit key would. A pair with no value prints its key alone in a
   * mapping (`{b, c: }` → `{ b, c }`), and as `? b` in a sequence.
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
    if (key === undefined) return { key: undefined, keyNode: undefined, value };
    if (value === undefined) return { key: (seq ? "? " : "") + this.flat(key), keyNode: key, value };
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
    const c = this.flowCollection(n);
    if (c === undefined && this.multiScalar(n)) return this.scalarLines(n, indent);
    // A multi-line scalar inside holds a hard line break, which breaks the collection and every one around it.
    const hard = c !== undefined && this.hasMultiScalar(c);
    const flat = hard ? "" : this.flat(n, bare);
    if (c === undefined || (!hard && !this.flowComment(n) && col + textWidth(flat) + trail <= this.width)) return [flat];
    const items = this.flowItems(c);
    if (items.length === 0) return unsupported("an empty flow collection past printWidth");
    // proseWrap other than "preserve" would fill a broken collection's multi-word scalars.
    if (this.prose !== "preserve" && (hard || /\s/.test(flat.replace(/[,:] /g, "")))) unsupported("a broken flow collection under proseWrap");
    const { props } = this.properties(n);
    const seq = this.kind(c) === "flow_sequence";
    const last = items[items.length - 1]!.item;
    const emptyLast = this.kind(last) === "flow_pair" && this.named(last).length === 0;
    if (hard ? emptyLast : /(?:^|, ): $/.test(flat.slice(1, -1))) unsupported("a broken flow collection ending in an empty pair");
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
      // An item after a `# prettier-ignore` printed on its own line keeps its source text, later lines and all.
      const ignore = trailed === false ? this.comments[this.next - 1] : undefined;
      const sub =
        ignore !== undefined && this.ignores.has(ignore) && !this.ignored.has(ignore)
          ? this.flowAsWritten(item, ignore)
          : this.kind(item) === "flow_node"
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

  /** Flow item `item` after own-line comment `ignore`, as the source writes it. */
  flowAsWritten(item: number, ignore: number): string[] {
    if (this.flowComment(item)) unsupported("a comment inside an ignored flow item");
    const text = this.tree.text(item);
    // print.ts trims every line it does not mark verbatim, and a flow item's lines carry no such mark.
    if (/[ \t]$/m.test(text)) unsupported("trailing whitespace in an ignored flow item");
    this.ignored.add(ignore);
    return text.split("\n");
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
    const multiKey = this.multiKey(pair, seq, col, trail);
    if (multiKey !== undefined) return multiKey;
    const { key, keyNode, value } = this.pairParts(pair, seq);
    const flat = this.flatItem(pair, seq);
    if (key === undefined && value !== undefined && this.flowCollection(value) !== undefined && this.pending(this.start(value)) === undefined) {
      if (!this.flowComment(value) && !this.hasMultiScalar(this.flowCollection(value) as number) && col + textWidth(flat) + trail <= this.width) return [flat];
      // oxfmt reads a broken flow mapping after an empty key as another pair, a layout with no rule here.
      if (this.kind(this.flowCollection(value) as number) === "flow_mapping") unsupported("a broken flow mapping after an empty key");
      // A broken sequence opens after `: `, its items two columns past the colon plus tabWidth.
      const v = this.layout(value, col + 2, col + 2, trail);
      return [`: ${v[0]}`, ...v.slice(1)];
    }
    if (this.flowComment(pair)) return this.commentedPair(pair, key, keyNode, value, col, trail);
    if (col + textWidth(flat) + trail <= this.width) return [flat];
    const flowKey = keyNode !== undefined && this.flowCollection(keyNode) !== undefined;
    if (flowKey && value !== undefined && col + textWidth(key as string) + 1 > this.width) {
      const k = this.layout(keyNode, col + 2, col + 2, 0);
      const v = this.layout(value, col + 2, col + 2, trail);
      return [`? ${k[0]}`, ...k.slice(1), `${" ".repeat(col)}: ${v[0]}`, ...v.slice(1)];
    }
    if (value === undefined && flowKey) {
      // A key alone lays out as an item would; in a sequence after `? `, its items two columns further in.
      if (!seq) return this.layout(keyNode, col, col, trail);
      const k = this.layout(keyNode, col + 2, col + 2, trail);
      return [`? ${k[0]}`, ...k.slice(1)];
    }
    if (value === undefined || this.flowCollection(value) === undefined) {
      if (flowKey) unsupported("a flow key past printWidth");
      return [flat];
    }
    if (key === undefined) return unsupported("a flow value past printWidth after an empty key");
    return [`${key}:`, ...this.moved(value, col + this.tab, trail)];
  }

  /**
   * A flow pair whose key is a multi-line scalar, at column `col`: `? ` before the key's lines, its later lines two
   * columns in, and `: value` on the line after them; with no value, a mapping's key prints as an item would, a
   * sequence's after `? `. Undefined for a pair whose key is one line.
   */
  multiKey(pair: number, seq: boolean, col: number, trail: number): string[] | undefined {
    let key: number | undefined;
    let value: number | undefined;
    for (let i = 0; i < this.tree.count(pair); i++) {
      const k = this.tree.child(pair, i);
      if (this.tree.fieldName(k) === "key") key = k;
      else if (this.tree.fieldName(k) === "value") value = k;
    }
    if (key === undefined || !this.multiScalar(key)) return undefined;
    if (this.flowComment(pair)) unsupported("a comment in a flow pair with a multi-line key");
    if (value === undefined && !seq) return this.scalarLines(key, col);
    const k = this.scalarLines(key, col + 2);
    if (value === undefined) return [`? ${k[0]}`, ...k.slice(1)];
    // oxfmt keeps a collection with a multi-line value flat, a layout with no rule here.
    const v = this.layout(value, col + 2, col + 2, trail);
    if (v.length > 1 || this.flowCollection(value) !== undefined) unsupported("a collection value after a multi-line flow key");
    return [`? ${k[0]}`, ...k.slice(1), `${" ".repeat(col)}: ${v[0]}`];
  }

  /** Whether flow node `n` is a plain or quoted scalar printing over more than one line: proseWrap other than "preserve" joins a one-paragraph one. */
  multiScalar(n: number): boolean {
    if (this.kind(n) !== "flow_node") return false;
    const s = this.properties(n).content;
    if (s === undefined || !/^(?:plain|single_quote|double_quote)_scalar$/.test(this.kind(s)) || !this.tree.text(s).includes("\n")) return false;
    return this.prose === "preserve" || this.parts(s).paras.length > 1;
  }

  /** Whether flow collection `c` holds a multi-line scalar, at any depth. */
  hasMultiScalar(c: number): boolean {
    for (let i = 0; i < this.tree.count(c); i++) {
      const k = this.tree.child(c, i);
      if (this.multiScalar(k)) return true;
      if (this.tree.count(k) > 0 && this.hasMultiScalar(k)) return true;
    }
    return false;
  }

  /**
   * A multi-line scalar flow node's lines under proseWrap preserve, one per source line, the later ones at `indent`
   * (a blank one empty). The first carries no indent: it continues the current line.
   */
  scalarLines(n: number, indent: number): string[] {
    if (this.prose !== "preserve") unsupported("a multi-line flow scalar under proseWrap");
    const { head, paras, tail } = this.scalarParts(n);
    const lines = paras.map((p) => p.join(" "));
    lines[0] = head + lines[0];
    lines[lines.length - 1] += tail;
    return lines.map((l, i) => (i === 0 || l === "" ? l : " ".repeat(indent) + l));
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
      const deep = paras.findLastIndex((p, f) => f >= paras.length - u && p.length > 0);
      if (this.lastDescendant(n) && deep >= 0) paras = paras.slice(0, deep + 1);
      else if (u > 0) paras = u >= 2 && !this.lastDescendant(n) ? paras.slice(0, -(u - 1)) : paras.slice(0, -u);
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
      const ignore = this.ignoring(item);
      if (ignore !== undefined) this.asWritten(item, ignore);
      else this.item(item, indent, after === undefined ? limit : this.start(after));
      prev = item;
    }
    // The comments after the last item that are no shallower than the items stay in this collection.
    let c: number | undefined;
    while ((c = this.pending(limit)) !== undefined) {
      if (this.tree.lf(c) !== 0 && this.tree.col(c) < col) break;
      this.between(this.tree.ord(c) + 1, prev, col, indent, false);
    }
  }

  /**
   * The own-line `# prettier-ignore` printed last, when nothing but comments stands between it and `item`. One
   * before a `---` or a key belongs to that, and refuses at the end as unused.
   */
  ignoring(item: number): number | undefined {
    const c = this.comments[this.next - 1];
    if (c === undefined || !this.ignores.has(c) || this.ignored.has(c)) return undefined;
    // A trailing one belongs to its line; only the stream's first line has no line break before it.
    if (this.tree.lf(c) === 0 && c !== this.comments[0]) return undefined;
    if (this.tree.lf(c) === 0)
      for (let o = 0; o < this.tree.ord(c); o++)
        if (this.tree.count(this.tree.at(o)) === 0) return undefined;
    for (let o = this.tree.ord(c) + 1; o < this.start(item); o++) {
      const n = this.tree.at(o);
      if (this.tree.count(n) === 0 && this.kind(n) !== "comment") return undefined;
    }
    return c;
  }

  /**
   * A block item after an own-line `# prettier-ignore`, as the source writes it from its first token to its last:
   * its later lines keep their source indent, and the comments inside it are part of it.
   */
  asWritten(item: number, ignore: number): void {
    for (let o = this.start(item); o < this.tree.ord(item); o++)
      if (this.kind(this.tree.at(o)) === "block_scalar") unsupported("a block scalar in an ignored item");
    // A stream's last node spans the line breaks after it.
    const [head, ...rest] = this.tree.text(item).replace(/(?:\r?\n[ \t]*)+$/, "").split("\n");
    this.verbatim.add(this.lines.length - 1);
    this.append(head!);
    for (const l of rest) {
      this.verbatim.add(this.lines.length);
      this.lines.push(l);
    }
    const end = this.tree.ord(this.lastLeaf(item));
    for (; this.next < this.comments.length && this.tree.ord(this.comments[this.next]!) < end; this.next++)
      if (this.ignores.has(this.comments[this.next]!)) this.ignored.add(this.comments[this.next]!);
    this.ignored.add(ignore);
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
    } else if (this.pending(this.start(v)) !== undefined) {
      // One comment before a sequence item's scalar moves onto the dash's line, the scalar below it. oxfmt prints
      // several after a `- ` with a trailing space, and those after `?` or `:` no rule here covers.
      const c = this.pending(this.start(v)) as number;
      this.next++;
      if (!this.lines[this.lines.length - 1]!.endsWith("-") || this.pending(this.start(v)) !== undefined)
        unsupported("comments before a marked scalar");
      if (this.tree.lf(c) >= 2 || this.tree.lf(firstLeaf(this.tree, v)) >= 2) unsupported("a blank line around a comment before a sequence item's scalar");
      this.append(` ${this.tree.text(c)}`);
      this.line(" ".repeat(indent + 2));
      this.fill(v, indent + 2);
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
    // A block collection key moves one comment before it onto the `?` line, wherever the source has it.
    const blockKey = this.kind(key) === "block_node" && !this.isBlockScalar(key);
    if (lead !== undefined) {
      const second = this.comments[this.next + 1];
      if ((this.tree.lf(lead) !== 0 && !blockKey) || (second !== undefined && this.tree.ord(second) < this.start(key)))
        unsupported("comments before an explicit key");
      if (!blockKey && (this.kind(key) !== "flow_node" || this.flowCollection(key) !== undefined || value === undefined))
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
    let colonComment = false;
    if (value !== undefined && colon !== undefined && this.kind(this.tree.child(pair, 0)) === "?") {
      const c = this.comments.slice(this.next).find((k) => this.tree.ord(k) > colonAt);
      if (c !== undefined && this.tree.ord(c) < this.start(value)) {
        // oxfmt moves an own-line one onto the `:` line of a pair it keeps explicit, a layout with no rule here.
        if (this.tree.lf(c) !== 0) unsupported("an own-line comment after an explicit pair's colon");
        colonComment = true;
      }
    }
    if (value === undefined) {
      if (colon !== undefined && after.length > 0) unsupported("a comment before the `:` of an empty value");
      // A `!!set` keeps its keys explicit.
      const holder = this.tree.parent(this.tree.parent(pair));
      const set = this.named(holder).some((k) => this.kind(k) === "tag" && this.tree.text(k) === "!!set");
      if (lead === undefined && trail === undefined && !set && this.singleLine(key)) return this.implicitPair(key, undefined, indent, until);
      this.append("?");
      if (lead !== undefined) this.commentedKey(key, lead, indent, colonAt);
      else this.marked(key, indent, colonAt);
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
    if (this.kind(key) === "flow_node" && lead === undefined && after.length === 0 && !wide) {
      if (colonComment) return this.colonComments(key, value, indent, until);
      return this.implicitPair(key, value, indent, until);
    }
    const valueBlock = this.kind(value) === "block_node" && !this.isBlockScalar(value);
    if (colonComment && !valueBlock) unsupported("a comment after the colon of a pair kept explicit");
    this.append("?");
    if (lead !== undefined) this.commentedKey(key, lead, indent, colonAt);
    else this.marked(key, indent, colonAt);
    // Comments indented past the `?` stay with the key, two columns in, up to the first one that is not.
    let keyed = true;
    while (this.pending(colonAt) !== undefined) {
      const c = this.comments[this.next]!;
      keyed &&= this.tree.col(c) > this.tree.col(pair);
      this.ownLine(c, keyed ? indent + 2 : indent, false);
    }
    this.line(`${" ".repeat(indent)}:`);
    if (colonComment) {
      // `: # c` with the collection on the lines after it, two columns in.
      const c = this.pending(this.start(value)) as number;
      this.trailing(c);
      if (this.pending(this.start(value)) !== undefined) unsupported("comments after an explicit pair's colon");
      this.belowMarker(value, indent, until);
      return;
    }
    if (this.pending(this.start(value)) !== undefined) unsupported("a comment before an explicit pair's value");
    this.marked(value, indent, until);
  }

  /** `?` and comment `lead` on the current line, then `key` below them two columns in. */
  commentedKey(key: number, lead: number, indent: number, colonAt: number): void {
    this.trailing(lead);
    if (this.kind(key) === "block_node") this.belowMarker(key, indent, colonAt);
    else this.line(" ".repeat(indent + 2) + this.scalar(key));
  }

  /** Block collection node `n` on the lines after a `?` or `:` line, two columns past the marker at `indent`. */
  belowMarker(n: number, indent: number, until: number): void {
    const { props, coll } = this.collection(n);
    if (props !== "") unsupported("properties on a collection below a commented marker");
    this.line(" ".repeat(indent + 2));
    this.block(coll, indent + 2, true, until);
  }

  /**
   * An explicit pair printed implicit whose `:` a comment trails: `key:`, then the comments and the value each on
   * a line of their own one tabWidth in.
   */
  colonComments(key: number, value: number, indent: number, until: number): void {
    this.implicitPair(key, undefined, indent, until);
    const pad = " ".repeat(indent + this.tab);
    let c: number | undefined;
    let first = true;
    while ((c = this.pending(this.start(value))) !== undefined) {
      if (!first && this.tree.lf(c) >= 2) unsupported("a blank line between comments after an explicit pair's colon");
      this.line(pad + this.tree.text(c));
      this.next++;
      first = false;
    }
    if (this.tree.lf(firstLeaf(this.tree, value)) >= 2) unsupported("a blank line before a value after a colon comment");
    this.line(pad);
    if (this.isBlockScalar(value)) unsupported("a block scalar after an explicit pair's colon comment");
    else if (this.kind(value) === "block_node") {
      const { props, coll } = this.collection(value);
      if (props !== "") unsupported("properties after an explicit pair's colon comment");
      this.block(coll, indent + this.tab, true, until);
    } else if (this.flowCollection(value) !== undefined) this.putFlow(value, indent + this.tab);
    else this.fill(value, indent + this.tab);
  }

  /**
   * The comments before a scalar or flow value: one on the key's line trails it, the rest go on lines of their own at
   * `indent`, and the value's line starts below them, after a blank line only where the source has one after an
   * own-line comment.
   */
  valueComments(value: number, indent: number): void {
    let c: number | undefined;
    let own = false;
    while ((c = this.pending(this.start(value))) !== undefined) {
      if (own && this.tree.lf(c) >= 2) unsupported("a blank line between comments before a value");
      own = this.tree.lf(c) > 0;
      if (own) this.line(" ".repeat(indent) + this.tree.text(c));
      else this.append(` ${this.tree.text(c)}`);
      this.next++;
    }
    const { content } = this.properties(value);
    if (content !== undefined && this.pending(this.start(content)) !== undefined) unsupported("comments before and after a value's properties");
    if (own && this.tree.lf(firstLeaf(this.tree, value)) >= 2) this.blank();
    this.line(" ".repeat(indent));
  }

  /** A pair whose key prints implicit (`key: value`), its first line already started at `indent`. */
  implicitPair(key: number, value: number | undefined, indent: number, until: number): void {
    // An alias key keeps a space before the colon, which would otherwise read as part of its name.
    const flowKey = this.flowCollection(key) !== undefined;
    if (flowKey) this.noFlowComment(key);
    const keyText = flowKey ? this.flat(key) : (this.flatScalar(key) ?? unsupported("a multi-line implicit key"));
    const spaced = this.named(key).some((k) => this.kind(k) === "alias") || (!flowKey && this.properties(key).content === undefined);
    this.append(spaced ? `${keyText} :` : `${keyText}:`);
    const keyLine = this.lines.length - 1;
    if (value === undefined) return;
    if (this.flowCollection(value) !== undefined) {
      if (this.pending(this.start(value)) !== undefined) {
        this.valueComments(value, indent + this.tab);
        // An own-line `# prettier-ignore` keeps the collection as written; one trailing the key's line ignores nothing.
        const ignore = this.ignoring(value);
        if (ignore !== undefined) this.asWritten(value, ignore);
        else this.putFlow(value, indent + this.tab);
        return;
      }
      // A comment or multi-line scalar breaks the collection, which then opens on the key's line with its items two
      // tabWidths in.
      const c = this.flowCollection(value) as number;
      if (this.flowComment(value) || this.hasMultiScalar(c)) {
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
    if (this.pending(this.start(value)) !== undefined) {
      this.valueComments(value, indent + this.tab);
      this.fill(value, indent + this.tab);
      return;
    }
    // Comments after a scalar value's properties end the key's line, the scalar one tabWidth in below them.
    const { props, content } = this.properties(value);
    if (props !== "" && content !== undefined && this.pending(this.start(content)) !== undefined) {
      this.append(" ");
      this.propsComments(props, content, indent + this.tab);
      this.line(" ".repeat(indent + this.tab));
      this.fill(value, indent + this.tab, true);
      return;
    }
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
    // Comments after a `...` belong past it, not to the collection before it.
    let end = limit;
    for (let i = 0; i < this.tree.count(doc); i++)
      if (this.kind(this.tree.child(doc, i)) === "...") end = this.start(this.tree.child(doc, i));
    let directive = false;
    // An own-line `# prettier-ignore` right before `---` keeps the document's content as written.
    let ignore: number | undefined;
    for (let i = 0; i < this.tree.count(doc); i++) {
      const c = this.tree.child(doc, i);
      const k = this.kind(c);
      const comment = this.pending(this.start(c));
      if (comment !== undefined) {
        if (directive && this.tree.lf(comment) >= 2) unsupported("a blank line between a directive and a comment");
        this.loose(this.start(c));
      }
      // oxfmt drops the blank lines after a directive.
      const blank = this.tree.lf(c) >= 2 && this.lines.length > 0 && !(directive && comment === undefined);
      if (k !== "comment") directive = k.endsWith("_directive");
      switch (k) {
        case "comment":
          break;
        case "yaml_directive":
        case "tag_directive":
        case "reserved_directive":
          if (blank && !this.scalarEnd) this.blank();
          // oxfmt separates a directive's name and parameters by one space.
          this.line(this.tree.text(c).trim().split(/[ \t]+/).join(" "));
          break;
        case "---":
        case "...":
          // After a block scalar its chomping alone decides the blank line before a marker.
          if (blank && !this.scalarEnd) this.blank();
          this.line(this.tree.text(c));
          if (k === "---") ignore = this.ignoring(c);
          break;
        case "block_node": {
          if (this.tree.lf(firstLeaf(this.tree, c)) >= 2 && this.lines.length > 0 && !this.afterMarker()) this.blank();
          this.onMarkerLine(c);
          if (ignore !== undefined) {
            this.ignoredContent(c, ignore);
            break;
          }
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
          this.block(coll, 0, false, end, first);
          break;
        }
        case "flow_node": {
          this.onMarkerLine(c);
          if (this.tree.lf(firstLeaf(this.tree, c)) >= 2 && this.lines.length > 0 && !this.afterMarker()) this.blank();
          if (ignore !== undefined) {
            this.ignoredContent(c, ignore);
            break;
          }
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

  /** A document's content `c` after an ignored `---`, as written on the lines after the marker. */
  ignoredContent(c: number, ignore: number): void {
    this.line("");
    this.asWritten(c, ignore);
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

  /** Comments outside every collection, at column 0 however indented, or trailing their line. */
  loose(before: number): void {
    let c: number | undefined;
    while ((c = this.pending(before)) !== undefined) {
      if (this.tree.lf(c) === 0 && this.lines.length > 0) this.trailing(c);
      else this.ownLine(c, 0, this.lines.length > 0 && !this.afterMarker());
    }
  }
}

/** The stream `root` as printed, without its final line break, and whether oxfmt prints one after it. */
export function printYaml(tree: FormatTree, root: number, options: PrettierOptions): { text: string; final: boolean } {
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
    if (/^#\s*prettier-ignore\b/.test(tree.text(n))) p.ignores.add(n);
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
  if (p.ignored.size < p.ignores.size) unsupported("a prettier-ignore comment before no block item");
  const lines = p.lines.map((l, i) => (p.verbatim.has(i) ? l : l.trimEnd()));
  // proseWrap other than "preserve" refolds plain scalars and turns a long key explicit (`? key`).
  if (proseWrap !== "preserve" && lines.some((l, i) => !p.verbatim.has(i) && !p.filled.has(i) && l.length > options.printWidth))
    unsupported("a line past printWidth under proseWrap");
  return { text: lines.join("\n"), final: p.keptLast === undefined || p.lines.length === p.keptLast };
}
