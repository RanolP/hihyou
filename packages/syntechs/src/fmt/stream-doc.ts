import {
  ALIGN as D_ALIGN,
  BEST_FIT_PARENTHESIZE as D_BEST_FIT_PARENTHESIZE,
  BEST_FITTING as D_BEST_FITTING,
  BREAK_PARENT as D_BREAK_PARENT,
  brokenOf,
  contentsOf,
  type Doc,
  type DocHandle,
  FILL as D_FILL,
  FITS_EXPANDED as D_FITS_EXPANDED,
  flagsOf,
  flatOf,
  GROUP as D_GROUP,
  GROUP_IF_BREAK as D_GROUP_IF_BREAK,
  IF_BREAK as D_IF_BREAK,
  INDENT as D_INDENT,
  isBroken,
  isDocs,
  isLiteral,
  isSynthetic,
  kindCode,
  kindOf,
  LINE as D_LINE,
  LINE_SUFFIX as D_LINE_SUFFIX,
  LINE_SUFFIX_BOUNDARY as D_LINE_SUFFIX_BOUNDARY,
  NONE,
  nodeOf,
  partsOf,
  reservedOf,
  slotC,
  statesOf,
  TEXT as D_TEXT,
  TOKEN as D_TOKEN,
  textOf,
} from "./doc.js";
import {
  BROKEN,
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  LINE_SUFFIX,
  open,
  SOFT,
  sBreakParent,
  sLine,
  sText,
  sToken,
} from "./stream.js";

/** A Doc construct the stream cannot express yet; `sDoc` throws it before appending anything. */
export class Unsupported extends Error {}

/**
 * Appends `doc` to the stream (see `stream.ts`) so that `printStream` prints what `printer.ts`'s `print` prints
 * for it: the same text, and the same tokens at the same offsets. It is how a Doc-building formatter moves onto
 * the stream one construct at a time, and how the equivalence harness checks the stream against the printer.
 */
export function sDoc(doc: Doc): void {
  check(doc, new Set());
  const groups = new Map<number, number>();
  const emit = (d: Doc): void => {
    if (isDocs(d)) {
      for (const x of d) emit(x);
      return;
    }
    const h = d as DocHandle;
    switch (kindCode(h)) {
      case D_TOKEN:
        sToken(nodeOf(h), textOf(h), isSynthetic(h));
        return;
      case D_TEXT:
        sText(textOf(h));
        return;
      case D_LINE:
        sLine(flagsOf(h) & (SOFT | HARD));
        return;
      case D_BREAK_PARENT:
        sBreakParent();
        return;
      case D_GROUP:
        groups.set(h, open(GROUP, -1, isBroken(h) ? BROKEN : 0));
        emit(contentsOf(h));
        close();
        return;
      case D_INDENT:
        open(INDENT);
        emit(contentsOf(h));
        close();
        return;
      case D_LINE_SUFFIX:
        open(LINE_SUFFIX);
        emit(contentsOf(h));
        close();
        return;
      case D_FILL: {
        open(FILL);
        const parts = partsOf(h);
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 0) open(FILL_ITEM);
          emit(parts[i] as Doc);
          if (i % 2 === 0) close();
        }
        close();
        return;
      }
      case D_IF_BREAK: {
        const of = slotC(h);
        const ref = of === NONE ? -1 : (groups.get(of) as number);
        open(IF_BROKEN, ref);
        emit(brokenOf(h));
        close();
        open(IF_FLAT, ref);
        emit(flatOf(h));
        close();
        return;
      }
    }
  };
  emit(doc);
}

/**
 * Throws `Unsupported` for anything in `doc` the stream cannot print yet: a kind it lacks, a group an `ifBreak`
 * names before the group itself is built, or a shared part holding a group (the stream would build it twice).
 */
function check(doc: Doc, seen: Set<Doc>): void {
  const groups = new Set<number>();
  const shared = new Set<Doc>();
  const walk = (d: Doc): boolean => {
    if (seen.has(d)) {
      if (!shared.has(d)) shared.add(d);
      return false;
    }
    let intervals = false;
    if (isDocs(d)) {
      seen.add(d);
      for (const x of d) if (walk(x)) intervals = true;
      return intervals;
    }
    const h = d as DocHandle;
    const kind = kindCode(h);
    switch (kind) {
      case D_TOKEN:
        if (isLiteral(h) && textOf(h).includes("\n"))
          throw new Unsupported("literal token");
        return false;
      case D_TEXT:
      case D_BREAK_PARENT:
        return false;
      case D_LINE:
        if (flagsOf(h) & ~(SOFT | HARD))
          throw new Unsupported("collapsing or blank line");
        return false;
      case D_GROUP:
        if (statesOf(h)) throw new Unsupported("conditionalGroup");
        seen.add(d);
        groups.add(h);
        walk(contentsOf(h));
        return true;
      case D_LINE_SUFFIX:
        if (reservedOf(h) > 0)
          throw new Unsupported("lineSuffix with reserved width");
      // falls through
      case D_INDENT:
        seen.add(d);
        walk(contentsOf(h));
        return true;
      case D_FILL:
        seen.add(d);
        for (const x of partsOf(h)) walk(x);
        return true;
      case D_IF_BREAK: {
        seen.add(d);
        const of = slotC(h);
        if (of !== NONE && !groups.has(of))
          throw new Unsupported("ifBreak on a group built after it");
        walk(brokenOf(h));
        walk(flatOf(h));
        return true;
      }
      case D_ALIGN:
      case D_LINE_SUFFIX_BOUNDARY:
      case D_BEST_FITTING:
      case D_BEST_FIT_PARENTHESIZE:
      case D_FITS_EXPANDED:
      case D_GROUP_IF_BREAK:
        throw new Unsupported(kindOf(h));
      default:
        throw new Unsupported(`doc kind ${kind}`);
    }
  };
  walk(doc);
  for (const d of shared)
    if (holdsInterval(d)) throw new Unsupported("a shared part holding intervals");
}

function holdsInterval(d: Doc): boolean {
  if (isDocs(d)) return d.some(holdsInterval);
  const kind = kindCode(d as DocHandle);
  return !(
    kind === D_TOKEN ||
    kind === D_TEXT ||
    kind === D_LINE ||
    kind === D_BREAK_PARENT
  );
}
