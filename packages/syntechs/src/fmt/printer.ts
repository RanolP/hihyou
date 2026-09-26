import {
  type BestFitParenthesize,
  type BestFitting,
  type Doc,
  type Fill,
  type Group,
  type GroupIfBreak,
  type GroupRef,
  hardline,
  isDocs,
  type Token,
} from "./doc.js";
import { textWidth } from "./width.js";

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

/**
 * The source tokens in output order and, at the same index of `at`, the UTF-16 offset in the output where each
 * one's text starts: parallel arrays rather than an object per token, since every pass places every token.
 */
export interface Placed {
  tokens: Token[];
  at: Int32Array;
}

const hardLine: Doc = { k: "line", soft: false, hard: true };
const BREAK = 0;
const FLAT = 1;
type Mode = typeof BREAK | typeof FLAT;
/** Prettier's indentation: each level an indent or an alignment, rendered to `value` spanning `length` columns. */
interface Indentation {
  readonly value: string;
  readonly length: number;
  readonly queue: readonly (number | string | "indent")[];
  /** This indentation one indent deeper under `indentedIn`, built once: the printer and every width check step into it. */
  indented?: Indentation;
  indentedIn?: Layout;
}
type Cmd = { indent: Indentation; mode: Mode; doc: Doc };

const ROOT: Indentation = { value: "", length: 0, queue: [] };

// Prettier's generateIndent: alignment runs are spaces, or with tabs one tab each once an indent follows them.
// A negative step drops the innermost level instead (prettier's dedent).
function deeper(
  from: Indentation,
  step: number | string | "indent",
  layout: Layout,
): Indentation {
  if (step === "indent" && from.indentedIn === layout && from.indented)
    return from.indented;
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
  const next: Indentation = { value, length, queue };
  if (step === "indent") {
    from.indented = next;
    from.indentedIn = layout;
  }
  return next;
}

/** Prettier's align: `-Infinity` back to the root, nothing for `0` or `""`, else one alignment step deeper. */
const aligned = (
  from: Indentation,
  n: number | string,
  layout: Layout,
): Indentation =>
  n === Number.NEGATIVE_INFINITY
    ? ROOT
    : n === 0 || n === ""
      ? from
      : deeper(from, n, layout);

function unknownDoc(d: never): never {
  throw new Error(`unknown doc ${JSON.stringify(d)}`);
}

/**
 * Marks every group that holds a hard break, directly or through a nested broken group, as broken. A conditional
 * group is only walked, never marked: which of its states breaks is the printer's choice. A doc may share a part
 * between both branches of an `ifBreak` or between states, so each part is visited once, not once per path to it.
 */
function propagateBreaks(d: Doc, seen = new Map<Doc, boolean>()): boolean {
  const known = seen.get(d);
  if (known !== undefined) return known;
  const result = propagate(d, seen);
  seen.set(d, result);
  return result;
}

function propagate(d: Doc, seen: Map<Doc, boolean>): boolean {
  // Every part is visited, not only up to the first break: each nested group needs its own mark.
  if (isDocs(d)) {
    let broken = false;
    for (let i = 0; i < d.length; i++)
      if (propagateBreaks(d[i] as Doc, seen)) broken = true;
    return broken;
  }
  switch (d.k) {
    case "breakParent":
      return true;
    case "group":
      if (d.expandedStates) {
        for (const state of d.expandedStates) propagateBreaks(state, seen);
        return d.break;
      }
      if (propagateBreaks(d.contents, seen)) d.break = true;
      return d.break;
    case "groupIfBreak":
      if (propagateBreaks(d.contents, seen)) d.break = true;
      return d.break;
    case "indent":
    case "align":
    case "lineSuffix":
      return propagateBreaks(d.contents, seen);
    case "fill":
      return propagateBreaks(d.parts, seen);
    case "ifBreak":
      return propagateBreaks([d.broken, d.flat], seen);
    // A variant's breaks are its own: the choice among variants is what decides whether the line breaks.
    case "bestFitting":
      propagateBreaks(d.variants, seen);
      return false;
    case "bestFitParenthesize":
      propagateBreaks(d.contents, seen);
      return false;
    case "fitsExpanded":
      d.expands = propagateBreaks(d.contents, seen);
      return false;
    case "token":
    case "text":
    case "lineSuffixBoundary":
      return false;
    case "line":
      return d.hard && d.collapse === true;
    default:
      return unknownDoc(d);
  }
}

/**
 * Whether `next` fits in `width` columns up to its first line break; when `next` runs out, the enclosing
 * `rest` commands are measured too, in their own modes. `mustBeFlat` rejects any already-broken group.
 * A space from a line counts only once text follows it, as it would be trimmed at a line end.
 * With `allLines`, every line `next` breaks into is measured, not only the first.
 */
