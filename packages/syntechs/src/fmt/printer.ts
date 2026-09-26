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

const BREAK = 0;
const FLAT = 1;
type Mode = typeof BREAK | typeof FLAT;
type Cmd = { indent: number; mode: Mode; doc: Doc };

function unknownDoc(d: never): never {
  throw new Error(`unknown doc ${JSON.stringify(d)}`);
}

/** Marks every group that holds a hard break, directly or through a nested broken group, as broken. */
function propagateBreaks(d: Doc): boolean {
  // Every part is visited, not only up to the first break: each nested group needs its own mark.
  if (isDocs(d)) {
    let broken = false;
    for (let i = 0; i < d.length; i++)
      if (propagateBreaks(d[i] as Doc)) broken = true;
    return broken;
  }
  switch (d.k) {
    case "breakParent":
      return true;
    case "group":
      if (propagateBreaks(d.contents)) d.break = true;
      return d.break;
    case "indent":
    case "lineSuffix":
      return propagateBreaks(d.contents);
    case "fill":
      return propagateBreaks(d.parts);
    case "ifBreak": {
      const broken = propagateBreaks(d.broken);
      return propagateBreaks(d.flat) || broken;
    }
    case "token":
    case "text":
    case "line":
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
  next: Cmd,
  rest: readonly Cmd[],
  width: number,
  mustBeFlat: boolean,
  groupModes: ReadonlyMap<Group, Mode>,
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
      case "text":
        if (d.text === "") break;
        if (pendingSpace) {
          width -= 1;
          pendingSpace = false;
        }
        width -= textWidth(d.text);
        break;
      case "indent":
        cmds.push({ mode, doc: d.contents });
        break;
      case "fill":
        for (let i = d.parts.length - 1; i >= (d.from ?? 0); i--)
          cmds.push({ mode, doc: d.parts[i] as Doc });
        break;
      case "group":
        if (mustBeFlat && d.break) return false;
        cmds.push({ mode: d.break ? BREAK : mode, doc: d.contents });
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
  const cmds: Cmd[] = [{ indent: 0, mode: BREAK, doc }];
  let remeasure = false;
  const suffixes: Cmd[] = [];
  const groupModes = new Map<Group, Mode>();
  const indents: string[] = [];
  const indentation = (level: number) => {
    let s = indents[level];
    if (s === undefined) {
      s = layout.useTabs
        ? "\t".repeat(level)
        : " ".repeat(level * layout.indentWidth);
      indents[level] = s;
    }
    return s;
  };
  const write = (s: string) => {
    current += s;
    length += s.length;
    column += textWidth(s);
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
        write(d.text);
        break;
      case "text":
        write(d.text);
        break;
      case "indent":
        cmds.push({ indent: indent + 1, mode, doc: d.contents });
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
        write(indentation(indent));
        column = indent * layout.indentWidth;
        break;
      case "ifBreak": {
        const m = d.group ? (groupModes.get(d.group) ?? FLAT) : mode;
        cmds.push({ indent, mode, doc: m === BREAK ? d.broken : d.flat });
        break;
      }
      case "lineSuffix":
        suffixes.push({ indent, mode, doc: d.contents });
        break;
      case "breakParent":
        break;
      default:
        unknownDoc(d);
    }
  }
  out.push(current);
  return { text: out.join(""), placed };

  function printGroup(g: Group, indent: number, mode: Mode) {
    if (mode === FLAT && !remeasure) {
      const m = g.break ? BREAK : FLAT;
      groupModes.set(g, m);
      cmds.push({ indent, mode: m, doc: g.contents });
      return;
    }
    remeasure = false;
    const flat: Cmd = { indent, mode: FLAT, doc: g.contents };
    const fitsFlat =
      !g.break &&
      fits(flat, cmds, layout.lineWidth - column, false, groupModes);
    groupModes.set(g, fitsFlat ? FLAT : BREAK);
    cmds.push(fitsFlat ? flat : { indent, mode: BREAK, doc: g.contents });
  }

  // Prettier's fill: a separator breaks unless the content before and after it fit on the line together.
  function printFill(f: Fill, indent: number, mode: Mode) {
    const width = layout.lineWidth - column;
    const from = f.from ?? 0;
    const content = f.parts[from];
    const separator = f.parts[from + 1];
    const second = f.parts[from + 2];
    if (content === undefined) return;
    const flat = (doc: Doc): Cmd => ({ indent, mode: FLAT, doc });
    const broken = (doc: Doc): Cmd => ({ indent, mode: BREAK, doc });
    const contentFits = fits(flat(content), [], width, true, groupModes);
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
    if (fits(flat([content, separator, second]), [], width, true, groupModes))
      cmds.push(flat(separator), flat(content));
    else if (contentFits) cmds.push(broken(separator), flat(content));
    else cmds.push(broken(separator), broken(content));
  }
}
