import type { FormatTree } from "../../../fmt/tree.js";
import type { Expr, Py } from "./ast.js";
import { exprAst, Unformattable } from "./ast.js";
import { byteOffsetOf, endOf, startOf } from "./trivia.js";

/**
 * Ruff's match patterns (`Pattern`), read from the tree-sitter nodes. Each is a node of ruff's AST, so the
 * comment placement walks into it and attaches comments to its parts as ruff does. Tree-sitter has no node for a
 * parenthesized pattern (it reads `(p)` as a one-element tuple without a comma) nor for `-1` (two sibling tokens),
 * so this model folds both in: `paren` holds a pattern's outermost redundant parentheses.
 */
export type Pat = {
  readonly kind: "Pattern";
  /** The node the pattern was read from: its first token for `-1`, the case clause for a bare tuple. */
  readonly ts: number;
  readonly node: number;
  readonly start: number;
  readonly end: number;
  readonly kids: Py[];
  parent: Py | undefined;
  paren?: { open: number; close: number };
  /** The `case_pattern` holding the pattern, whose rule prints it; none past the parentheses of `(p)`. */
  cp?: number;
} & (
  | { k: "expr"; e: Expr; capture: boolean }
  | { k: "neg"; minus: number; e: Expr }
  | { k: "complex"; left: Pat; op: number; right: Pat }
  | { k: "attr"; parts: readonly number[] }
  | { k: "wild" }
  | { k: "star"; star: number; name: number }
  | {
      k: "seq";
      type: "list" | "tuple" | "bare";
      open?: number;
      close?: number;
      items: Pat[];
      commas: number;
      end_: number;
    }
  | {
      k: "map";
      open: number;
      close: number;
      /** Each key is a value pattern, read as ruff reads the key expression. */
      pairs: { key: Pat; colon: number; value: Pat }[];
      /** `**rest`, which is no node of its own: its comments are the mapping's dangling ones. */
      rest: { star: number; name: number } | undefined;
    }
  | { k: "class"; cls: readonly number[]; args: PatArgs }
  | { k: "as"; pattern: Pat; as: number; name: number }
  | { k: "or"; items: Pat[]; bars: number[] }
);

/** Ruff's `PatternArguments`: a class pattern's parentheses and what they hold. */
export interface PatArgs {
  readonly kind: "PatternArguments";
  readonly ts: number;
  readonly start: number;
  readonly end: number;
  readonly kids: Py[];
  parent: Py | undefined;
  readonly open: number;
  readonly close: number;
  readonly items: Pat[];
  readonly keywords: PatKeyword[];
}

/** Ruff's `PatternKeyword`, `name=value`. */
export interface PatKeyword {
  readonly kind: "PatternKeyword";
  readonly ts: number;
  readonly start: number;
  readonly end: number;
  readonly kids: Py[];
  parent: Py | undefined;
  readonly name: number;
  readonly eq: number;
  readonly value: Pat;
  /** The `as` and name of `k=p as n`, which tree-sitter reads as `(k=p) as n`. */
  readonly alias: { as: number; name: number } | undefined;
}

type Variant<P> = P extends unknown ? Omit<P, "kind" | "ts" | "kids" | "parent"> : never;

/** Every pattern read from a tree, by each node it was read from, for the rules that print one of its nodes. */
const read = new WeakMap<FormatTree, Map<number, Pat | PatKeyword>>();

function readOf(t: FormatTree): Map<number, Pat | PatKeyword> {
  let m = read.get(t);
  if (!m) read.set(t, (m = new Map()));
  return m;
}

/** The pattern (or class keyword) read from `n`. */
export function patternAt(t: FormatTree, n: number): Pat | PatKeyword | undefined {
  return read.get(t)?.get(n);
}

function link<T extends { kids: Py[] }>(node: T): T {
  for (const k of node.kids) k.parent = node as unknown as Py;
  return node;
}

function kidsOf(p: Variant<Pat>): Py[] {
  switch (p.k) {
    case "complex":
      return [p.left, p.right];
    case "seq":
      return p.items;
    case "map":
      return p.pairs.flatMap((x) => [x.key, x.value]);
    case "class":
      return [p.args];
    case "as":
      return [p.pattern];
    case "or":
      return p.items;
    default:
      return [];
  }
}

function mk(p: Variant<Pat>): Pat {
  return link({ ...p, kind: "Pattern", ts: p.node, kids: kidsOf(p), parent: undefined } as Pat);
}

const kids = (t: FormatTree, n: number): number[] =>
  Array.from({ length: t.count(n) }, (_, i) => t.child(n, i));

export const outerEnd = (t: FormatTree, p: Pat) =>
  p.paren !== undefined ? endOf(t, p.paren.close) : p.end;

