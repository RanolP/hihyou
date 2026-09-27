import {
  ALIGN,
  ALL_LINES,
  alignOf,
  BEST_FIT_PARENTHESIZE,
  BEST_FITTING,
  BREAK_PARENT,
  BROKEN,
  buf,
  COLLAPSE,
  type Doc,
  type DocHandle,
  docCount,
  deref,
  EXPANDS,
  FILL,
  FITS_EXPANDED,
  GROUP,
  GROUP_IF_BREAK,
  HARD,
  hardline,
  IF_BREAK,
  INDENT,
  LINE,
  LINE_SUFFIX,
  LINE_SUFFIX_BOUNDARY,
  LITERAL,
  lineOf,
  NONE,
  nodes,
  SOFT,
  STATES,
  strs,
  SYNTHETIC,
  BLANK,
  TEXT,
  TOKEN,
  type TokenNode,
} from "./doc.js";
import {
  type Indentation,
  type Layout,
  renderIndentation as render,
} from "./stream.js";
import { textWidth } from "./width.js";

/** A source token as printed: its node, its text, and whether a rule inserted it (see `synthetic`). */
export interface PlacedToken {
  readonly node: TokenNode;
  readonly text: string;
  readonly synthetic: boolean;
}
/**
 * The source tokens in output order and, at the same index of `at`, the UTF-16 offset in the output where each
 * one's text starts: parallel arrays rather than an object per token, since every pass places every token.
 */
export interface Placed {
  tokens: PlacedToken[];
  at: Int32Array;
}

const hardLine = lineOf(HARD);
const BREAK = 0;
const FLAT = 1;
type Mode = typeof BREAK | typeof FLAT;
// How many lines a width check counts: the first, all, or all with any width (inside `fitsExpanded`, only the
// text around it).
const FIRST_LINE = 0;
const ALL = 1;
const OVERFLOW = 2;

function unknownDoc(kind: number): never {
  throw new Error(`unknown doc kind ${kind}`);
}

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

