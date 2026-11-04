import { parseTree, type Tree } from "syntechs/core";
import type { Anchor as FormatAnchor, Formatted } from "syntechs/fmt";
import { cacheKey } from "./cache.js";
import type { BlobId, EngineContext, Grammar } from "./host.js";

/**
 * One version of a file as the diff shows it: its display text (the blob's text, or the formatter's
 * output of it), and where each node of the ORIGINAL tree lands in that text. Matching and `AstSteps` always
 * run on the original tree; only lines and spans are read off the display text.
 */
export interface Version {
  text: string;
  /** Offset of each line's first character; one entry per line, none for an empty text. */
  lineStarts: number[];
  tree?: Tree;
  start(n: number): number;
  end(n: number): number;
}

/** The blob's bytes; an absent side (added or deleted file) reads as empty. */
export function readBlob(
  ctx: EngineContext,
  id: BlobId | null,
): Promise<Uint8Array> {
  if (id === null) return Promise.resolve(new Uint8Array());
  return ctx.cache.through(
    cacheKey.blob(id),
    () => ctx.host.readBlob(id),
    (bytes) => bytes.length,
  );
}

/** UTF-8 text, or undefined for content git would call binary (a NUL byte early on) or that is not UTF-8. */
export function decodeText(bytes: Uint8Array): string | undefined {
  if (bytes.subarray(0, 8000).includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

/** Arena words per node are about 6.3; four bytes each, plus the source string. */
const treeBytes = (tree: Tree, text: string) =>
  tree.nodeCount * 26 + text.length * 2;

export function parseBlob(
  ctx: EngineContext,
  id: BlobId | null,
  grammar: Grammar,
  text: string,
): Promise<Tree> {
  if (id === null) return Promise.resolve(parseTree(grammar.language, text));
  return ctx.cache.through(
    cacheKey.tree(id, grammar.id),
    () => parseTree(grammar.language, text),
    (tree) => treeBytes(tree, text),
  );
}

/** The formatter's output for the tree, or undefined when the grammar has none or it failed. */
export async function formatBlob(
  ctx: EngineContext,
  id: BlobId | null,
  grammar: Grammar,
  tree: Tree,
): Promise<(Formatted & { ok: true }) | undefined> {
  const formatter = grammar.format;
  if (!formatter) return undefined;
  const run = () => formatter.format(tree);
  const out =
    id === null
      ? run()
      : await ctx.cache.through(cacheKey.formatted(id, grammar.id), run, (f) =>
          f.ok ? f.text.length * 2 + f.anchors.length * 48 : 64,
        );
  return out.ok ? out : undefined;
}

export function lineStartsOf(text: string): number[] {
  if (text.length === 0) return [];
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    if (i + 1 < text.length) starts.push(i + 1);
  return starts;
}

/** 0-based line holding `offset`. */
export function lineOf(v: Version, offset: number): number {
  const starts = v.lineStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Offset just past line `line`, its newline included. */
export function lineEnd(v: Version, line: number): number {
  return v.lineStarts[line + 1] ?? v.text.length;
}

export function plainVersion(text: string, tree?: Tree): Version {
  return {
    text,
    lineStarts: lineStartsOf(text),
    ...(tree && { tree }),
    start: (n) => tree?.start(n) ?? 0,
    end: (n) => tree?.end(n) ?? 0,
  };
}

/**
 * The formatted text, with each original node placed over the output of its tokens. A token the
 * formatter dropped (a redundant parenthesis) sits, zero-width, where the output had reached.
 */
export function formattedVersion(
  tree: Tree,
  text: string,
  anchors: readonly FormatAnchor[],
): Version {
  const at = new Map<number, FormatAnchor>();
  for (const a of anchors) if (!a.synthetic) at.set(a.from[0], a);
  const starts = new Float64Array(tree.nodeCount);
  const ends = new Float64Array(tree.nodeCount);
  let reached = 0;
  // Postorder visits every leaf in source order, and every child before its parent.
  for (let ord = 0; ord < tree.nodeCount; ord++) {
    const n = tree.at(ord);
    const count = tree.count(n);
    if (count === 0) {
      const a = tree.end(n) > tree.start(n) ? at.get(tree.start(n)) : undefined;
      starts[ord] = a ? a.to[0] : reached;
      ends[ord] = a ? a.to[1] : reached;
      reached = Math.max(reached, ends[ord] as number);
      continue;
    }
    let s = Infinity;
    let e = -Infinity;
    for (let i = 0; i < count; i++) {
      const c = tree.ord(tree.child(n, i));
      s = Math.min(s, starts[c] as number);
      e = Math.max(e, ends[c] as number);
    }
    starts[ord] = s;
    ends[ord] = e;
  }
  return {
    text,
    lineStarts: lineStartsOf(text),
    tree,
    start: (n) => starts[tree.ord(n)] as number,
    end: (n) => ends[tree.ord(n)] as number,
  };
}

/** Each display line's 1-based line in the original source, or zero for formatter-only lines. */
export function sourceLines(v: Version, original: string): number[] {
  let out: number[] = v.lineStarts.map(() => 0);
  const tree = v.tree;
  if (!tree) return out;
  const o = plainVersion(original);
  for (let ord = 0; ord < tree.nodeCount; ord++) {
    const n = tree.at(ord);
    if (tree.count(n) !== 0 || v.end(n) === v.start(n)) continue;
    const dl = lineOf(v, v.start(n));
    const displayEnd = lineOf(v, v.end(n) - 1);
    const origStart = lineOf(o, tree.start(n)) + 1;
    const origEnd = lineOf(o, tree.end(n) - 1) + 1;
    for (let k = 0; k <= displayEnd - dl; k++)
      if (out[dl + k] === 0)
        out[dl + k] = Math.min(origStart + k, origEnd);
  }
  // A formatter without token anchors can still locate lines when it changed whitespace alone.
  if (out.every((line) => line === 0)) {
    const mapped: number[] = out.map(() => 0);
    let source = 0;
    let display = 0;
    while (true) {
      while (source < original.length && /\s/.test(original.charAt(source)))
        source++;
      while (display < v.text.length && /\s/.test(v.text.charAt(display)))
        display++;
      if (source === original.length || display === v.text.length) break;
      if (original.charAt(source) !== v.text.charAt(display)) break;
      const line = lineOf(v, display);
      if (mapped[line] === 0) mapped[line] = lineOf(o, source) + 1;
      source++;
      display++;
    }
    while (source < original.length && /\s/.test(original.charAt(source)))
      source++;
    while (display < v.text.length && /\s/.test(v.text.charAt(display)))
      display++;
    if (source === original.length && display === v.text.length) out = mapped;
  }
  const nextBlank = new Int32Array(o.lineStarts.length + 2);
  let next = 0;
  for (let line = o.lineStarts.length; line > 0; line--) {
    if (o.text.slice(o.lineStarts[line - 1], lineEnd(o, line - 1)).trim() === "")
      next = line;
    nextBlank[line] = next;
  }
  let previousDisplay = -1;
  let previousOriginal = 0;
  for (let display = 0; display < out.length; display++) {
    const currentOriginal = out[display] as number;
    if (currentOriginal === 0) continue;
    if (previousDisplay !== -1) {
      let blank = nextBlank[previousOriginal + 1] as number;
      for (let line = previousDisplay + 1; line < display; line++) {
        if (blank === 0 || blank >= currentOriginal) break;
        if (v.text.slice(v.lineStarts[line], lineEnd(v, line)).trim() !== "")
          continue;
        out[line] = blank;
        blank = nextBlank[blank + 1] as number;
      }
    }
    previousDisplay = display;
    previousOriginal = currentOriginal;
  }
  return out;
}