const unsupportedPattern = (t: FormatTree, n: number): never => {
  throw new Unformattable(`unsupported pattern ${t.kindName(n)} at ${byteOffsetOf(t, n)}`);
};

/**
 * The pattern after `case` in `clause`, its `case_pattern`s spanning `start` to `end` before `stop` (the guard's
 * `if` or the colon): several top-level patterns (or one and a comma) are a tuple without parentheses.
 */
export function readCasePattern(
  t: FormatTree,
  clause: number,
  start: number,
  end: number,
  stop: number,
): Pat {
  const parts = kids(t, clause).filter(
    (x) =>
      startOf(t, x) >= start &&
      endOf(t, x) <= stop &&
      (t.kindName(x) === "case_pattern" || t.kindName(x) === ","),
  );
  const items = parts.filter((x) => t.kindName(x) === "case_pattern");
  const first = items[0];
  if (first === undefined) return unsupportedPattern(t, clause);
  if (items.length === 1 && parts.length === 1) return readPattern(t, first);
  return mk({
    k: "seq",
    type: "bare",
    node: clause,
    start,
    end,
    items: items.map((x) => readPattern(t, x)),
    commas: clause,
    end_: stop,
  });
}

export function readPattern(t: FormatTree, n: number): Pat {
  const p = readNode(t, n);
  readOf(t).set(n, p);
  return p;
}