/** Prints `doc` as prettier's printer would, returning the text and where each source token was placed. */
export function print(
  doc: Doc,
  layout: Layout,
): { text: string; placed: Placed } {
  // Nothing is built while printing, so the buffer is fixed from here on.
  const b = buf;
  const count = docCount();
  const ruff = layout.ruff === true;
  // A group's printed mode, by handle: 0 unset (read as flat), else mode + 1.
  const groupModes = new Uint8Array(count);
  const modeOf = (g: number): Mode =>
    groupModes[g] === BREAK + 1 ? BREAK : FLAT;

  const indents: Indentation[] = [
    { value: "", length: 0, queue: [], indented: -1, aligned: undefined },
  ];
  const deeper = (from: number): number => {
    const f = indents[from] as Indentation;
    if (f.indented < 0) {
      indents.push(render(f, "indent", layout));
      f.indented = indents.length - 1;
    }
    return f.indented;
  };
  // Prettier's align: `-Infinity` back to the root, nothing for `0` or `""`, else one alignment step deeper.
  const aligned = (from: number, n: number | string): number => {
    if (n === Number.NEGATIVE_INFINITY) return 0;
    if (n === 0 || n === "") return from;
    const f = indents[from] as Indentation;
    f.aligned ??= new Map();
    let id = f.aligned.get(n);
    if (id === undefined) {
      indents.push(render(f, n, layout));
      id = indents.length - 1;
      f.aligned.set(n, id);
    }
    return id;
  };

  // A token's or a text's width, measured once and kept in its third slot.
  const widthOf = (h: number, s: string): number => {
    let w = b[h * 4 + 3] as number;
    if (w < 0) {
      w = textWidth(s);
      b[h * 4 + 3] = w;
    }
    return w;
  };

  propagateBreaks(b, count);

  // The print stack: a doc and its indentation, mode, and (for a fill) the index of its first unprinted part.
  const pDoc: Doc[] = [];
  let pInd = new Int32Array(256);
  let pMode = new Uint8Array(256);
  let pAux = new Int32Array(256);
  let pp = 0;
  const push = (d: Doc, ind: number, mode: Mode, aux = 0) => {
    if (pp === pInd.length) {
      pInd = grow32(pInd);
      pMode = grow8(pMode);
      pAux = grow32(pAux);
    }
    pDoc[pp] = d;
    pInd[pp] = ind;
    pMode[pp] = mode;
    pAux[pp] = aux;
    pp++;
  };
  // Line suffixes waiting for the next line break.
  const sDoc: Doc[] = [];
  const sInd: number[] = [];
  const sMode: Mode[] = [];
  const flushSuffixes = () => {
    for (let i = sDoc.length - 1; i >= 0; i--)
      push(sDoc[i] as Doc, sInd[i] as number, sMode[i] as Mode);
    sDoc.length = 0;
    sInd.length = 0;
    sMode.length = 0;
  };

  // The width-check stack: as the print stack, plus how many lines each entry measures.
  const fDoc: Doc[] = [];
  let fInd = new Int32Array(256);
  let fMode = new Uint8Array(256);
  let fAll = new Uint8Array(256);
  let fAux = new Int32Array(256);
  let fp = 0;
  const fpush = (d: Doc, ind: number, mode: number, all: number, aux = 0) => {
    if (fp === fInd.length) {
      fInd = grow32(fInd);
      fMode = grow8(fMode);
      fAll = grow8(fAll);
      fAux = grow32(fAux);
    }
    fDoc[fp] = d;
    fInd[fp] = ind;
    fMode[fp] = mode;
    fAll[fp] = all;
    fAux[fp] = aux;
    fp++;
  };

  /**
   * Whether what `fpush` put on the width-check stack fits in `width` columns up to its first line break; when
   * it runs out, the print stack's entries below `restTop` are measured too, in their own modes. `mustBeFlat`
   * rejects any already-broken group. A space from a line counts only once text follows it, as it would be
   * trimmed at a line end. An entry pushed as `ALL` measures every line it breaks into, not only the first.
   */
  function fits(
    restTop: number,
    width: number,
    mustBeFlat: boolean,
    hasLineSuffix: boolean,
  ): boolean {
    if (width < 0) {
      fp = 0;
      return false;
    }
    let restIdx = restTop;
    let pendingSpace = false;
    for (;;) {
      let d: Doc;
      let ind: number;
      let mode: number;
      let all: number;
      let aux: number;
      if (fp > 0) {
        fp--;
        d = fDoc[fp] as Doc;
        ind = fInd[fp] as number;
        mode = fMode[fp] as number;
        all = fAll[fp] as number;
        aux = fAux[fp] as number;
      } else if (restIdx > 0) {
        restIdx--;
        d = pDoc[restIdx] as Doc;
        ind = pInd[restIdx] as number;
        mode = pMode[restIdx] as number;
        all = FIRST_LINE;
        aux = pAux[restIdx] as number;
      } else return true;
      if (typeof d !== "number") {
        const ds = d as readonly Doc[];
        for (let i = ds.length - 1; i >= 0; i--)
          fpush(ds[i] as Doc, ind, mode, all);
        continue;
      }
      const at = d * 4;
      const head = b[at] as number;
      const kind = head & 0xff;
      const flags = head >>> 8;
      switch (kind) {
        case TOKEN:
        case TEXT: {
          const s = strs[b[at + 2] as number] as string;
          if (s === "") break;
          if (pendingSpace) {
            width -= 1;
            pendingSpace = false;
          }
          const newline = flags & LITERAL ? s.indexOf("\n") : -1;
          if (newline < 0) {
            width -= widthOf(d, s);
            break;
          }
          if (ruff && mustBeFlat) {
            fp = 0;
            return false;
          }
          width -= textWidth(s.slice(0, newline));
          if (all === FIRST_LINE) {
            fp = 0;
            return width >= 0;
          }
          width =
            layout.lineWidth - textWidth(s.slice(s.lastIndexOf("\n") + 1));
          break;
        }
        case FITS_EXPANDED: {
          const contents = deref(b[at + 1] as number);
          const whenFlat = b[at + 2] as number;
          if (mode === BREAK) fpush(contents, ind, mode, all);
          else if (whenFlat === NONE || modeOf(whenFlat) === FLAT)
            fpush(contents, ind, BREAK, OVERFLOW);
          else if (flags & EXPANDS) {
            fp = 0;
            return false;
          } else fpush(contents, ind, mode, all);
          break;
        }
        case INDENT:
          fpush(deref(b[at + 1] as number), deeper(ind), mode, all);
          break;
        case ALIGN:
          fpush(
            deref(b[at + 1] as number),
            aligned(ind, alignOf(d)),
            mode,
            all,
          );
          break;
        case FILL: {
          const parts = deref(b[at + 1] as number) as readonly Doc[];
          for (let i = parts.length - 1; i >= aux; i--)
            fpush(parts[i] as Doc, ind, mode, all);
          break;
        }
        case GROUP: {
          const broken = (flags & BROKEN) !== 0;
          if (mustBeFlat && broken) {
            fp = 0;
            return false;
          }
          const m = broken ? BREAK : mode;
          if (ruff) groupModes[d] = m + 1;
          const last =
            (broken || mode === BREAK) && flags & STATES
              ? (deref(b[at + 2] as number) as readonly Doc[]).at(-1)
              : undefined;
          fpush(last ?? deref(b[at + 1] as number), ind, m, all);
          break;
        }
        case GROUP_IF_BREAK:
          if (modeOf(b[at + 2] as number) === BREAK) {
            const broken = (flags & BROKEN) !== 0;
            if (mustBeFlat && broken) {
              fp = 0;
              return false;
            }
            fpush(deref(b[at + 1] as number), ind, broken ? BREAK : mode, all);
          } else fpush(deref(b[at + 1] as number), ind, mode, all);
          break;
        case LINE:
          if (mode === FLAT && !(flags & HARD)) {
            if (flags & SOFT) break;
            if (ruff) width -= 1;
            else pendingSpace = true;
            break;
          }
          if (mode === FLAT || all === FIRST_LINE) {
            fp = 0;
            return true;
          }
          width = layout.lineWidth - (indents[ind] as Indentation).length;
          pendingSpace = false;
          break;
        case IF_BREAK: {
          const g = b[at + 3] as number;
          const m = g !== NONE ? modeOf(g) : mode;
          fpush(deref(b[at + (m === BREAK ? 1 : 2)] as number), ind, mode, all);
          break;
        }
        case BEST_FITTING: {
          const variants = deref(b[at + 1] as number) as readonly Doc[];
          if (mode === FLAT)
            fpush(
              variants[0] ?? [],
              ind,
              mode,
              flags & ALL_LINES ? ALL : FIRST_LINE,
            );
          else fpush(variants.at(-1) ?? [], ind, mode, all);
          break;
        }
        case BEST_FIT_PARENTHESIZE:
          if (ruff) groupModes[d] = mode + 1;
          fpush(deref(b[at + 2] as number), ind, mode, all);
          break;
        case LINE_SUFFIX: {
          const reserved = b[at + 2] as number;
          width -= reserved;
          if (ruff && reserved && width < 0) {
            fp = 0;
            return false;
          }
          hasLineSuffix = true;
          break;
        }
        case LINE_SUFFIX_BOUNDARY:
          if (hasLineSuffix) {
            fp = 0;
            return false;
          }
          break;
        case BREAK_PARENT:
          break;
        default:
          unknownDoc(kind);
      }
      if (width < 0 && all !== OVERFLOW) {
        fp = 0;
        return false;
      }
    }
  }

  // Finished lines, each followed by its line break; the line being printed is `current`, so a line end trims
  // one string instead of walking back over the pieces of the line.
  const out: string[] = [];
  let current = "";
  let length = 0;
  let column = 0;
  // Where the text of the current line starts, after its indentation.
  let lineStart = 0;
  const tokens: PlacedToken[] = [];
  let placedAt = new Int32Array(1024);
  let remeasure = false;
  const endLine = () => {
    out.push(current, "\n");
    current = "";
    length += 1;
  };
  // A literal token's breaks restart the column, at the root indentation as prettier's literalline does. Its
  // lines are finished as they are: a line end trims only the line being printed.
  const writeLiteral = (s: string) => {
    const lastBreak = s.lastIndexOf("\n");
    out.push(current + s.slice(0, lastBreak + 1));
    current = s.slice(lastBreak + 1);
    length += s.length;
    column = textWidth(current);
  };
  // Trailing spaces and tabs go when a line ends; tokens never end in either, so no placement moves.
  const trimLineEnd = () => {
    let end = current.length;
    for (let c = current.charCodeAt(end - 1); c === 32 || c === 9;)
      c = current.charCodeAt(--end - 1);
    if (end === current.length) return;
    length -= current.length - end;
    current = current.slice(0, end);
  };

  push(doc, 0, BREAK);
  for (;;) {
    if (pp === 0) {
      if (sDoc.length === 0) break;
      flushSuffixes();
    }
    pp--;
    const d = pDoc[pp] as Doc;
    const ind = pInd[pp] as number;
    const mode = pMode[pp] as Mode;
    const aux = pAux[pp] as number;
    if (typeof d !== "number") {
      const ds = d as readonly Doc[];
      for (let i = ds.length - 1; i >= 0; i--) push(ds[i] as Doc, ind, mode);
      continue;
    }
    const at = d * 4;
    const head = b[at] as number;
    const kind = head & 0xff;
    const flags = head >>> 8;
    switch (kind) {
      case TOKEN: {
        const s = strs[b[at + 2] as number] as string;
        if (tokens.length === placedAt.length) {
          const grown = new Int32Array(placedAt.length * 2);
          grown.set(placedAt);
          placedAt = grown;
        }
        placedAt[tokens.length] = length;
        tokens.push({
          node: nodes[b[at + 1] as number] as TokenNode,
          text: s,
          synthetic: (flags & SYNTHETIC) !== 0,
        });
        if (flags & LITERAL && s.includes("\n")) {
          writeLiteral(s);
          if (ruff) remeasure = true;
        } else {
          current += s;
          length += s.length;
          column += widthOf(d, s);
        }
        break;
      }
      case TEXT: {
        const s = strs[b[at + 2] as number] as string;
        current += s;
        length += s.length;
        column += widthOf(d, s);
        break;
      }
      case INDENT:
        push(deref(b[at + 1] as number), deeper(ind), mode);
        break;
      case ALIGN:
        push(deref(b[at + 1] as number), aligned(ind, alignOf(d)), mode);
        break;
      case GROUP:
        printGroup(d, kind, flags, ind, mode);
        break;
      case GROUP_IF_BREAK:
        if (modeOf(b[at + 2] as number) === BREAK)
          printGroup(d, kind, flags, ind, mode);
        else push(deref(b[at + 1] as number), ind, mode);
        break;
      case FILL:
        printFill(d, ind, mode, aux);
        break;
      case LINE: {
        if (mode === FLAT && !(flags & HARD)) {
          if (!(flags & SOFT)) {
            current += " ";
            length += 1;
            column += 1;
          }
          break;
        }
        // A hard break inside a flat group: the next group must measure afresh.
        if (mode === FLAT || ruff) remeasure = true;
        if (sDoc.length > 0) {
          push(d, ind, mode, aux);
          flushSuffixes();
          break;
        }
        trimLineEnd();
        if (!(flags & COLLAPSE) || length > lineStart) endLine();
        if (flags & BLANK) endLine();
        const indentation = indents[ind] as Indentation;
        current += indentation.value;
        length += indentation.value.length;
        column = indentation.length;
        lineStart = length;
        break;
      }
      case FITS_EXPANDED: {
        const whenFlat = b[at + 2] as number;
        if (whenFlat === NONE || modeOf(whenFlat) === FLAT) remeasure = true;
        push(deref(b[at + 1] as number), ind, mode);
        break;
      }
      case IF_BREAK: {
        const g = b[at + 3] as number;
        const m = g !== NONE ? modeOf(g) : mode;
        push(deref(b[at + (m === BREAK ? 1 : 2)] as number), ind, mode);
        break;
      }
      case LINE_SUFFIX:
        sDoc.push(deref(b[at + 1] as number));
        sInd.push(ind);
        sMode.push(mode);
        column += b[at + 2] as number;
        break;
      case BEST_FITTING:
        printBestFitting(d, flags, ind, mode);
        break;
      case BEST_FIT_PARENTHESIZE:
        printBestFitParenthesize(d, ind, mode);
        break;
      case LINE_SUFFIX_BOUNDARY:
        if (sDoc.length > 0) push(hardLine, ind, mode);
        break;
      case BREAK_PARENT:
        break;
      default:
        unknownDoc(kind);
    }
  }
  out.push(current);
  return {
    text: out.join(""),
    placed: { tokens, at: placedAt.subarray(0, tokens.length) },
  };

  function printGroup(
    g: number,
    kind: number,
    flags: number,
    ind: number,
    mode: Mode,
  ) {
    const at = g * 4;
    const contents = deref(b[at + 1] as number);
    const broken = (flags & BROKEN) !== 0;
    let chosen = contents;
    let m: Mode;
    if (mode === FLAT && !remeasure) m = broken ? BREAK : FLAT;
    else {
      remeasure = false;
      // Ruff measures a group's contents as flat, so an `ifBreak` on the group itself reads flat meanwhile.
      if (ruff && kind === GROUP) groupModes[g] = FLAT + 1;
      const width = layout.lineWidth - column;
      const suffix = sDoc.length > 0;
      m = BREAK;
      if (!broken) {
        fpush(contents, ind, FLAT, FIRST_LINE);
        if (fits(pp, width, false, suffix)) m = FLAT;
      }
      if (m === BREAK && kind === GROUP && flags & STATES) {
        const states = deref(b[at + 2] as number) as readonly Doc[];
        if (!broken)
          for (let i = 1; i < states.length - 1; i++) {
            fpush(states[i] as Doc, ind, FLAT, FIRST_LINE);
            if (fits(pp, width, false, suffix)) {
              chosen = states[i] as Doc;
              m = FLAT;
              break;
            }
          }
        if (m === BREAK) chosen = states.at(-1) ?? contents;
      }
    }
    if (kind === GROUP) groupModes[g] = m + 1;
    push(chosen, ind, m);
  }

  function printBestFitting(h: number, flags: number, ind: number, mode: Mode) {
    const variants = deref(b[h * 4 + 1] as number) as readonly Doc[];
    const last = variants.length - 1;
    if (mode === FLAT && !remeasure) {
      push(variants[0] ?? [], ind, FLAT);
      return;
    }
    remeasure = false;
    const width = layout.lineWidth - column;
    const all = flags & ALL_LINES ? ALL : FIRST_LINE;
    for (let i = 0; i < last; i++) {
      fpush(variants[i] as Doc, ind, FLAT, all);
      if (fits(pp, width, false, sDoc.length > 0)) {
        push(variants[i] as Doc, ind, FLAT);
        return;
      }
    }
    push(variants[last] ?? [], ind, BREAK);
  }

  function printBestFitParenthesize(h: number, ind: number, mode: Mode) {
    const at = h * 4;
    const contents = deref(b[at + 2] as number);
    groupModes[h] = FLAT + 1;
    if (mode === FLAT && !remeasure) {
      push(contents, ind, FLAT);
      return;
    }
    remeasure = false;
    const width = layout.lineWidth - column;
    fpush(contents, ind, FLAT, FIRST_LINE);
    if (fits(pp, width, false, sDoc.length > 0)) {
      push(contents, ind, FLAT);
      return;
    }
    groupModes[h] = BREAK + 1;
    // `open`, the contents indented on lines of their own (the node after this one), `close`.
    const open = b[at + 1] as DocHandle;
    const close = b[at + 3] as DocHandle;
    const wrapped = (h + 1) as DocHandle;
    fpush(close, ind, BREAK, ALL);
    fpush(hardline, ind, BREAK, ALL);
    fpush(wrapped, ind, BREAK, ALL);
    fpush(open, ind, BREAK, ALL);
    if (fits(pp, width, false, sDoc.length > 0)) {
      push(close, ind, BREAK);
      push(hardline, ind, BREAK);
      push(wrapped, ind, BREAK);
      push(open, ind, BREAK);
      return;
    }
    groupModes[h] = FLAT + 1;
    // Bare after all, but each group inside measures itself rather than printing flat on trust.
    remeasure = true;
    push(contents, ind, FLAT);
  }

  // Prettier's fill: a separator breaks unless the content before and after it fit on the line together.
  function printFill(h: number, ind: number, mode: Mode, from: number) {
    const width = layout.lineWidth - column;
    const parts = deref(b[h * 4 + 1] as number) as readonly Doc[];
    const content = parts[from];
    const separator = parts[from + 1];
    const second = parts[from + 2];
    if (content === undefined) return;
    const suffix = sDoc.length > 0;
    fpush(content, ind, FLAT, FIRST_LINE);
    const contentFits = fits(0, width, true, suffix);
    const cm = contentFits ? FLAT : BREAK;
    if (separator === undefined) {
      push(content, ind, cm);
      return;
    }
    if (second === undefined) {
      push(separator, ind, cm);
      push(content, ind, cm);
      return;
    }
    push(h as DocHandle, ind, mode, from + 2);
    fpush(second, ind, FLAT, FIRST_LINE);
    fpush(separator, ind, FLAT, FIRST_LINE);
    fpush(content, ind, FLAT, FIRST_LINE);
    if (fits(0, width, true, suffix)) {
      push(separator, ind, FLAT);
      push(content, ind, FLAT);
    } else {
      push(separator, ind, BREAK);
      push(content, ind, cm);
    }
  }
}

