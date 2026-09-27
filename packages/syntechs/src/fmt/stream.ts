import type { Layout } from "./printer.js";
import { textWidth } from "./width.js";

/**
 * A prototype layout IR beside `doc.ts`: the document is one linear stream of entries (text runs, source
 * tokens, line breaks), and every group, indent, `ifBreak` branch, line suffix and fill is a `[start, end)`
 * interval over it in a side table, in the order it was opened, so nesting is preorder. The builder keeps a
 * running flat width, so a group's flat width is the difference of two numbers taken when it opens and closes,
 * and whether it holds a forced break is known when it closes: measuring a group reads its own contents in O(1)
 * and scans only what follows it, up to the next line break.
 *
 * The semantics are `printer.ts`'s for the subset JSON builds (no align, best-fitting, literal lines or ruff
 * measuring); `stream-format.ts` compares the two on the same input.
 */

// Entry kinds.
const TEXT = 0;
const TOKEN = 1;
const LINE = 2;
// Line flags.
export const SOFT = 1;
export const HARD = 2;
// Interval kinds.
export const GROUP = 0;
export const INDENT = 1;
/** Printed only when its condition (its group's mode, or the enclosing mode) is broken. */
export const IF_BROKEN = 2;
/** Printed only when its condition is flat. */
export const IF_FLAT = 3;
export const LINE_SUFFIX = 4;
export const FILL = 5;
/** One content part of a fill; the entries between two items are the separator. */
export const FILL_ITEM = 6;
// Interval flags.
export const BROKEN = 1;
/** The interval ends in a line whose space no text inside it follows: prettier counts it only if text follows. */
const TRAIL = 2;
/** The O(1) measure does not hold (a hard line, a broken part, an `ifBreak` on an already decided group): scan. */
const SPECIAL = 4;
/**
 * Opened inside a run of lines whose first line is outside it, and a line of that run is its first measured
 * entry: prettier's fits, measuring it from its start, counts that space, which the running width counted before it.
 */
const LEAD = 8;

const BREAK = 0;
const FLAT = 1;
type Mode = typeof BREAK | typeof FLAT;

const grow32 = (a: Int32Array) => {
  const g = new Int32Array(a.length * 2);
  g.set(a);
  return g;
};
const grow8 = (a: Uint8Array) => {
  const g = new Uint8Array(a.length * 2);
  g.set(a);
  return g;
};

// The stream.
let eKind = new Uint8Array(4096);
let eFlag = new Uint8Array(4096);
let eStr = new Int32Array(4096);
let eNode = new Int32Array(4096);
let eW = new Int32Array(4096);
let n = 0;
const strs: string[] = [];
/** Whether the last entry is a text run the next text may extend: no interval opened or closed since. */
let mergeable = false;

// The interval table.
let iKind = new Uint8Array(1024);
let iFlag = new Uint8Array(1024);
let iStart = new Int32Array(1024);
let iEnd = new Int32Array(1024);
/** The first interval opened after this one closed: skipping an interval skips its descendants in the table. */
let iNext = new Int32Array(1024);
let iRef = new Int32Array(1024);
/** The running flat width when it opened and when it closed. */
let iP0 = new Int32Array(1024);
let iP1 = new Int32Array(1024);
let m = 0;

// Open intervals, with the counters at their opening.
let oIdx = new Int32Array(256);
let oBp = new Int32Array(256);
let oHard = new Int32Array(256);
let oRefs = new Int32Array(256);
let op = 0;

let pos = 0;
let bp = 0;
let hard = 0;
/** Depth inside intervals a flat measure skips (an `ifBreak`'s broken branch, a line suffix). */
let noMeasure = 0;
/** The entry of the last measured `line` no measured text has followed yet, else -1. */
let lastLine = -1;
/** The first line of that run: prettier's fits owes one space for a run of lines, so only it counts. */
let runStart = -1;
/** The groups the `ifBreak`s opened so far depend on, in opening order. */
let refs = new Int32Array(64);
let refCount = 0;
/** Ruff's measure (`Layout.ruff`), fixed when the stream is reset: every flat space counts where it stands. */
let ruffSpaces = false;

