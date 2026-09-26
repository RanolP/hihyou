import type { FormatNode } from "../../../fmt/tree.js";
import type {
  Attribute,
  BinOp,
  ClassDef,
  Comprehension,
  Expr,
  ImportFrom,
  Lambda,
  Module,
  Parameter,
  Parameters,
  Py,
  Slice,
  Stmt,
  Str,
  Subscript,
  UnaryOp,
  With,
} from "./ast.js";
import { outer } from "./ast.js";
import {
  firstToken,
  fullLineEnd,
  hasLineBreak,
  hasToken,
  indentationAt,
  lexAt,
  maxEmptyLines,
  tokens,
} from "./trivia.js";

/**
 * Ruff's comment attachment (comments/visitor.rs, placement.rs): each comment is found its enclosing, preceding
 * and following node by walking the AST in source order, then a per-node handler, or else the default rule,
 * makes it leading, trailing or dangling on one node. The rules print a node's comments where ruff does, and
 * mark each printed so that no comment prints twice or not at all.
 */
export interface Comment {
  readonly ts: FormatNode;
  readonly start: number;
  readonly end: number;
  /** Alone on its line (`own`), or after code (`eol`). */
  readonly line: "own" | "eol";
  formatted: boolean;
}

interface Attached {
  leading: Comment[];
  dangling: Comment[];
  trailing: Comment[];
}

const NONE: readonly Comment[] = [];

/** What a comment can attach to: an AST node, or a token list or leaf ruff treats as a node (an alias name). */
export type Key = object;

export class Comments {
  private readonly map = new Map<Key, Attached>();
  readonly all: Comment[] = [];

  private slot(node: Key): Attached {
    let a = this.map.get(node);
    if (!a) {
      a = { leading: [], dangling: [], trailing: [] };
      this.map.set(node, a);
    }
    return a;
  }
  pushLeading(node: Key, c: Comment) {
    this.slot(node).leading.push(c);
  }
  pushDangling(node: Key, c: Comment) {
    this.slot(node).dangling.push(c);
  }
  pushTrailing(node: Key, c: Comment) {
    this.slot(node).trailing.push(c);
  }
  leading(node: Key): readonly Comment[] {
    return this.map.get(node)?.leading ?? NONE;
  }
  dangling(node: Key): readonly Comment[] {
    return this.map.get(node)?.dangling ?? NONE;
  }
  trailing(node: Key): readonly Comment[] {
    return this.map.get(node)?.trailing ?? NONE;
  }
  hasLeading(node: Key): boolean {
    return this.leading(node).length > 0;
  }
  hasDangling(node: Key): boolean {
    return this.dangling(node).length > 0;
  }
  hasTrailing(node: Key): boolean {
    return this.trailing(node).length > 0;
  }
  hasTrailingOwnLine(node: Key): boolean {
    return this.trailing(node).some((c) => c.line === "own");
  }
  has(node: Key): boolean {
    const a = this.map.get(node);
    return !!a && a.leading.length + a.dangling.length + a.trailing.length > 0;
  }
  /** Leading, dangling or trailing comments of `node` or any node inside it. */
  hasAnyIn(start: number, end: number): boolean {
    return this.all.some((c) => c.start >= start && c.end <= end);
  }
}

const STMT_KINDS = new Set([
  "Module",
  "Expr",
  "Assign",
  "AnnAssign",
  "AugAssign",
  "Return",
  "Delete",
  "Pass",
  "Break",
  "Continue",
  "Raise",
  "Assert",
  "Global",
  "Nonlocal",
  "Import",
  "ImportFrom",
  "If",
  "For",
  "While",
  "With",
  "Try",
  "FunctionDef",
  "ClassDef",
  "Match",
  "TypeAlias",
]);

export const isStmt = (p: Py): p is Stmt => STMT_KINDS.has(p.kind);

