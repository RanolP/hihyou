import { NO_NODE, type Tree } from "../../../core/arena.js";
import {
  decimalValue,
  type Lexeme,
  type Normalize,
} from "../../../fmt/check.js";

/**
 * What `check` compares for Python: ruff respells strings (quotes, prefixes, escapes, joined implicit
 * concatenations, re-indented docstrings) and numbers, adds and drops optional parentheses, trailing commas,
 * `;` and backslash continuations, and moves a body after `:` onto its own lines. Those map to one form or to
 * none. Indentation carries meaning, so the first kept token of each logical line is prefixed with its block
 * depth, as Python's tokenizer counts INDENT and DEDENT.
 */

/** Parents under which a tuple's parentheses are optional: a statement's value or target, a subscript, `yield`, a match's subject, an `except`'s types (PEP 758). */
const bareTupleParents = new Set([
  "expression_statement",
  "for_statement",
  "return_statement",
  "assignment",
  "augmented_assignment",
  "subscript",
  "delete_statement",
  "yield",
  "match_statement",
  "except_clause",
]);

/** Parents whose `:` ends a compound statement's header. */
const headers = new Set([
  "if_statement",
  "elif_clause",
  "else_clause",
  "for_statement",
  "while_statement",
  "try_statement",
  "except_clause",
  "except_group_clause",
  "finally_clause",
  "with_statement",
  "function_definition",
  "class_definition",
  "match_statement",
  "case_clause",
]);

const docstringOwners = new Set(["function_definition", "class_definition"]);

/** Whether a string lexeme is a docstring, which ruff re-indents: the first statement of a module, def or class. */
function isDocstring(tree: Tree, n: number): boolean {
  let s = n;
  while (
    tree.parent(s) !== NO_NODE &&
    tree.kindName(tree.parent(s)) === "parenthesized_expression"
  )
    s = tree.parent(s);
  const stmt = tree.parent(s);
  if (stmt === NO_NODE || tree.kindName(stmt) !== "expression_statement")
    return false;
  const container = tree.parent(stmt);
  if (container === NO_NODE) return false;
  let first = NO_NODE;
  for (let i = 0, count = tree.count(container); i < count; i++) {
    const c = tree.child(container, i);
    if (tree.named(c) && tree.kindName(c) !== "comment") {
      first = c;
      break;
    }
  }
  if (first !== stmt) return false;
  if (tree.kindName(container) === "module") return true;
  const owner = tree.parent(container);
  return (
    tree.kindName(container) === "block" &&
    owner !== NO_NODE &&
    docstringOwners.has(tree.kindName(owner))
  );
}

/** How many of `n`'s children are named and no comment. */
function namedCount(tree: Tree, n: number): number {
  let named = 0;
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.named(c) && tree.kindName(c) !== "comment") named++;
  }
  return named;
}

/**
 * Whether `t` is an empty tuple among a `del`'s targets, which deletes nothing: ruff prints `del (),` as `del ()`,
 * so its parentheses and the comma after it may come and go.
 */
function emptyDelTarget(tree: Tree, t: number): boolean {
  if (t === NO_NODE || tree.kindName(t) !== "tuple" || namedCount(tree, t) !== 0) return false;
  for (let p = tree.parent(t); p !== NO_NODE; p = tree.parent(p)) {
    const k = tree.kindName(p);
    if (k === "delete_statement") return true;
    if (k !== "tuple" && k !== "list" && k !== "expression_list" && k !== "parenthesized_expression")
      return false;
  }
  return false;
}

/** The sibling before `n` that is no comment, or NO_NODE. */
function previousSibling(tree: Tree, n: number): number {
  const parent = tree.parent(n);
  if (parent === NO_NODE) return NO_NODE;
  let before = NO_NODE;
  for (let i = 0, count = tree.count(parent); i < count; i++) {
    const c = tree.child(parent, i);
    if (c === n) return before;
    if (tree.kindName(c) !== "comment") before = c;
  }
  return NO_NODE;
}

/**
 * Whether `t`, a `tuple`, is a `with`'s whole item list as tree-sitter reads it where CPython reads parenthesized
 * items: `with ((x := a, y := b)):`, one tuple in more parentheses, which ruff prints in one pair, or `with (a,):`,
 * one item and a trailing comma, which ruff prints as `with a:` once the comma is no magic one. `with (*a,):` stays
 * a tuple, since no item can be a starred or unparenthesized named expression. `comma` asks about the latter only.
 */
