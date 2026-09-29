import { NO_NODE, type Tree } from "../../core/arena.js";
import { decimalValue, type Lexeme, type Normalize } from "../../fmt/check.js";
import { cook } from "../../fmt/dsl/normalizers.js";

/**
 * What a JS/TS token means: its value (a string's cooked text, a number's value, a key's name) and where it
 * stands in the tree, as its chain of ancestors with the field and position of each. `check` parses both
 * sides, so a layout that changes the tree (a dropped paren that regroups `(a + b) * c`, a missing `;` that
 * joins two lines into a call) changes some token's place and fails; tokens whose presence means nothing where
 * they stand (a `;`, a trailing `,`, a paren) normalize away.
 */
export const jsNormalize: Normalize = (lexemes, text, tree) => {
  const jsx = new JsxTexts(text, tree);
  const places = new Places(tree, (n) => jsx.isText(n));
  return lexemes.map((l, i) => {
    const run = jsx.runOf(l.node);
    // Prettier merges adjacent JSX spaces into one, which HTML renders alike.
    if (run)
      return jsx.first(run)
        ? `jsx:${run.value.replace(/ {2,}/g, " ")}@${places.at(run.element)}`
        : undefined;
    const value = valueForm(tree, l, l.node, lexemes, i);
    return value === undefined ? undefined : `${value}@${places.of(l.node)}`;
  });
};

/** The kinds `check` reads whole: a string's quotes and fragments are separate leaves. */
export const jsAtoms = ["string"] as const;

const CLOSERS = new Set([")", "]", "}", ">"]);
const TYPE_BODIES = new Set(["object_type", "interface_body"]);

function valueForm(
  tree: Tree,
  l: Lexeme,
  node: number,
  lexemes: readonly Lexeme[],
  i: number,
): string | undefined {
  const t = l.text;
  const parent = tree.parent(node);
  if (!tree.named(node)) {
    if (t === ";") return undefined;
    // A type member's separator: `,` and `;` mean the same there.
    if (
      t === "," &&
      parent !== NO_NODE &&
      TYPE_BODIES.has(tree.kindName(parent))
    )
      return undefined;
    if ((t === "|" || t === "&") && isLeadingOperator(tree, node))
      return undefined;
    if (t === ",") {
      const next = lexemes[i + 1]?.text;
      const previous = lexemes[i - 1]?.text;
      if (
        next !== undefined &&
        CLOSERS.has(next) &&
        previous !== "," &&
        previous !== "["
      )
        return undefined;
    }
    if (
      (t === "(" || t === ")") &&
      parent !== NO_NODE &&
      (tree.kindName(parent) === "parenthesized_expression" ||
        tree.kindName(parent) === "parenthesized_type" ||
        transparent(tree, parent) ||
        isEmptyNewArguments(tree, parent))
    )
      return undefined;
    return t;
  }
  const kind = tree.kindName(node);
  if (kind === "jsx_text")
    return `jsx:${t.split(/\s+/).filter(Boolean).join(" ")}`;
  if (isKey(tree, node)) return `key:${keyName(kind, t)}`;
  switch (kind) {
    case "string":
      if (parentKind(tree, node) === "jsx_attribute")
        return `attr:${decodeQuotes(t.slice(1, -1))}`;
      return `str:${cook(t.slice(1, -1))}`;
    case "number":
      return `num:${decimalValue(t.replaceAll("_", "")) ?? t.toLowerCase()}`;
    case "regex": {
      const slash = t.lastIndexOf("/");
      return `re:${t.slice(0, slash)}/${t
        .slice(slash + 1)
        .split("")
        .sort()
        .join("")}`;
    }
    // Prettier sorts a regex's flags.
    case "regex_flags":
      return `flags:${[...t].sort().join("")}`;
    default:
      return t;
  }
}

const KEY_PARENTS: Readonly<Record<string, string>> = {
  pair: "key",
  pair_pattern: "key",
  method_definition: "name",
  method_signature: "name",
  abstract_method_signature: "name",
  property_signature: "name",
  public_field_definition: "name",
  field_definition: "property",
};

function isKey(tree: Tree, n: number): boolean {
  const kind = tree.kindName(n);
  if (kind !== "string" && kind !== "number" && kind !== "property_identifier")
    return false;
  const p = tree.parent(n);
  if (p === NO_NODE) return false;
  const pk = tree.kindName(p);
  if (pk === "enum_body" || pk === "enum_assignment")
    return tree.fieldName(n) === "name" || pk === "enum_body";
  const key = KEY_PARENTS[pk];
  return key !== undefined && key === tree.fieldName(n);
}

