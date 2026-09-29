import { textWidth } from "./width.js";

/**
 * The layout IR every formatter builds: the document is one linear stream of entries (text runs, source
 * tokens, line breaks), and every group, indent, `ifBreak` branch, line suffix and fill is a `[start, end)`
 * interval over it in a side table, in the order it was opened, so nesting is preorder. The builder keeps a
 * running flat width, so a group's flat width is the difference of two numbers taken when it opens and closes,
 * and whether it holds a forced break is known when it closes: measuring a group reads its own contents in O(1)
 * and scans only what follows it, up to the next line break.
 *
 * The semantics are those of prettier's Doc printer, ruff's measure and layout kinds included; `stream.test.ts`
 * pins them.
 */

// Entry kinds.
const TEXT = 0;
const TOKEN = 1;
const LINE = 2;
/** Prints the span interval its `eStr` holds, there, in the mode and indentation around (see `sJump`). */
const JUMP = 3;
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
/**
 * It may hold a hard line: what the `hard` counter counts (a literal token and a flat part too), so `willBreak`
 * scans for a hard line only in the intervals that hold one, which a break parent need not accompany.
 */
const HARDS = 16;
/** It holds a break parent (a hard line's included) or a broken group, which breaks the groups around it. */
const BREAKS = 32;

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

// --- choice ---
/**
 * An interval kind: prettier's conditionalGroup, its `STATE` children in order (see `openChoice`). Its `iRef`
 * holds its last state, -1 with none.
 */
export const CHOICE = 17;
/** An interval kind: one state of a `CHOICE`, measured in O(1) as a group's contents are. */
const STATE = 18;
/**
 * Per open choice, `CHOICE_SAVE` numbers: the builder's measure counters when it opened, the same after its
 * first state, and how many states closed so far. Each state after the first is built from the counters at the
 * opening, and the choice closes with the first state's: the enclosing intervals measure that state only.
 */
const choiceSaves: number[] = [];
const CHOICE_SAVE = 15;
/** Whether the stream holds a choice, whose state breaks reach no `BREAKS` flag around it (see `willBreak`). */
let choiceSeen = false;
// --- end choice ---

const BREAK = 0;
const FLAT = 1;
/**
 * Inside a `FLATTEN` interval: removeLines' modes, the flat or broken mode prettier's printer gives the part rebuilt
 * (`FORCED_BREAK | mode`). Every line but a hard one prints flat, and nothing is decided.
 */
const FORCED_BREAK = 2;
type Mode = typeof BREAK | typeof FLAT;

const grow32 = (a: Int32Array) => {
  const g = new Int32Array(a.length * 2);
  g.set(a);
  return g;
};
/**
 * Shortens save stack `a` to `len`: popping, as V8 takes `a.length = len` through the runtime even when nothing
 * changes, and the builder shrinks a stack at every close.
 */
const truncate = (a: number[], len: number) => {
  while (a.length > len) a.pop();
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
/** Line flags: a broken line on a line still empty prints nothing, and one adds an empty line. */
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
  if (v !== k + 1) {
    noMeasure++;
    // Ruff's RemoveSoftLinesBuffer keeps the first variant only: the break parents of the others do not count.
    ifbXbp.push(xbp);
  }
  return v;
}

