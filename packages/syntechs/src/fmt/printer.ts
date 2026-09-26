import { type Doc, type Fill, type Group, isDocs, type Token } from "./doc.js";
import { textWidth } from "./width.js";

export interface Layout {
  lineWidth: number;
  indentWidth: number;
  useTabs: boolean;
}

/** A source token and the UTF-16 offset in the output where its text starts. */
export interface Placed {
  token: Token;
  at: number;
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
}
type Cmd = { indent: Indentation; mode: Mode; doc: Doc };

const ROOT: Indentation = { value: "", length: 0, queue: [] };

// Prettier's generateIndent: alignment runs are spaces, or with tabs one tab each once an indent follows them.
function deeper(
  from: Indentation,
  step: number | string | "indent",
  layout: Layout,
): Indentation {
  const queue = [...from.queue, step];
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
  return { value, length, queue };
}

function unknownDoc(d: never): never {
  throw new Error(`unknown doc ${JSON.stringify(d)}`);
}

/**
 * Marks every group that holds a hard break, directly or through a nested broken group, as broken. A conditional
 * group is only walked, never marked: which of its states breaks is the printer's choice. `seen` visits a group
 * shared between states once.
 */
function propagateBreaks(d: Doc, seen: Set<Group> = new Set()): boolean {
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
      if (seen.has(d)) return d.break;
      seen.add(d);
      if (d.expandedStates) {
        for (const state of d.expandedStates) propagateBreaks(state, seen);
        return d.break;
      }
      if (propagateBreaks(d.contents, seen)) d.break = true;
      return d.break;
    case "indent":
    case "align":
    case "lineSuffix":
      return propagateBreaks(d.contents, seen);
    case "fill":
      return propagateBreaks(d.parts, seen);
    case "ifBreak": {
      const broken = propagateBreaks(d.broken, seen);
      return propagateBreaks(d.flat, seen) || broken;
    }
    case "token":
    case "text":
    case "line":
    case "lineSuffixBoundary":
      return false;
    default:
      return unknownDoc(d);
  }
}

/**
 * Whether `next` fits in `width` columns up to its first line break; when `next` runs out, the enclosing
 * `rest` commands are measured too, in their own modes. `mustBeFlat` rejects any already-broken group.
 * A space from a line counts only once text follows it, as it would be trimmed at a line end.
 */
function fits(
  next: { mode: Mode; doc: Doc },
  rest: readonly Cmd[],
  width: number,
  mustBeFlat: boolean,
  groupModes: ReadonlyMap<Group, Mode>,
  hasLineSuffix = false,
): boolean {
  let restIdx = rest.length;
  let pendingSpace = false;
  const cmds: { mode: Mode; doc: Doc }[] = [next];
  while (width >= 0) {
    const cmd = cmds.pop() ?? (restIdx > 0 ? rest[--restIdx] : undefined);
    if (!cmd) return true;
    const { mode, doc: d } = cmd;
    if (isDocs(d)) {
      for (let i = d.length - 1; i >= 0; i--)
        cmds.push({ mode, doc: d[i] as Doc });
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
        const nl = d.k === "token" && d.literal ? d.text.indexOf("\n") : -1;
        if (nl !== -1) return width - textWidth(d.text.slice(0, nl)) >= 0;
        width -= textWidth(d.text);
        break;
      }
      case "indent":
      case "align":
        cmds.push({ mode, doc: d.contents });
        break;
      case "fill":
        for (let i = d.parts.length - 1; i >= (d.from ?? 0); i--)
          cmds.push({ mode, doc: d.parts[i] as Doc });
        break;
      case "group":
        if (mustBeFlat && d.break) return false;
        cmds.push({
          mode: d.break ? BREAK : mode,
          doc:
            ((d.break || mode === BREAK) && d.expandedStates?.at(-1)) ||
            d.contents,
        });
        break;
      case "line":
        if (mode === BREAK || d.hard) return true;
        if (!d.soft) pendingSpace = true;
        break;
      case "ifBreak": {
        const m = d.group ? (groupModes.get(d.group) ?? FLAT) : mode;
        cmds.push({ mode, doc: m === BREAK ? d.broken : d.flat });
        break;
      }
      case "lineSuffix":
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
  }
  return false;
}

/** Prints `doc` as prettier's printer would, returning the text and where each source token was placed. */
export function print(
  doc: Doc,
  layout: Layout,
): { text: string; placed: Placed[] } {
  propagateBreaks(doc);
  // Finished lines, each followed by its line break; the line being printed is `current`, so a line end trims
  // one string instead of walking back over the pieces of the line.
  const out: string[] = [];
  let current = "";
  let length = 0;
  let column = 0;
  const placed: Placed[] = [];
  const cmds: Cmd[] = [{ indent: ROOT, mode: BREAK, doc }];
  let remeasure = false;
  const suffixes: Cmd[] = [];
  const groupModes = new Map<Group, Mode>();
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
        placed.push({ token: d, at: length });
        if (d.literal && d.text.includes("\n")) writeLiteral(d.text);
        else write(d.text);
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
          indent:
            d.n === Number.NEGATIVE_INFINITY
              ? ROOT
              : d.n === 0 || d.n === ""
                ? indent
                : deeper(indent, d.n, layout),
          mode,
          doc: d.contents,
        });
        break;
      case "group":
        printGroup(d, indent, mode);
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
        if (mode === FLAT) remeasure = true;
        if (suffixes.length > 0) {
          cmds.push(cmd, ...suffixes.reverse());
          suffixes.length = 0;
          break;
        }
        trimLineEnd();
        out.push(current, "\n");
        current = "";
        length += 1;
        write(indent.value);
        column = indent.length;
        break;
      case "ifBreak": {
        const m = d.group ? (groupModes.get(d.group) ?? FLAT) : mode;
        cmds.push({ indent, mode, doc: m === BREAK ? d.broken : d.flat });
        break;
      }
      case "lineSuffix":
        suffixes.push({ indent, mode, doc: d.contents });
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
  return { text: out.join(""), placed };

  function printGroup(g: Group, indent: Indentation, mode: Mode) {
    const cmd = chooseGroup(g, indent, mode);
    groupModes.set(g, cmd.mode);
    cmds.push(cmd);
  }

  function chooseGroup(g: Group, indent: Indentation, mode: Mode): Cmd {
    if (mode === FLAT && !remeasure)
      return { indent, mode: g.break ? BREAK : FLAT, doc: g.contents };
    remeasure = false;
    const width = layout.lineWidth - column;
    const suffix = suffixes.length > 0;
    const flat: Cmd = { indent, mode: FLAT, doc: g.contents };
    if (!g.break && fits(flat, cmds, width, false, groupModes, suffix))
      return flat;
    const states = g.expandedStates;
    if (!states) return { indent, mode: BREAK, doc: g.contents };
    if (!g.break)
      for (const state of states.slice(1, -1)) {
        const candidate: Cmd = { indent, mode: FLAT, doc: state };
        if (fits(candidate, cmds, width, false, groupModes, suffix))
          return candidate;
      }
    return { indent, mode: BREAK, doc: states.at(-1) ?? g.contents };
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
        suffix,
      )
    )
      cmds.push(flat(separator), flat(content));
    else if (contentFits) cmds.push(broken(separator), flat(content));
    else cmds.push(broken(separator), broken(content));
  }
}