function keyName(kind: string, t: string): string {
  if (kind === "string") return cook(t.slice(1, -1));
  if (kind === "number") return String(Number(t.replaceAll("_", "")));
  return t;
}

/** The kind of `n`'s parent; undefined at the root. */
function parentKind(tree: Tree, n: number): string | undefined {
  const p = tree.parent(n);
  return p === NO_NODE ? undefined : tree.kindName(p);
}

/** The first child of `n` that passes `test`, or `NO_NODE`. */
function findChild(
  tree: Tree,
  n: number,
  test: (c: number) => boolean,
): number {
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (test(c)) return c;
  }
  return NO_NODE;
}

/** The named children of `n` that are not comments, counted. */
function codeChildren(tree: Tree, n: number): number {
  let k = 0;
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.named(c) && tree.kindName(c) !== "comment") k++;
  }
  return k;
}

const decodeQuotes = (s: string) =>
  s.replaceAll("&quot;", '"').replaceAll("&apos;", "'");

/**
 * Where a node stands: its field and position under each ancestor, interned as numbers. Parentheses around an
 * expression, and the parentheses of an arrow's single plain parameter, are see-through: `(a)` stands where `a`
 * does. They are not where dropping them would change the meaning in a way the tree does not show: around an
 * optional chain that is then called or read (`(a?.b).c`), and around a string statement (a directive).
 *
 * A chain of one logical operator is flat: prettier drops the parens of `a && (b && c)`, which regroups the tree
 * without changing what it means, so each operand and operator stands at its index in the whole chain.
 */
class Places {
  /** A JSX child that is text stands nowhere of its own: its run of text (`JsxTexts`) carries the meaning. */
  constructor(
    private readonly tree: Tree,
    private readonly isJsxText: (n: number) => boolean,
  ) {}

  private readonly ids = new Map<string, number>();
  private readonly memo = new Map<number, number>();
  private readonly index = new Map<number, number>();
  /** An operand or operator of a flat logical chain: the chain's root and its index there. */
  private readonly flat = new Map<number, { root: number; at: number }>();

  /** The place of `n` itself, as a number. */
  at(n: number): number {
    return this.chain(n);
  }

  of(n: number): string {
    const p = this.parentOf(n);
    return `${this.label(n)}/${p !== NO_NODE ? this.chain(p) : 0}`;
  }