export function resetStream(ruff = false): void {
  ruffSpaces = ruff;
  n = 0;
  strs.length = 0;
  mergeable = false;
  m = 0;
  op = 0;
  pos = 0;
  bp = 0;
  hard = 0;
  noMeasure = 0;
  lastLine = -1;
  refCount = 0;
}

function entry(kind: number, flag: number, str: number, node: number, w: number) {
  if (n === eKind.length) {
    eKind = grow8(eKind);
    eFlag = grow8(eFlag);
    eStr = grow32(eStr);
    eNode = grow32(eNode);
    eW = grow32(eW);
  }
  eKind[n] = kind;
  eFlag[n] = flag;
  eStr[n] = str;
  eNode[n] = node;
  eW[n] = w;
  n++;
}

function measured(s: string, w: number) {
  if (noMeasure > 0 || s.length === 0) return;
  pos += w;
  lastLine = -1;
}

/** Synthesized text; it joins the text run before it when nothing opened or closed in between. */
export function sText(s: string): void {
  const w = textWidth(s);
  measured(s, w);
  if (mergeable) {
    const at = eStr[n - 1] as number;
    strs[at] += s;
    eW[n - 1] = (eW[n - 1] as number) + w;
    return;
  }
  strs.push(s);
  entry(TEXT, 0, strs.length - 1, 0, w);
  mergeable = true;
}

/** A source token (or, `synthetic`, one a rule inserted, anchored to `node`): an entry of its own, for its anchor. */
export function sToken(node: number, s: string, synthetic = false): void {
  const w = textWidth(s);
  measured(s, w);
  strs.push(s);
  entry(TOKEN, synthetic ? 1 : 0, strs.length - 1, node, w);
  mergeable = false;
}

/** A line: 0 (a space when flat), `SOFT` (nothing when flat) or `HARD` (always breaks; pair it with `sBreakParent`). */
export function sLine(flags: number): void {
  if (noMeasure === 0 && flags === 0) {
    if (ruffSpaces) pos += 1;
    else if (lastLine === -1) {
      pos += 1;
      runStart = n;
    } else
      for (let o = op - 1; o >= 0; o--) {
        const k = oIdx[o] as number;
        if ((iStart[k] as number) <= runStart || (iFlag[k] as number) & LEAD)
          break;
        iFlag[k] = (iFlag[k] as number) | LEAD;
      }
    lastLine = n;
  }
  if (flags & HARD) hard++;
  entry(LINE, flags, 0, 0, 0);
  mergeable = false;
}

/** Breaks every enclosing group. */
export function sBreakParent(): void {
  bp++;
}

export function sHardline(): void {
  sLine(HARD);
  bp++;
}

/** Opens an interval at the end of the stream; `ref` is the group an `IF_BROKEN`/`IF_FLAT` asks (-1: the enclosing mode). */
export function open(kind: number, ref = -1, flags = 0): number {
  if (m === iKind.length) {
    iKind = grow8(iKind);
    iFlag = grow8(iFlag);
    iStart = grow32(iStart);
    iEnd = grow32(iEnd);
    iNext = grow32(iNext);
    iRef = grow32(iRef);
    iP0 = grow32(iP0);
    iP1 = grow32(iP1);
  }
  if (op === oIdx.length) {
    oIdx = grow32(oIdx);
    oBp = grow32(oBp);
    oHard = grow32(oHard);
    oRefs = grow32(oRefs);
  }
  iKind[m] = kind;
  iFlag[m] = flags;
  iStart[m] = n;
  iRef[m] = ref;
  iP0[m] = pos;
  oIdx[op] = m;
  oBp[op] = bp;
  oHard[op] = hard;
  oRefs[op] = refCount;
  op++;
  if (kind === IF_BROKEN || kind === LINE_SUFFIX) noMeasure++;
  if (ref >= 0 && (kind === IF_BROKEN || kind === IF_FLAT)) {
    if (refCount === refs.length) refs = grow32(refs);
    refs[refCount++] = ref;
  }
  mergeable = false;
  return m++;
}