/**
 * Marks every group that holds a hard break, directly or through a nested broken group, as broken, in one pass
 * over the buffer. A conditional group is only walked, never marked: which of its states breaks is the printer's
 * choice. A doc may share a part between both branches of an `ifBreak` or between states, so each node is
 * visited once, whatever the paths to it; children are mostly built before their parents, so walking handles in
 * order keeps the recursion shallow.
 */
function propagateBreaks(b: Int32Array, count: number): void {
  // 0 unvisited, 1 holds no break, 2 holds one.
  const memo = new Uint8Array(count);
  const breaks = (d: Doc): boolean => {
    if (typeof d !== "number") {
      // Every part is visited, not only up to the first break: each nested group needs its own mark.
      const ds = d as readonly Doc[];
      let broken = false;
      for (let i = 0; i < ds.length; i++)
        if (breaks(ds[i] as Doc)) broken = true;
      return broken;
    }
    const known = memo[d] as number;
    if (known !== 0) return known === 2;
    const result = visit(d);
    memo[d] = result ? 2 : 1;
    return result;
  };
  const visit = (h: number): boolean => {
    const at = h * 4;
    const head = b[at] as number;
    const flags = head >>> 8;
    switch (head & 0xff) {
      case BREAK_PARENT:
        return true;
      case GROUP:
        if (flags & STATES) {
          for (const state of deref(b[at + 2] as number) as readonly Doc[])
            breaks(state);
          return (flags & BROKEN) !== 0;
        }
        if (breaks(deref(b[at + 1] as number))) {
          b[at] = head | (BROKEN << 8);
          return true;
        }
        return (flags & BROKEN) !== 0;
      case GROUP_IF_BREAK:
        if (breaks(deref(b[at + 1] as number))) {
          b[at] = head | (BROKEN << 8);
          return true;
        }
        return (flags & BROKEN) !== 0;
      case INDENT:
      case ALIGN:
      case LINE_SUFFIX:
      case FILL:
        return breaks(deref(b[at + 1] as number));
      case IF_BREAK: {
        const broken = breaks(deref(b[at + 1] as number));
        return breaks(deref(b[at + 2] as number)) || broken;
      }
      // A variant's breaks are its own: the choice among variants is what decides whether the line breaks.
      case BEST_FITTING:
        breaks(deref(b[at + 1] as number));
        return false;
      case BEST_FIT_PARENTHESIZE:
        breaks(deref(b[at + 2] as number));
        return false;
      case FITS_EXPANDED:
        if (breaks(deref(b[at + 1] as number))) b[at] = head | (EXPANDS << 8);
        return false;
      case TOKEN:
      case TEXT:
      case LINE_SUFFIX_BOUNDARY:
        return false;
      case LINE:
        return (flags & HARD) !== 0 && (flags & COLLAPSE) !== 0;
      default:
        return unknownDoc(head & 0xff);
    }
  };
  for (let h = 1; h < count; h++) breaks(h as DocHandle);
}
