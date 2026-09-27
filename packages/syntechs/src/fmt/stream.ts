import {
  type Indentation,
  type Layout,
  render as renderIndentation,
} from "./printer.js";
import { textWidth } from "./width.js";

/**
 * A prototype layout IR beside `doc.ts`: the document is one linear stream of entries (text runs, source
 * tokens, line breaks), and every group, indent, `ifBreak` branch, line suffix and fill is a `[start, end)`
 * interval over it in a side table, in the order it was opened, so nesting is preorder. The builder keeps a
 * running flat width, so a group's flat width is the difference of two numbers taken when it opens and closes,
 * and whether it holds a forced break is known when it closes: measuring a group reads its own contents in O(1)
 * and scans only what follows it, up to the next line break.
 *
 * The semantics are `printer.ts`'s, ruff's measure and layout kinds included, but for conditional groups;
 * `stream-format.ts` compares the two on the same input, and `stream-doc.ts` lowers a formatter's Doc onto it.
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

// --- lineSuffixBoundary ---
/**
 * A line flag: the entry is prettier's lineSuffixBoundary, stored as a hard line that prints only while line
 * suffixes are pending and that a measure fails on once it has seen a line suffix.
 */
export const BOUNDARY = 16;
/** An interval flag: it holds a measured boundary, so it cannot fit flat while a line suffix is pending. */
const BND = 64;
/** An interval flag: it holds a measured line suffix, which a boundary measured after it fails on. */
const SFX = 128;
/** The interval count `m` when the last measured boundary was appended, and the last measured suffix then. */
let bndM = -1;
let bndSfx = -1;
/** The last line suffix opened where a flat measure reads it. */
let lastSfx = -1;
// --- end lineSuffixBoundary ---

// --- align ---
/** An interval kind: its contents at an alignment past the enclosing indentation (see `openAlign`). */
export const ALIGN = 16;
/** Each align interval's step, by the index its `iRef` holds. */
const alignSteps: (number | string)[] = [];
// --- end align ---

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

// --- ruff ---
// Ruff's layout kinds, numbered from 40, apart from the other kinds.
/** One literal token holding a line break (`sLiteral`): its lines print as they are, the column restarting at 0. */
const LITERAL_TOKEN = 40;
/** Line flags (`doc.ts`'s): a broken line on a line still empty prints nothing, and one adds an empty line. */
export const COLLAPSE = 4;
export const BLANK = 8;
/** Its contents indented when the group `iRef` (-1: the enclosing mode) prints broken; see `openIndentIfBreak`. */
const INDENT_IF_BROKEN = 41;
/** As `INDENT_IF_BROKEN`, indented when the group prints flat. */
const INDENT_IF_FLAT = 42;

/**
 * Opens ruff's `indent_if_group_breaks` (prettier's indentIfBreak): its contents, built once, indented when the
 * group interval `ref` (-1: the enclosing mode) prints broken, or with `negate` when it prints flat. Close it
 * with `close`. The indentation reaches only line breaks, so a measure reads the contents as they are.
 */
export function openIndentIfBreak(ref: number, negate = false): number {
  return open(negate ? INDENT_IF_FLAT : INDENT_IF_BROKEN, ref);
}
/** Ruff's `conditional_group`: a group while the group `iRef` prints broken, else its contents in the mode around. */
export const GROUP_IF_BROKEN = 43;
/** Ruff's `fits_expanded`; see `openFitsExpanded`. `close` turns it `FITS_EXPANDED_BREAKS` when its contents break. */
const FITS_EXPANDED = 44;
const FITS_EXPANDED_BREAKS = 45;
/** Whether the stream holds a `fitsExpanded`, so a measure tracks the indentation it enters. */
let expandsSeen = false;

/**
 * Opens ruff's `fits_expanded`: while the group interval `whenFlat` (-1: always) prints flat, a group measuring
 * it counts only the text around it, as if its contents were broken over lines of any width. Its breaks do not
 * break the groups around; they fail the measure when the condition does not hold. Close it with `close`.
 */