function fits(
  next: Cmd,
  rest: readonly Cmd[],
  width: number,
  mustBeFlat: boolean,
  groupModes: Map<GroupRef, Mode>,
  layout: Layout,
  hasLineSuffix: boolean,
  allLines = false,
): boolean {
  let restIdx = rest.length;
  let pendingSpace = false;
  // How many lines count: the first, all, or all with any width (inside `fitsExpanded`, only the text around it).
  type Measure = typeof FIRST_LINE | typeof ALL_LINES | typeof OVERFLOW;
  type Measured = Cmd & { all: Measure };
  const cmds: Measured[] = [
    { ...next, all: allLines ? ALL_LINES : FIRST_LINE },
  ];
  if (width < 0) return false;
  for (;;) {
    const cmd =
      cmds.pop() ??
      (restIdx > 0
        ? { ...(rest[--restIdx] as Cmd), all: FIRST_LINE }
        : undefined);
    if (!cmd) return true;
    const { indent, mode, doc: d, all } = cmd;
    const push = (doc: Doc, m = mode, i = indent, a: Measure = all) =>
      cmds.push({ indent: i, mode: m, doc, all: a });
    if (isDocs(d)) {
      for (let i = d.length - 1; i >= 0; i--) push(d[i] as Doc);
      continue;
    }
    switch (d.k) {
      case "token":
      case "text": {
        if (d.text === "") break;
        if (pendingSpace) {
          width -= 1;
          pendingSpace = false;
        }
        const newline =
          d.k === "token" && d.literal ? d.text.indexOf("\n") : -1;
        if (newline < 0) {
          width -= textWidth(d.text);
          break;
        }
        if (layout.ruff && mustBeFlat) return false;
        width -= textWidth(d.text.slice(0, newline));
        if (all === FIRST_LINE) return width >= 0;
        width =
          layout.lineWidth -
          textWidth(d.text.slice(d.text.lastIndexOf("\n") + 1));
        break;
      }
      case "fitsExpanded":
        if (mode === BREAK) push(d.contents);
        else if (!d.whenFlat || (groupModes.get(d.whenFlat) ?? FLAT) === FLAT)
          push(d.contents, BREAK, indent, OVERFLOW);
        else if (d.expands) return false;
        else push(d.contents);
        break;
      case "indent":
        push(d.contents, mode, deeper(indent, "indent", layout));
        break;
      case "align":
        push(d.contents, mode, aligned(indent, d.n, layout));
        break;
      case "fill":
        for (let i = d.parts.length - 1; i >= (d.from ?? 0); i--)
          push(d.parts[i] as Doc);
        break;
      case "group": {
        if (mustBeFlat && d.break) return false;
        const m = d.break ? BREAK : mode;
        if (layout.ruff) groupModes.set(d, m);
        push(
          ((d.break || mode === BREAK) && d.expandedStates?.at(-1)) ||
            d.contents,
          m,
        );
        break;
      }
      case "groupIfBreak":
        if ((groupModes.get(d.cond) ?? FLAT) === BREAK) {
          if (mustBeFlat && d.break) return false;
          push(d.contents, d.break ? BREAK : mode);
        } else push(d.contents);
        break;
      case "line":
        if (mode === FLAT && !d.hard) {
          if (d.soft) break;
          if (layout.ruff) width -= 1;
          else pendingSpace = true;
          break;
        }
        if (mode === FLAT || all === FIRST_LINE) return true;
        width = layout.lineWidth - indent.length;
        pendingSpace = false;
        break;
      case "ifBreak": {
        const m = d.group ? (groupModes.get(d.group) ?? FLAT) : mode;
        push(m === BREAK ? d.broken : d.flat);
        break;
      }
      case "bestFitting":
        if (mode === FLAT)
          push(
            d.variants[0] ?? [],
            mode,
            indent,
            d.allLines ? ALL_LINES : FIRST_LINE,
          );
        else push(d.variants.at(-1) ?? []);
        break;
      case "bestFitParenthesize":
        if (layout.ruff) groupModes.set(d, mode);
        push(d.contents);
        break;
      case "lineSuffix":
        width -= d.reserved ?? 0;
        if (layout.ruff && d.reserved && width < 0) return false;
        hasLineSuffix = true;
        break;
      case "lineSuffixBoundary":
        if (hasLineSuffix) return false;
        break;
      case "breakParent":
        break;
      default:
        unknownDoc(d);
    }
    if (width < 0 && all !== OVERFLOW) return false;
  }
}

const FIRST_LINE = 0;
const ALL_LINES = 1;
const OVERFLOW = 2;