/** Closes the innermost open interval. */
export function close(): void {
  op--;
  const k = oIdx[op] as number;
  const kind = iKind[k] as number;
  iEnd[k] = n;
  iNext[k] = m;
  iP1[k] = pos;
  if (kind === IF_BROKEN || kind === LINE_SUFFIX) noMeasure--;
  let flags = iFlag[k] as number;
  if (lastLine >= (iStart[k] as number)) flags |= TRAIL;
  const hasBp = bp > (oBp[op] as number);
  const hasHard = hard > (oHard[op] as number);
  if (kind === GROUP) {
    if (flags & BROKEN && !hasBp) bp++;
    if (hasBp) flags |= BROKEN;
    // Measured flat, a hard line stops the measure, and an `ifBreak` on a group decided before this one reads
    // that group's mode rather than flat. Inside a line suffix or an `ifBreak`'s broken branch nothing was
    // measured as it was built.
    let special = (hasHard && !(flags & BROKEN)) || noMeasure > 0;
    for (let r = oRefs[op] as number; r < refCount && !special; r++)
      if ((refs[r] as number) < k) special = true;
    if (special) flags |= SPECIAL;
  } else if (kind === FILL_ITEM) {
    if (
      hasHard ||
      hasBp ||
      refCount > (oRefs[op] as number) ||
      noMeasure > 0
    )
      flags |= SPECIAL;
  }
  iFlag[k] = flags;
  mergeable = false;
}

/** What `printStream` returns: the text, and each printed token's stream entry and output offset. */
export interface StreamPrinted {
  text: string;
  /** Per printed token, in output order: its node, text length, whether synthetic, and its UTF-16 offset. */
  nodes: Int32Array;
  lengths: Int32Array;
  synthetic: Uint8Array;
  at: Int32Array;
}