  private chain(n: number): number {
    const hit = this.memo.get(n);
    if (hit !== undefined) return hit;
    const p = this.parentOf(n);
    const key = `${this.tree.kindName(n)}:${this.label(n)}/${p !== NO_NODE ? this.chain(p) : 0}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.ids.size + 1;
      this.ids.set(key, id);
    }
    this.memo.set(n, id);
    return id;
  }

  private top(n: number): number {
    const tree = this.tree;
    for (
      let p = tree.parent(n);
      p !== NO_NODE && transparent(tree, p);
      p = tree.parent(n)
    )
      n = p;
    return n;
  }

  private parentOf(n: number): number {
    const t = this.top(n);
    return this.flatPlace(t)?.root ?? this.tree.parent(t);
  }

  private label(n: number): string {
    const tree = this.tree;
    const t = this.top(n);
    const flat = this.flatPlace(t);
    if (flat) return `${tree.named(t) ? "" : tree.kindName(t)}~${flat.at}`;
    const field =
      tree.fieldName(t) === "parameter" &&
      parentKind(tree, t) === "arrow_function"
        ? "parameters"
        : tree.fieldName(t);
    return `${field ?? ""}|${this.position(t)}`;
  }

  private flatPlace(t: number) {
    const tree = this.tree;
    const p = tree.parent(t);
    const op = p !== NO_NODE ? logicalOperator(tree, p) : undefined;
    if (!op) return undefined;
    let root = p;
    for (;;) {
      const up = tree.parent(this.top(root));
      if (up === NO_NODE || logicalOperator(tree, up) !== op) break;
      root = up;
    }
    if (!this.flat.has(t)) {
      let at = 0;
      const walk = (n: number) => {
        for (let i = 0, count = tree.count(n); i < count; i++) {
          const c = tree.child(n, i);
          if (!tree.named(c)) {
            if (tree.fieldName(c) === "operator")
              this.flat.set(c, { root, at: at - 1 });
            continue;
          }
          if (tree.kindName(c) === "comment") continue;
          const inner = this.bottom(c);
          if (logicalOperator(tree, inner) === op) walk(inner);
          else this.flat.set(c, { root, at: at++ });
        }
      };
      walk(root);
    }
    return this.flat.get(t);
  }

  /** The node under `n`'s see-through parens: the inverse of `top`. */
  private bottom(n: number): number {
    const tree = this.tree;
    while (transparent(tree, n)) {
      const inner = findChild(
        tree,
        n,
        (c) => tree.named(c) && tree.kindName(c) !== "comment",
      );
      if (inner === NO_NODE) break;
      n = inner;
    }
    return n;
  }

  private position(n: number): number {
    const tree = this.tree;
    const p = tree.parent(n);
    if (p === NO_NODE) return 0;
    let i = this.index.get(n);
    if (i === undefined) {
      let count = 0;
      for (let k = 0, all = tree.count(p); k < all; k++) {
        const c = tree.child(p, k);
        if (
          tree.named(c) &&
          tree.kindName(c) !== "comment" &&
          tree.kindName(c) !== "empty_statement" &&
          !this.isJsxText(c)
        )
          this.index.set(c, count++);
        else this.index.set(c, -1);
      }
      i = this.index.get(n) ?? -1;
    }
    return i;
  }
}

/** The `()` prettier adds to `new A`, which calls the constructor with no arguments either way. */
const isEmptyNewArguments = (tree: Tree, n: number) =>
  tree.kindName(n) === "arguments" &&
  parentKind(tree, n) === "new_expression" &&
  codeChildren(tree, n) === 0;

const LOGICAL = new Set(["&&", "||", "??"]);

function logicalOperator(tree: Tree, n: number): string | undefined {
  if (tree.kindName(n) !== "binary_expression") return undefined;
  const operator = findChild(tree, n, (c) => tree.fieldName(c) === "operator");
  const op = operator === NO_NODE ? undefined : tree.kindName(operator);
  return op !== undefined && LOGICAL.has(op) ? op : undefined;
}

/** The `|` of `type A = | a | b`, which prettier drops. */
const isLeadingOperator = (tree: Tree, n: number) => {
  const p = tree.parent(n);
  if (p === NO_NODE) return false;
  const pk = tree.kindName(p);
  return (
    (pk === "union_type" || pk === "intersection_type") &&
    tree.count(p) > 0 &&
    tree.child(p, 0) === n
  );
};

function transparent(tree: Tree, n: number): boolean {
  switch (tree.kindName(n)) {
    case "parenthesized_expression":
      return !parensMatter(tree, n);
    case "parenthesized_type":
      return true;
    case "union_type":
    case "intersection_type": {
      return (
        tree.count(n) > 0 &&
        isLeadingOperator(tree, tree.child(n, 0)) &&
        codeChildren(tree, n) === 1
      );
    }
    case "formal_parameters":
      return (
        parentKind(tree, n) === "arrow_function" &&
        soleParameter(tree, n) !== NO_NODE
      );
    case "required_parameter": {
      const p = tree.parent(n);
      return (
        p !== NO_NODE &&
        tree.kindName(p) === "formal_parameters" &&
        transparent(tree, p)
      );
    }
    default:
      return false;
  }
}

/**
 * The single parameter of a list that holds one plain identifier (in TS, a `required_parameter` holding only
 * it), or `NO_NODE`.
 */
export function soleParameter(tree: Tree, params: number): number {
  let only = NO_NODE;
  for (let i = 0, count = tree.count(params); i < count; i++) {
    const c = tree.child(params, i);
    if (!tree.named(c) || tree.kindName(c) === "comment") {
      if (tree.kindName(c) === "comment") return NO_NODE;
      continue;
    }
    if (only !== NO_NODE) return NO_NODE;
    only = c;
  }
  if (only === NO_NODE) return NO_NODE;
  if (tree.kindName(only) === "identifier") return only;
  if (
    tree.kindName(only) === "required_parameter" &&
    tree.count(only) === 1 &&
    tree.kindName(tree.child(only, 0)) === "identifier"
  )
    return tree.child(only, 0);
  return NO_NODE;
}

function parensMatter(tree: Tree, pe: number): boolean {
  const code = (c: number) => tree.named(c) && tree.kindName(c) !== "comment";
  let inner = findChild(tree, pe, code);
  while (
    inner !== NO_NODE &&
    tree.kindName(inner) === "parenthesized_expression"
  )
    inner = findChild(tree, inner, code);
  if (inner === NO_NODE) return true;
  const pk = parentKind(tree, pe);
  if (tree.kindName(inner) === "string" && pk === "expression_statement")
    return true;
  const field = tree.fieldName(pe);
  const reads =
    (pk === "member_expression" || pk === "subscript_expression") &&
    field === "object";
  const calls = pk === "call_expression" && field === "function";
  return (
    (reads || calls || pk === "non_null_expression") &&
    hasOptionalChain(tree, inner)
  );
}

/** Whether the chain `n` heads (`NO_NODE` for none) holds a `?.`. */
export function hasOptionalChain(tree: Tree, n: number): boolean {
  while (n !== NO_NODE) {
    const kind = tree.kindName(n);
    if (
      kind !== "member_expression" &&
      kind !== "subscript_expression" &&
      kind !== "call_expression"
    )
      return kind === "non_null_expression"
        ? hasOptionalChain(tree, tree.count(n) > 0 ? tree.child(n, 0) : NO_NODE)
        : false;
    if (
      findChild(tree, n, (c) => {
        const k = tree.kindName(c);
        return k === "optional_chain" || k === "?.";
      }) !== NO_NODE
    )
      return true;
    n = findChild(tree, n, (c) => {
      const f = tree.fieldName(c);
      return f === "object" || f === "function";
    });
  }
  return false;
}

/**
 * The text of a JSX element's children as React reads it: each run of text between two other children, with
 * `{" "}` counted as text, is one value, the lines of each JSXText trimmed and joined as Babel's
 * cleanJSXElementLiteralChild does. Prettier moves the line breaks of a run and trades a space for `{" "}`,
 * which changes the run's tokens but not that value, so a run is compared whole, at its element.
 */
class JsxTexts {
  private readonly runs = new Map<number, JsxRun>();
  private readonly scanned = new Set<number>();
  private readonly emitted = new Set<JsxRun>();

  constructor(
    private readonly text: string,
    private readonly tree: Tree,
  ) {}

  /** A child of a JSX element that belongs to a run of text. */
  isText(n: number): boolean {
    if (parentKind(this.tree, n) !== "jsx_element") return false;
    const kind = this.tree.kindName(n);
    return (
      kind === "jsx_text" ||
      kind === "html_character_reference" ||
      this.isSpace(n)
    );
  }

  /** The run the token `n` is part of: a text node, or a token of a `{" "}`. */
  runOf(n: number): JsxRun | undefined {
    const p = this.tree.parent(n);
    const child = this.isText(n)
      ? n
      : p !== NO_NODE && this.isText(p)
        ? p
        : NO_NODE;
    if (child === NO_NODE) return undefined;
    const element = this.tree.parent(child);
    if (!this.scanned.has(element)) this.scan(element);
    return this.runs.get(child);
  }

  /** Whether this is the first token of `run` asked about: the one that carries its value. */
  first(run: JsxRun): boolean {
    if (this.emitted.has(run)) return false;
    this.emitted.add(run);
    return true;
  }

  private isSpace(n: number): boolean {
    const tree = this.tree;
    if (tree.kindName(n) !== "jsx_expression") return false;
    let named = 0;
    let s = NO_NODE;
    for (let i = 0, count = tree.count(n); i < count; i++) {
      const c = tree.child(n, i);
      if (!tree.named(c)) continue;
      if (named++ === 0) s = c;
    }
    return (
      named === 1 &&
      tree.kindName(s) === "string" &&
      this.text.slice(tree.start(s) + 1, tree.end(s) - 1) === " "
    );
  }

  private scan(element: number) {
    const tree = this.tree;
    this.scanned.add(element);
    const open = findChild(
      tree,
      element,
      (c) => tree.fieldName(c) === "open_tag",
    );
    const close = findChild(
      tree,
      element,
      (c) => tree.fieldName(c) === "close_tag",
    );
    let run: JsxRun = { element, value: "" };
    let from = open !== NO_NODE ? tree.end(open) : tree.start(element);
    const text = (to: number) => {
      run.value += cleanJsxText(this.text.slice(from, to));
    };
    for (let i = 0, count = tree.count(element); i < count; i++) {
      const c = tree.child(element, i);
      if (c === open || c === close) continue;
      const kind = tree.kindName(c);
      if (kind === "jsx_text" || kind === "html_character_reference") {
        this.runs.set(c, run);
        continue;
      }
      text(tree.start(c));
      from = tree.end(c);
      if (this.isSpace(c)) {
        run.value += " ";
        this.runs.set(c, run);
      } else if (kind !== "comment") run = { element, value: "" };
    }
    text(close !== NO_NODE ? tree.start(close) : tree.end(element));
  }
}

interface JsxRun {
  readonly element: number;
  value: string;
}

/** Babel's cleanJSXElementLiteralChild: each line trimmed where it meets a line break, blank lines dropped. */
function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = -1;
  for (const [i, l] of lines.entries()) if (/[^ \t]/.test(l)) last = i;
  let out = "";
  for (const [i, l] of lines.entries()) {
    let line = l.replaceAll("\t", " ");
    if (i > 0) line = line.replace(/^ +/, "");
    if (i < lines.length - 1) line = line.replace(/ +$/, "");
    if (line) out += i === last ? line : `${line} `;
  }
  return out;
}
