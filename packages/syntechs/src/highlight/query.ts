// tree-sitter's query language (https://tree-sitter.github.io/tree-sitter/using-parsers/queries), parsed into
// plain data. src/highlight/generate.node.ts writes a grammar's queries/highlights.scm through this into its
// highlight.gen.ts, and the matcher in ./index.ts runs that data against a syntechs Tree.

export type Quantifier = "?" | "*" | "+";

interface Common {
  /** Capture names, without their `@`. */
  captures: string[];
  quantifier?: Quantifier;
  /** The field this element's node must hold in its parent. */
  field?: string;
}

export interface NodeElement extends Common {
  type: "node";
  /** A named kind (`(identifier)`), an anonymous token's text (`"("`), or a wildcard (`(_)`, `_`). */
  match:
    | { kind: string }
    | { token: string }
    | { wildcard: "named" | "any" };
  /** `!field`: the node has no child in this field. */
  negated: string[];
  children: Element[];
}

/** `[a b]`: any one of its members. */
export interface AltElement extends Common {
  type: "alt";
  members: Element[];
}

/** `(a b)` with no kind: its members as consecutive siblings. */
export interface SeqElement extends Common {
  type: "seq";
  members: Element[];
}

/** `.`: the elements around it are adjacent named siblings (or the first/last named child). */
export interface AnchorElement {
  type: "anchor";
}

export type Element = NodeElement | AltElement | SeqElement | AnchorElement;

export type Argument = { capture: string } | { string: string };

export interface Predicate {
  /** `match` covers `#match?` and `#lua-match?`; `#not-...?` sets `negate`. */
  op: "match" | "eq" | "any-of";
  negate: boolean;
  args: Argument[];
}

export interface Pattern {
  root: Element;
  predicates: Predicate[];
}

export class QueryError extends Error {}

const PREDICATES: Record<string, [Predicate["op"], boolean]> = {
  "match?": ["match", false],
  "not-match?": ["match", true],
  // Lua patterns read as regexes: the two agree on the anchors and classes highlights.scm files use.
  "lua-match?": ["match", false],
  "not-lua-match?": ["match", true],
  "eq?": ["eq", false],
  "not-eq?": ["eq", true],
  "any-of?": ["any-of", false],
  "not-any-of?": ["any-of", true],
};

/** Every top-level pattern of a query source, in order: a pattern's index is tree-sitter's pattern index. */
export function parseQuery(source: string): Pattern[] {
  let i = 0;
  const lineOf = (at: number) => source.slice(0, at).split("\n").length;
  const fail = (message: string): never => {
    throw new QueryError(`query line ${lineOf(i)}: ${message}`);
  };
  const skip = () => {
    for (;;) {
      while (i < source.length && /\s/.test(source[i] as string)) i++;
      if (source[i] !== ";") return;
      while (i < source.length && source[i] !== "\n") i++;
    }
  };
  const peek = () => {
    skip();
    return source[i];
  };
  const identifier = (): string => {
    const m = /^[A-Za-z0-9_.\-?!/]+/.exec(source.slice(i));
    if (m === null) return fail(`expected a name at ${JSON.stringify(source.slice(i, i + 20))}`);
    i += m[0].length;
    return m[0];
  };
  const string = (): string => {
    i++; // opening quote
    let out = "";
    while (source[i] !== '"') {
      if (i >= source.length) fail("unterminated string");
      let c = source[i++] as string;
      if (c === "\\") {
        const e = source[i++] as string;
        c = e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === "0" ? "\0" : e;
      }
      out += c;
    }
    i++;
    return out;
  };

  let predicates: Predicate[] = [];
  const predicate = () => {
    i++; // `#`
    const name = identifier();
    const args: Argument[] = [];
    while (peek() !== ")") {
      if (i >= source.length) fail(`unterminated #${name}`);
      if (source[i] === "@") {
        i++;
        args.push({ capture: identifier() });
      } else if (source[i] === '"') args.push({ string: string() });
      else args.push({ string: identifier() });
    }
    i++;
    if (name.endsWith("!")) return; // a directive (#set!, #offset!, ...): no effect on what matches
    const known = PREDICATES[name];
    if (known === undefined) return fail(`unsupported predicate #${name}`);
    predicates.push({ op: known[0], negate: known[1], args });
  };

  /** Quantifier and captures after an element. */
  const suffix = <T extends Element>(el: T): T => {
    if (el.type === "anchor") return el;
    const c = peek();
    if (c === "?" || c === "*" || c === "+") {
      el.quantifier = c;
      i++;
    }
    while (peek() === "@") {
      i++;
      el.captures.push(identifier());
    }
    return el;
  };

  /** Elements up to `close`, predicates among them collected. */
  const elements = (close: string, negated?: string[]): Element[] => {
    const out: Element[] = [];
    while (peek() !== close) {
      if (i >= source.length) fail(`missing ${close}`);
      if (source[i] === "!" && negated !== undefined) {
        i++;
        negated.push(identifier());
        continue;
      }
      if (source[i] === "(" && /^\(\s*#/.test(source.slice(i))) {
        i++;
        skip();
        predicate();
        continue;
      }
      out.push(element());
    }
    i++;
    return out;
  };

  const element = (): Element => {
    const c = peek();
    if (c === ".") {
      i++;
      return { type: "anchor" };
    }
    if (c === "!") {
      return fail("a negated field outside a node");
    }
    // `field: element`
    const field = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(source.slice(i));
    if (field !== null) {
      i += field[0].length;
      const el = element();
      if (el.type === "anchor") return fail("a field on an anchor");
      el.field = field[1] as string;
      return el;
    }
    if (c === '"')
      return suffix<NodeElement>({
        type: "node",
        match: { token: string() },
        negated: [],
        children: [],
        captures: [],
      });
    if (c === "[") {
      i++;
      return suffix<AltElement>({ type: "alt", members: elements("]"), captures: [] });
    }
    if (c === "_") {
      i++;
      return suffix<NodeElement>({
        type: "node",
        match: { wildcard: "any" },
        negated: [],
        children: [],
        captures: [],
      });
    }
    if (c !== "(") return fail(`unexpected ${JSON.stringify(c)}`);
    i++;
    const head = peek();
    if (head === "(" || head === "[" || head === '"' || head === ".") {
      // `((a) (b))`: a sibling sequence. One member stands for itself, as `((comment) (#match? ...))` does.
      const members = elements(")");
      if (members.length === 1) return suffix(members[0] as Element);
      return suffix<SeqElement>({ type: "seq", members, captures: [] });
    }
    const name = identifier();
    if (name.includes("/")) return fail(`supertype pattern (${name}) is not supported`);
    const node: NodeElement = {
      type: "node",
      match: name === "_" ? { wildcard: "named" } : { kind: name },
      negated: [],
      children: [],
      captures: [],
    };
    node.children = elements(")", node.negated);
    return suffix(node);
  };

  const patterns: Pattern[] = [];
  while (peek() !== undefined) {
    predicates = [];
    const root = element();
    if (root.type === "anchor") fail("an anchor at the top level");
    patterns.push({ root, predicates });
  }
  return patterns;
}
