import * as stream from "../../../fmt/stream.js";
import type { Expr, Stmt } from "./ast.js";
import type { Fmt } from "./builders.js";
import type { PrintArgs } from "../../../fmt/rules.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import {
  breakParent,
  type Format,
  type Group,
  group,
  ifBreak,
  indent,
  lineOf,
  text,
  token,
  synthetic,
} from "./elements.js";

// Where the rules Python's DSL spec generates (fmt.gen.ts) write: the generator points their stream imports here
// (`generate.node.ts`). Called through `dslPart`, a rule's output is recorded and turned into a `Format`, so the
// ruff rules around it read it as any part of theirs: once built, written into any buffer, probed, or re-emitted
// into several variants. Outside a recording the calls go to the stream.

export { BROKEN, FILL, FILL_ITEM, GROUP, IF_BROKEN, INDENT, SOFT } from "../../../fmt/stream.js";

type Op =
  | { readonly t: "tok"; readonly node: number; readonly s: string; readonly synthetic: boolean }
  | { readonly t: "text"; readonly s: string }
  | { readonly t: "line"; readonly flags: number }
  | { readonly t: "bp" }
  | { readonly t: "open"; readonly kind: number; readonly ref: number; readonly flags: number }
  | { readonly t: "close" }
  | { readonly t: "part"; readonly f: Format };

let ops: Op[] | undefined;
let opens = 0;

export function sToken(node: number, s: string, synthetic = false): void {
  if (ops) ops.push({ t: "tok", node, s, synthetic });
  else stream.sToken(node, s, synthetic);
}
export function sText(s: string): void {
  if (ops) ops.push({ t: "text", s });
  else stream.sText(s);
}
export function sLine(flags: number): void {
  if (ops) ops.push({ t: "line", flags });
  else stream.sLine(flags);
}
export function sBreakParent(): void {
  if (ops) ops.push({ t: "bp" });
  else stream.sBreakParent();
}
export function sHardline(): void {
  sLine(stream.HARD);
  sBreakParent();
}
/** In a recording, the interval's id is its index among the recording's opens. */
export function open(kind: number, ref = -1, flags = 0): number {
  if (!ops) return stream.open(kind, ref, flags);
  ops.push({ t: "open", kind, ref, flags });
  return opens++;
}
export function close(): void {
  if (ops) ops.push({ t: "close" });
  else stream.close();
}

/** The recorded ops as a `Format`: each interval a nested element, `ref`s resolved to the groups recorded before. */
function toFormat(rec: readonly Op[]): Format {
  const groups: (Group | undefined)[] = [];
  let at = 0;
  let opened = 0;
  const seq = (): Format[] => {
    const out: Format[] = [];
    while (at < rec.length) {
      const o = rec[at++] as Op;
      switch (o.t) {
        case "tok":
          out.push(o.synthetic ? synthetic(o.node, o.s) : token(o.node, o.s));
          break;
        case "text":
          out.push(text(o.s));
          break;
        case "line":
          out.push(lineOf(o.flags));
          break;
        case "bp":
          out.push(breakParent);
          break;
        case "part":
          out.push(o.f);
          break;
        case "close":
          return out;
        case "open": {
          const id = opened++;
          const of = (ref: number) => {
            if (ref < 0) return undefined;
            const g = groups[ref];
            if (!g) throw new Error(`python sink: interval ${id} refers to ${ref}, not a recorded group`);
            return g;
          };
          if (o.kind === stream.GROUP) {
            const contents: Format[] = [];
            const g = group(contents, (o.flags & stream.BROKEN) !== 0);
            groups[id] = g;
            contents.push(...seq());
            out.push(g);
          } else if (o.kind === stream.INDENT) out.push(indent(seq()));
          else if (o.kind === stream.IF_BROKEN) out.push(ifBreak(seq(), [], of(o.ref)));
          else throw new Error(`python sink: interval kind ${o.kind} has no ruff element`);
        }
      }
    }
    return out;
  };
  const out = seq();
  if (at !== rec.length) throw new Error("python sink: a close with no open");
  return out;
}

/** What a custom rule `.via` names reads to print its child by ruff's rules. */
export interface Ruff {
  readonly f: Fmt;
  /** Each expression by the tree-sitter node it was read from (`toAst`). */
  readonly byTs: ReadonlyMap<number, Expr>;
  /** Each statement by the tree-sitter node it was read from. */
  readonly stmts: ReadonlyMap<number, Stmt>;
}

let current: StreamCtx<unknown> | undefined;
let ruff: Ruff | undefined;

/** Runs `fn` with `ctx` as the context `dslPart` prints through, the module rule's, and `r` as `ruffOf`'s. */
export function within<T>(ctx: StreamCtx<unknown>, r: Ruff, fn: () => T): T {
  const outer = [current, ruff] as const;
  current = ctx;
  ruff = r;
  try {
    return fn();
  } finally {
    [current, ruff] = outer;
  }
}

/** Whether the module rule is printing: ruff's rules then print every comment. */
export const printing = (): boolean => current !== undefined;

/** The expression tree-sitter node `node` was read as, with the `Fmt` printing it. */
export function ruffOf(node: number): { f: Fmt; e: Expr } {
  const e = ruff?.byTs.get(node);
  if (!ruff || !e) throw new Error("python sink: a .via custom on a node read as no expression");
  return { f: ruff.f, e };
}

/** The statement tree-sitter node `child` is a child of, for a `.via` custom that prints by the whole statement. */
export function ruffStmtOf(child: number): { f: Fmt; s: Stmt } {
  const s = current && ruff?.stmts.get(current.tree.parent(child));
  if (!ruff || !s) throw new Error("python sink: a .via custom on a child of no statement");
  return { f: ruff.f, s };
}

/** Writes `f`, a part ruff's rules built, where a `.via` custom prints: always inside a `dslPart` recording. */
export function part(f: Format): void {
  if (!ops) throw new Error("python sink: a ruff part outside a dslPart recording");
  ops.push({ t: "part", f });
}

/**
 * Tree-sitter node `node` as its rule of Python's DSL spec prints it, without its comments (ruff prints those).
 * `args` carry what ruff's caller chose for the node (its `Opts`); the rule and its `.via` customs read them as
 * `ctx.args`.
 */
export function dslPart(node: number, args?: PrintArgs): Format {
  if (!current) throw new Error("python sink: dslPart outside the module rule");
  // A broken node prints as its text straight into the stream, past this recording.
  if (current.isBroken(node)) throw new Error("python sink: dslPart of a broken node");
  const outer = ops;
  const outerOpens = opens;
  const rec: Op[] = [];
  ops = rec;
  opens = 0;
  try {
    current.printNode(node, args);
  } finally {
    ops = outer;
    opens = outerOpens;
  }
  return toFormat(rec);
}
