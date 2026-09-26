import { decimalValue, type Lexeme, type Normalize } from "../../fmt/check.js";
import type { FormatNode } from "../../fmt/tree.js";

/**
 * What a JS/TS token means: its value (a string's cooked text, a number's value, a key's name) and where it
 * stands in the tree, as its chain of ancestors with the field and position of each. `check` parses both
 * sides, so a layout that changes the tree (a dropped paren that regroups `(a + b) * c`, a missing `;` that
 * joins two lines into a call) changes some token's place and fails; tokens whose presence means nothing where
 * they stand (a `;`, a trailing `,`, a paren) normalize away.
 */
export const jsNormalize: Normalize = (lexemes) => {
  const places = new Places();
  return lexemes.map((l, i) => {
    const value = valueForm(l, l.node, lexemes, i);
    return value === undefined ? undefined : `${value}@${places.of(l.node)}`;
  });
};

/** The kinds `check` reads whole: a string's quotes and fragments are separate leaves. */
export const jsAtoms = ["string"] as const;

const CLOSERS = new Set([")", "]", "}", ">"]);
const TYPE_BODIES = new Set(["object_type", "interface_body"]);

function valueForm(
  l: Lexeme,
  node: FormatNode,
  lexemes: readonly Lexeme[],
  i: number,
): string | undefined {
  const t = l.text;
  if (!node.named) {
    if (t === ";") return undefined;
    // A type member's separator: `,` and `;` mean the same there.
    if (t === "," && node.parent && TYPE_BODIES.has(node.parent.kind))
      return undefined;
    if ((t === "|" || t === "&") && isLeadingOperator(node)) return undefined;
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
      node.parent &&
      (node.parent.kind === "parenthesized_expression" ||
        node.parent.kind === "parenthesized_type" ||
        transparent(node.parent))
    )
      return undefined;
    return t;
  }
  if (node.kind === "jsx_text")
    return `jsx:${t.split(/\s+/).filter(Boolean).join(" ")}`;
  if (isKey(node)) return `key:${keyName(node, t)}`;
  switch (node.kind) {
    case "string":
      if (node.parent?.kind === "jsx_attribute")
        return `attr:${decodeQuotes(t.slice(1, -1))}`;
      return `str:${cook(t.slice(1, -1))}`;
    case "number":
      return `num:${decimalValue(t.replaceAll("_", "")) ?? t.toLowerCase()}`;
    case "regex": {
      const slash = t.lastIndexOf("/");
      return `re:${t.slice(0, slash)}/${[...t.slice(slash + 1)].sort().join("")}`;
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

function isKey(n: FormatNode): boolean {
  if (
    n.kind !== "string" &&
    n.kind !== "number" &&
    n.kind !== "property_identifier"
  )
    return false;
  const p = n.parent;
  if (!p) return false;
  if (p.kind === "enum_body" || p.kind === "enum_assignment")
    return n.field === "name" || p.kind === "enum_body";
  return KEY_PARENTS[p.kind] === n.field;
}

function keyName(n: FormatNode, t: string): string {
  if (n.kind === "string") return cook(t.slice(1, -1));
  if (n.kind === "number") return String(Number(t.replaceAll("_", "")));
  return t;
}

const decodeQuotes = (s: string) =>
  s.replaceAll("&quot;", '"').replaceAll("&apos;", "'");

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
};

/** A string literal's value from its source between the quotes, escapes resolved as the spec cooks them. */
export function cook(raw: string): string {
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = raw.charAt(++i);
    const simple = SIMPLE_ESCAPES[e];
    if (simple !== undefined) out += simple;
    else if (e === "x") {
      out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === "u") {
      if (raw.charAt(i + 1) === "{") {
        const close = raw.indexOf("}", i);
        out += String.fromCodePoint(
          Number.parseInt(raw.slice(i + 2, close), 16),
        );
        i = close;
      } else {
        out += String.fromCharCode(
          Number.parseInt(raw.slice(i + 1, i + 5), 16),
        );
        i += 4;
      }
    } else if (e >= "0" && e <= "7") {
      const m = /^[0-7]{1,3}/.exec(raw.slice(i, i + 3))?.[0] ?? e;
      const digits = Number.parseInt(m, 8) > 255 ? m.slice(0, 2) : m;
      out += String.fromCharCode(Number.parseInt(digits, 8));
      i += digits.length - 1;
    } else if (e === "\r") {
      if (raw.charAt(i + 1) === "\n") i++;
    } else if (e !== "\n" && e !== " " && e !== " ") out += e;
  }
  return out;
}

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
  private readonly ids = new Map<string, number>();
  private readonly memo = new Map<FormatNode, number>();
  private readonly index = new Map<FormatNode, number>();
  /** An operand or operator of a flat logical chain: the chain's root and its index there. */
  private readonly flat = new Map<
    FormatNode,
    { root: FormatNode; at: number }
  >();

  of(n: FormatNode): string {
    const p = this.parentOf(n);
    return `${this.label(n)}/${p ? this.chain(p) : 0}`;
  }

  private chain(n: FormatNode): number {
    const hit = this.memo.get(n);
    if (hit !== undefined) return hit;
    const p = this.parentOf(n);
    const key = `${n.kind}:${this.label(n)}/${p ? this.chain(p) : 0}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.ids.size + 1;
      this.ids.set(key, id);
    }
    this.memo.set(n, id);
    return id;
  }

  private top(n: FormatNode): FormatNode {
    while (n.parent && transparent(n.parent)) n = n.parent;
    return n;
  }

  private parentOf(n: FormatNode): FormatNode | undefined {
    const t = this.top(n);
    return this.flatPlace(t)?.root ?? t.parent;
  }

  private label(n: FormatNode): string {
    const t = this.top(n);
    const flat = this.flatPlace(t);
    if (flat) return `${t.named ? "" : t.kind}~${flat.at}`;
    const field =
      t.field === "parameter" && t.parent?.kind === "arrow_function"
        ? "parameters"
        : t.field;
    return `${field ?? ""}|${this.position(t)}`;
  }

  private flatPlace(t: FormatNode) {
    const p = t.parent;
    const op = p && logicalOperator(p);
    if (!op) return undefined;
    let root = p;
    for (;;) {
      const up = this.top(root).parent;
      if (!up || logicalOperator(up) !== op) break;
      root = up;
    }
    if (!this.flat.has(t)) {
      let at = 0;
      const walk = (n: FormatNode) => {
        for (const c of n.children) {
          if (!c.named) {
            if (c.field === "operator") this.flat.set(c, { root, at: at - 1 });
            continue;
          }
          if (c.kind === "comment") continue;
          const inner = this.bottom(c);
          if (logicalOperator(inner) === op) walk(inner);
          else this.flat.set(c, { root, at: at++ });
        }
      };
      walk(root);
    }
    return this.flat.get(t);
  }

  /** The node under `n`'s see-through parens: the inverse of `top`. */
  private bottom(n: FormatNode): FormatNode {
    while (transparent(n)) {
      const inner = n.children.find((c) => c.named && c.kind !== "comment");
      if (!inner) break;
      n = inner;
    }
    return n;
  }

  private position(n: FormatNode): number {
    const p = n.parent;
    if (!p) return 0;
    let i = this.index.get(n);
    if (i === undefined) {
      let count = 0;
      for (const c of p.children) {
        if (c.named && c.kind !== "comment" && c.kind !== "empty_statement")
          this.index.set(c, count++);
        else this.index.set(c, -1);
      }
      i = this.index.get(n) ?? -1;
    }
    return i;
  }
}

const LOGICAL = new Set(["&&", "||", "??"]);

function logicalOperator(n: FormatNode): string | undefined {
  if (n.kind !== "binary_expression") return undefined;
  const op = n.children.find((c) => c.field === "operator")?.kind;
  return op !== undefined && LOGICAL.has(op) ? op : undefined;
}

/** The `|` of `type A = | a | b`, which prettier drops. */
const isLeadingOperator = (n: FormatNode) =>
  (n.parent?.kind === "union_type" || n.parent?.kind === "intersection_type") &&
  n.parent.children[0] === n;

function transparent(n: FormatNode): boolean {
  switch (n.kind) {
    case "parenthesized_expression":
      return !parensMatter(n);
    case "parenthesized_type":
      return true;
    case "union_type":
    case "intersection_type": {
      const lead = n.children[0];
      return (
        lead !== undefined &&
        isLeadingOperator(lead) &&
        n.children.filter((c) => c.named && c.kind !== "comment").length === 1
      );
    }
    case "formal_parameters":
      return (
        n.parent?.kind === "arrow_function" && soleParameter(n) !== undefined
      );
    case "required_parameter":
      return n.parent?.kind === "formal_parameters" && transparent(n.parent);
    default:
      return false;
  }
}

/** The single parameter of a list that holds one plain identifier (in TS, a `required_parameter` holding only it). */
export function soleParameter(params: FormatNode): FormatNode | undefined {
  let only: FormatNode | undefined;
  for (const c of params.children) {
    if (!c.named || c.kind === "comment") {
      if (c.kind === "comment") return undefined;
      continue;
    }
    if (only) return undefined;
    only = c;
  }
  if (!only) return undefined;
  if (only.kind === "identifier") return only;
  if (
    only.kind === "required_parameter" &&
    only.children.length === 1 &&
    only.children[0]?.kind === "identifier"
  )
    return only.children[0];
  return undefined;
}

function parensMatter(pe: FormatNode): boolean {
  let inner = pe.children.find((c) => c.named && c.kind !== "comment");
  while (inner?.kind === "parenthesized_expression")
    inner = inner.children.find((c) => c.named && c.kind !== "comment");
  if (!inner) return true;
  const p = pe.parent;
  if (inner.kind === "string" && p?.kind === "expression_statement")
    return true;
  const reads =
    (p?.kind === "member_expression" || p?.kind === "subscript_expression") &&
    pe.field === "object";
  const calls = p?.kind === "call_expression" && pe.field === "function";
  return (
    (reads || calls || p?.kind === "non_null_expression") &&
    hasOptionalChain(inner)
  );
}

export function hasOptionalChain(n: FormatNode | undefined): boolean {
  while (n) {
    if (
      n.kind !== "member_expression" &&
      n.kind !== "subscript_expression" &&
      n.kind !== "call_expression"
    )
      return n.kind === "non_null_expression"
        ? hasOptionalChain(n.children[0])
        : false;
    if (n.children.some((c) => c.kind === "optional_chain" || c.kind === "?."))
      return true;
    n = n.children.find((c) => c.field === "object" || c.field === "function");
  }
  return false;
}