/** The nested bodies' last child of `p`: its last branch's last statement (ruff's `last_child_in_body`). */
export function lastChildInBody(p: Py): Py | undefined {
  switch (p.kind) {
    case "FunctionDef":
    case "ClassDef":
    case "With":
    case "MatchCase":
    case "ExceptHandler":
    case "ElifElse":
      return p.body.at(-1);
    case "If":
      return (p.clauses.at(-1)?.body ?? p.body).at(-1);
    case "For":
    case "While":
      return (p.orelse?.body.length ? p.orelse.body : p.body).at(-1);
    case "Match":
      return p.cases.at(-1);
    case "Try":
      if (p.finalbody?.body.length) return p.finalbody.body.at(-1);
      if (p.orelse?.body.length) return p.orelse.body.at(-1);
      if (p.handlers.length) return p.handlers.at(-1);
      return p.body.at(-1);
    default:
      return undefined;
  }
}

export function isFirstStatementInBody(s: Py, body: Py): boolean {
  switch (body.kind) {
    case "For":
    case "While":
      return s === body.body[0] || s === body.orelse?.body[0];
    case "Try":
      return s === body.body[0] || s === body.orelse?.body[0] || s === body.finalbody?.body[0];
    case "If":
    case "ElifElse":
    case "With":
    case "ExceptHandler":
    case "MatchCase":
    case "FunctionDef":
    case "ClassDef":
      return s === body.body[0];
    case "Match":
      return s === body.cases[0];
    default:
      return false;
  }
}

export function isFirstStatementInAlternateBody(s: Py, body: Py): boolean {
  switch (body.kind) {
    case "For":
    case "While":
      return s === body.orelse?.body[0];
    case "Try":
      return s === body.handlers[0] || s === body.orelse?.body[0] || s === body.finalbody?.body[0];
    case "If":
      return s === body.clauses[0];
    default:
      return false;
  }
}

const isAlternativeBranchWithNode = (p: Py) => p.kind === "ExceptHandler" || p.kind === "ElifElse";

interface Decorated {
  readonly c: Comment;
  readonly enclosing: Py;
  readonly preceding: Py | undefined;
  readonly following: Py | undefined;
  readonly parent: Py | undefined;
}

type Placement = { to: "leading" | "trailing" | "dangling"; node: Key } | undefined;

const leading = (node: Key): Placement => ({ to: "leading", node });
const trailing = (node: Key): Placement => ({ to: "trailing", node });
const dangling = (node: Key): Placement => ({ to: "dangling", node });

