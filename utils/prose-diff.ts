/**
 * Tracked-changes diff over rendered prose, pure logic.
 *
 * Input: block-level segments (tag + plain text + rendered html) of the old
 * and new documents. Unchanged blocks keep their rendered html; changed
 * blocks are rebuilt from a word-level diff with <ins>/<del> marks.
 */

import { diffArrays, diffWords } from 'diff';

export interface BlockSeg {
  tag: string;
  text: string;
  html: string;
}

export interface ProseBlock {
  kind: 'same' | 'changed' | 'added' | 'removed';
  html: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function wordDiffHtml(tag: string, oldText: string, newText: string): string {
  const parts = diffWords(oldText, newText);
  const body = parts
    .map((p) =>
      p.added
        ? `<ins>${escapeHtml(p.value)}</ins>`
        : p.removed
          ? `<del>${escapeHtml(p.value)}</del>`
          : escapeHtml(p.value),
    )
    .join('');
  return `<${tag}>${body}</${tag}>`;
}

/** Whole block rendered as inserted/deleted prose. */
function markedBlock(tag: string, text: string, mark: 'ins' | 'del'): string {
  return `<${tag}><${mark}>${escapeHtml(text)}</${mark}></${tag}>`;
}

export function diffBlocks(
  oldBlocks: BlockSeg[],
  newBlocks: BlockSeg[],
): ProseBlock[] {
  const out: ProseBlock[] = [];
  const chunks = diffArrays(oldBlocks, newBlocks, {
    comparator: (a, b) => a.text === b.text && a.tag === b.tag,
  });
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const next = chunks[i + 1];
    if (!chunk.added && !chunk.removed) {
      for (const b of chunk.value) out.push({ kind: 'same', html: b.html });
      continue;
    }
    // A removed run followed by an added run = modified blocks: pair them
    // index-wise for word-level marks.
    if (chunk.removed && next?.added) {
      const removed = chunk.value;
      const added = next.value;
      const paired = Math.min(removed.length, added.length);
      for (let j = 0; j < paired; j++) {
        out.push({
          kind: 'changed',
          html: wordDiffHtml(added[j].tag, removed[j].text, added[j].text),
        });
      }
      for (let j = paired; j < removed.length; j++) {
        out.push({
          kind: 'removed',
          html: markedBlock(removed[j].tag, removed[j].text, 'del'),
        });
      }
      for (let j = paired; j < added.length; j++) {
        out.push({
          kind: 'added',
          html: markedBlock(added[j].tag, added[j].text, 'ins'),
        });
      }
      i++; // consumed the added run
      continue;
    }
    for (const b of chunk.value) {
      out.push(
        chunk.removed
          ? { kind: 'removed', html: markedBlock(b.tag, b.text, 'del') }
          : { kind: 'added', html: markedBlock(b.tag, b.text, 'ins') },
      );
    }
  }
  return out;
}