export function closeVariant(v: number): void {
  close();
  if (v !== (iRef[v] as number) + 1) {
    noMeasure--;
    xbp = ifbXbp.pop() as number;
  }
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
/** What an interval holds itself rather than through an interval inside it (the `OWN_` bits), which `flatBreaks` reads. */
let iOwn = new Uint8Array(1024);
/** It was opened broken: a group's or a choice's own shouldBreak. */
const OWN_BROKEN = 1;
/** A break parent (a hard line's included) was appended directly inside it. */
const OWN_BP = 2;
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
/** Columns a tab in a token takes: ruff counts each as `indent-width` wide, prettier as none. */
let tabWidth = 0;

const tokenWidth = (s: string) => {
  const w = textWidth(s);
  if (tabWidth === 0) return w;
  let tabs = 0;
  for (let i = s.indexOf("\t"); i !== -1; i = s.indexOf("\t", i + 1)) tabs++;
  return w + tabs * tabWidth;
};

export function resetStream(ruff = false, tabs = 0): void {
  ruffSpaces = ruff;
  tabWidth = tabs;
  expandsSeen = false;
  fittingSeen = false;
  choiceSeen = false;
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
  choiceSaves.length = 0;
  spanSaves.length = 0;
  leadAt = -1;
  xbp = 0;
  flatSaves.length = 0;
  ifbXbp.length = 0;
  deadSaves.length = 0;
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
  const w = tokenWidth(s);
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

/**
 * A source token (or, `synthetic`, one a rule inserted, anchored to `node`): an entry of its own, for its anchor.
 * An `imaginary` one counts no width toward its line, as ktfmt's trailing comma, which it adds after the layout.
 */
export function sToken(node: number, s: string, synthetic = false, imaginary = false): void {
  const w = imaginary ? 0 : tokenWidth(s);
  measured(s, w);
  strs.push(s);
  entry(TOKEN, synthetic ? 1 : 0, strs.length - 1, node, w);
  mergeable = false;
}

/**
 * A token whose line breaks are literal (prettier's `literalline`): a measure ends at its first line break and
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
    } else if (lastLine === FRESH) {
      pos += 1;
      runStart = n;
      leadAt = n;
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
 * without them. A hard line that collapses breaks every enclosing group by itself, as prettier's propagateBreaks does.
 */
export function sRuffLine(flags: number): void {
  sLine(flags & (SOFT | HARD));
  eFlag[n - 1] = flags;
  if (flags & HARD && flags & COLLAPSE) bp++;
}

/** Breaks every enclosing group. */
export function sBreakParent(): void {
  bp++;
  xbp++;
  if (op > 0) {
    const k = oIdx[op - 1] as number;
    iOwn[k] = (iOwn[k] as number) | OWN_BP;
  }
}

export function sHardline(): void {
  sLine(HARD);
  sBreakParent();
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
    iOwn = grow8(iOwn);
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
  iOwn[m] = flags & BROKEN ? OWN_BROKEN : 0;
  iStart[m] = n;
  iRef[m] = ref;
  iP0[m] = pos;
  oIdx[op] = m;
  oBp[op] = bp;
  oHard[op] = hard;
  oRefs[op] = refCount;
  op++;
  if (kind === LINE_SUFFIX && noMeasure === 0) lastSfx = m;
  if (kind === IF_BROKEN) {
    noMeasure++;
    ifbXbp.push(xbp);
  } else if (kind === LINE_SUFFIX) noMeasure++;
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

/**
 * Opens prettier's conditionalGroup (`broken`: its shouldBreak). Append each state between `openState` and
 * `closeState`, most compact first, then `closeChoice`. A break inside a state does not break the enclosing
 * groups; `broken` does.
 */
export function openChoice(broken: boolean): number {
  choiceSeen = true;
  choiceSaves.push(pos, lastLine, runStart, lastSfx, bndM, bndSfx);
  choiceSaves.push(0, 0, 0, 0, 0, 0, 0, xbp, xbp);
  return open(CHOICE, -1, broken ? BROKEN : 0);
}

export function openState(): number {
  const b = choiceSaves.length - CHOICE_SAVE;
  if ((choiceSaves[b + 12] as number) > 0) {
    // Measured from its own start, as prettier measures a state: no run of lines reaches in, so no line of
    // it marks the enclosing intervals, which measure the first state only.
    pos = choiceSaves[b] as number;
    lastLine = -1;
    lastSfx = choiceSaves[b + 3] as number;
    bndM = choiceSaves[b + 4] as number;
    bndSfx = choiceSaves[b + 5] as number;
  }
  choiceSaves[b + 14] = xbp;
  return open(STATE);
}

export function closeState(): void {
  const o = op - 1;
  const k = oIdx[o] as number;
  // As a fill item: a measure that must scan, not read the O(1) width.
  const special =
    hard > (oHard[o] as number) ||
    bp > (oBp[o] as number) ||
    refCount > (oRefs[o] as number) ||
    noMeasure > 0;
  close();
  if (special) iFlag[k] = (iFlag[k] as number) | SPECIAL;
  const b = choiceSaves.length - CHOICE_SAVE;
  if ((choiceSaves[b + 12] as number) === 0) {
    choiceSaves[b + 6] = pos;
    choiceSaves[b + 7] = lastLine;
    choiceSaves[b + 8] = runStart;
    choiceSaves[b + 9] = lastSfx;
    choiceSaves[b + 10] = bndM;
    choiceSaves[b + 11] = bndSfx;
  }
  choiceSaves[b + 12] = (choiceSaves[b + 12] as number) + 1;
  iRef[oIdx[op - 1] as number] = k;
}

export function closeChoice(): void {
  const b = choiceSaves.length - CHOICE_SAVE;
  if ((choiceSaves[b + 12] as number) > 0) {
    pos = choiceSaves[b + 6] as number;
    lastLine = choiceSaves[b + 7] as number;
    runStart = choiceSaves[b + 8] as number;
    lastSfx = choiceSaves[b + 9] as number;
    bndM = choiceSaves[b + 10] as number;
    bndSfx = choiceSaves[b + 11] as number;
  }
  // removeLines keeps the last state only.
  xbp = (choiceSaves[b + 13] as number) + xbp - (choiceSaves[b + 14] as number);
  truncate(choiceSaves, b);
  const o = op - 1;
  bp = (oBp[o] as number) + ((iFlag[oIdx[o] as number] as number) & BROKEN ? 1 : 0);
  close();
}

/** Closes the innermost open interval. */
export function close(): void {
  op--;
  const k = oIdx[op] as number;
  const kind = iKind[k] as number;
  iEnd[k] = n;
  iNext[k] = m;
  iP1[k] = pos;
  if (kind === IF_BROKEN) {
    noMeasure--;
    // removeLines keeps an ifBreak's flat branch only.
    xbp = ifbXbp.pop() as number;
  } else if (kind === LINE_SUFFIX) noMeasure--;
  let flags = iFlag[k] as number;
  if (lastLine >= (iStart[k] as number)) flags |= TRAIL;
  const hasBp = bp > (oBp[op] as number);
  const hasHard = hard > (oHard[op] as number);
  if (hasBp) flags |= BREAKS;
  if (hasHard) flags |= HARDS;
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

// --- span ---
/**
 * An interval kind: a part a Doc shares, built once (`openSpan`) and printed again wherever a `JUMP` entry names
 * it (`sJump`). It is built as if nothing were measured before it, so what it holds measures the same wherever
 * it prints, and closes with the effect a jump to it has on the counters around, which `transfer` applies.
 */
export const SPAN = 19;
/** `lastLine` at a span's start: nothing measured in it yet, so a line there is its lead. */
const FRESH = -2;
/** The entry of the first line of the span being built, when it is the first thing measured in it, else -1. */
let leadAt = -1;
/** Per span still open: the builder state it was opened in (`SPAN_SAVE` numbers). */
const spanSaves: number[] = [];
const SPAN_SAVE = 10;
/** Per closed span: what its contents do to the counters around (the `S_` bits). Its `iRef` holds `S_REFS`'s group. */
let spanBits = new Int32Array(1024);
const S_HARD = 1;
const S_BP = 2;
/** Its first measured entry is a line: in a run of lines around, that line's space was already counted. */
const S_LEAD = 4;
/** It measured text or a line: `lastLine` after it is its own. */
const S_TOUCH = 8;
/** It ends in a run of lines. */
const S_RUN = 16;
/** It ends in the run its lead started, with no text: a run around goes on through it. */
const S_LINES_ONLY = 32;
const S_SFX = 64;
const S_BND = 128;
/** A measured line suffix before its measured boundary. */
const S_BND_SFX = 256;
/** It holds an `ifBreak` on a group; `iRef` holds the first such group. */
const S_REFS = 512;
/** It holds a break parent removeLines keeps (`xbp`). */
const S_XBP = 1024;
/**
 * It holds an `ifBreak` on a group inside it, which only a print through a jump reads differently: the first
 * jump runs `scanInnerRefs`, so a span printed only where it was built (a node's print cache) never scans.
 */
const S_INNER = 2048;

/** Opens the span a shared part is built in; close it with `closeSpan`, then print it again with `sJump`. */
export function openSpan(): number {
  spanSaves.push(pos, lastLine, runStart, lastSfx, bndM, bndSfx, noMeasure, refCount, leadAt, xbp);
  lastLine = FRESH;
  runStart = -1;
  lastSfx = -1;
  bndM = -1;
  bndSfx = -1;
  noMeasure = 0;
  leadAt = -1;
  return open(SPAN);
}

export function closeSpan(): void {
  const o = op - 1;
  const t = oIdx[o] as number;
  let bits =
    (hard > (oHard[o] as number) ? S_HARD : 0) | (bp > (oBp[o] as number) ? S_BP : 0);
  close();
  const b = spanSaves.length - SPAN_SAVE;
  if (xbp > (spanSaves[b + 9] as number)) bits |= S_XBP;
  const refs0 = spanSaves[b + 7] as number;
  let first = -1;
  let inner = false;
  for (let r = refs0; r < refCount; r++) {
    const g = refs[r] as number;
    if (first < 0 || g < first) first = g;
    if (g > t) inner = true;
  }
  if (first >= 0) {
    bits |= S_REFS;
    iRef[t] = first;
  }
  if (inner) bits |= S_INNER;
  const endLine = lastLine;
  const endRun = runStart;
  const lead = leadAt;
  if (lead >= 0) bits |= S_LEAD;
  if (endLine !== FRESH) bits |= S_TOUCH;
  if (endLine >= 0) {
    bits |= S_RUN;
    if (lead >= 0 && endRun === lead) bits |= S_LINES_ONLY;
  }
  const flags = iFlag[t] as number;
  if (flags & SFX) bits |= S_SFX;
  if (flags & BND) bits |= S_BND;
  if (flags & SPECIAL) bits |= S_BND_SFX;
  while (t >= spanBits.length) spanBits = grow32(spanBits);
  spanBits[t] = bits;
  pos = spanSaves[b] as number;
  lastLine = spanSaves[b + 1] as number;
  runStart = spanSaves[b + 2] as number;
  lastSfx = spanSaves[b + 3] as number;
  bndM = spanSaves[b + 4] as number;
  bndSfx = spanSaves[b + 5] as number;
  noMeasure = spanSaves[b + 6] as number;
  leadAt = spanSaves[b + 8] as number;
  truncate(spanSaves, b);
  // Its own groups and refs are counted where it was built; the rest is the effect around.
  transfer(bits & ~(S_HARD | S_BP | S_REFS | S_XBP), t, endLine, endRun, lead);
}

/** Prints the closed span `t` here again: a `JUMP` entry, measured as the span's contents would be here. */
export function sJump(t: number): void {
  const bits = spanBits[t] as number;
  if (bits & S_INNER) {
    spanBits[t] = bits & ~S_INNER;
    scanInnerRefs(t);
  }
  const j = n;
  entry(JUMP, 0, t, 0, 0);
  mergeable = false;
  transfer(bits, t, j, j, j);
}

/** Applies span `t`'s effect on the counters around, its last line at `endLine`, its run from `endRun`. */
function transfer(bits: number, t: number, endLine: number, endRun: number, lead: number) {
  if (bits & S_HARD) hard++;
  if (bits & S_BP) bp++;
  if (bits & S_XBP) xbp++;
  if (bits & S_REFS) {
    if (refCount === refs.length) refs = grow32(refs);
    refs[refCount++] = iRef[t] as number;
  }
  if (noMeasure > 0) return;
  // Intervals from `m` on open after it: any index at or past it reads as inside it for those around.
  if (bits & S_BND) {
    bndM = m;
    bndSfx = bits & S_BND_SFX ? m : lastSfx;
  }
  if (bits & S_SFX) lastSfx = m;
  const w = (iP1[t] as number) - (iP0[t] as number);
  if (!ruffSpaces && bits & S_LEAD && lastLine >= 0) {
    // Its lead line joins the run around, whose first line counted the space.
    pos += w - 1;
    for (let o = op - 1; o >= 0; o--) {
      const k = oIdx[o] as number;
      if ((iStart[k] as number) <= runStart || (iFlag[k] as number) & LEAD) break;
      iFlag[k] = (iFlag[k] as number) | LEAD;
    }
    if (bits & S_LINES_ONLY) lastLine = endLine;
    else if (bits & S_RUN) {
      lastLine = endLine;
      runStart = endRun;
    } else lastLine = -1;
    return;
  }
  pos += w;
  if (bits & S_LEAD && lastLine === FRESH) leadAt = lead;
  if (bits & S_RUN) {
    lastLine = endLine;
    runStart = endRun;
  } else if (bits & S_TOUCH) lastLine = -1;
}

/**
 * Printed again through a jump, an `ifBreak` on a group inside span `t` reads that group's mode from the print
 * before, as prettier's printer reads a shared group's: the groups holding it measure by a scan, which reads it.
 */
function scanInnerRefs(t: number) {
  const end = iNext[t] as number;
  const held = new Int32Array(end - t + 1);
  for (let x = t; x < end; x++) {
    const kind = iKind[x] as number;
    held[x - t + 1] =
      (held[x - t] as number) +
      ((kind === IF_BROKEN || kind === IF_FLAT) && (iRef[x] as number) > t ? 1 : 0);
  }
  for (let x = t + 1; x < m; x++) {
    const kind = iKind[x] as number;
    if (
      (kind === GROUP || kind === GROUP_IF_BROKEN || kind === FILL_ITEM || kind === STATE) &&
      (held[(iNext[x] as number) - t] as number) > (held[x + 1 - t] as number)
    )
      iFlag[x] = (iFlag[x] as number) | SPECIAL;
  }
}
// --- end span ---

// --- flat ---
/**
 * An interval kind: prettier's removeLines as a print mode rather than a rebuild, so `FLATTEN{sJump(t)}` prints a
 * shared part flat without building it again. Inside, every line but a hard one prints flat, an `ifBreak` takes
 * its flat branch, a conditional group its last state, and no group or fill item decides anything; a jump prints
 * its span the same way. A break parent (a hard line's included) still breaks the groups around; a group's own
 * shouldBreak does not.
 */
export const FLATTEN = 20;
/**
 * The break parents removeLines keeps: those appended, not a group's shouldBreak, nor one in a conditional group's
 * state before the last or in an `ifBreak`'s broken branch.
 */
let xbp = 0;
/** Per flat interval still open: `xbp`, `pos` and `lastLine` at its start. */
const flatSaves: number[] = [];
/** Per `IF_BROKEN`, and best-fitting variant after the first, still open: `xbp` at its start. */
const ifbXbp: number[] = [];

/**
 * A flat part's `iRef` when `openFlat(true)` opened it, as the JS printer flattens a template substitution: a
 * conditional group takes its first state rather than its last, as prettier's printDocToString does at an
 * infinite width.
 */
const FIRST_STATES = 1;
/** A print mode bit, set with `FORCED_BREAK` inside a `FIRST_STATES` flat part: a choice prints its first state. */
const FIRST = 4;
const isFirstStates = (k: number) => iKind[k] === FLATTEN && iRef[k] === FIRST_STATES;
/** The mode flat part `k` gives what it holds, when it is entered in `mode`. */
const flatMode = (k: number, mode: number) =>
  (mode & FLAT) | FORCED_BREAK | (iRef[k] === FIRST_STATES ? FIRST : 0);

/**
 * Opens a removeLines part; close it with `closeFlat`. With `firstStates` it is the JS printer's flatten of a
 * template substitution instead, which is the same except that a conditional group takes its first state.
 */
export function openFlat(firstStates = false): number {
  flatSaves.push(xbp, pos, lastLine);
  // The groups around measure it by a scan, which reads its mode, rather than by the width it was built with.
  hard++;
  const k = open(FLATTEN, firstStates ? FIRST_STATES : -1);
  // A line inside is removeLines' text, which no run of lines around goes on through.
  lastLine = -1;
  return k;
}

export function closeFlat(): void {
  const b = flatSaves.length - 3;
  const k = oIdx[op - 1] as number;
  const first = iRef[k] === FIRST_STATES;
  bp = (oBp[op - 1] as number) + (!first && xbp > (flatSaves[b] as number) ? 1 : 0);
  close();
  if (first) {
    // `xbp` counted the break parents in each choice's last state, but this part keeps those in its first.
    const keeps = flatBreaks(k, true, false);
    xbp = (flatSaves[b] as number) + (keeps ? 1 : 0);
    if (keeps) {
      bp++;
      iFlag[k] = (iFlag[k] as number) | BREAKS;
    }
  }
  lastLine = pos === flatSaves[b + 1] ? (flatSaves[b + 2] as number) : -1;
  truncate(flatSaves, b);
}
// --- end flat ---

// --- dead ---
/**
 * An interval kind: a part built and then abandoned, as the JS printer abandons an argument it printed expanded
 * when that print throws ArgExpansionBailout. The stream has no rewind, so the part stays, never printed nor
 * measured, and the builder's counters return to where it opened. A span closed inside stays a jump target.
 */
export const DEAD = 21;
/** Per dead interval still open: the interval, `op`, and the builder state it was opened in (`DEAD_SAVE` numbers). */
const deadSaves: number[] = [];
const DEAD_SAVE = 18;

/** Opens a part that may be abandoned; `closeDead` it however far its build got. */
export function openDead(): number {
  const d = open(DEAD);
  deadSaves.push(
    d,
    op - 1,
    pos,
    bp,
    hard,
    noMeasure,
    lastLine,
    runStart,
    refCount,
    lastSfx,
    bndM,
    bndSfx,
    leadAt,
    xbp,
    choiceSaves.length,
    spanSaves.length,
    flatSaves.length,
    ifbXbp.length,
  );
  lastLine = -1;
  return d;
}

/** Closes dead interval `d`, with every interval opened inside it still open, and restores the counters. */
export function closeDead(d: number): void {
  let b = deadSaves.length - DEAD_SAVE;
  // A dead interval opened inside `d` and left open closes with it.
  while (deadSaves[b] !== d) b -= DEAD_SAVE;
  const o = deadSaves[b + 1] as number;
  for (let x = op - 1; x >= o; x--) {
    const k = oIdx[x] as number;
    iEnd[k] = n;
    iNext[k] = m;
    iP1[k] = pos;
  }
  op = o;
  pos = deadSaves[b + 2] as number;
  iP1[d] = pos;
  bp = deadSaves[b + 3] as number;
  hard = deadSaves[b + 4] as number;
  noMeasure = deadSaves[b + 5] as number;
  lastLine = deadSaves[b + 6] as number;
  runStart = deadSaves[b + 7] as number;
  refCount = deadSaves[b + 8] as number;
  lastSfx = deadSaves[b + 9] as number;
  bndM = deadSaves[b + 10] as number;
  bndSfx = deadSaves[b + 11] as number;
  leadAt = deadSaves[b + 12] as number;
  xbp = deadSaves[b + 13] as number;
  truncate(choiceSaves, deadSaves[b + 14] as number);
  truncate(spanSaves, deadSaves[b + 15] as number);
  truncate(flatSaves, deadSaves[b + 16] as number);
  truncate(ifbXbp, deadSaves[b + 17] as number);
  truncate(deadSaves, b);
  mergeable = false;
}
// --- end dead ---

// --- queries ---
// What a rule asks of a part it built, as prettier's and the JS printer's Doc queries ask of a Doc: the part is a
// closed interval, a span when it is only a sequence. Each reads the interval's own entries and intervals, and the
// span of each jump among them.

/**
 * Walks closed interval `k`'s contents as a Doc query reads them: `enter(x)` is asked of each interval inside
 * (false skips it), `entry(i)` of each entry outside a skipped one; either returning true stops the walk.
 */
function walkIn(
  k: number,
  enter: (x: number) => boolean | "stop",
  entryAt: (i: number) => boolean,
): boolean {
  const to = iEnd[k] as number;
  const stop = iNext[k] as number;
  let cur = k + 1;
  let i = iStart[k] as number;
  for (;;) {
    let skipped = false;
    while (cur < stop && iStart[cur] === i) {
      const go = iKind[cur] === DEAD ? false : enter(cur);
      if (go === "stop") return true;
      if (go) cur++;
      else {
        i = iEnd[cur] as number;
        cur = iNext[cur] as number;
        skipped = true;
        break;
      }
    }
    if (skipped) continue;
    if (i >= to) return false;
    if (entryAt(i)) return true;
    i++;
  }
}

/**
 * Prettier's willBreak: whether closed interval `k` holds a break parent (a hard line's included) or a broken
 * group. A choice reads its first state only, as the Doc's contents are that state.
 */
export function willBreak(k: number): boolean {
  const kind = iKind[k] as number;
  // Ruff's will_break reads a best-fitting's most expanded variant.
  if (kind === BEST_FITTING || kind === BEST_FITTING_ALL)
    return (iRef[k] as number) >= 0 && willBreak(iRef[k] as number);
  const flags = iFlag[k] as number;
  if (flags & (BROKEN | BREAKS)) return true;
  if (kind === CHOICE) return (iRef[k] as number) >= 0 && willBreak(k + 1);
  if (kind === FLATTEN) return willBreakFlat(k);
  // The flags miss three breaks: a choice's first state breaks nothing around it, nor do ruff's layouts (a
  // best-fitting, a best-fit-parenthesize, a fitsExpanded), and a hard line need not come with a break parent.
  // Only an interval that may hold one needs the walk.
  const deep = choiceSeen || fittingSeen || expandsSeen;
  if (!deep && !(flags & HARDS)) return false;
  return walkIn(
    k,
    (x) => {
      const kind = iKind[x] as number;
      if (kind === CHOICE || kind === FLATTEN || kind === BEST_FITTING || kind === BEST_FITTING_ALL)
        return willBreak(x) ? "stop" : false;
      // A best-fit-parenthesize's parentheses are not its contents.
      if (kind === PAREN) return false;
      if (
        (kind === BEST_FIT_PARENTHESIZE || kind === FITS_EXPANDED || kind === FITS_EXPANDED_BREAKS) &&
        (iFlag[x] as number) & BREAKS
      )
        return "stop";
      return deep || ((iFlag[x] as number) & HARDS) !== 0;
    },
    (i) => isHardLine(i) || (eKind[i] === JUMP && willBreak(eStr[i] as number)),
  );
}

const isHardLine = (i: number) =>
  eKind[i] === LINE && ((eFlag[i] as number) & (HARD | BOUNDARY)) === HARD;

/**
 * `willBreak` of a flat part, as prettier asks it of what removeLines rebuilt: its flags count the break parents
 * removeLines keeps, and its hard lines count only where removeLines keeps them: a choice's in its last state,
 * an `ifBreak`'s in its flat branch.
 */
function willBreakFlat(k: number, first = isFirstStates(k)): boolean {
  const flags = iFlag[k] as number;
  if (flags & BREAKS && iKind[k] === FLATTEN) return true;
  if (!(flags & HARDS)) return false;
  return walkIn(
    k,
    (x) => {
      const kind = iKind[x] as number;
      // Ruff's RemoveSoftLinesBuffer keeps a best-fitting's first variant, a best-fit-parenthesize's contents.
      if (kind === BEST_FITTING || kind === BEST_FITTING_ALL)
        return (iRef[x] as number) >= 0 && willBreakFlat(x + 1, first) ? "stop" : false;
      if (kind === IF_BROKEN || kind === PAREN) return false;
      if (isFirstStates(x)) return willBreakFlat(x) ? "stop" : false;
      if (kind !== CHOICE) return ((iFlag[x] as number) & HARDS) !== 0;
      const last = iRef[x] as number;
      return last >= 0 && willBreakFlat(first ? x + 1 : last, first) ? "stop" : false;
    },
    (i) => isHardLine(i) || (eKind[i] === JUMP && willBreakFlat(eStr[i] as number, first)),
  );
}

/**
 * The JS printer's canBreak: whether closed interval `k` holds a line, in any state of a choice or branch; inside
 * a flat part (`hardOnly`), a hard line, the only kind removeLines keeps.
 */
export function canBreak(
  k: number,
  hardOnly = iKind[k] === FLATTEN,
  first = isFirstStates(k),
): boolean {
  return walkIn(
    k,
    (x) => {
      // A flattened substitution holds only its choices' first states and its ifBreaks' flat branches.
      if (isFirstStates(x)) return canBreak(x, true, true) ? "stop" : false;
      if (first) {
        if (iKind[x] === IF_BROKEN) return false;
        if (iKind[x] === CHOICE)
          return (iRef[x] as number) >= 0 && canBreak(x + 1, true, true) ? "stop" : false;
      }
      return hardOnly || iKind[x] !== FLATTEN || (canBreak(x, true) ? "stop" : false);
    },
    (i) =>
      (eKind[i] === LINE &&
        !((eFlag[i] as number) & BOUNDARY) &&
        (!hardOnly || ((eFlag[i] as number) & HARD) !== 0)) ||
      (eKind[i] === JUMP && canBreak(eStr[i] as number, hardOnly, first)),
  );
}

/**
 * Whether closed interval `k`, printed flat, holds a break parent that stays there. A flat print takes a
 * choice's first state when `first` holds, its last state otherwise, and an `ifBreak`'s flat branch. `strict` is
 * the JS printer's flatten of a template substitution, which gives up on any part that would print a line break.
 * So under `strict` a hard line counts too, as does a text or token holding a line break, and, when `first`
 * holds, a group's or a choice's own shouldBreak, which removeLines drops.
 */
function flatBreaks(k: number, first: boolean, strict: boolean): boolean {
  const own = (x: number) =>
    ((iOwn[x] as number) & OWN_BP) !== 0 ||
    (strict &&
      first &&
      ((iOwn[x] as number) & OWN_BROKEN) !== 0 &&
      (iKind[x] === GROUP || iKind[x] === CHOICE));
  if (own(k)) return true;
  return walkIn(
    k,
    (x) => {
      const kind = iKind[x] as number;
      if (kind === IF_BROKEN) return false;
      if (kind === FLATTEN) return flatBreaks(x, iRef[x] === FIRST_STATES, strict) ? "stop" : false;
      if (own(x)) return "stop";
      if (kind !== CHOICE) return true;
      const last = iRef[x] as number;
      return last >= 0 && flatBreaks(first ? x + 1 : last, first, strict) ? "stop" : false;
    },
    (i) => {
      const kind = eKind[i] as number;
      if (kind === JUMP) return flatBreaks(eStr[i] as number, first, strict);
      if (!strict) return false;
      if (kind === LINE) return isHardLine(i);
      return (strs[eStr[i] as number] as string).includes("\n");
    },
  );
}

/**
 * Whether the JS printer's flatten of a template substitution gives up on closed interval `k`. That is, whether
 * `k`, printed at an infinite width with each choice in its first state, would hold a line break: a hard line, a
 * break parent, a group that must break, or a text spanning lines. When it would not, `openFlat(true)` prints it
 * that way.
 */
export const flattenBreaks = (k: number): boolean => flatBreaks(k, true, true);

/**
 * The JS printer's docText: the text closed interval `k` prints when it holds only text in unbroken groups (no
 * line, choice, break parent or other interval), else undefined.
 */
export function flatText(k: number): string | undefined {
  const textual = (x: number) => {
    const kind = iKind[x] as number;
    return (
      ((kind === GROUP && !((iFlag[x] as number) & BROKEN)) ||
        kind === SPAN ||
        kind === LITERAL_TOKEN) &&
      !((iFlag[x] as number) & BREAKS)
    );
  };
  if (!textual(k)) return undefined;
  let out = "";
  const failed = walkIn(
    k,
    (x) => (textual(x) ? true : "stop"),
    (i) => {
      const kind = eKind[i] as number;
      if (kind === TEXT || kind === TOKEN) {
        out += strs[eStr[i] as number] as string;
        return false;
      }
      if (kind === JUMP) {
        const s = flatText(eStr[i] as number);
        if (s === undefined) return true;
        out += s;
        return false;
      }
      return true;
    },
  );
  return failed ? undefined : out;
}

/**
 * The width closed interval `k` measured flat as it was built, a conditional group's first state: what a group's
 * fits reads. The JS printer pads a jest `each` table's cells by it.
 */
export const flatWidth = (k: number): number => (iP1[k] as number) - (iP0[k] as number);

/** What closed interval `k` is: its kind (`GROUP`, `CHOICE`, `FILL`, `SPAN`, ...) and its parts in order. */
export interface Shape {
  readonly kind: number;
  /** A choice's states, a fill's items; else none. */
  readonly parts: readonly number[];
}

export function shape(k: number): Shape {
  const kind = iKind[k] as number;
  const parts: number[] = [];
  if (kind === CHOICE || kind === FILL)
    for (let x = k + 1; x < (iNext[k] as number); x = iNext[x] as number)
      if (iKind[x] === (kind === CHOICE ? STATE : FILL_ITEM)) parts.push(x);
  return { kind, parts };
}
// --- end queries ---

/** What `printStream` returns: the text, and each printed token's stream entry and output offset. */
export interface StreamPrinted {
  text: string;
  /** Per printed token, in output order: its node, text length, whether synthetic, and its UTF-16 offset. */
  nodes: Int32Array;
  lengths: Int32Array;
  synthetic: Uint8Array;
  at: Int32Array;
}

export interface Layout {
  lineWidth: number;
  indentWidth: number;
  useTabs: boolean;
  /**
   * Measure as ruff's printer does rather than prettier's: a space counts where it stands, a group measured
   * inside another records its mode for the `ifBreak`s that follow it, and any printed line break makes the
   * next group measure afresh.
   */
  ruff?: boolean;
}

/** Prettier's indentation: each level an indent or an alignment, rendered to `value` spanning `length` columns. */
export interface Indentation {
  readonly value: string;
  readonly length: number;
  readonly queue: readonly (number | string | "indent")[];
  /** The indentation one indent deeper, by id, built once: the printer and every width check step into it. */
  indented: number;
  /** The alignments already built from this one, by step. */
  aligned: Map<number | string, number> | undefined;
}

// Prettier's generateIndent: alignment runs are spaces, or with tabs one tab each once an indent follows them.
// A negative step drops the innermost level instead (prettier's dedent).
export function renderIndentation(
  from: Indentation,
  step: number | string | "indent",
  layout: Layout,
): Indentation {
  const queue =
    typeof step === "number" && step < 0
      ? from.queue.slice(0, -1)
      : [...from.queue, step];
  let value = "";
  let length = 0;
  let lastTabs = 0;
  let lastSpaces = 0;
  const flushSpaces = () => {
    value += " ".repeat(lastSpaces);
    length += lastSpaces;
    lastTabs = 0;
    lastSpaces = 0;
  };
  const flushTabs = () => {
    value += "\t".repeat(lastTabs);
    length += layout.indentWidth * lastTabs;
    lastTabs = 0;
    lastSpaces = 0;
  };
  for (const s of queue) {
    if (s === "indent") {
      if (layout.useTabs) {
        flushTabs();
        value += "\t";
      } else {
        flushSpaces();
        value += " ".repeat(layout.indentWidth);
      }
      length += layout.indentWidth;
    } else if (typeof s === "string") {
      if (layout.useTabs) flushTabs();
      else flushSpaces();
      value += s;
      length += s.length;
    } else {
      lastTabs += 1;
      lastSpaces += s;
    }
  }
  flushSpaces();
  return { value, length, queue, indented: -1, aligned: undefined };
}

/** Prints the stream built since `resetStream`, as prettier's printer would print the equivalent Doc. */
export function printStream(layout: Layout): StreamPrinted {
  const ruff = layout.ruff === true;
  if (ruff !== ruffSpaces)
    throw new Error("printStream: reset the stream with the layout's ruff");
  if (op !== 0) throw new Error(`printStream: ${op} intervals left open`);
  const lineWidth = layout.lineWidth;
  // Indentations by id, as prettier's printer builds them: each one step (an indent or an alignment) deeper than
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

  // --- span ---
  // The jumps printing stands in, innermost last: each one's base print frame, and the entry and interval after it.
  let jFp = new Int32Array(16);
  let jRet = new Int32Array(16);
  let jCur = new Int32Array(16);
  let jp = 0;
  // A measure's own: the jumps it entered, by the depth of their frame, and the entry and interval after each.
  let mjLs = new Int32Array(16);
  let mjRet = new Int32Array(16);
  let mjCur = new Int32Array(16);
  // --- end span ---

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
    // The jumps this measure entered, and the print frames of the jumps printing stands in, innermost last.
    let mj = 0;
    let pj = jp - 1;
    for (;;) {
      while (ls > 0 && (lEnd[ls - 1] as number) <= i) {
        ls--;
        if (mj > 0 && mjLs[mj - 1] === ls) {
          mj--;
          i = mjRet[mj] as number;
          cur = mjCur[mj] as number;
        }
      }
      let mode: number;
      if (ls > 0) mode = lMode[ls - 1] as number;
      else if (i < to) mode = mode0;
      else {
        if (!rest) return true;
        while (lp >= floor && (fEnd[lp] as number) <= i) {
          if (pj >= 0 && jFp[pj] === lp) {
            // Past the span printing jumped into: on after the jump, where nothing measured before reaches.
            i = jRet[pj] as number;
            cur = jCur[pj] as number;
            pj--;
            to = -1;
            allEnd = -1;
            ovEnd = -1;
          }
          lp--;
        }
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
          // removeLines rebuilds a group without its own shouldBreak: broken only by what it holds.
          const broken =
            ((iFlag[k] as number) & (mode < FORCED_BREAK ? BROKEN : BREAKS)) !== 0;
          if (mustBeFlat && broken) return false;
          cur++;
          // Ruff records a measured group's mode for the `ifBreak`s after it.
          if (ruff) groupModes[k] = (broken ? BREAK : mode) + 1;
          if (e > i) {
            // BREAK, or FORCED_BREAK inside a flat part.
            if (broken) mode &= FORCED_BREAK | FIRST;
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
          // Inside a flat part, never BREAK: the flat branch.
          const c = r >= 0 && mode < FORCED_BREAK ? modeOf(r) : mode;
          if ((kind === IF_BROKEN) === (c === BREAK)) cur++;
          else {
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          }
        } else if (kind === FLATTEN) {
          cur++;
          mode = flatMode(k, mode);
          if (e > i) {
            if (ls === lEnd.length) {
              lEnd = grow32(lEnd);
              lMode = grow8(lMode);
            }
            lEnd[ls] = e;
            lMode[ls] = mode;
            ls++;
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
            width = lineWidth - tokenWidth(s.slice(s.lastIndexOf("\n") + 1));
            if (width < 0 && i >= ovEnd) return false;
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          }
          if (pending) width -= 1;
          return width - tokenWidth(s.slice(0, s.indexOf("\n"))) >= 0;
        } else if (kind === GROUP_IF_BROKEN) {
          cur++;
          // Only a broken one under a broken condition changes the mode; it broke every group around it too.
          if (
            mode < FORCED_BREAK &&
            (iFlag[k] as number) & BROKEN &&
            modeOf(iRef[k] as number) === BREAK
          ) {
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
          } else pick[k] = mode >= FORCED_BREAK ? k + 1 : (iRef[k] as number);
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
            // Ruff's RemoveSoftLinesBuffer (elements.ts's) drops an indent inside a flat part.
            if (ruff && mode >= FORCED_BREAK) ind = base;
            else if (kind === INDENT) ind = deeper(base);
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
        } else if (kind === CHOICE) {
          // Prettier's fits reads the first state, or the last one when broken or measured broken; removeLines
          // keeps the last one alone, no group around it, and a flattened substitution the first.
          const broken = mode < FORCED_BREAK && ((iFlag[k] as number) & BROKEN) !== 0;
          if (mustBeFlat && broken) return false;
          const md = broken ? BREAK : mode;
          if (ruff) groupModes[k] = md + 1;
          const last = iRef[k] as number;
          const s = last < 0 ? -1 : mode & FIRST || !(broken || mode !== FLAT) ? k + 1 : last;
          if (e > i) {
            if (ls === lEnd.length) {
              lEnd = grow32(lEnd);
              lMode = grow8(lMode);
            }
            lEnd[ls] = e;
            lMode[ls] = md;
            ls++;
          }
          if (s < 0) {
            i = e;
            cur = iNext[k] as number;
          } else {
            i = iStart[s] as number;
            cur = s + 1;
          }
          jumped = true;
          break;
        } else if (kind === STATE || kind === DEAD) {
          // A state the enclosing choice did not take, or an abandoned part.
          i = e;
          cur = iNext[k] as number;
          jumped = true;
          break;
        } else cur++;
      }
      if (jumped) continue;
      if (eKind[i] === JUMP) {
        const t = eStr[i] as number;
        if ((iEnd[t] as number) > (iStart[t] as number)) {
          // The span's entries come before the jump: bounds past the jump are past them, others end before it.
          if (allEnd <= i) allEnd = -1;
          if (ovEnd <= i) ovEnd = -1;
          while (xs > 0 && (xEnd[xs - 1] as number) <= i) xs--;
          if (ls === lEnd.length) {
            lEnd = grow32(lEnd);
            lMode = grow8(lMode);
          }
          if (mj === mjLs.length) {
            mjLs = grow32(mjLs);
            mjRet = grow32(mjRet);
            mjCur = grow32(mjCur);
          }
          mjLs[mj] = ls;
          mjRet[mj] = i + 1;
          mjCur[mj] = cur;
          mj++;
          lEnd[ls] = iEnd[t] as number;
          lMode[ls] = mode;
          ls++;
          i = iStart[t] as number;
          cur = t + 1;
        } else i++;
        continue;
      }
      if (eKind[i] === LINE) {
        const f = eFlag[i] as number;
        if (f & BOUNDARY) {
          if (seenSuffix) return false;
          i++;
          continue;
        }
        if (mode !== BREAK && !(f & HARD)) {
          if (!(f & SOFT)) {
            if (mode !== FLAT) {
              // removeLines' text " ".
              if (pending) {
                width -= 1;
                pending = false;
              }
              width -= 1;
            } else if (ruff) width -= 1;
            else pending = true;
          }
        } else if (i < allEnd && !(mode & FLAT)) {
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
    // The next item follows the separator's own intervals (an `ifBreak`), which only a scan measures.
    let next = iNext[k] as number;
    let separatorIntervals = false;
    while (
      next < m &&
      iKind[next] !== FILL_ITEM &&
      (iStart[next] as number) < fillEnd
    ) {
      separatorIntervals = true;
      next = iNext[next] as number;
    }
    if (
      next < m &&
      iKind[next] === FILL_ITEM &&
      (iStart[next] as number) < fillEnd
    ) {
      let special = ((flags | (iFlag[next] as number)) & SPECIAL) !== 0;
      if (separatorIntervals) special = true;
      if ((flags | (iFlag[next] as number)) & BND) special = true;
      for (let s = iEnd[k] as number; s < (iStart[next] as number); s++)
        if (
          (eKind[s] === LINE && (eFlag[s] as number) & HARD) ||
          eKind[s] === JUMP
        )
          special = true;
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

  // --- choice ---
  /** The state `decideChoice` took. */
  let picked = 0;
  /** Whether state `s` fits flat in `width`, measured as `decideGroup` measures a group's contents. */
  function stateFits(s: number, width: number): boolean {
    if (width < 0) return false;
    const flags = iFlag[s] as number;
    if (flags & SPECIAL || (flags & BND && sK.length > 0))
      return measure(
        iStart[s] as number,
        iEnd[s] as number,
        s + 1,
        width,
        false,
        FLAT,
        false,
        true,
      );
    const w = flatWidth(s);
    if (w > width) return false;
    const e = iEnd[s] as number;
    suffixIn = (flags & SFX) !== 0;
    return measure(
      e,
      e,
      iNext[s] as number,
      width - w,
      (flags & TRAIL) !== 0,
      FLAT,
      false,
      true,
    );
  }
  /**
   * Prettier's printGroup for a conditional group: the first state flat when it fits, else the first later
   * one that fits flat, else the last one broken; in a flat mode, the first state as the group's own mode. Sets
   * `picked`.
   */
  function decideChoice(k: number, mode: number): Mode {
    const broken = ((iFlag[k] as number) & BROKEN) !== 0;
    const last = iRef[k] as number;
    picked = k + 1;
    if (mode === FLAT && !remeasure) return broken ? BREAK : FLAT;
    remeasure = false;
    if (ruff) groupModes[k] = FLAT + 1;
    if (!broken) {
      const width = lineWidth - column;
      if (stateFits(k + 1, width)) return FLAT;
      for (let s = iNext[k + 1] as number; s < last; s = iNext[s] as number)
        if (stateFits(s, width)) {
          picked = s;
          return FLAT;
        }
    }
    picked = last;
    return BREAK;
  }
  // --- end choice ---

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
            if (tm >= FORCED_BREAK) {
              // Prettier decides removeLines' group, which clears a pending remeasure, but only a hard line in
              // it breaks, and it breaks only by what it holds.
              remeasure = false;
              cur++;
              if (e > i)
                fpush(e, ti, (iFlag[k] as number) & BREAKS ? FORCED_BREAK | (tm & FIRST) : tm);
              break;
            }
            const g = decideGroup(k, tm);
            groupModes[k] = g + 1;
            cur++;
            if (e > i) fpush(e, ti, g);
            break;
          }
          case INDENT:
            cur++;
            // Ruff's RemoveSoftLinesBuffer (elements.ts's) drops an indent inside a flat part.
            if (e > i) fpush(e, ruff && tm >= FORCED_BREAK ? ti : deeper(ti), tm);
            break;
          case IF_BROKEN:
          case IF_FLAT: {
            const r = iRef[k] as number;
            // Inside a flat part, never BREAK: the flat branch.
            const c = r >= 0 && tm < FORCED_BREAK ? modeOf(r) : tm;
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
            // Ruff's RemoveSoftLinesBuffer passes a line suffix through as it is.
            sM.push(ruff ? tm & ~FORCED_BREAK : tm);
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          case FILL:
            if (e > i) {
              cur++;
              fpush(e, ti, tm);
            } else {
              // Empty, it has no frame of its own, and its items would decide the separator mode of the frame
              // around; it prints nothing.
              cur = iNext[k] as number;
              jumped = true;
            }
            break;
          case FILL_ITEM: {
            if (tm >= FORCED_BREAK) {
              cur++;
              if (e > i) fpush(e, ti, tm);
              break;
            }
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
            column = tokenWidth(current);
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
                tm < FORCED_BREAK && (iKind[k] === INDENT_IF_BROKEN) === (c === BREAK)
                  ? deeper(ti)
                  : ti,
                tm,
              );
            break;
          }
          case GROUP_IF_BROKEN: {
            const g =
              tm < FORCED_BREAK && modeOf(iRef[k] as number) === BREAK ? decideGroup(k, tm) : tm;
            cur++;
            if (e > i) fpush(e, ti, g);
            break;
          }
          case FITS_EXPANDED:
          case FITS_EXPANDED_BREAKS: {
            const r = iRef[k] as number;
            if (tm < FORCED_BREAK && (r < 0 || modeOf(r) === FLAT)) remeasure = true;
            cur++;
            break;
          }
          case BEST_FIT_PARENTHESIZE: {
            groupModes[k] = FLAT + 1;
            // Inside a flat part, its contents alone, as ruff's RemoveSoftLinesBuffer (elements.ts's) keeps.
            let g: number = tm >= FORCED_BREAK ? tm : FLAT;
            if (tm < FORCED_BREAK && (tm !== FLAT || remeasure)) {
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
            // Inside a flat part, its first variant, as ruff's RemoveSoftLinesBuffer keeps.
            if ((tm === FLAT && !remeasure) || tm >= FORCED_BREAK) {
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
              if (e > i) fpush(e, ti, tm >= FORCED_BREAK ? tm : modeOf(p));
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
          case CHOICE: {
            if ((iRef[k] as number) < 0) {
              i = e;
              cur = iNext[k] as number;
              jumped = true;
              break;
            }
            if (tm >= FORCED_BREAK) {
              // removeLines keeps the last state alone, no group around it; a flattened substitution the first.
              picked = tm & FIRST ? k + 1 : (iRef[k] as number);
              if (e > i) fpush(e, ti, tm);
            } else {
              const g = decideChoice(k, tm);
              groupModes[k] = g + 1;
              if (e > i) fpush(e, ti, g);
            }
            i = iStart[picked] as number;
            cur = picked + 1;
            jumped = true;
            break;
          }
          case FLATTEN:
            cur++;
            if (e > i) fpush(e, ti, flatMode(k, tm));
            break;
          case STATE:
          case DEAD:
            // A state the enclosing choice did not take, or an abandoned part.
            i = e;
            cur = iNext[k] as number;
            jumped = true;
            break;
          case SPAN:
            cur++;
            break;
          default:
            throw new Error(`printStream: unknown interval kind ${iKind[k]}`);
        }
        if (jumped) break;
      }
      if (jumped) continue;
      const md = fMode[fp - 1] as number;
      if (eKind[i] === JUMP) {
        const t = eStr[i] as number;
        if (jp === jFp.length) {
          jFp = grow32(jFp);
          jRet = grow32(jRet);
          jCur = grow32(jCur);
        }
        jFp[jp] = fp;
        jRet[jp] = i + 1;
        jCur[jp] = cur;
        jp++;
        run(iStart[t] as number, iEnd[t] as number, t + 1, fInd[fp - 1] as number, md);
        jp--;
        i++;
        continue;
      }
      if (eKind[i] === LINE) {
        const f = eFlag[i] as number;
        if (f & BOUNDARY && sK.length === 0) {
          i++;
          continue;
        }
        if (md !== BREAK && !(f & HARD)) {
          if (!(f & SOFT)) {
            current += " ";
            length += 1;
            column += 1;
          }
        } else {
          // A hard break inside a flat group (FLAT or FORCED_BREAK | FLAT): the next group must measure afresh.
          if (md & FLAT || ruff) remeasure = true;
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