/** Prints `doc` as prettier's printer would, returning the text and where each source token was placed. */
export function print(
  doc: Doc,
  layout: Layout,
): { text: string; placed: Placed } {
  propagateBreaks(doc);
  // Finished lines, each followed by its line break; the line being printed is `current`, so a line end trims
  // one string instead of walking back over the pieces of the line.
  const out: string[] = [];
  let current = "";
  let length = 0;
  let column = 0;
  // Where the text of the current line starts, after its indentation.
  let lineStart = 0;
  const tokens: Token[] = [];
  let at = new Int32Array(1024);
  const cmds: Cmd[] = [{ indent: ROOT, mode: BREAK, doc }];
  let remeasure = false;
  const suffixes: Cmd[] = [];
  const groupModes = new Map<GroupRef, Mode>();
  const endLine = () => {
    out.push(current, "\n");
    current = "";
    length += 1;
  };
  const write = (s: string) => {
    current += s;
    length += s.length;
    column += textWidth(s);
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
    for (let c = current.charCodeAt(end - 1); c === 32 || c === 9; )
      c = current.charCodeAt(--end - 1);
    if (end === current.length) return;
    length -= current.length - end;
    current = current.slice(0, end);
  };

  for (;;) {
    let cmd = cmds.pop();
    if (!cmd && suffixes.length > 0) {
      cmds.push(...suffixes.reverse());
      suffixes.length = 0;
      cmd = cmds.pop();
    }
    if (!cmd) break;
    const { indent, mode, doc: d } = cmd;
    if (isDocs(d)) {
      for (let i = d.length - 1; i >= 0; i--)
        cmds.push({ indent, mode, doc: d[i] as Doc });
      continue;
    }
    switch (d.k) {
      case "token":
        if (tokens.length === at.length) {
          const grown = new Int32Array(at.length * 2);
          grown.set(at);
          at = grown;
        }
        at[tokens.length] = length;
        tokens.push(d);
        if (d.literal && d.text.includes("\n")) {
          writeLiteral(d.text);
          if (layout.ruff) remeasure = true;
        } else write(d.text);
        break;
      case "text":
        write(d.text);
        break;
      case "indent":
        cmds.push({
          indent: deeper(indent, "indent", layout),
          mode,
          doc: d.contents,
        });
        break;
      case "align":
        cmds.push({
          indent: aligned(indent, d.n, layout),
          mode,
          doc: d.contents,
        });
        break;
      case "group":
        printGroup(d, indent, mode);
        break;
      case "groupIfBreak":
        if ((groupModes.get(d.cond) ?? FLAT) === BREAK)
          printGroup(d, indent, mode);
        else cmds.push({ indent, mode, doc: d.contents });
        break;
      case "fill":
        printFill(d, indent, mode);
        break;
      case "line":
        if (mode === FLAT && !d.hard) {
          if (!d.soft) write(" ");
          break;
        }
        // A hard break inside a flat group: the next group must measure afresh.
        if (mode === FLAT || layout.ruff) remeasure = true;
        if (suffixes.length > 0) {
          cmds.push(cmd, ...suffixes.reverse());
          suffixes.length = 0;
          break;
        }
        trimLineEnd();
        if (!d.collapse || length > lineStart) endLine();
        if (d.blank) endLine();
        write(indent.value);
        column = indent.length;
        lineStart = length;
        break;
      case "fitsExpanded":
        if (!d.whenFlat || (groupModes.get(d.whenFlat) ?? FLAT) === FLAT)
          remeasure = true;
        cmds.push({ indent, mode, doc: d.contents });
        break;
      case "ifBreak": {
        const m = d.group ? (groupModes.get(d.group) ?? FLAT) : mode;
        cmds.push({ indent, mode, doc: m === BREAK ? d.broken : d.flat });
        break;
      }
      case "lineSuffix":
        suffixes.push({ indent, mode, doc: d.contents });
        column += d.reserved ?? 0;
        break;
      case "bestFitting":
        printBestFitting(d, indent, mode);
        break;
      case "bestFitParenthesize":
        printBestFitParenthesize(d, indent, mode);
        break;
      case "lineSuffixBoundary":
        if (suffixes.length > 0) cmds.push({ indent, mode, doc: hardLine });
        break;
      case "breakParent":
        break;
      default:
        unknownDoc(d);
    }
  }
  out.push(current);
  return {
    text: out.join(""),
    placed: { tokens, at: at.subarray(0, tokens.length) },
  };

  function printGroup(
    g: Group | GroupIfBreak,
    indent: Indentation,
    mode: Mode,
  ) {
    const cmd = chooseGroup(g, indent, mode);
    if (g.k === "group") groupModes.set(g, cmd.mode);
    cmds.push(cmd);
  }

  function chooseGroup(
    g: Group | GroupIfBreak,
    indent: Indentation,
    mode: Mode,
  ): Cmd {
    if (mode === FLAT && !remeasure)
      return { indent, mode: g.break ? BREAK : FLAT, doc: g.contents };
    remeasure = false;
    // Ruff measures a group's contents as flat, so an `ifBreak` on the group itself reads flat meanwhile.
    if (layout.ruff && g.k === "group") groupModes.set(g, FLAT);
    const width = layout.lineWidth - column;
    const suffix = suffixes.length > 0;
    const flat: Cmd = { indent, mode: FLAT, doc: g.contents };
    if (!g.break && fits(flat, cmds, width, false, groupModes, layout, suffix))
      return flat;
    const states = g.k === "group" ? g.expandedStates : undefined;
    if (!states) return { indent, mode: BREAK, doc: g.contents };
    if (!g.break)
      for (const state of states.slice(1, -1)) {
        const candidate: Cmd = { indent, mode: FLAT, doc: state };
        if (fits(candidate, cmds, width, false, groupModes, layout, suffix))
          return candidate;
      }
    return { indent, mode: BREAK, doc: states.at(-1) ?? g.contents };
  }

  function printBestFitting(b: BestFitting, indent: Indentation, mode: Mode) {
    const last = b.variants.length - 1;
    if (mode === FLAT && !remeasure) {
      cmds.push({ indent, mode: FLAT, doc: b.variants[0] ?? [] });
      return;
    }
    remeasure = false;
    const width = layout.lineWidth - column;
    for (const variant of b.variants.slice(0, last)) {
      const flat: Cmd = { indent, mode: FLAT, doc: variant };
      if (
        fits(
          flat,
          cmds,
          width,
          false,
          groupModes,
          layout,
          suffixes.length > 0,
          b.allLines,
        )
      ) {
        cmds.push(flat);
        return;
      }
    }
    cmds.push({ indent, mode: BREAK, doc: b.variants[last] ?? [] });
  }

  function printBestFitParenthesize(
    b: BestFitParenthesize,
    indent: Indentation,
    mode: Mode,
  ) {
    const flat: Cmd = { indent, mode: FLAT, doc: b.contents };
    groupModes.set(b, FLAT);
    if (mode === FLAT && !remeasure) {
      cmds.push(flat);
      return;
    }
    remeasure = false;
    const width = layout.lineWidth - column;
    if (
      fits(flat, cmds, width, false, groupModes, layout, suffixes.length > 0)
    ) {
      cmds.push(flat);
      return;
    }
    groupModes.set(b, BREAK);
    const wrapped: Cmd = {
      indent,
      mode: BREAK,
      doc: [
        b.open,
        { k: "indent", contents: [hardline, b.contents] },
        hardline,
        b.close,
      ],
    };
    if (
      fits(
        wrapped,
        cmds,
        width,
        false,
        groupModes,
        layout,
        suffixes.length > 0,
        true,
      )
    ) {
      cmds.push(wrapped);
      return;
    }
    groupModes.set(b, FLAT);
    // Bare after all, but each group inside measures itself rather than printing flat on trust.
    remeasure = true;
    cmds.push(flat);
  }

  // Prettier's fill: a separator breaks unless the content before and after it fit on the line together.
  function printFill(f: Fill, indent: Indentation, mode: Mode) {
    const width = layout.lineWidth - column;
    const from = f.from ?? 0;
    const content = f.parts[from];
    const separator = f.parts[from + 1];
    const second = f.parts[from + 2];
    if (content === undefined) return;
    const flat = (doc: Doc): Cmd => ({ indent, mode: FLAT, doc });
    const broken = (doc: Doc): Cmd => ({ indent, mode: BREAK, doc });
    const suffix = suffixes.length > 0;
    const contentFits = fits(
      flat(content),
      [],
      width,
      true,
      groupModes,
      layout,
      suffix,
    );
    if (separator === undefined) {
      cmds.push(contentFits ? flat(content) : broken(content));
      return;
    }
    if (second === undefined) {
      cmds.push(
        contentFits ? flat(separator) : broken(separator),
        contentFits ? flat(content) : broken(content),
      );
      return;
    }
    cmds.push({ indent, mode, doc: { ...f, from: from + 2 } });
    if (
      fits(
        flat([content, separator, second]),
        [],
        width,
        true,
        groupModes,
        layout,
        suffix,
      )
    )
      cmds.push(flat(separator), flat(content));
    else if (contentFits) cmds.push(broken(separator), flat(content));
    else cmds.push(broken(separator), broken(content));
  }
}