/** Prints the stream built since `resetStream`, as `printer.ts`'s `print` would print the equivalent Doc. */
export function printStream(layout: Layout): StreamPrinted {
  const ruff = layout.ruff === true;
  if (ruff !== ruffSpaces)
    throw new Error("printStream: reset the stream with the layout's ruff");
  if (op !== 0) throw new Error(`printStream: ${op} intervals left open`);
  const lineWidth = layout.lineWidth;
  // Indentation by level: the stream has indents only, no alignment.
  const indents: string[] = [""];
  const indentOf = (level: number) => {
    let s = indents[level];
    if (s === undefined) {
      s = layout.useTabs
        ? "\t".repeat(level)
        : " ".repeat(level * layout.indentWidth);
      indents[level] = s;
    }
    return s;
  };

  // A group's printed mode, by interval: 0 unset (read as flat), else mode + 1.
  const groupModes = new Uint8Array(m);
  const modeOf = (g: number): Mode =>
    groupModes[g] === BREAK + 1 ? BREAK : FLAT;

  // Print frames: the open intervals that change the indentation or the mode, innermost last. A fill's frame
  // holds the mode of the separator after the item being printed, up to `fSep`; past it, as prettier measures
  // the fill's remaining parts, its own mode `fOwn`.
  let fEnd = new Int32Array(256);
  let fInd = new Int32Array(256);
  let fMode = new Uint8Array(256);
  let fOwn = new Uint8Array(256);
  let fSep = new Int32Array(256);
  let fp = 0;
  const fpush = (end: number, ind: number, mode: number) => {
    if (fp === fEnd.length) {
      fEnd = grow32(fEnd);
      fInd = grow32(fInd);
      fMode = grow8(fMode);
      fOwn = grow8(fOwn);
      fSep = grow32(fSep);
    }
    fEnd[fp] = end;
    fInd[fp] = ind;
    fMode[fp] = mode;
    fOwn[fp] = mode;
    fSep[fp] = end;
    fp++;
  };
  // Frames a measure enters past where printing stands.
  let lEnd = new Int32Array(64);
  let lMode = new Uint8Array(64);

  let remeasure = false;
  // While flushed line-suffix content prints: its base frame, below which a measure does not go, and the
  // suffixes of the same flush still to print (`qK`/`qM` from `qAt`), which a measure reads instead.
  let floor = 0;
  let qK: number[] = [];
  let qM: number[] = [];
  let qAt = 0;

  /**
   * Prettier's fits over the stream: entries from `from` measured in `mode0` up to `to`, then (with `rest`) the
   * entries after, each in the mode printing will give it, until a line that breaks. `cur` is the first interval
   * starting at or after `from`. `pending` is a space owed to the next text.
   */
  function measure(
    from: number,
    to: number,
    cur: number,
    width: number,
    pending: boolean,
    mode0: Mode,
    mustBeFlat: boolean,
    rest: boolean,
  ): boolean {
    let i = from;
    let lp = fp - 1;
    let ls = 0;
    let q = qAt;
    for (;;) {
      while (ls > 0 && (lEnd[ls - 1] as number) <= i) ls--;
      let mode: number;
      if (ls > 0) mode = lMode[ls - 1] as number;
      else if (i < to) mode = mode0;
      else {
        if (!rest) return true;
        while (lp >= floor && (fEnd[lp] as number) <= i) lp--;
        if (lp < floor) {
          // Inside flushed line-suffix content, prettier's rest is the suffixes queued after it, then the line
          // that flushed them, which breaks: the frames below were printed already.
          if (q >= qK.length) return true;
          const k = qK[q] as number;
          if (ls === lEnd.length) {
            lEnd = grow32(lEnd);
            lMode = grow8(lMode);
          }
          lEnd[ls] = iEnd[k] as number;
          lMode[ls] = qM[q] as number;
          ls++;
          q++;
          i = iStart[k] as number;
          cur = k + 1;
          continue;
        }
        mode = (i < (fSep[lp] as number) ? fMode : fOwn)[lp] as number;
      }
      if (i >= n) return true;
      let jumped = false;
      while (cur < m && iStart[cur] === i) {
        const k = cur;
        const e = iEnd[k] as number;
        const kind = iKind[k] as number;
        if (kind === GROUP) {
          const broken = ((iFlag[k] as number) & BROKEN) !== 0;
          if (mustBeFlat && broken) return false;
          cur++;
          // Ruff records a measured group's mode for the `ifBreak`s after it.
          if (ruff) groupModes[k] = (broken ? BREAK : mode) + 1;
          if (e > i) {
            if (broken) mode = BREAK;
            if (ls === lEnd.length) {
              lEnd = grow32(lEnd);
              lMode = grow8(lMode);
            }
            lEnd[ls] = e;
            lMode[ls] = mode;
            ls++;
          }
        } else if (kind === IF_BROKEN || kind === IF_FLAT) {
          const r = iRef[k] as number;
          const c = r >= 0 ? modeOf(r) : mode;
          if ((kind === IF_BROKEN) === (c === BREAK)) cur++;
          else {
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          }
        } else if (kind === LINE_SUFFIX) {
          i = e;
          cur = iNext[k] as number;
          jumped = true;
          break;
        } else cur++;
      }
      if (jumped) continue;
      if (eKind[i] === LINE) {
        const f = eFlag[i] as number;
        if (mode === FLAT && !(f & HARD)) {
          if (!(f & SOFT)) {
            if (ruff) width -= 1;
            else pending = true;
          }
        } else return true;
      } else if ((strs[eStr[i] as number] as string).length > 0) {
        if (pending) {
          width -= 1;
          pending = false;
        }
        width -= eW[i] as number;
      }
      if (width < 0) return false;
      i++;
    }
  }

  const flatWidth = (k: number) =>
    (iP1[k] as number) -
    (iP0[k] as number) +
    ((iFlag[k] as number) & LEAD ? 1 : 0) -
    ((iFlag[k] as number) & TRAIL ? 1 : 0);

  function decideGroup(k: number, mode: number): Mode {
    const flags = iFlag[k] as number;
    if (mode === FLAT && !remeasure) return flags & BROKEN ? BREAK : FLAT;
    remeasure = false;
    // Ruff measures a group's contents as flat, so an `ifBreak` on the group itself reads flat meanwhile.
    if (ruff) groupModes[k] = FLAT + 1;
    if (flags & BROKEN) return BREAK;
    const width = lineWidth - column;
    if (width < 0) return BREAK;
    if (flags & SPECIAL)
      return measure(
        iStart[k] as number,
        iEnd[k] as number,
        k + 1,
        width,
        false,
        FLAT,
        false,
        true,
      )
        ? FLAT
        : BREAK;
    const w = flatWidth(k);
    if (w > width) return BREAK;
    const e = iEnd[k] as number;
    return measure(
      e,
      e,
      iNext[k] as number,
      width - w,
      (flags & TRAIL) !== 0,
      FLAT,
      false,
      true,
    )
      ? FLAT
      : BREAK;
  }

  // Prettier's fill: an item prints flat when it fits alone, and the separator after it breaks unless the item
  // and the next one fit on the line together. Both measures stop at the fill: no rest.
  let separatorMode: Mode = BREAK;
  /** Where the separator after the decided item ends: the next item's start, else the fill's end. */
  let separatorEnd = 0;
  function decideItem(k: number, fillEnd: number): Mode {
    const width = lineWidth - column;
    const flags = iFlag[k] as number;
    const contentFits =
      width >= 0 &&
      (flags & SPECIAL
        ? measure(
            iStart[k] as number,
            iEnd[k] as number,
            k + 1,
            width,
            false,
            FLAT,
            true,
            false,
          )
        : flatWidth(k) <= width);
    const next = iNext[k] as number;
    if (
      next < m &&
      iKind[next] === FILL_ITEM &&
      (iStart[next] as number) < fillEnd
    ) {
      let special = ((flags | (iFlag[next] as number)) & SPECIAL) !== 0;
      for (let s = iEnd[k] as number; s < (iStart[next] as number); s++)
        if (eKind[s] === LINE && (eFlag[s] as number) & HARD) special = true;
      const pairFits =
        width >= 0 &&
        (special
          ? measure(
              iStart[k] as number,
              iEnd[next] as number,
              k + 1,
              width,
              false,
              FLAT,
              true,
              false,
            )
          : (iP1[next] as number) -
              (iP0[k] as number) +
              (flags & LEAD ? 1 : 0) -
              ((iFlag[next] as number) & TRAIL ? 1 : 0) <=
            width);
      separatorMode = pairFits ? FLAT : BREAK;
      separatorEnd = iStart[next] as number;
    } else {
      // A trailing separator prints in the item's mode, as prettier's printFill with no part after it.
      separatorMode = contentFits ? FLAT : BREAK;
      separatorEnd = fillEnd;
    }
    return contentFits ? FLAT : BREAK;
  }

  const out: string[] = [];
  let current = "";
  let length = 0;
  let column = 0;
  let tokens = 0;
  let placedEntry = new Int32Array(1024);
  let placedAt = new Int32Array(1024);
  const endLine = () => {
    out.push(current, "\n");
    current = "";
    length += 1;
  };
  const trimLineEnd = () => {
    let end = current.length;
    for (let c = current.charCodeAt(end - 1); c === 32 || c === 9;)
      c = current.charCodeAt(--end - 1);
    if (end === current.length) return;
    length -= current.length - end;
    current = current.slice(0, end);
  };

  // Line suffixes waiting for the next line break: interval, indentation, mode.
  const sK: number[] = [];
  const sI: number[] = [];
  const sM: number[] = [];
  const flushSuffixes = () => {
    const ks = sK.splice(0);
    const is = sI.splice(0);
    const ms = sM.splice(0);
    const saved = [floor, qK, qM, qAt] as const;
    qK = ks;
    qM = ms;
    for (let j = 0; j < ks.length; j++) {
      const k = ks[j] as number;
      floor = fp;
      qAt = j + 1;
      run(
        iStart[k] as number,
        iEnd[k] as number,
        k + 1,
        is[j] as number,
        ms[j] as number,
      );
    }
    [floor, qK, qM, qAt] = saved;
  };

  function run(from: number, to: number, cur: number, ind: number, mode: number) {
    const base = fp;
    fpush(to, ind, mode);
    let i = from;
    for (;;) {
      while (fp > base + 1 && (fEnd[fp - 1] as number) <= i) fp--;
      if (i >= to) break;
      let jumped = false;
      while (cur < m && iStart[cur] === i) {
        const k = cur;
        const e = iEnd[k] as number;
        const top = fp - 1;
        const tm = fMode[top] as number;
        const ti = fInd[top] as number;
        switch (iKind[k]) {
          case GROUP: {
            const g = decideGroup(k, tm);
            groupModes[k] = g + 1;
            cur++;
            if (e > i) fpush(e, ti, g);
            break;
          }
          case INDENT:
            cur++;
            if (e > i) fpush(e, ti + 1, tm);
            break;
          case IF_BROKEN:
          case IF_FLAT: {
            const r = iRef[k] as number;
            const c = r >= 0 ? modeOf(r) : tm;
            if ((iKind[k] === IF_BROKEN) === (c === BREAK)) cur++;
            else {
              i = e;
              cur = iNext[k] as number;
              jumped = true;
            }
            break;
          }
          case LINE_SUFFIX:
            sK.push(k);
            sI.push(ti);
            sM.push(tm);
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          case FILL:
            cur++;
            if (e > i) fpush(e, ti, tm);
            break;
          case FILL_ITEM: {
            const cm = decideItem(k, fEnd[top] as number);
            fMode[top] = separatorMode;
            fSep[top] = separatorEnd;
            cur++;
            if (e > i) fpush(e, ti, cm);
            break;
          }
          default:
            throw new Error(`printStream: unknown interval kind ${iKind[k]}`);
        }
        if (jumped) break;
      }
      if (jumped) continue;
      const md = fMode[fp - 1] as number;
      if (eKind[i] === LINE) {
        const f = eFlag[i] as number;
        if (md === FLAT && !(f & HARD)) {
          if (!(f & SOFT)) {
            current += " ";
            length += 1;
            column += 1;
          }
        } else {
          // A hard break inside a flat group: the next group must measure afresh.
          if (md === FLAT || ruff) remeasure = true;
          // A suffix queued inside flushed suffix content prints before this line too.
          while (sK.length > 0) flushSuffixes();
          trimLineEnd();
          endLine();
          const indentation = indentOf(fInd[fp - 1] as number);
          current += indentation;
          length += indentation.length;
          column = (fInd[fp - 1] as number) * layout.indentWidth;
        }
      } else {
        const s = strs[eStr[i] as number] as string;
        if (eKind[i] === TOKEN) {
          if (tokens === placedAt.length) {
            placedAt = grow32(placedAt);
            placedEntry = grow32(placedEntry);
          }
          placedEntry[tokens] = i;
          placedAt[tokens] = length;
          tokens++;
        }
        current += s;
        length += s.length;
        column += eW[i] as number;
      }
      i++;
    }
    fp = base;
  }

  run(0, n, 0, 0, BREAK);
  while (sK.length > 0) flushSuffixes();
  out.push(current);

  const nodes = new Int32Array(tokens);
  const lengths = new Int32Array(tokens);
  const synthetic = new Uint8Array(tokens);
  for (let t = 0; t < tokens; t++) {
    const e = placedEntry[t] as number;
    nodes[t] = eNode[e] as number;
    lengths[t] = (strs[eStr[e] as number] as string).length;
    synthetic[t] = eFlag[e] as number;
  }
  return {
    text: out.join(""),
    nodes,
    lengths,
    synthetic,
    at: placedAt.subarray(0, tokens),
  };
}