function withItemsTuple(tree: Tree, t: number, comma: boolean): boolean {
  let item = tree.parent(t);
  let wrapped = false;
  while (item !== NO_NODE && tree.kindName(item) === "parenthesized_expression") {
    item = tree.parent(item);
    wrapped = true;
  }
  if (item === NO_NODE || tree.kindName(item) !== "with_item") return false;
  const clause = tree.parent(item);
  if (clause === NO_NODE || tree.kindName(clause) !== "with_clause" || namedCount(tree, clause) !== 1)
    return false;
  if (wrapped || tree.kindName(tree.child(clause, 0)) === "(") return !comma;
  if (namedCount(tree, t) !== 1) return false;
  for (let i = 0, count = tree.count(t); i < count; i++) {
    const c = tree.child(t, i);
    if (tree.named(c) && tree.kindName(c) !== "comment")
      return tree.kindName(c) !== "list_splat" && tree.kindName(c) !== "named_expression";
  }
  return false;
}

/** Whether `t`, a `tuple_pattern`, is in a case's pattern, rather than an assignment or `for` target. */
function inCase(tree: Tree, t: number): boolean {
  const parent = tree.parent(t);
  return parent !== NO_NODE && tree.kindName(parent) === "case_pattern";
}

/** How many patterns a `case` lists before its guard or colon; several make one tuple without parentheses. */
function casePatternCount(tree: Tree, clause: number): number {
  let patterns = 0;
  for (let i = 0, count = tree.count(clause); i < count; i++)
    if (tree.kindName(tree.child(clause, i)) === "case_pattern") patterns++;
  return patterns;
}

/** Whether `t`, a `tuple_pattern` in a case, is `(p)`: parentheses that only group p. */
function grouping(tree: Tree, t: number): boolean {
  let named = 0;
  for (let i = 0, count = tree.count(t); i < count; i++) {
    const c = tree.child(t, i);
    if (tree.named(c)) {
      if (tree.kindName(c) !== "comment") named++;
    } else if (tree.text(c) === ",") return false;
  }
  return named === 1;
}

/**
 * Whether the parentheses of `t`, a `tuple_pattern` in a case, are ones ruff may add or drop: they group one
 * pattern, or they hold the case's whole pattern (behind any grouping ones), a tuple with or without them.
 */
function optionalCaseParens(tree: Tree, t: number): boolean {
  if (grouping(tree, t)) return true;
  for (let p = tree.parent(t); ; ) {
    const up = tree.parent(p);
    if (up === NO_NODE) return false;
    const k = tree.kindName(up);
    if (k === "case_clause") return casePatternCount(tree, up) === 1;
    if (k !== "tuple_pattern" || !grouping(tree, up)) return false;
    p = tree.parent(up);
    if (p === NO_NODE || tree.kindName(p) !== "case_pattern") return false;
  }
}

const simpleEscapes: Record<string, string> = {
  "\n": "",
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/** The value of a non-raw string's literal text: escapes decoded, `\N{...}` kept with its name upper-cased. */
function decode(text: string, bytes: boolean): string {
  return text.replace(
    /\\(\r\n|[\n\\'"abfnrtv]|[0-7]{1,3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|N\{[^}]*\})/g,
    (all, e: string) => {
      if (e === "\r\n") return "";
      const simple = simpleEscapes[e];
      if (simple !== undefined) return simple;
      if (/^[0-7]/.test(e)) return String.fromCodePoint(Number.parseInt(e, 8));
      if (e[0] === "N")
        return bytes ? all : `\\N{${e.slice(2, -1).toUpperCase()}}`;
      if (bytes && e[0] !== "x") return all;
      return String.fromCodePoint(Number.parseInt(e.slice(1), 16));
    },
  );
}

/** One string part's form: `b` for bytes, then the value, with each interpolation as its text without blanks. */
function stringValue(
  tree: Tree,
  part: number,
  text: string,
  at: number,
): { bytes: boolean; value: string } {
  const startNode = tree.count(part) > 0 ? tree.child(part, 0) : NO_NODE;
  const prefix =
    startNode !== NO_NODE
      ? text
          .slice(tree.start(startNode) - at, tree.end(startNode) - at)
          .replace(/['"]/g, "")
          .toLowerCase()
      : "";
  const raw = prefix.includes("r");
  const bytes = prefix.includes("b");
  const interpolated = prefix.includes("f") || prefix.includes("t");
  let value = "";
  for (let i = 0, count = tree.count(part); i < count; i++) {
    const c = tree.child(part, i);
    const k = tree.kindName(c);
    const t = text.slice(tree.start(c) - at, tree.end(c) - at);
    if (k === "string_content" || k === "escape_sequence") {
      let v = raw ? t : decode(t, bytes);
      if (interpolated) v = v.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
      value += v;
    } else if (k === "interpolation")
      value += `\0${fieldForm(tree, c, text, at)}\0`;
  }
  return { bytes, value };
}

/** A string or concatenation's value, its parts joined, as ruff may join them. */
function stringsValue(
  tree: Tree,
  n: number,
  text: string,
  at: number,
): { bytes: boolean; value: string } {
  if (tree.kindName(n) !== "concatenated_string")
    return stringValue(tree, n, text, at);
  let bytes = false;
  let value = "";
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.kindName(c) !== "string") continue;
    const v = stringValue(tree, c, text, at);
    bytes ||= v.bytes;
    value += v.value;
  }
  return { bytes, value };
}

/**
 * An interpolation's form: its tokens without blanks, each nested string by its value, since ruff respells a
 * nested string's quotes and escapes (PEP 701 lets it reuse the enclosing quotes).
 */
function fieldForm(tree: Tree, n: number, text: string, at: number): string {
  const k = tree.kindName(n);
  if (k === "string" || k === "concatenated_string") {
    const v = stringsValue(tree, n, text, at);
    return `\u0001${v.bytes ? "b" : ""}${v.value}\u0001`;
  }
  const slice = (from: number, to: number) =>
    text.slice(from - at, to - at).replace(/\s+/g, "");
  let out = "";
  let last = tree.start(n);
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    // The text between children is a hidden token: a format spec's literal characters.
    out += slice(last, tree.start(c));
    const ck = tree.kindName(c);
    // A trailing comma comes and goes as the collection splits.
    const trailing =
      ck === "," && i + 1 < count && /^[)\]}]$/.test(tree.kindName(tree.child(n, i + 1)));
    if (ck !== "comment" && !trailing) out += fieldForm(tree, c, text, at);
    last = tree.end(c);
  }
  return out + slice(last, tree.end(n));
}

