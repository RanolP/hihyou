// Where YAML's rules write (generate.node.ts names this module as yaml's sink). print.ts lays a stream out as lines
// it measures as it goes, so a rule of the spec (format.ts) that spells a leaf writes its text here, and print.ts
// reads that text back (`captured`) to place it. The leaf rules spell, never lay out: the layout writers throw.

let out: string[] | undefined;

/** The text `fn` writes through this sink. */
export function captured(fn: () => void): string {
  const outer = out;
  const parts: string[] = [];
  out = parts;
  try {
    fn();
  } finally {
    out = outer;
  }
  return parts.join("");
}

function write(text: string): void {
  if (out === undefined) throw new Error("yaml sink: a write outside print.ts's `captured`");
  out.push(text);
}

export const sText = (text: string): void => write(text);
export const sToken = (_node: number, text: string): void => write(text);
export const sLiteral = (_node: number, text: string): void => write(text);

const layout = (): never => {
  throw new Error("yaml sink: a YAML rule lays out through print.ts, not the stream's layout");
};
export const BROKEN = 0;
export const FILL = 0;
export const FILL_ITEM = 0;
export const GROUP = 0;
export const IF_BROKEN = 0;
export const INDENT = 0;
export const SOFT = 0;
export const open = layout as (kind: number, ref?: number) => void;
export const close = layout as () => void;
export const sBreakParent = layout as () => void;
export const sHardline = layout as () => void;
export const sLine = layout as (flags: number) => void;