function readNode(t: FormatTree, n: number): Pat {
  const kind = (x: number) => t.kindName(x);
  const base = { node: n, start: startOf(t, n), end: endOf(t, n) };
  const cs = kids(t, n).filter((x) => kind(x) !== "line_continuation" && kind(x) !== "comment");
  for (const x of cs) if (kind(x) === "ERROR" || t.missing(x)) unsupportedPattern(t, x);
  switch (kind(n)) {
    case "case_pattern": {
      const p = readGroup(t, n, cs);
      if (p.paren === undefined) p.cp = n;
      return p;
    }
    case "union_pattern": {
      const bars = cs.filter((x) => kind(x) === "|");
      const items: Pat[] = [];
      let run: number[] = [];
      for (const x of [...cs, undefined]) {
        if (x === undefined || kind(x) === "|") {
          items.push(readGroup(t, n, run));
          run = [];
        } else run.push(x);
      }
      return mk({ ...base, k: "or", items, bars });
    }
    case "dotted_name": {
      const [only] = cs;
      if (cs.length === 1 && only !== undefined && kind(only) === "identifier")
        return mk({ ...base, k: "expr", e: exprAst(t, only), capture: true });
      return mk({ ...base, k: "attr", parts: cs });
    }
    case "identifier":
      return mk({ ...base, k: "expr", e: exprAst(t, n), capture: true });
    case "string":
    case "concatenated_string":
    case "integer":
    case "float":
    case "none":
    case "true":
    case "false":
      return mk({ ...base, k: "expr", e: exprAst(t, n), capture: false });
    case "_":
      return mk({ ...base, k: "wild" });
    case "complex_pattern": {
      const op = cs.findLast((x) => kind(x) === "+" || kind(x) === "-");
      if (op === undefined) return unsupportedPattern(t, n);
      const at = cs.indexOf(op);
      return mk({
        ...base,
        k: "complex",
        left: readGroup(t, n, cs.slice(0, at)),
        op,
        right: readGroup(t, n, cs.slice(at + 1)),
      });
    }
    case "splat_pattern": {
      const [star, name] = cs;
      if (star === undefined || name === undefined || kind(star) !== "*" || cs.length !== 2)
        return unsupportedPattern(t, n);
      return mk({ ...base, k: "star", star, name });
    }
    case "as_pattern": {
      const [inner, as, name] = cs;
      if (
        inner === undefined ||
        as === undefined ||
        name === undefined ||
        kind(as) !== "as" ||
        cs.length !== 3
      )
        return unsupportedPattern(t, n);
      return mk({ ...base, k: "as", pattern: readPattern(t, inner), as, name });
    }
    case "list_pattern":
    case "tuple_pattern": {
      const open = cs[0];
      const close = cs.at(-1);
      if (open === undefined || close === undefined || cs.length < 2)
        return unsupportedPattern(t, n);
      const items = cs.filter((x) => kind(x) === "case_pattern");
      const commas = cs.filter((x) => kind(x) === ",").length;
      const [only] = items;
      if (kind(n) === "tuple_pattern" && only !== undefined && items.length === 1 && !commas) {
        // `(p)`: the parentheses are the pattern's own, the outermost pair kept.
        const inner = readPattern(t, only);
        inner.paren = { open, close };
        return inner;
      }
      return mk({
        ...base,
        k: "seq",
        type: kind(n) === "list_pattern" ? "list" : "tuple",
        open,
        close,
        items: items.map((x) => readPattern(t, x)),
        commas: n,
        end_: base.end,
      });
    }
    case "dict_pattern": {
      const open = cs[0];
      const close = cs.at(-1);
      if (open === undefined || close === undefined || kind(open) !== "{" || kind(close) !== "}")
        return unsupportedPattern(t, n);
      const pairs: { key: Pat; colon: number; value: Pat }[] = [];
      let rest: { star: number; name: number } | undefined;
      let run: number[] = [];
      let colon: number | undefined;
      for (const x of cs.slice(1, -1)) {
        if (kind(x) === ",") continue;
        if (kind(x) === "splat_pattern") {
          const [star, name] = kids(t, x).filter((y) => kind(y) !== "comment");
          if (
            star === undefined ||
            name === undefined ||
            kind(star) !== "**" ||
            kids(t, x).filter((y) => kind(y) !== "comment").length !== 2
          )
            return unsupportedPattern(t, x);
          rest = { star, name };
        } else if (kind(x) === ":" && colon === undefined) colon = x;
        else if (colon !== undefined && kind(x) === "case_pattern") {
          pairs.push({ key: readGroup(t, n, run), colon, value: readPattern(t, x) });
          run = [];
          colon = undefined;
        } else if (colon === undefined) run.push(x);
        else return unsupportedPattern(t, x);
      }
      if (run.length > 0 || colon !== undefined) return unsupportedPattern(t, n);
      return mk({ ...base, k: "map", open, close, pairs, rest });
    }
    case "class_pattern": {
      const at = cs.findIndex((x) => kind(x) === "(");
      const open = cs[at];
      const close = cs.at(-1);
      const cls = cs[0];
      if (open === undefined || close === undefined || kind(close) !== ")" || at !== 1 || cls === undefined)
        return unsupportedPattern(t, n);
      if (kind(cls) !== "dotted_name") return unsupportedPattern(t, cls);
      const items: Pat[] = [];
      const keywords: PatKeyword[] = [];
      for (const x of cs.slice(at + 1, -1)) {
        if (kind(x) === ",") continue;
        let kw = t.count(x) === 1 ? t.child(x, 0) : undefined;
        let alias: { as: number; name: number } | undefined;
        if (kw !== undefined && kind(kw) === "as_pattern") {
          const [inner, as, name] = kids(t, kw);
          const k = inner !== undefined && t.count(inner) === 1 ? t.child(inner, 0) : undefined;
          if (k !== undefined && kind(k) === "keyword_pattern" && as !== undefined && name !== undefined) {
            alias = { as, name };
            kw = k;
          }
        }
        if (kw !== undefined && kind(kw) === "keyword_pattern") {
          const [name, eq, ...value] = kids(t, kw).filter((y) => kind(y) !== "comment");
          if (name === undefined || eq === undefined || kind(eq) !== "=")
            return unsupportedPattern(t, kw);
          const v = readGroup(t, kw, value);
          const keyword: PatKeyword = link({
            kind: "PatternKeyword",
            ts: kw,
            start: startOf(t, kw),
            end: endOf(t, alias ? alias.name : kw),
            kids: [v],
            parent: undefined,
            name,
            eq,
            value: v,
            alias,
          });
          readOf(t).set(kw, keyword);
          keywords.push(keyword);
        } else if (keywords.length > 0) return unsupportedPattern(t, x);
        else items.push(readPattern(t, x));
      }
      const args: PatArgs = link({
        kind: "PatternArguments",
        ts: open,
        start: startOf(t, open),
        end: endOf(t, close),
        kids: [...items, ...keywords],
        parent: undefined,
        open,
        close,
        items,
        keywords,
      });
      return mk({ ...base, k: "class", cls: kids(t, cls), args });
    }
    default:
      return unsupportedPattern(t, n);
  }
}

/** One pattern from sibling nodes: a lone node, or `-` and a number, which tree-sitter leaves unwrapped. */
export function readGroup(t: FormatTree, parent: number, nodes: number[]): Pat {
  const [a, b] = nodes;
  if (a !== undefined && nodes.length === 1) return readPattern(t, a);
  if (
    a !== undefined &&
    b !== undefined &&
    nodes.length === 2 &&
    t.kindName(a) === "-" &&
    (t.kindName(b) === "integer" || t.kindName(b) === "float")
  )
    return mk({ node: a, start: startOf(t, a), end: endOf(t, b), k: "neg", minus: a, e: exprAst(t, b) });
  return unsupportedPattern(t, a !== undefined ? a : parent);
}