/** Ruff's code example openings in a docstring: a doctest, a Markdown fence, a reStructuredText block. */
const codeExample = />>>|```|~~~|::/;

function stringForm(tree: Tree, l: Lexeme): string {
  const { bytes, value: joined } = stringsValue(tree, l.node, l.text, l.at);
  let value = joined;
  if (isDocstring(tree, l.node))
    value = codeExample.test(value)
      ? // `docstring-code-format` formats the examples as code, which re-spaces them and adds or drops the
        // punctuation it may, and a doctest's `...` lines come and go with its lines; the check does not see the
        // options, so a docstring with an example compares loosely.
        value.replace(/^([ \t]*)\.\.\.(?=\s|$)/gm, "$1").replace(/[\s,;()'"\\]+/g, "")
      : value
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s !== "")
          .join("\n");
  return `S${bytes ? "b" : ""}${value}`;
}

function numberForm(text: string): string {
  const t = text.toLowerCase().replace(/_/g, "");
  if (/^0[xob]/.test(t)) return `N${t}`;
  if (t.endsWith("j"))
    return `N${decimalValue(t.slice(0, -1)) ?? t.slice(0, -1)}j`;
  return `N${decimalValue(t) ?? t}`;
}

const closers = new Set([")", "]", "}"]);

/** Whether `l`, a punctuation leaf, is one ruff may add or drop without changing meaning. */
function optional(tree: Tree, l: Lexeme, next: Lexeme | undefined): boolean {
  const n = l.node;
  const parent = tree.parent(n);
  const parentKind = parent === NO_NODE ? undefined : tree.kindName(parent);
  switch (l.text) {
    case ";":
      return true;
    case "(":
    case ")":
      if (parent === NO_NODE) return false;
      if (parentKind === "parenthesized_expression") return true;
      if (emptyDelTarget(tree, parent)) return true;
      if (parentKind === "tuple_pattern" && inCase(tree, parent))
        return optionalCaseParens(tree, parent);
      if (parentKind === "tuple" && withItemsTuple(tree, parent, false)) return true;
      if (parentKind === "tuple" || parentKind === "tuple_pattern") {
        // Around a tuple already in parentheses, the tuple's own are the ones ruff may keep or drop.
        let outer = tree.parent(parent);
        while (
          outer !== NO_NODE &&
          tree.kindName(outer) === "parenthesized_expression"
        )
          outer = tree.parent(outer);
        return outer !== NO_NODE && bareTupleParents.has(tree.kindName(outer));
      }
      if (
        parentKind === "with_clause" ||
        parentKind === "import_from_statement"
      )
        return true;
      if (parentKind === "argument_list") {
        const grand = tree.parent(parent);
        return (
          grand !== NO_NODE &&
          tree.kindName(grand) === "class_definition" &&
          namedCount(tree, parent) === 0
        );
      }
      return false;
    case ",": {
      if (emptyDelTarget(tree, previousSibling(tree, n))) return true;
      // A bare tuple's trailing comma (`for x in 1, 2,:`), which ruff drops or keeps inside added parentheses.
      if (
        (parentKind === "expression_list" || parentKind === "pattern_list") &&
        tree.child(parent, tree.count(parent) - 1) === n
      )
        return namedCount(tree, parent) > 1;
      // A case's bare tuple's trailing comma (`case a, b,:`), which ruff drops or keeps inside added parentheses.
      if (parentKind === "case_clause" && next?.text === ":")
        return casePatternCount(tree, parent) > 1;
      // So is a match's bare subject tuple's (`match a, b,:`).
      if (parentKind === "match_statement" && next?.text === ":")
        return namedCount(tree, parent) > 2;
      if (!next || !closers.has(next.text)) return false;
      if (parentKind === "tuple" && withItemsTuple(tree, parent, true)) return true;
      // A one-element tuple's comma is what makes it a tuple, in a subscript's brackets too.
      if (
        parentKind === "tuple" ||
        parentKind === "tuple_pattern" ||
        parentKind === "subscript" ||
        parentKind === "type_parameter"
      )
        return namedCount(tree, parent) > 1;
      return true;
    }
    default:
      return false;
  }
}

function form(
  tree: Tree,
  l: Lexeme,
  next: Lexeme | undefined,
): string | undefined {
  const k = tree.kindName(l.node);
  if (k === "line_continuation" || l.text.trim() === "") return undefined;
  if (k === "string" || k === "concatenated_string") return stringForm(tree, l);
  if (k === "integer" || k === "float") return numberForm(l.text);
  if (!tree.named(l.node) && optional(tree, l, next)) return undefined;
  return l.text;
}

/** The column of `at` in `text`, with tabs to the next multiple of 8, as Python's tokenizer counts it. */
function column(text: string, at: number): number {
  let start = at;
  while (start > 0 && text[start - 1] !== "\n" && text[start - 1] !== "\r")
    start--;
  let col = 0;
  // A form feed resets the column, as in Python's tokenizer.
  for (let i = start; i < at; i++)
    col =
      text[i] === "\t"
        ? (Math.floor(col / 8) + 1) * 8
        : text[i] === "\f"
          ? 0
          : col + 1;
  return col;
}

/** Whether a logical line ends between `from` and `to`: a line break no backslash escapes. */
function hasNewline(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (c !== "\n" && c !== "\r") continue;
    const before = c === "\n" && text[i - 1] === "\r" ? i - 2 : i - 1;
    if (text[before] !== "\\") return true;
  }
  return false;
}

export const normalize: Normalize = (lexemes, text, tree) => {
  const out: (string | undefined)[] = [];
  const indents = [0];
  let brackets = 0;
  let lineDepth = 0;
  let pending: number | undefined;
  let prev: Lexeme | undefined;
  let prevEnd = 0;
  // A logical line opened by a backslash takes its indent from the first token after it, as CPython's tokenizer does.
  let lineOpen = false;
  for (const [i, l] of lexemes.entries()) {
    const f = form(tree, l, lexemes[i + 1]);
    const continued =
      prev !== undefined && tree.kindName(prev.node) === "line_continuation";
    const startsLine: boolean =
      brackets === 0 &&
      (lineOpen ||
        (!continued && (prev === undefined || hasNewline(text, prevEnd, l.at))));
    lineOpen = startsLine && tree.kindName(l.node) === "line_continuation";
    if (lineOpen) {
      // The line's indent waits for its first token past the backslash.
    } else if (startsLine) {
      const col = column(text, l.at);
      while (col < (indents.at(-1) ?? 0)) indents.pop();
      if (col > (indents.at(-1) ?? 0)) indents.push(col);
      lineDepth = indents.length - 1;
      pending = lineDepth;
    } else if (
      brackets === 0 &&
      prev &&
      !tree.named(prev.node) &&
      prev.text === ";"
    )
      pending = lineDepth;
    else if (
      brackets === 0 &&
      prev &&
      prev.text === ":" &&
      tree.parent(prev.node) !== NO_NODE &&
      headers.has(tree.kindName(tree.parent(prev.node)))
    ) {
      // A body on its header's line, which ruff moves to its own indented line.
      lineDepth += 1;
      pending = lineDepth;
    }
    if (!tree.named(l.node) || tree.count(l.node) === 0) {
      if (l.text === "(" || l.text === "[" || l.text === "{") brackets++;
      else if (closers.has(l.text)) brackets = Math.max(0, brackets - 1);
    }
    if (f !== undefined && pending !== undefined) {
      out.push(`${pending}:${f}`);
      pending = undefined;
    } else out.push(f);
    prev = l;
    prevEnd = l.at + l.text.length;
  }
  return out;
};