/** Every `comment` node of the tree-sitter tree under `root`, in source order. */
function commentNodes(root: FormatNode): FormatNode[] {
  const out: FormatNode[] = [];
  const walk = (n: FormatNode) => {
    if (n.kind === "comment") out.push(n);
    else for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** Attaches every comment of the tree `module` was read from to a node of `module`. */
export function attach(module: Module, source: string): Comments {
  const comments = new Comments();
  const pending: Comment[] = commentNodes(module.ts).map((ts) => ({
    ts,
    start: ts.start,
    end: ts.end,
    line: indentationAt(source, ts.start) === undefined ? "eol" : "own",
    formatted: false,
  }));
  comments.all.push(...pending);
  const placer = new Placer(source, comments.all);
  let next = 0;
  const parents: Py[] = [];
  let preceding: Py | undefined;

  const push = (d: Decorated) => {
    const p = placer.place(d);
    if (p) {
      if (p.to === "leading") comments.pushLeading(p.node, d.c);
      else if (p.to === "trailing") comments.pushTrailing(p.node, d.c);
      else comments.pushDangling(p.node, d.c);
      return;
    }
    if (d.c.line === "eol") {
      if (d.preceding) comments.pushTrailing(d.preceding, d.c);
      else if (d.following) comments.pushLeading(d.following, d.c);
      else comments.pushDangling(d.enclosing, d.c);
    } else if (d.following) comments.pushLeading(d.following, d.c);
    else if (d.preceding) comments.pushTrailing(d.preceding, d.c);
    else comments.pushDangling(d.enclosing, d.c);
  };

  const visit = (node: Py) => {
    const range = node.kind === "Module" ? { start: 0, end: source.length } : node;
    const enclosing = parents.at(-1) ?? node;
    for (let c = pending[next]; c && c.end <= range.start; c = pending[++next])
      push({ c, enclosing, preceding, following: node, parent: parents.at(-2) });
    preceding = undefined;
    parents.push(node);
    const skip = (pending[next]?.start ?? Number.POSITIVE_INFINITY) >= range.end;
    if (!skip) for (const k of node.kids) visit(k);
    parents.pop();
    const root = parents.length === 0;
    for (let c = pending[next]; c && (root || c.start < range.end); c = pending[++next])
      push({ c, enclosing: node, parent: parents.at(-1), preceding, following: undefined });
    preceding = node;
  };
  visit(module);
  return comments;
}

class Placer {
  constructor(
    readonly src: string,
    readonly comments: readonly Comment[],
  ) {}

  place(d: Decorated): Placement {
    return (
      this.parenthesized(d) ??
      this.endOfLineAroundBody(d) ??
      this.ownLineAroundBody(d) ??
      this.enclosed(d)
    );
  }

  /** Whether any token in [start, end), up to an `as`, `def` or `class`, is `kind`. */
  private anyBefore(start: number, end: number, kind: string): boolean {
    for (const t of tokens(this.src, start, end)) {
      if (t.kind === "as" || t.kind === "def" || t.kind === "class") return false;
      if (t.kind === kind) return true;
    }
    return false;
  }

  private parenthesized(d: Decorated): Placement {
    if (d.enclosing.kind === "Str") return undefined;
    const { preceding, following, c } = d;
    if (!preceding || !following) return undefined;
    if (this.anyBefore(preceding.end, c.start, "(")) return leading(following);
    if (this.anyBefore(c.end, following.start, ")")) return trailing(preceding);
    return undefined;
  }

  private endOfLineAroundBody(d: Decorated): Placement {
    if (d.c.line === "own") return undefined;
    const { following, preceding, enclosing, c } = d;
    if (
      following &&
      isFirstStatementInBody(following, enclosing) &&
      !firstToken(this.src, c.end, following.start)
    )
      return dangling(enclosing);
    if (preceding) {
      let last = lastChildInBody(preceding);
      if (last) {
        for (let n = lastChildInBody(last); n; n = lastChildInBody(n)) last = n;
        return trailing(last);
      }
    }
    return undefined;
  }

  private ownLineAroundBody(d: Decorated): Placement {
    if (d.c.line === "eol") return undefined;
    const { preceding } = d;
    if (!preceding) return undefined;
    if (firstToken(this.src, preceding.end, d.c.start)) return undefined;
    return (
      this.betweenBranches(d, preceding) ??
      this.afterBranch(d, preceding) ??
      this.betweenStatements(d)
    );
  }

  private betweenStatements(d: Decorated): Placement {
    const { preceding, following } = d;
    if (!preceding || !following || !isStmt(preceding) || !isStmt(following)) return undefined;
    if (d.c.line === "eol") return undefined;
    return maxEmptyLines(this.src, d.c.end, following.start) === 0 ? leading(following) : trailing(preceding);
  }

  /** Ruff's `comment_indentation_after`: the least indentation of the comments from the line after `preceding` to `c`. */
  private commentIndentationAfter(preceding: Py, c: Comment): number {
    let min: number | undefined;
    const from = fullLineEnd(this.src, preceding.end);
    for (const x of this.comments) {
      if (x.start < from || x.end > c.end) continue;
      const indent = indentationAt(this.src, x.start);
      if (indent !== undefined) min = Math.min(min ?? indent.length, indent.length);
    }
    return min ?? 0;
  }

  private betweenBranches(d: Decorated, preceding: Py): Placement {
    const { following, enclosing } = d;
    if (!following || !isFirstStatementInAlternateBody(following, enclosing)) return undefined;
    const commentIndent = this.commentIndentationAfter(preceding, d.c);
    const precedingIndent = indentationAt(this.src, preceding.start)?.length ?? commentIndent + 1;
    if (commentIndent > precedingIndent) return undefined;
    if (commentIndent === precedingIndent)
      return isAlternativeBranchWithNode(preceding) ? dangling(enclosing) : trailing(preceding);
    return isAlternativeBranchWithNode(following) ? leading(following) : dangling(enclosing);
  }

  private afterBranch(d: Decorated, preceding: Py): Placement {
    let last = lastChildInBody(preceding);
    if (!last) {
      if (d.following && isFirstStatementInAlternateBody(d.following, d.enclosing)) last = preceding;
      else return undefined;
    }
    const commentIndent = this.commentIndentationAfter(preceding, d.c);
    const precedingIndent = indentationAt(this.src, preceding.start)?.length ?? 0;
    if (commentIndent === precedingIndent) return undefined;
    let parent: Py | undefined;
    let child: Py = last;
    for (;;) {
      const childIndent = indentationAt(this.src, child.start)?.length ?? 0;
      if (commentIndent < childIndent) return parent ? trailing(parent) : undefined;
      if (commentIndent === childIndent) return trailing(child);
      const nested = lastChildInBody(child);
      if (!nested) return trailing(child);
      parent = child;
      child = nested;
    }
  }

  private enclosed(d: Decorated): Placement {
    const e = d.enclosing;
    switch (e.kind) {
      case "Parameters":
        return this.parametersSeparator(d, e) ?? (e.open ? this.bracketedEndOfLine(d) : undefined);
      case "Parameter":
        return this.parameter(d, e);
      case "Arguments":
      case "TypeParams":
        return this.bracketedEndOfLine(d);
      case "Comprehension":
        return this.comprehension(d, e);
      case "Attribute":
        return this.attribute(d, e);
      case "BinOp":
        return this.binaryLeftOrOperator(d, e);
      case "BoolOp":
      case "Compare":
        return this.binaryLike(d);
      case "Keyword":
        return this.keyword(d, e);
      case "UnaryOp":
        return this.unaryOp(d, e);
      case "Named":
        return this.named(d);
      case "Lambda":
        return this.lambda(d, e);
      case "Dict":
        return this.dictUnpacking(d) ?? this.bracketedEndOfLine(d) ?? this.keyValue(d);
      case "DictComp":
        return this.dictUnpacking(d) ?? this.keyValue(d) ?? this.bracketedEndOfLine(d);
      case "IfExp":
        return this.ifExp(d, e);
      case "Slice":
        return this.slice(d, e);
      case "Starred":
        if (d.following && !hasToken(this.src, e.start, d.c.start, "(")) return leading(e);
        return undefined;
      case "Subscript":
        return this.subscript(d, e);
      case "Module":
        return this.module(d, e);
      case "WithItem":
        return this.withItem(d);
      case "FunctionDef":
        if (
          d.c.line === "own" &&
          d.preceding?.kind === "Decorator" &&
          (d.following?.kind === "Parameters" || d.following?.kind === "TypeParams")
        )
          return dangling(e);
        return undefined;
      case "ClassDef":
        return this.classDef(d, e);
      case "ImportFrom":
        return this.importFrom(d, e);
      case "With":
        return this.withStmt(d, e);
      case "Call":
        if (
          d.c.line === "own" &&
          d.preceding &&
          d.following &&
          d.preceding.end < d.c.start &&
          d.c.end < d.following.start
        )
          return dangling(e);
        return undefined;
      case "Str":
        return dangling(e);
      case "List":
      case "Set":
      case "ListComp":
      case "SetComp":
        return this.bracketedEndOfLine(d);
      case "Tuple":
        return e.open ? this.bracketedEndOfLine(d) : undefined;
      case "Generator":
        return e.open ? this.bracketedEndOfLine(d) : undefined;
      case "Return":
        return this.implicitConcatenated(d);
      case "Assign":
      case "AugAssign":
      case "TypeAlias":
        return d.preceding === e.value ? this.implicitConcatenated(d) : undefined;
      case "AnnAssign":
        return e.value && d.preceding === e.value ? this.implicitConcatenated(d) : undefined;
      case "Alias":
      case "Pattern":
        return dangling(e);
      default:
        return undefined;
    }
  }

  private bracketedEndOfLine(d: Decorated): Placement {
    if (d.c.line !== "eol") return undefined;
    const it = tokens(this.src, d.enclosing.start, d.c.start);
    if (it.next().done) return undefined;
    if (it.next().done) return dangling(d.enclosing);
    return undefined;
  }

  private parametersSeparator(d: Decorated, p: Parameters): Placement {
    for (const [i, item] of p.items.entries()) {
      if (item.kind !== "Separator") continue;
      if (item.tok.kind === "*" && i + 1 >= p.items.length) continue;
      const prev = p.items[i - 1];
      const next = p.items[i + 1];
      const precedingEnd = prev ? prev.end : (p.open?.end ?? p.start);
      const followingStart = next ? next.start : (p.close?.start ?? p.end);
      if (d.c.start > precedingEnd && d.c.start < item.start && d.c.line === "own") return dangling(p);
      if (d.c.start > item.end && d.c.start < followingStart && d.c.line === "eol") return dangling(p);
    }
    return undefined;
  }

  private parameter(d: Decorated, p: Parameter): Placement {
    // Ruff's `Parameter` ends at its annotation; its default belongs to the enclosing `ParameterWithDefault`.
    const innerEnd = p.annotation ? outer(p.annotation).end : p.name.end;
    if (d.c.start > innerEnd) return undefined;
    if (p.annotation) {
      const colon = firstToken(this.src, p.name.end);
      return colon && d.c.start < colon.start ? leading(p) : undefined;
    }
    if (d.c.start < p.name.start) {
      const params = d.parent;
      if (params?.kind === "Parameters" && params.start === p.start) return leading(params);
      return leading(p);
    }
    return undefined;
  }

  /** The first token after `from`, past closing parentheses: the operator between two operands. */
  private operatorAfter(from: number, to: number): number {
    for (const t of tokens(this.src, from, to)) if (t.kind !== ")") return t.start;
    return to;
  }

  private binaryLeftOrOperator(d: Decorated, b: BinOp): Placement {
    if (!d.preceding || !d.following) return undefined;
    const op = this.operatorAfter(b.left.end, b.right.start);
    if (d.c.end < op) return trailing(b.left);
    if (
      d.c.line === "eol" &&
      hasLineBreak(this.src, b.left.end, op) &&
      hasLineBreak(this.src, op, b.right.start)
    )
      return dangling(b);
    return undefined;
  }

  private binaryLike(d: Decorated): Placement {
    const { preceding, following } = d;
    if (!preceding || !following) return undefined;
    const op = this.operatorAfter(preceding.end, following.start);
    return d.c.end < op ? trailing(preceding) : undefined;
  }

  private module(d: Decorated, m: Module): Placement {
    if (!d.preceding && !d.following) {
      const last = m.body.at(-1);
      return last ? trailing(last) : leading(m);
    }
    if (d.c.line === "eol") return undefined;
    const { preceding, following } = d;
    if (!preceding || !following) return undefined;
    if (following.kind !== "FunctionDef" && following.kind !== "ClassDef") return undefined;
    return maxEmptyLines(this.src, d.c.end, following.start) === 0 ? leading(following) : trailing(preceding);
  }

  private slice(d: Decorated, s: Slice): Placement {
    const before = this.previousToken(d.c.start);
    if (d.c.line === "eol" && before === "[") return dangling(d.parent ?? s);
    const [first, second] = s.colons;
    const node =
      !first || d.c.start < first.start ? s.lower : !second || d.c.start < second.start ? s.upper : s.step;
    if (!node) return dangling(s);
    return d.c.start < node.start ? leading(node) : trailing(node);
  }

  /** The last code token before `offset`, comments skipped. */
  private previousToken(offset: number): string | undefined {
    let i = offset;
    for (;;) {
      while (i > 0 && /[ \t\f\r\n\\]/.test(this.src[i - 1] as string)) i--;
      if (i === 0) return undefined;
      const c = this.comments.find((x) => x.end === i);
      if (c) {
        i = c.start;
        continue;
      }
      return this.src[i - 1];
    }
  }

  private subscript(d: Decorated, s: Subscript): Placement {
    if (s.slice.kind === "Slice") return this.slice({ ...d, parent: s }, s.slice);
    if (d.c.line === "eol" && s.value.end < d.c.start) {
      const it = tokens(this.src, s.value.end, d.c.start);
      let found = false;
      for (let t = it.next(); !t.done; t = it.next())
        if (t.value.kind === "[") {
          found = true;
          break;
        }
      if (!found) return undefined;
      if (it.next().done) return dangling(s);
    }
    return undefined;
  }

  private classDef(d: Decorated, c: ClassDef): Placement {
    if (d.c.line === "own" && d.c.start < c.name.start) {
      const last = c.decorators.at(-1);
      if (last && last.end < d.c.start) return dangling(c);
    }
    return undefined;
  }

  private keyword(d: Decorated, k: { start: number; name: FormatNode | undefined; kind: "Keyword" }): Placement {
    const start = k.name ? k.name.end : k.start;
    if (hasToken(this.src, start, d.c.start, "(")) return undefined;
    return leading(d.enclosing);
  }

  private dictUnpacking(d: Decorated): Placement {
    if (!d.following) return undefined;
    const from = d.preceding ? d.preceding.end : d.enclosing.start;
    for (const t of tokens(this.src, from, d.c.start)) if (t.kind === "**") return leading(d.following);
    return undefined;
  }

  private keyValue(d: Decorated): Placement {
    const { preceding, following } = d;
    if (!preceding || !following) return undefined;
    return hasToken(this.src, preceding.end, following.start, ":") ? dangling(d.enclosing) : undefined;
  }

  private attribute(d: Decorated, a: Attribute): Placement {
    if (!d.preceding) return leading(a.value);
    let rparen: number | undefined;
    for (const t of tokens(this.src, a.value.end)) {
      if (t.kind !== ")") break;
      rparen = t.start;
    }
    if (rparen !== undefined && d.c.start < rparen) return trailing(a.value);
    if (d.c.line === "eol" && d.c.end < a.dot.start) return trailing(a.value);
    return dangling(a);
  }

  private ifExp(d: Decorated, e: Expr & { kind: "IfExp" }): Placement {
    if (d.c.line === "own") return undefined;
    if (e.ifTok.start < d.c.start && d.c.start < outer(e.test).start && d.c.start < e.test.start) return leading(e.test);
    if (e.elseTok.start < d.c.start && d.c.start < e.orelse.start) return leading(e.orelse);
    return undefined;
  }

  private unaryOp(d: Decorated, u: UnaryOp): Placement {
    let upTo = u.operand.start;
    for (const t of tokens(this.src, u.op.end, u.operand.start))
      if (t.kind === "(") {
        upTo = t.start;
        break;
      }
    return d.c.end < upTo && d.c.line === "eol" ? dangling(u) : undefined;
  }

  private named(d: Decorated): Placement {
    const { preceding, following } = d;
    if (!preceding || !following) return undefined;
    for (const t of tokens(this.src, preceding.end, following.start))
      if (t.kind === ":=") return d.c.end < t.start ? trailing(preceding) : dangling(d.enclosing);
    return undefined;
  }

  private lambda(d: Decorated, l: Lambda): Placement {
    if (l.params) {
      if (d.c.start < l.params.start) return d.c.line === "own" ? leading(l.params) : dangling(l);
      if (l.params.end < d.c.start && d.c.start < l.body.start) {
        if (hasToken(this.src, l.params.end, d.c.start, "(")) return undefined;
        return dangling(l);
      }
    } else if (d.c.start < l.body.start) {
      if (hasToken(this.src, l.start, d.c.start, "(")) return undefined;
      return dangling(l);
    }
    return undefined;
  }

  private withItem(d: Decorated): Placement {
    const { preceding, following } = d;
    if (!preceding || !following) return undefined;
    let as: number | undefined;
    for (const t of tokens(this.src, preceding.end, following.start))
      if (t.kind === "as") {
        as = t.start;
        break;
      }
    if (as === undefined) return undefined;
    if (d.c.end < as) return trailing(preceding);
    return d.c.line === "eol" ? dangling(d.enclosing) : leading(following);
  }

  private importFrom(d: Decorated, i: ImportFrom): Placement {
    const first = i.names[0];
    if (d.c.line === "eol" && first && i.start < d.c.start && d.c.start < first.start) return dangling(i);
    const next = firstToken(this.src, d.c.start);
    if (next?.kind === ",") {
      if (d.preceding?.kind === "Alias") return dangling(d.preceding);
    }
    return undefined;
  }

  private withStmt(d: Decorated, w: With): Placement {
    const first = w.items[0];
    if (d.c.line === "eol" && first && w.start < d.c.start && d.c.start < first.start) return dangling(w);
    return undefined;
  }

  private comprehension(d: Decorated, c: Comprehension): Placement {
    const own = d.c.line === "own";
    if (d.c.end < c.target.start) return own ? undefined : dangling(c);
    const inTok = c.kws.at(-1) as FormatNode;
    if (d.c.start < inTok.start) return own ? dangling(c) : undefined;
    if (d.c.start < c.iter.start) return own ? undefined : dangling(c);
    let lastEnd = outer(c.iter).end;
    for (const { kw, test } of c.ifs) {
      if (own) {
        if (lastEnd < d.c.start && d.c.start < kw.start) return dangling(c);
      } else if (kw.start < d.c.start && d.c.start < test.start) return dangling(c);
      lastEnd = outer(test).end;
    }
    return undefined;
  }

  private implicitConcatenated(d: Decorated): Placement {
    if (d.c.line !== "eol") return undefined;
    const s = d.preceding;
    if (!s || s.kind !== "Str" || (s as Str).parts.length < 2) return undefined;
    const str = s as Str;
    const last = str.parts.at(-1) as FormatNode;
    const secondLast = str.parts.at(-2) as FormatNode;
    if (hasLineBreak(this.src, secondLast.end, last.start) && str.parens.length > 0) {
      if (!hasToken(this.src, last.end, d.c.start, ")")) return trailing(last);
    }
    return undefined;
  }
}

/** Ruff's `is_pragma_comment`: a comment tools read, which never counts against the line width. */
export function isPragma(text: string): boolean {
  const t = text.replace(/^#\s*/, "");
  return /^(noqa|nosec)\b/i.test(t) || /^(isort|type|pyright|pyrefly|pylint|flake8|ruff|ty):/.test(t);
}

/** Ruff's `normalize_comment`: `#` then one space, unless a shebang-like or type comment. */
export function normalizeComment(raw: string): string {
  const text = raw.trimEnd();
  const content = text.slice(1);
  if (content === "") return "#";
  if (/^[ !:#'|]/.test(content)) return text;
  if (content.startsWith(" ")) {
    const trimmed = content.replace(/^ +/, "");
    if (trimmed.startsWith(" ")) return `# ${trimmed.trimStart()}`;
    if (trimmed.startsWith("type:")) return `# ${trimmed}`;
    return `# ${content.slice(1)}`;
  }
  return `# ${content}`;
}

export { lexAt };