export function openFitsExpanded(whenFlat: number): number {
  expandsSeen = true;
  // A group around it cannot be measured flat as one width.
  hard++;
  return open(FITS_EXPANDED, whenFlat);
}

/** Ruff's `best_fit_parenthesize`; see `openBestFitParenthesize`. */
export const BEST_FIT_PARENTHESIZE = 46;
/** A part of the best-fit-parenthesize `iRef` printed only when it is parenthesized: a parenthesis and its line. */
const PAREN = 47;
/** The contents of the best-fit-parenthesize `iRef`, indented when it is parenthesized. */
const PAREN_INDENT = 48;

/**
 * Opens ruff's `best_fit_parenthesize`: its contents print flat when they fit, else parenthesized on lines of
 * their own (`open`, then the contents indented, then `close`) when every line of that fits, else flat after
 * all with each group inside measuring itself. `open` and `close` are appended here; append the contents, then
 * call `closeBestFitParenthesize`. Its breaks do not break the groups around.
 */
export function openBestFitParenthesize(open0: () => void): number {
  expandsSeen = true;
  const k = open(BEST_FIT_PARENTHESIZE);
  openParen(k);
  open0();
  close();
  noMeasure--;
  open(PAREN_INDENT, k);
  openParen(k);
  parenLine();
  close();
  noMeasure--;
  return k;
}

export function closeBestFitParenthesize(k: number, close0: () => void): void {
  close();
  openParen(k);
  parenLine();
  close0();
  close();
  noMeasure--;
  close();
}

// A paren part is measured with no width, as the broken branch of an ifBreak is.
function openParen(k: number) {
  open(PAREN, k);
  noMeasure++;
}

// The line of a paren part breaks only when the part prints, so no group around counts it as a hard line.
function parenLine() {
  const h = hard;
  sLine(HARD);
  hard = h;
}

/** Ruff's `best_fitting`; see `openBestFitting`. `iRef` holds its last variant. */
const BEST_FITTING = 49;
/** A `BEST_FITTING` measuring every line of a variant, not only the first. */
const BEST_FITTING_ALL = 50;
/** One variant of the best-fitting `iRef`; its first variant is the interval after it. */
const VARIANT = 51;
/** Whether the stream holds a best-fitting, so the printer keeps the variant each one picked. */
let fittingSeen = false;

/**
 * Opens ruff's `best_fitting`: the first of its variants that fits flat (`allLines`: on every line) prints
 * flat, else the last prints broken; a flat measure reads the first, a broken one the last. Append each variant
 * between `openVariant` and `closeVariant`, then `close` it. Its breaks do not break the groups around.
 */
export function openBestFitting(allLines: boolean): number {
  fittingSeen = true;
  return open(allLines ? BEST_FITTING_ALL : BEST_FITTING);
}

export function openVariant(k: number): number {
  const v = open(VARIANT, k);
  iRef[k] = v;
  // Only the first variant counts toward the flat width around, as a flat measure reads only it.
  if (v !== k + 1) noMeasure++;
  return v;
}

export function closeVariant(v: number): void {
  close();
  if (v !== (iRef[v] as number) + 1) noMeasure--;
}
// --- end ruff ---

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
  expandsSeen = false;
  fittingSeen = false;
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
  bndM = -1;
  bndSfx = -1;
  lastSfx = -1;
  alignSteps.length = 0;
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

/**
 * A token whose line breaks are literal (`doc.ts`'s `literalToken`): a measure ends at its first line break and
 * the column restarts after the last. Counted as a hard line, so a group holding it scans rather than measure O(1).
 */
export function sLiteral(node: number, s: string): void {
  if (!s.includes("\n")) {
    sToken(node, s);
    return;
  }
  open(LITERAL_TOKEN);
  sToken(node, s);
  hard++;
  close();
}

/**
 * Opens a line suffix whose `reserved` columns count against the line now, although its contents print at the
 * next line break: ruff's way to keep a trailing comment within the width. Close it with `close`.
 */
