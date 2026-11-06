// Markdown as one tree. tree-sitter-markdown splits the language in two grammars: the block structure, whose
// paragraphs, heading text and table cells are opaque `inline` nodes, and the inline grammar an editor injects
// into each. The diff needs one tree, so `parse` reads the blocks, parses each inline span with the second
// grammar, and builds a tree of both: the inline grammar's kinds are numbered after the block grammar's.
//
// Plain words have no node in either grammar, so a changed word would mark its whole paragraph. The text no
// node covers inside an inline span or a code block becomes one `text` leaf per word or punctuation mark.

import { FIXED, MISSING, NAMED, type Tree, TreeBuilder } from "../../core/arena.js";
import { type Language, loadLanguage, parseTree } from "../../core/index.js";
import { FLAG_NAMED, FLAG_VISIBLE, SYM_ERROR_REPEAT } from "../../core/language.js";
import { language as inline } from "../markdown-inline/index.js";
import { grammar, keywordLex, lex, tables } from "./bundle.js";
import { createScanner } from "./scanner.js";

const block = loadLanguage(tables, lex, keywordLex, createScanner);

/** The inline grammar's kind `k` is kind `INLINE + k` in the joined tree. */
const INLINE = block.symbolNames.length;
const TEXT = INLINE + inline.symbolNames.length;

/** The block nodes whose text is inline markdown, parsed with the inline grammar. */
const INLINE_SPANS = new Set(["inline", "pipe_table_cell"]);
/** The block nodes whose uncovered text is split into words. */
const WORD_SPANS = new Set([
  "code_fence_content",
  "indented_code_block",
  "html_block",
  "minus_metadata",
  "plus_metadata",
]);

/** The inline nodes that stay one leaf whatever the inline grammar parsed inside them. */
const INLINE_ATOMS = new Set(["link_destination", "uri_autolink", "email_autolink", "html_tag"]);

/** The inline nodes of plain text, split into words even when the inline grammar parsed nothing inside them. */
const INLINE_TEXT = new Set(["link_text", "image_description", "link_title", "link_label"]);

/** A word, or one mark of anything else that is not whitespace. */
const WORD = /[\p{L}\p{M}\p{N}_]+|\S/gu;

function joined(kind: number, offset: number): number {
  return kind >= SYM_ERROR_REPEAT ? kind : kind + offset;
}

function flagsOf(tree: Tree, n: number): number {
  return (
    (tree.named(n) ? NAMED : 0) | (tree.missing(n) ? MISSING | FIXED : 0)
  );
}

function parse(text: string): Tree {
  const blocks = parseTree(block, text);
  const b = new TreeBuilder(language, text);
  let errorChars = blocks.errorChars;

  /** Emits a `text` leaf per word in `[from, to)`, and the block leaves `keep` holds that start in it, in order. */
  const words = (from: number, to: number, keep: number[], k: { i: number }) => {
    let at = from;
    for (;;) {
      while (k.i < keep.length && blocks.start(keep[k.i] as number) < at) k.i++;
      // A prefix inside an inline node (emphasis over two lines) is dropped with the node's text.
      const next = k.i < keep.length ? (keep[k.i] as number) : -1;
      const stop =
        next !== -1 && blocks.start(next) < to && blocks.end(next) <= to
          ? blocks.start(next)
          : to;
      WORD.lastIndex = at;
      for (let m = WORD.exec(text); m !== null && m.index < stop; m = WORD.exec(text)) {
        const end = Math.min(m.index + m[0].length, stop);
        b.leaf(TEXT, 0, NAMED, m.index, end);
        WORD.lastIndex = end;
      }
      if (stop === to) return;
      b.leaf(blocks.kind(next), blocks.field(next), flagsOf(blocks, next), blocks.start(next), blocks.end(next));
      at = blocks.end(next);
      k.i++;
    }
  };

  /** Emits inline node `n` of `tree`, parsed from a span starting at `base`, filling its gaps with words. */
  const inlineNode = (tree: Tree, n: number, base: number, field: number, keep: number[], k: { i: number }) => {
    const start = base + tree.start(n);
    const end = base + tree.end(n);
    const count = tree.count(n);
    const kind = joined(tree.kind(n), INLINE);
    // A URL reads as one unit: the inline grammar splits it at every `/` and `:`.
    if (
      (count === 0 && !INLINE_TEXT.has(tree.kindName(n))) ||
      INLINE_ATOMS.has(tree.kindName(n))
    ) {
      b.leaf(kind, field, flagsOf(tree, n), start, end);
      return;
    }
    const mark = b.mark();
    let at = start;
    for (let i = 0; i < count; i++) {
      const c = tree.child(n, i);
      words(at, base + tree.start(c), keep, k);
      inlineNode(tree, c, base, 0, keep, k);
      at = Math.max(at, base + tree.end(c));
    }
    words(at, end, keep, k);
    b.inner(kind, field, flagsOf(tree, n), start, end, mark);
  };

  const blockNode = (n: number) => {
    const name = blocks.kindName(n);
    const start = blocks.start(n);
    const end = blocks.end(n);
    const count = blocks.count(n);
    const kids: number[] = [];
    for (let i = 0; i < count; i++) kids.push(blocks.child(n, i));
    // In a span of text the block grammar's anonymous tokens are its scan of the characters (`*`, `[`), which
    // the inline grammar or the words replace; its named ones are the line prefixes, kept.
    const prefixes = kids.filter((c) => blocks.named(c));
    if (INLINE_SPANS.has(name) && blocks.named(n)) {
      // The inline grammar reads the span with its block prefixes (`> `, list indentation) blanked out, as an
      // injection's ranges leave them out; the prefixes stay leaves of the span.
      let span = text.slice(start, end);
      for (const c of prefixes)
        span =
          span.slice(0, blocks.start(c) - start) +
          " ".repeat(blocks.end(c) - blocks.start(c)) +
          span.slice(blocks.end(c) - start);
      const inner = parseTree(inline, span);
      errorChars += inner.errorChars;
      const mark = b.mark();
      const k = { i: 0 };
      let at = start;
      const root = inner.root;
      for (let i = 0; i < inner.count(root); i++) {
        const c = inner.child(root, i);
        words(at, start + inner.start(c), prefixes, k);
        inlineNode(inner, c, start, 0, prefixes, k);
        at = Math.max(at, start + inner.end(c));
      }
      words(at, end, prefixes, k);
      b.inner(blocks.kind(n), blocks.field(n), flagsOf(blocks, n), start, end, mark);
      return;
    }
    if (WORD_SPANS.has(name)) {
      const mark = b.mark();
      words(start, end, prefixes, { i: 0 });
      b.inner(blocks.kind(n), blocks.field(n), flagsOf(blocks, n), start, end, mark);
      return;
    }
    if (count === 0) {
      b.leaf(blocks.kind(n), blocks.field(n), flagsOf(blocks, n), start, end);
      return;
    }
    const mark = b.mark();
    for (const c of kids) blockNode(c);
    b.inner(blocks.kind(n), blocks.field(n), flagsOf(blocks, n), start, end, mark);
  };

  blockNode(blocks.root);
  return b.finish(errorChars);
}

const symbolFlags = new Uint8Array(TEXT + 1);
symbolFlags.set(block.symbolFlags);
symbolFlags.set(inline.symbolFlags, INLINE);
symbolFlags[TEXT] = FLAG_VISIBLE | FLAG_NAMED;

export const language: Language = {
  ...block,
  symbolNames: [...block.symbolNames, ...inline.symbolNames, "text"],
  symbolFlags,
  parse,
};
export { grammar };
