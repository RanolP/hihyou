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

/** Parents under which a tuple's parentheses are optional: a statement's value or target, a subscript, `yield`. */
const bareTupleParents = new Set([
  "expression_statement",
  "for_statement",
  "return_statement",
  "assignment",
  "augmented_assignment",
  "subscript",
  "delete_statement",
  "yield",
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
      value += `\0${t.replace(/\s+/g, "").replace(/'/g, '"')}\0`;
  }
  return { bytes, value };
}

function stringForm(tree: Tree, l: Lexeme): string {
  const parts: number[] = [];
  if (tree.kindName(l.node) === "concatenated_string") {
    for (let i = 0, count = tree.count(l.node); i < count; i++) {
      const c = tree.child(l.node, i);
      if (tree.kindName(c) === "string") parts.push(c);
    }
  } else parts.push(l.node);
  let bytes = false;
  let value = "";
  for (const p of parts) {
    const v = stringValue(tree, p, l.text, l.at);
    bytes ||= v.bytes;
    value += v.value;
  }
  if (isDocstring(tree, l.node))
    value = value
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
      // A bare tuple's trailing comma (`for x in 1, 2,:`), which ruff drops or keeps inside added parentheses.
      if (
        (parentKind === "expression_list" || parentKind === "pattern_list") &&
        tree.child(parent, tree.count(parent) - 1) === n
      )
        return namedCount(tree, parent) > 1;
      if (!next || !closers.has(next.text)) return false;
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
  for (const [i, l] of lexemes.entries()) {
    const f = form(tree, l, lexemes[i + 1]);
    const continued =
      prev !== undefined && tree.kindName(prev.node) === "line_continuation";
    if (
      brackets === 0 &&
      !continued &&
      (prev === undefined || hasNewline(text, prevEnd, l.at))
    ) {
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