export function openReservedSuffix(reserved: number): number {
  if (noMeasure === 0) pos += reserved;
  return open(LINE_SUFFIX, reserved);
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

/**
 * A line with ruff's `COLLAPSE` and `BLANK` flags besides `SOFT`/`HARD`; measured as `sLine` measures the line
 * without them. A hard line that collapses breaks every enclosing group by itself, as `printer.ts` propagates it.
 */
export function sRuffLine(flags: number): void {
  sLine(flags & (SOFT | HARD));
  eFlag[n - 1] = flags;
  if (flags & HARD && flags & COLLAPSE) bp++;
}

/** Breaks every enclosing group. */
export function sBreakParent(): void {
  bp++;
}

export function sHardline(): void {
  sLine(HARD);
  bp++;
}

/** Prettier's lineSuffixBoundary: a hard line here when line suffixes are pending, else nothing. */
export function sLineSuffixBoundary(): void {
  if (noMeasure === 0) {
    bndM = m;
    bndSfx = lastSfx;
  }
  entry(LINE, HARD | BOUNDARY, 0, 0, 0);
  mergeable = false;
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
  if (kind === LINE_SUFFIX && noMeasure === 0) lastSfx = m;
  if (kind === IF_BROKEN || kind === LINE_SUFFIX) noMeasure++;
  if (ref >= 0 && (kind === IF_BROKEN || kind === IF_FLAT)) {
    if (refCount === refs.length) refs = grow32(refs);
    refs[refCount++] = ref;
  }
  mergeable = false;
  return m++;
}

/**
 * Opens prettier's align: `n` spaces (or the string `n`) past the enclosing indentation, `-1` its innermost level
 * dropped (dedent), `-Infinity` the root (dedentToRoot). Close it with `close`.
 */
export function openAlign(n: number | string): number {
  alignSteps.push(n);
  return open(ALIGN, alignSteps.length - 1);
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
  if (kind === FITS_EXPANDED) {
    if (hasBp) iKind[k] = FITS_EXPANDED_BREAKS;
    bp = oBp[op] as number;
  } else if (
    kind === BEST_FIT_PARENTHESIZE ||
    kind === BEST_FITTING ||
    kind === BEST_FITTING_ALL
  )
    bp = oBp[op] as number;
  if (kind === GROUP || kind === GROUP_IF_BROKEN) {
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
  if (bndM > k) {
    flags |= BND;
    // A suffix before the boundary, both inside: the flat measure always reaches the boundary having seen it.
    if (bndSfx > k) flags |= SPECIAL;
  }
  if (lastSfx > k) flags |= SFX;
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
  // Indentations by id, as `printer.ts` builds them: each one step (an indent or an alignment) deeper than
  // another, built once.
  const indents: Indentation[] = [
    { value: "", length: 0, queue: [], indented: -1, aligned: undefined },
  ];
  const deeper = (from: number): number => {
    const f = indents[from] as Indentation;
    if (f.indented < 0) {
      indents.push(renderIndentation(f, "indent", layout));
      f.indented = indents.length - 1;
    }
    return f.indented;
  };
  const alignedFrom = (from: number, n: number | string): number => {
    if (n === Number.NEGATIVE_INFINITY) return 0;
    if (n === 0 || n === "") return from;
    const f = indents[from] as Indentation;
    f.aligned ??= new Map();
    let id = f.aligned.get(n);
    if (id === undefined) {
      indents.push(renderIndentation(f, n, layout));
      id = indents.length - 1;
      f.aligned.set(n, id);
    }
    return id;
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
  // --- ruff ---
  const overflows = expandsSeen;
  // The indentation intervals a measure enters, innermost last: read only by the lines inside a fitsExpanded.
  let xEnd = new Int32Array(16);
  let xInd = new Int32Array(16);
  /** The best-fit-parenthesize a measure reads parenthesized, else -1. */
  let parenK = -1;
  /**
   * Whether a measure from `from` reads the parentheses of the best-fit-parenthesize `r`: when it measures `r`
   * parenthesized, or `r` printed parenthesized before it. One it enters it reads bare, as ruff's fits does.
   */
  const parenOn = (r: number, from: number) =>
    r === parenK || (modeOf(r) === BREAK && (iStart[r] as number) < from);
  /** Each best-fitting's variant to read: the one it printed, or the one the measure entering it reads. */
  const pick = new Int32Array(fittingSeen ? m : 0);
  // --- end ruff ---

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
    all = false,
  ): boolean {
    let i = from;
    let lp = fp - 1;
    let ls = 0;
    let q = qAt;
    // Prettier's hasLineSuffix: a boundary fails the measure once a suffix is pending or was measured.
    let seenSuffix = suffixIn || sK.length > 0;
    suffixIn = false;
    // Where the last fitsExpanded measured broken ends: before it, lines restart the width and none is checked.
    let ovEnd = -1;
    // Where the lines measured each (`all`, and a fitsExpanded's) end: before it, a line restarts the width.
    let allEnd = all ? to : -1;
    let xs = 0;
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
        // Past a fitsExpanded whose last line overflowed, anything but a breaking line fails.
        if (width < 0 && i >= ovEnd) return false;
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
          seenSuffix = true;
          // A reserved suffix's `iRef` holds its reserved columns.
          const reserved = iRef[k] as number;
          if (reserved > 0 && (width -= reserved) < 0) return false;
          i = e;
          cur = iNext[k] as number;
          jumped = true;
          break;
        } else if (kind === LITERAL_TOKEN) {
          if (ruff && mustBeFlat) return false;
          const s = strs[eStr[i] as number] as string;
          if (i < allEnd) {
            width = lineWidth - textWidth(s.slice(s.lastIndexOf("\n") + 1));
            if (width < 0 && i >= ovEnd) return false;
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          }
          if (pending) width -= 1;
          return width - textWidth(s.slice(0, s.indexOf("\n"))) >= 0;
        } else if (kind === GROUP_IF_BROKEN) {
          cur++;
          // Only a broken one under a broken condition changes the mode; it broke every group around it too.
          if ((iFlag[k] as number) & BROKEN && modeOf(iRef[k] as number) === BREAK) {
            if (mustBeFlat) return false;
            if (e > i) {
              if (ls === lEnd.length) {
                lEnd = grow32(lEnd);
                lMode = grow8(lMode);
              }
              lEnd[ls] = e;
              lMode[ls] = BREAK;
              ls++;
              mode = BREAK;
            }
          }
        } else if (kind === FITS_EXPANDED || kind === FITS_EXPANDED_BREAKS) {
          cur++;
          const r = iRef[k] as number;
          if (mode === FLAT && (r < 0 || modeOf(r) === FLAT)) {
            if (e > i) {
              if (ls === lEnd.length) {
                lEnd = grow32(lEnd);
                lMode = grow8(lMode);
              }
              lEnd[ls] = e;
              lMode[ls] = BREAK;
              ls++;
              mode = BREAK;
              if (e > ovEnd) ovEnd = e;
              if (e > allEnd) allEnd = e;
            }
          } else if (mode === FLAT && kind === FITS_EXPANDED_BREAKS) return false;
        } else if (kind === BEST_FIT_PARENTHESIZE) {
          if (ruff) groupModes[k] = mode + 1;
          cur++;
        } else if (kind === PAREN) {
          if (parenOn(iRef[k] as number, from)) cur++;
          else {
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          }
        } else if (kind === BEST_FITTING || kind === BEST_FITTING_ALL) {
          cur++;
          // Flat, its first variant in the mode, every line of it measured when it asks; else its last.
          if (mode === FLAT) {
            pick[k] = k + 1;
            if (kind === BEST_FITTING_ALL && (iEnd[k + 1] as number) > allEnd)
              allEnd = iEnd[k + 1] as number;
          } else pick[k] = iRef[k] as number;
        } else if (kind === VARIANT) {
          if (pick[iRef[k] as number] === k) cur++;
          else {
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          }
        } else if (
          overflows &&
          (kind === INDENT ||
            kind === ALIGN ||
            kind === INDENT_IF_BROKEN ||
            kind === INDENT_IF_FLAT ||
            kind === PAREN_INDENT)
        ) {
          cur++;
          if (e > i) {
            while (xs > 0 && (xEnd[xs - 1] as number) <= i) xs--;
            const base =
              xs > 0
                ? (xInd[xs - 1] as number)
                : (fInd[lp >= floor ? lp : fp - 1] as number);
            let ind = base;
            if (kind === INDENT) ind = deeper(base);
            else if (kind === ALIGN)
              ind = alignedFrom(base, alignSteps[iRef[k] as number] as number | string);
            else if (kind === PAREN_INDENT) {
              if (parenOn(iRef[k] as number, from)) ind = deeper(base);
            } else {
              const r = iRef[k] as number;
              const c = r >= 0 ? modeOf(r) : mode;
              if ((kind === INDENT_IF_BROKEN) === (c === BREAK)) ind = deeper(base);
            }
            if (xs === xEnd.length) {
              xEnd = grow32(xEnd);
              xInd = grow32(xInd);
            }
            xEnd[xs] = e;
            xInd[xs] = ind;
            xs++;
          }
        } else cur++;
      }
      if (jumped) continue;
      if (eKind[i] === LINE) {
        const f = eFlag[i] as number;
        if (f & BOUNDARY) {
          if (seenSuffix) return false;
          i++;
          continue;
        }
        if (mode === FLAT && !(f & HARD)) {
          if (!(f & SOFT)) {
            if (ruff) width -= 1;
            else pending = true;
          }
        } else if (i < allEnd && mode !== FLAT) {
          while (xs > 0 && (xEnd[xs - 1] as number) <= i) xs--;
          const ind =
            xs > 0 ? (xInd[xs - 1] as number) : (fInd[lp >= floor ? lp : fp - 1] as number);
          width = lineWidth - (indents[ind] as Indentation).length;
        } else return true;
      } else if ((strs[eStr[i] as number] as string).length > 0) {
        if (pending) {
          width -= 1;
          pending = false;
        }
        width -= eW[i] as number;
      }
      if (width < 0 && i >= ovEnd) return false;
      i++;
    }
  }

  const flatWidth = (k: number) =>
    (iP1[k] as number) -
    (iP0[k] as number) +
    ((iFlag[k] as number) & LEAD ? 1 : 0) -
    ((iFlag[k] as number) & TRAIL ? 1 : 0);
  /** Whether the measure `measure` starts next begins past measured contents holding a line suffix. */
  let suffixIn = false;

  function decideGroup(k: number, mode: number): Mode {
    const flags = iFlag[k] as number;
    if (mode === FLAT && !remeasure) return flags & BROKEN ? BREAK : FLAT;
    remeasure = false;
    // Ruff measures a group's contents as flat, so an `ifBreak` on the group itself reads flat meanwhile.
    if (ruff) groupModes[k] = FLAT + 1;
    if (flags & BROKEN) return BREAK;
    const width = lineWidth - column;
    if (width < 0) return BREAK;
    if (flags & SPECIAL || (flags & BND && sK.length > 0))
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
    suffixIn = (flags & SFX) !== 0;
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
      (flags & SPECIAL || (flags & BND && sK.length > 0)
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
      if ((flags | (iFlag[next] as number)) & BND) special = true;
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
  /** Where the text of the current line starts, after its indentation: a `COLLAPSE` line reads it. */
  let lineStart = 0;
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
            if (e > i) fpush(e, deeper(ti), tm);
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
            if ((iRef[k] as number) > 0) column += iRef[k] as number;
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
          case ALIGN:
            cur++;
            if (e > i)
              fpush(
                e,
                alignedFrom(ti, alignSteps[iRef[k] as number] as number | string),
                tm,
              );
            break;
          case LITERAL_TOKEN: {
            // Its lines are finished as they are: a line end trims only the line being printed.
            const s = strs[eStr[i] as number] as string;
            if (tokens === placedAt.length) {
              placedAt = grow32(placedAt);
              placedEntry = grow32(placedEntry);
            }
            placedEntry[tokens] = i;
            placedAt[tokens] = length;
            tokens++;
            const lastBreak = s.lastIndexOf("\n");
            out.push(current + s.slice(0, lastBreak + 1));
            current = s.slice(lastBreak + 1);
            length += s.length;
            column = textWidth(current);
            if (ruff) remeasure = true;
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          }
          case INDENT_IF_BROKEN:
          case INDENT_IF_FLAT: {
            const r = iRef[k] as number;
            const c = r >= 0 ? modeOf(r) : tm;
            cur++;
            if (e > i)
              fpush(
                e,
                (iKind[k] === INDENT_IF_BROKEN) === (c === BREAK) ? deeper(ti) : ti,
                tm,
              );
            break;
          }
          case GROUP_IF_BROKEN: {
            const g =
              modeOf(iRef[k] as number) === BREAK ? decideGroup(k, tm) : tm;
            cur++;
            if (e > i) fpush(e, ti, g);
            break;
          }
          case FITS_EXPANDED:
          case FITS_EXPANDED_BREAKS: {
            const r = iRef[k] as number;
            if (r < 0 || modeOf(r) === FLAT) remeasure = true;
            cur++;
            break;
          }
          case BEST_FIT_PARENTHESIZE: {
            groupModes[k] = FLAT + 1;
            let g: Mode = FLAT;
            if (tm !== FLAT || remeasure) {
              remeasure = false;
              const width = lineWidth - column;
              if (!(width >= 0 && measure(i, e, k + 1, width, false, FLAT, false, true))) {
                groupModes[k] = BREAK + 1;
                parenK = k;
                const ok =
                  width >= 0 && measure(i, e, k + 1, width, false, BREAK, false, true, true);
                parenK = -1;
                if (ok) g = BREAK;
                else {
                  // Bare after all, but each group inside measures itself rather than printing flat on trust.
                  groupModes[k] = FLAT + 1;
                  remeasure = true;
                }
              }
            }
            cur++;
            if (e > i) fpush(e, ti, g);
            break;
          }
          case BEST_FITTING:
          case BEST_FITTING_ALL: {
            let v = iRef[k] as number;
            let g: Mode = BREAK;
            if (tm === FLAT && !remeasure) {
              v = k + 1;
              g = FLAT;
            } else {
              remeasure = false;
              const width = lineWidth - column;
              for (let x = k + 1; x !== (iRef[k] as number); x = iNext[x] as number) {
                pick[k] = x;
                if (
                  width >= 0 &&
                  measure(
                    iStart[x] as number,
                    iEnd[x] as number,
                    x + 1,
                    width,
                    false,
                    FLAT,
                    false,
                    true,
                    iKind[k] === BEST_FITTING_ALL,
                  )
                ) {
                  v = x;
                  g = FLAT;
                  break;
                }
              }
            }
            pick[k] = v;
            // Its variant's mode; no ifBreak asks a best-fitting's.
            groupModes[k] = g + 1;
            cur++;
            break;
          }
          case VARIANT: {
            const p = iRef[k] as number;
            if (pick[p] === k) {
              cur++;
              if (e > i) fpush(e, ti, modeOf(p));
            } else {
              i = e;
              cur = iNext[k] as number;
              jumped = true;
            }
            break;
          }
          case PAREN:
            if (modeOf(iRef[k] as number) === BREAK) cur++;
            else {
              i = e;
              cur = iNext[k] as number;
              jumped = true;
            }
            break;
          case PAREN_INDENT:
            cur++;
            if (e > i)
              fpush(e, modeOf(iRef[k] as number) === BREAK ? deeper(ti) : ti, tm);
            break;
          default:
            throw new Error(`printStream: unknown interval kind ${iKind[k]}`);
        }
        if (jumped) break;
      }
      if (jumped) continue;
      const md = fMode[fp - 1] as number;
      if (eKind[i] === LINE) {
        const f = eFlag[i] as number;
        if (f & BOUNDARY && sK.length === 0) {
          i++;
          continue;
        }
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
          if (!(f & COLLAPSE) || length > lineStart) endLine();
          if (f & BLANK) endLine();
          const indentation = indents[fInd[fp - 1] as number] as Indentation;
          current += indentation.value;
          length += indentation.value.length;
          column = indentation.length;
          lineStart = length;
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
