import type { FormatNode } from "../../../fmt/tree.js";

/**
 * Ruff's AST, read off tree-sitter-python's tree, because ruff's layout rules and comment placement are written
 * against it: parentheses are not nodes but a count on the expression they wrap (its range excludes them), a
 * chain of `and`s is one node, a statement's range ends with its last body statement, and a decorated
 * definition starts at its first decorator. Every token a rule prints is still a tree-sitter leaf, reached
 * through `ts`, so the self-check sees the input's own nodes.
 */
export type Py = Expr | Stmt | Other;

interface Base {
  /** The node this one was read from; for an expression, inside its parentheses. */
  readonly ts: FormatNode;
  readonly start: number;
  readonly end: number;
  /** Children in source order, as ruff's comment visitor walks them. */
  readonly kids: Py[];
  parent: Py | undefined;
}

/** A pair of parentheses around an expression, outermost first. */
export interface Paren {
  readonly open: FormatNode;
  readonly close: FormatNode;
  readonly wrapper: FormatNode;
}

interface ExprBase extends Base {
  readonly parens: Paren[];
}

export type Expr =
  | Leaf
  | Str
  | Attribute
  | Call
  | Subscript
  | Starred
  | UnaryOp
  | BinOp
  | BoolOp
  | Compare
  | IfExp
  | Lambda
  | Named
  | Await
  | Yield
  | Sequence
  | Dict
  | Comp
  | DictComp
  | Slice;

/** A name, number, `True`, `None`, `...`: printed as its one token (a number respelled). */
export interface Leaf extends ExprBase {
  readonly kind: "Name" | "Number" | "Bool" | "None" | "Ellipsis";
}
/** One string or an implicit concatenation of several (`parts`, tree-sitter `string` nodes). */
export interface Str extends ExprBase {
  readonly kind: "Str";
  readonly parts: readonly FormatNode[];
  readonly flavor: "str" | "bytes" | "f" | "t";
}
export interface Attribute extends ExprBase {
  readonly kind: "Attribute";
  readonly value: Expr;
  readonly dot: FormatNode;
  readonly attr: FormatNode;
}
export interface Call extends ExprBase {
  readonly kind: "Call";
  readonly func: Expr;
  readonly args: Arguments;
}
export interface Subscript extends ExprBase {
  readonly kind: "Subscript";
  readonly value: Expr;
  readonly open: FormatNode;
  readonly slice: Expr;
  readonly close: FormatNode;
}
/** `*x` or, in a dict or call, `**x`. */
export interface Starred extends ExprBase {
  readonly kind: "Starred";
  readonly op: FormatNode;
  readonly value: Expr;
}
export interface UnaryOp extends ExprBase {
  readonly kind: "UnaryOp";
  readonly op: FormatNode;
  readonly operand: Expr;
}
export interface BinOp extends ExprBase {
  readonly kind: "BinOp";
  readonly left: Expr;
  readonly op: FormatNode;
  readonly right: Expr;
}
export interface BoolOp extends ExprBase {
  readonly kind: "BoolOp";
  readonly values: Expr[];
  /** `ops[i]` stands between `values[i]` and `values[i + 1]`. */
  readonly ops: FormatNode[];
}
export interface Compare extends ExprBase {
  readonly kind: "Compare";
  readonly left: Expr;
  /** Each operator is one or two tokens (`not in` is one token in tree-sitter, `is not` too). */
  readonly ops: FormatNode[];
  readonly comparators: Expr[];
}
export interface IfExp extends ExprBase {
  readonly kind: "IfExp";
  readonly body: Expr;
  readonly ifTok: FormatNode;
  readonly test: Expr;
  readonly elseTok: FormatNode;
  readonly orelse: Expr;
}
export interface Lambda extends ExprBase {
  readonly kind: "Lambda";
  readonly lambdaTok: FormatNode;
  readonly params: Parameters | undefined;
  readonly colon: FormatNode;
  readonly body: Expr;
}
export interface Named extends ExprBase {
  readonly kind: "Named";
  readonly target: Expr;
  readonly op: FormatNode;
  readonly value: Expr;
}
export interface Await extends ExprBase {
  readonly kind: "Await";
  readonly kw: FormatNode;
  readonly value: Expr;
}
export interface Yield extends ExprBase {
  readonly kind: "Yield";
  /** `yield`, then `from` for `yield from`. */
  readonly kws: FormatNode[];
  readonly from: boolean;
  readonly value: Expr | undefined;
}
/** A tuple, list or set; a tuple without its own parentheses has none of `open` and `close`. */
export interface Sequence extends ExprBase {
  readonly kind: "Tuple" | "List" | "Set";
  readonly open: FormatNode | undefined;
  readonly elts: Expr[];
  readonly commas: FormatNode[];
  readonly close: FormatNode | undefined;
}
export interface DictItem {
  /** Absent for `**value`. */
  readonly key: Expr | undefined;
  readonly colon: FormatNode | undefined;
  readonly value: Expr;
}
export interface Dict extends ExprBase {
  readonly kind: "Dict";
  readonly open: FormatNode;
  readonly items: DictItem[];
  readonly close: FormatNode;
}
export interface Comp extends ExprBase {
  readonly kind: "ListComp" | "SetComp" | "Generator";
  /** Absent for a generator that shares its parentheses with the call around it. */
  readonly open: FormatNode | undefined;
  readonly elt: Expr;
  readonly generators: Comprehension[];
  readonly close: FormatNode | undefined;
}
export interface DictComp extends ExprBase {
  readonly kind: "DictComp";
  readonly open: FormatNode;
  readonly key: Expr;
  readonly colon: FormatNode;
  readonly value: Expr;
  readonly generators: Comprehension[];
  readonly close: FormatNode;
}
export interface Slice extends ExprBase {
  readonly kind: "Slice";
  readonly lower: Expr | undefined;
  readonly upper: Expr | undefined;
  readonly step: Expr | undefined;
  readonly colons: FormatNode[];
}

export type Other =
  | Arguments
  | Keyword
  | Comprehension
  | Parameters
  | Parameter
  | Alias
  | WithItem
  | Decorator
  | Clause
  | ExceptHandler
  | MatchCase
  | Pattern
  | TypeParams
  | TypeParam;

export interface Arguments extends Base {
  readonly kind: "Arguments";
  readonly open: FormatNode;
  /** Positional and keyword arguments in source order. */
  readonly items: (Expr | Keyword)[];
  readonly close: FormatNode;
}
/** `name=value`, or `**value` when `name` is absent. */
export interface Keyword extends Base {
  readonly kind: "Keyword";
  readonly name: FormatNode | undefined;
  /** `=`, or `**`. */
  readonly op: FormatNode;
  readonly value: Expr;
}
export interface Comprehension extends Base {
  readonly kind: "Comprehension";
  /** `async`? `for`, then `in`. */
  readonly kws: FormatNode[];
  readonly target: Expr;
  readonly iter: Expr;
  readonly ifs: { readonly kw: FormatNode; readonly test: Expr }[];
}
export interface Parameters extends Base {
  readonly kind: "Parameters";
  readonly open: FormatNode | undefined;
  /** Parameters and the `/` and `*` separators, in source order. */
  readonly items: (Parameter | Separator)[];
  readonly close: FormatNode | undefined;
}
export interface Separator {
  readonly kind: "Separator";
  readonly tok: FormatNode;
  readonly start: number;
  readonly end: number;
}
export interface Parameter extends Base {
  readonly kind: "Parameter";
  readonly star: FormatNode | undefined;
  readonly name: FormatNode;
  readonly colon: FormatNode | undefined;
  readonly annotation: Expr | undefined;
  readonly eq: FormatNode | undefined;
  readonly default: Expr | undefined;
}
/** `name as asname` of an import; `name` is the dotted name's tokens. */
export interface Alias extends Base {
  readonly kind: "Alias";
  readonly name: FormatNode[];
  readonly asTok: FormatNode | undefined;
  readonly asname: FormatNode | undefined;
}
export interface WithItem extends Base {
  readonly kind: "WithItem";
  readonly context: Expr;
  readonly asTok: FormatNode | undefined;
  readonly vars: Expr | undefined;
}
export interface Decorator extends Base {
  readonly kind: "Decorator";
  readonly at: FormatNode;
  readonly expr: Expr;
}
/** `elif test:` or `else:` of an `if`. */
export interface Clause extends Base {
  readonly kind: "ElifElse";
  readonly kw: FormatNode;
  readonly test: Expr | undefined;
  readonly colon: FormatNode;
  readonly body: Stmt[];
}
export interface ExceptHandler extends Base {
  readonly kind: "ExceptHandler";
  /** `except`, then `*` for `except*`. */
  readonly kws: FormatNode[];
  readonly type: Expr | undefined;
  readonly asTok: FormatNode | undefined;
  readonly name: FormatNode | undefined;
  readonly colon: FormatNode;
  readonly body: Stmt[];
}
export interface MatchCase extends Base {
  readonly kind: "MatchCase";
  readonly kw: FormatNode;
  readonly pattern: Pattern;
  readonly guardKw: FormatNode | undefined;
  readonly guard: Expr | undefined;
  readonly colon: FormatNode;
  readonly body: Stmt[];
}
/** A match pattern, printed from its tokens with Python's usual spacing. */
export interface Pattern extends Base {
  readonly kind: "Pattern";
}
export interface TypeParams extends Base {
  readonly kind: "TypeParams";
  readonly open: FormatNode;
  readonly params: TypeParam[];
  readonly close: FormatNode;
}
/** `T`, `T: bound`, `*Ts` or `**P`. */
export interface TypeParam extends Base {
  readonly kind: "TypeParam";
  /** `*` or `**`. */
  readonly star: FormatNode | undefined;
  readonly name: FormatNode;
  readonly colon: FormatNode | undefined;
  readonly bound: Expr | undefined;
}

export type Stmt =
  | Module
  | ExprStmt
  | Assign
  | AnnAssign
  | AugAssign
  | Simple
  | Import
  | ImportFrom
  | If
  | For
  | While
  | With
  | Try
  | FunctionDef
  | ClassDef
  | Match
  | TypeAlias;

export interface Module extends Base {
  readonly kind: "Module";
  readonly body: Stmt[];
}
export interface ExprStmt extends Base {
  readonly kind: "Expr";
  readonly value: Expr;
}
export interface Assign extends Base {
  readonly kind: "Assign";
  readonly targets: Expr[];
  /** `ops[i]` is the `=` after `targets[i]`. */
  readonly ops: FormatNode[];
  readonly value: Expr;
}
export interface AnnAssign extends Base {
  readonly kind: "AnnAssign";
  readonly target: Expr;
  readonly colon: FormatNode;
  readonly annotation: Expr;
  readonly eq: FormatNode | undefined;
  readonly value: Expr | undefined;
}
export interface AugAssign extends Base {
  readonly kind: "AugAssign";
  readonly target: Expr;
  readonly op: FormatNode;
  readonly value: Expr;
}
/** A keyword, then expressions separated by commas or its own words: return, del, raise, assert, global, ... */
export interface Simple extends Base {
  readonly kind:
    | "Return"
    | "Delete"
    | "Pass"
    | "Break"
    | "Continue"
    | "Raise"
    | "Assert"
    | "Global"
    | "Nonlocal";
  readonly kw: FormatNode;
  /** `Raise`: exc, cause; `Assert`: test, msg; `Return`, `Delete`: the one value. */
  readonly values: (Expr | undefined)[];
  /** `from` of `raise`, `,` of `assert`. */
  readonly sep: FormatNode | undefined;
  /** `Global`/`Nonlocal`: the names; the commas are `commas`. */
  readonly names: FormatNode[];
  readonly commas: FormatNode[];
}
export interface Import extends Base {
  readonly kind: "Import";
  readonly kw: FormatNode;
  readonly names: Alias[];
}
export interface ImportFrom extends Base {
  readonly kind: "ImportFrom";
  readonly fromKw: FormatNode;
  /** The dots and the module name's tokens. */
  readonly module: FormatNode[];
  readonly importKw: FormatNode;
  readonly open: FormatNode | undefined;
  readonly names: Alias[];
  readonly star: FormatNode | undefined;
  readonly close: FormatNode | undefined;
}
export interface If extends Base {
  readonly kind: "If";
  readonly kw: FormatNode;
  readonly test: Expr;
  readonly colon: FormatNode;
  readonly body: Stmt[];
  readonly clauses: Clause[];
}
/** A body after the main one, which ruff keeps as a plain list, with its header's tokens. */
export interface OrElse {
  readonly kw: FormatNode;
  readonly colon: FormatNode;
  readonly body: Stmt[];
}
export interface For extends Base {
  readonly kind: "For";
  /** `async`? `for`, then `in`. */
  readonly kws: FormatNode[];
  readonly target: Expr;
  readonly iter: Expr;
  readonly colon: FormatNode;
  readonly body: Stmt[];
  readonly orelse: OrElse | undefined;
}
export interface While extends Base {
  readonly kind: "While";
  readonly kw: FormatNode;
  readonly test: Expr;
  readonly colon: FormatNode;
  readonly body: Stmt[];
  readonly orelse: OrElse | undefined;
}
export interface With extends Base {
  readonly kind: "With";
  /** `async`? `with`. */
  readonly kws: FormatNode[];
  /** The parentheses around the items, when the source has them and they are not an item's own. */
  readonly open: FormatNode | undefined;
  readonly items: WithItem[];
  readonly close: FormatNode | undefined;
  readonly colon: FormatNode;
  readonly body: Stmt[];
}
export interface Try extends Base {
  readonly kind: "Try";
  readonly kw: FormatNode;
  readonly colon: FormatNode;
  readonly body: Stmt[];
  readonly handlers: ExceptHandler[];
  readonly orelse: OrElse | undefined;
  readonly finalbody: OrElse | undefined;
}
export interface FunctionDef extends Base {
  readonly kind: "FunctionDef";
  readonly decorators: Decorator[];
  /** `async`? `def`. */
  readonly kws: FormatNode[];
  readonly name: FormatNode;
  readonly typeParams: TypeParams | undefined;
  readonly params: Parameters;
  readonly arrow: FormatNode | undefined;
  readonly returns: Expr | undefined;
  readonly colon: FormatNode;
  readonly body: Stmt[];
}
export interface ClassDef extends Base {
  readonly kind: "ClassDef";
  readonly decorators: Decorator[];
  readonly kw: FormatNode;
  readonly name: FormatNode;
  readonly typeParams: TypeParams | undefined;
  readonly args: Arguments | undefined;
  readonly colon: FormatNode;
  readonly body: Stmt[];
}
export interface Match extends Base {
  readonly kind: "Match";
  readonly kw: FormatNode;
  readonly subject: Expr;
  readonly colon: FormatNode;
  readonly cases: MatchCase[];
}
export interface TypeAlias extends Base {
  readonly kind: "TypeAlias";
  readonly kw: FormatNode;
  readonly name: Expr;
  readonly typeParams: TypeParams | undefined;
  readonly eq: FormatNode;
  readonly value: Expr;
}

/** Thrown for input the formatter must not touch: a parse error, or Python 2. */
export class Unformattable extends Error {}

const fail = (node: FormatNode, why: string): never => {
  throw new Unformattable(`${why}: ${node.kind} at ${node.start}`);
};

/** Converts `root` (a tree-sitter `module`) to ruff's AST, rejecting any parse error first. */
export function toAst(root: FormatNode, source: string): Module {
  return new Reader(source).module(root);
}

class Reader {
  constructor(readonly source: string) {}

  text(n: FormatNode): string {
    return this.source.slice(n.start, n.end);
  }

  /** The named children that carry code: not comments, not line continuations. */
  named(n: FormatNode): FormatNode[] {
    const out: FormatNode[] = [];
    for (const c of n.children) {
      if (c.kind === "ERROR" || c.missing) fail(c, "parse error");
      if (c.named && c.kind !== "comment" && c.kind !== "line_continuation")
        out.push(c);
    }
    return out;
  }

  tok(n: FormatNode, kind: string): FormatNode | undefined {
    for (const c of n.children) if (!c.named && c.kind === kind) return c;
    return undefined;
  }

  need(n: FormatNode, kind: string): FormatNode {
    return this.tok(n, kind) ?? fail(n, `no ${kind}`);
  }

  field(n: FormatNode, name: string): FormatNode | undefined {
    for (const c of n.children) if (c.field === name) return c;
    return undefined;
  }

  fields(n: FormatNode, name: string): FormatNode[] {
    return n.children.filter((c) => c.field === name);
  }

  needField(n: FormatNode, name: string): FormatNode {
    return this.field(n, name) ?? fail(n, `no ${name}`);
  }

  module(n: FormatNode): Module {
    if (n.kind !== "module") fail(n, "not a module");
    const body = this.body(n);
    return this.link({
      kind: "Module",
      ts: n,
      start: n.start,
      end: n.end,
      kids: body,
      parent: undefined,
      body,
    });
  }

  /** Sets each child's `parent`. */
  link<T extends Py>(node: T): T {
    for (const k of node.kids) k.parent = node;
    return node;
  }

  body(block: FormatNode): Stmt[] {
    return this.named(block).map((s) => this.stmt(s));
  }

  /** The end of a statement: its last body statement's, or its own. */
  stmtEnd(body: readonly Stmt[], fallback: number): number {
    return body.at(-1)?.end ?? fallback;
  }

  stmt(n: FormatNode): Stmt {
    switch (n.kind) {
      case "expression_statement":
        return this.exprStmt(n);
      case "return_statement":
      case "delete_statement": {
        const kw = this.need(
          n,
          n.kind === "return_statement" ? "return" : "del",
        );
        const value = this.named(n)[0];
        const values = [value && this.expr(value)];
        return this.simple(
          n,
          n.kind === "return_statement" ? "Return" : "Delete",
          kw,
          values,
        );
      }
      case "pass_statement":
        return this.simple(n, "Pass", this.need(n, "pass"), []);
      case "break_statement":
        return this.simple(n, "Break", this.need(n, "break"), []);
      case "continue_statement":
        return this.simple(n, "Continue", this.need(n, "continue"), []);
      case "raise_statement": {
        const cause = this.field(n, "cause");
        const exc = this.named(n).find((c) => c !== cause);
        return this.simple(
          n,
          "Raise",
          this.need(n, "raise"),
          [exc && this.expr(exc), cause && this.expr(cause)],
          this.tok(n, "from"),
        );
      }
      case "assert_statement": {
        const [test, msg] = this.named(n);
        return this.simple(
          n,
          "Assert",
          this.need(n, "assert"),
          [test && this.expr(test), msg && this.expr(msg)],
          this.tok(n, ","),
        );
      }
      case "global_statement":
      case "nonlocal_statement": {
        const global = n.kind === "global_statement";
        const s = this.simple(
          n,
          global ? "Global" : "Nonlocal",
          this.need(n, global ? "global" : "nonlocal"),
          [],
        );
        s.names.push(...this.named(n));
        s.commas.push(...n.children.filter((c) => c.kind === ","));
        return s;
      }
      case "import_statement": {
        const names = this.fields(n, "name").map((a) => this.alias(a));
        return this.link({
          kind: "Import",
          ts: n,
          start: n.start,
          end: n.end,
          kids: names,
          parent: undefined,
          kw: this.need(n, "import"),
          names,
        });
      }
      case "import_from_statement":
      case "future_import_statement":
        return this.importFrom(n);
      case "if_statement":
        return this.ifStmt(n);
      case "for_statement":
        return this.forStmt(n);
      case "while_statement": {
        const body = this.body(this.needField(n, "body"));
        const orelse = this.orelse(this.field(n, "alternative"));
        const test = this.expr(this.needField(n, "condition"));
        return this.link({
          kind: "While",
          ts: n,
          start: n.start,
          end: this.stmtEnd(orelse?.body ?? body, n.end),
          kids: [test, ...body, ...(orelse?.body ?? [])],
          parent: undefined,
          kw: this.need(n, "while"),
          test,
          colon: this.need(n, ":"),
          body,
          orelse,
        });
      }
      case "with_statement":
        return this.withStmt(n);
      case "try_statement":
        return this.tryStmt(n);
      case "function_definition":
        return this.functionDef(n, [], n.start);
      case "class_definition":
        return this.classDef(n, [], n.start);
      case "decorated_definition": {
        const decorators = this.named(n)
          .filter((c) => c.kind === "decorator")
          .map((d): Decorator => {
            const expr = this.expr(
              this.named(d)[0] ?? fail(d, "empty decorator"),
            );
            return this.link({
              kind: "Decorator",
              ts: d,
              start: d.start,
              end: d.end,
              kids: [expr],
              parent: undefined,
              at: this.need(d, "@"),
              expr,
            });
          });
        const def = this.needField(n, "definition");
        return def.kind === "class_definition"
          ? this.classDef(def, decorators, n.start)
          : this.functionDef(def, decorators, n.start);
      }
      case "match_statement":
        return this.matchStmt(n);
      case "type_alias_statement": {
        const [left, right] = [
          this.needField(n, "left"),
          this.needField(n, "right"),
        ];
        // `type X[T] = ...` reads its left side as a generic type: the name, then the parameters.
        const head = this.typeExpr(left);
        const generic = head.kind === "generic_type";
        const name = this.expr(
          generic ? (this.named(head)[0] as FormatNode) : head,
        );
        const tp = generic
          ? this.named(head).find((c) => c.kind === "type_parameter")
          : undefined;
        const typeParams = tp && this.typeParams(tp);
        const value = this.expr(this.typeExpr(right));
        return this.link({
          kind: "TypeAlias",
          ts: n,
          start: n.start,
          end: n.end,
          kids: [name, ...(typeParams ? [typeParams] : []), value],
          parent: undefined,
          kw: this.need(n, "type"),
          name,
          typeParams,
          eq: this.need(n, "="),
          value,
        });
      }
      default:
        return fail(n, "unsupported statement");
    }
  }

  simple(
    n: FormatNode,
    kind: Simple["kind"],
    kw: FormatNode,
    values: (Expr | undefined)[],
    sep?: FormatNode,
  ): Simple {
    return this.link({
      kind,
      ts: n,
      start: n.start,
      end: n.end,
      kids: values.filter((v) => v !== undefined),
      parent: undefined,
      kw,
      values,
      sep,
      names: [],
      commas: [],
    });
  }

  exprStmt(n: FormatNode): Stmt {
    const named = this.named(n);
    const first = named[0] ?? fail(n, "empty statement");
    // `a, b` as a statement is one tuple; tree-sitter lists its items in the statement.
    if (named.length > 1 || this.tok(n, ","))
      return this.wrapExpr(n, this.tupleOf(n, named, undefined, undefined));
    const inner = this.unparen(first);
    if (inner.kind === "assignment") return this.assignment(n, first);
    if (inner.kind === "augmented_assignment" && inner === first) {
      const target = this.expr(this.needField(first, "left"));
      const value = this.expr(this.needField(first, "right"));
      return this.link({
        kind: "AugAssign",
        ts: n,
        start: n.start,
        end: n.end,
        kids: [target, value],
        parent: undefined,
        target,
        op: this.needField(first, "operator"),
        value,
      });
    }
    return this.wrapExpr(n, this.expr(first));
  }

  wrapExpr(n: FormatNode, value: Expr): ExprStmt {
    return this.link({
      kind: "Expr",
      ts: n,
      start: n.start,
      end: n.end,
      kids: [value],
      parent: undefined,
      value,
    });
  }

  assignment(n: FormatNode, a: FormatNode): Stmt {
    if (a.kind !== "assignment") fail(a, "parenthesized assignment");
    const type = this.field(a, "type");
    const left = this.expr(this.needField(a, "left"));
    if (type) {
      const annotation = this.expr(this.typeExpr(type));
      const right = this.field(a, "right");
      const value = right && this.expr(right);
      return this.link({
        kind: "AnnAssign",
        ts: n,
        start: n.start,
        end: n.end,
        kids: [left, annotation, ...(value ? [value] : [])],
        parent: undefined,
        target: left,
        colon: this.need(a, ":"),
        annotation,
        eq: this.tok(a, "="),
        value,
      });
    }
    // `a = b = c` nests to the right in tree-sitter; ruff lists the targets.
    const targets = [left];
    const ops = [this.need(a, "=")];
    let right = this.needField(a, "right");
    while (right.kind === "assignment" && !this.field(right, "type")) {
      targets.push(this.expr(this.needField(right, "left")));
      ops.push(this.need(right, "="));
      right = this.needField(right, "right");
    }
    const value = this.expr(right);
    return this.link({
      kind: "Assign",
      ts: n,
      start: n.start,
      end: n.end,
      kids: [...targets, value],
      parent: undefined,
      targets,
      ops,
      value,
    });
  }

  /** A `type` node's expression. */
  typeExpr(t: FormatNode): FormatNode {
    if (t.kind !== "type") return t;
    const named = this.named(t);
    if (named.length !== 1) fail(t, "unsupported type");
    return named[0] as FormatNode;
  }

  alias(a: FormatNode): Alias {
    const nameNode =
      a.kind === "aliased_import" ? this.needField(a, "name") : a;
    const name = this.dotted(nameNode);
    const asname =
      a.kind === "aliased_import" ? this.needField(a, "alias") : undefined;
    return {
      kind: "Alias",
      ts: a,
      start: a.start,
      end: a.end,
      kids: [],
      parent: undefined,
      name,
      asTok: a.kind === "aliased_import" ? this.need(a, "as") : undefined,
      asname,
    };
  }

  /** The leaves of a dotted name or relative import. */
  dotted(n: FormatNode): FormatNode[] {
    const out: FormatNode[] = [];
    const walk = (x: FormatNode) => {
      if (x.kind === "comment" || x.kind === "line_continuation") return;
      if (x.kind === "ERROR" || x.missing) fail(x, "parse error");
      if (x.children.length === 0 || x.kind === "identifier") out.push(x);
      else for (const c of x.children) walk(c);
    };
    walk(n);
    return out;
  }

  importFrom(n: FormatNode): ImportFrom {
    const module =
      n.kind === "future_import_statement"
        ? [this.need(n, "__future__")]
        : this.dotted(this.needField(n, "module_name"));
    const names = this.fields(n, "name").map((a) => this.alias(a));
    const wildcard = this.named(n).find((c) => c.kind === "wildcard_import");
    const node: ImportFrom = {
      kind: "ImportFrom",
      ts: n,
      start: n.start,
      end: n.end,
      kids: names,
      parent: undefined,
      fromKw: this.need(n, "from"),
      module,
      importKw: this.need(n, "import"),
      open: this.tok(n, "("),
      names,
      star: wildcard && (wildcard.children[0] ?? wildcard),
      close: this.tok(n, ")"),
    };
    return this.link(node);
  }

  ifStmt(n: FormatNode): If {
    const test = this.expr(this.needField(n, "condition"));
    const body = this.body(this.needField(n, "consequence"));
    const clauses = this.fields(n, "alternative").map((c): Clause => {
      const cbody = this.body(
        this.needField(c, c.kind === "elif_clause" ? "consequence" : "body"),
      );
      const ctest =
        c.kind === "elif_clause"
          ? this.expr(this.needField(c, "condition"))
          : undefined;
      return this.link({
        kind: "ElifElse",
        ts: c,
        start: c.start,
        end: this.stmtEnd(cbody, c.end),
        kids: [...(ctest ? [ctest] : []), ...cbody],
        parent: undefined,
        kw: this.need(c, c.kind === "elif_clause" ? "elif" : "else"),
        test: ctest,
        colon: this.need(c, ":"),
        body: cbody,
      });
    });
    return this.link({
      kind: "If",
      ts: n,
      start: n.start,
      end: clauses.at(-1)?.end ?? this.stmtEnd(body, n.end),
      kids: [test, ...body, ...clauses],
      parent: undefined,
      kw: this.need(n, "if"),
      test,
      colon: this.need(n, ":"),
      body,
      clauses,
    });
  }

  orelse(c: FormatNode | undefined): OrElse | undefined {
    if (!c) return undefined;
    const block =
      this.field(c, "body") ?? this.named(c).find((x) => x.kind === "block");
    return {
      kw: this.need(c, c.kind === "finally_clause" ? "finally" : "else"),
      colon: this.need(c, ":"),
      body: block ? this.body(block) : [],
    };
  }

  forStmt(n: FormatNode): For {
    const target = this.expr(this.needField(n, "left"));
    const iter = this.expr(this.needField(n, "right"));
    const body = this.body(this.needField(n, "body"));
    const orelse = this.orelse(this.field(n, "alternative"));
    const kws = [
      this.tok(n, "async"),
      this.need(n, "for"),
      this.need(n, "in"),
    ].filter((k) => k !== undefined);
    return this.link({
      kind: "For",
      ts: n,
      start: n.start,
      end: this.stmtEnd(orelse?.body ?? body, n.end),
      kids: [target, iter, ...body, ...(orelse?.body ?? [])],
      parent: undefined,
      kws,
      target,
      iter,
      colon: this.need(n, ":"),
      body,
      orelse,
    });
  }

  withStmt(n: FormatNode): With {
    const clause =
      this.named(n).find((c) => c.kind === "with_clause") ??
      fail(n, "no with clause");
    const items = this.named(clause).map((item): WithItem => {
      const value = this.needField(item, "value");
      let context: Expr;
      let asTok: FormatNode | undefined;
      let vars: Expr | undefined;
      if (value.kind === "as_pattern") {
        const [ctx, target] = this.named(value);
        context = this.expr(ctx ?? fail(value, "no context"));
        asTok = this.need(value, "as");
        const t = target && (this.named(target)[0] ?? target);
        vars = t && this.expr(t);
      } else context = this.expr(value);
      return this.link({
        kind: "WithItem",
        ts: item,
        start: item.start,
        end: item.end,
        kids: [context, ...(vars ? [vars] : [])],
        parent: undefined,
        context,
        asTok,
        vars,
      });
    });
    const body = this.body(this.needField(n, "body"));
    return this.link({
      kind: "With",
      ts: n,
      start: n.start,
      end: this.stmtEnd(body, n.end),
      kids: [...items, ...body],
      parent: undefined,
      kws: [this.tok(n, "async"), this.need(n, "with")].filter(
        (k) => k !== undefined,
      ),
      open: this.tok(clause, "("),
      items,
      close: this.tok(clause, ")"),
      colon: this.need(n, ":"),
      body,
    });
  }

  tryStmt(n: FormatNode): Try {
    const body = this.body(this.needField(n, "body"));
    const handlers: ExceptHandler[] = [];
    let orelse: OrElse | undefined;
    let finalbody: OrElse | undefined;
    for (const c of this.named(n)) {
      if (c.kind === "except_clause") {
        const block = this.named(c).find((x) => x.kind === "block");
        const hbody = block ? this.body(block) : [];
        const value = this.field(c, "value");
        let type: Expr | undefined;
        let asTok: FormatNode | undefined;
        let name: FormatNode | undefined;
        if (value?.kind === "as_pattern") {
          const [t, target] = this.named(value);
          type = this.expr(t ?? fail(value, "no type"));
          asTok = this.need(value, "as");
          name = target && (this.named(target)[0] ?? target);
        } else if (value) type = this.expr(value);
        // `except A, B:` is Python 2 unless it is `except (A, B)`; tree-sitter reads the second as the alias.
        const alias = this.field(c, "alias");
        if (alias) fail(c, "Python 2 except");
        handlers.push(
          this.link({
            kind: "ExceptHandler",
            ts: c,
            start: c.start,
            end: this.stmtEnd(hbody, c.end),
            kids: [...(type ? [type] : []), ...hbody],
            parent: undefined,
            kws: [this.need(c, "except"), this.tok(c, "*")].filter(
              (k) => k !== undefined,
            ),
            type,
            asTok,
            name,
            colon: this.need(c, ":"),
            body: hbody,
          }),
        );
      } else if (c.kind === "else_clause") orelse = this.orelse(c);
      else if (c.kind === "finally_clause") finalbody = this.orelse(c);
    }
    const last =
      finalbody?.body ?? orelse?.body ?? handlers.at(-1)?.body ?? body;
    return this.link({
      kind: "Try",
      ts: n,
      start: n.start,
      end: this.stmtEnd(last, n.end),
      kids: [
        ...body,
        ...handlers,
        ...(orelse?.body ?? []),
        ...(finalbody?.body ?? []),
      ],
      parent: undefined,
      kw: this.need(n, "try"),
      colon: this.need(n, ":"),
      body,
      handlers,
      orelse,
      finalbody,
    });
  }

  functionDef(
    n: FormatNode,
    decorators: Decorator[],
    start: number,
  ): FunctionDef {
    const tp = this.field(n, "type_parameters");
    const typeParams = tp && this.typeParams(tp);
    const params = this.parameters(this.needField(n, "parameters"));
    const ret = this.field(n, "return_type");
    const returns = ret && this.expr(this.typeExpr(ret));
    const body = this.body(this.needField(n, "body"));
    return this.link({
      kind: "FunctionDef",
      ts: n,
      start,
      end: this.stmtEnd(body, n.end),
      kids: [
        ...decorators,
        ...(typeParams ? [typeParams] : []),
        params,
        ...(returns ? [returns] : []),
        ...body,
      ],
      parent: undefined,
      decorators,
      kws: [this.tok(n, "async"), this.need(n, "def")].filter(
        (k) => k !== undefined,
      ),
      name: this.needField(n, "name"),
      typeParams,
      params,
      arrow: this.tok(n, "->"),
      returns,
      colon: this.need(n, ":"),
      body,
    });
  }

  classDef(n: FormatNode, decorators: Decorator[], start: number): ClassDef {
    const tp = this.field(n, "type_parameters");
    const typeParams = tp && this.typeParams(tp);
    const sup = this.field(n, "superclasses");
    const args = sup && this.arguments(sup);
    const body = this.body(this.needField(n, "body"));
    return this.link({
      kind: "ClassDef",
      ts: n,
      start,
      end: this.stmtEnd(body, n.end),
      kids: [
        ...decorators,
        ...(typeParams ? [typeParams] : []),
        ...(args ? [args] : []),
        ...body,
      ],
      parent: undefined,
      decorators,
      kw: this.need(n, "class"),
      name: this.needField(n, "name"),
      typeParams,
      args,
      colon: this.need(n, ":"),
      body,
    });
  }

  typeParams(n: FormatNode): TypeParams {
    const params = this.named(n).map((t) => this.typeParam(t));
    return this.link({
      kind: "TypeParams",
      ts: n,
      start: n.start,
      end: n.end,
      kids: params,
      parent: undefined,
      open: this.need(n, "["),
      params,
      close: this.need(n, "]"),
    });
  }

  typeParam(t: FormatNode): TypeParam {
    const p = this.typeExpr(t);
    const base = { ts: p, start: p.start, end: p.end, parent: undefined };
    switch (p.kind) {
      case "identifier":
        return {
          ...base,
          kind: "TypeParam",
          kids: [],
          star: undefined,
          name: p,
          colon: undefined,
          bound: undefined,
        };
      case "splat_type":
        return {
          ...base,
          kind: "TypeParam",
          kids: [],
          star: p.children[0] ?? fail(p, "no star"),
          name: this.named(p)[0] ?? fail(p, "no name"),
          colon: undefined,
          bound: undefined,
        };
      case "constrained_type": {
        const [nameType, boundType] = this.named(p);
        const name = nameType && this.typeExpr(nameType);
        if (!name || name.kind !== "identifier" || !boundType)
          return fail(p, "unsupported type parameter");
        const bound = this.expr(boundType);
        return this.link({
          ...base,
          kind: "TypeParam",
          kids: [bound],
          star: undefined,
          name,
          colon: this.need(p, ":"),
          bound,
        });
      }
      default:
        return fail(p, "unsupported type parameter");
    }
  }

  matchStmt(n: FormatNode): Match {
    const subject = this.expr(this.needField(n, "subject"));
    const block = this.needField(n, "body");
    const cases = this.named(block).map((c): MatchCase => {
      const patternNode =
        this.named(c).find((x) => x.kind === "case_pattern") ??
        fail(c, "no pattern");
      this.dotted(patternNode);
      const guardClause = this.field(c, "guard");
      const guardExpr = guardClause && this.named(guardClause)[0];
      const guard = guardExpr && this.expr(guardExpr);
      const body = this.body(this.needField(c, "consequence"));
      // Every pattern after `case`, up to the guard or the colon, as one node.
      const last =
        this.named(c)
          .filter((x) => x.kind === "case_pattern")
          .at(-1) ?? patternNode;
      const pattern: Pattern = {
        kind: "Pattern",
        ts: c,
        start: patternNode.start,
        end: last.end,
        kids: [],
        parent: undefined,
      };
      return this.link({
        kind: "MatchCase",
        ts: c,
        start: c.start,
        end: this.stmtEnd(body, c.end),
        kids: [pattern, ...(guard ? [guard] : []), ...body],
        parent: undefined,
        kw: this.need(c, "case"),
        pattern,
        guardKw: guardClause && this.need(guardClause, "if"),
        guard,
        colon: this.need(c, ":"),
        body,
      });
    });
    return this.link({
      kind: "Match",
      ts: n,
      start: n.start,
      end: cases.at(-1)?.end ?? n.end,
      kids: [subject, ...cases],
      parent: undefined,
      kw: this.need(n, "match"),
      subject,
      colon: this.need(n, ":"),
      cases,
    });
  }

  /** The node inside any parentheses around `n`. */
  unparen(n: FormatNode): FormatNode {
    let x = n;
    for (;;) {
      if (x.kind !== "parenthesized_expression") return x;
      const inner = this.named(x);
      if (inner.length !== 1) return x;
      x = inner[0] as FormatNode;
    }
  }

  expr(n: FormatNode): Expr {
    const parens: Paren[] = [];
    let x = n;
    while (x.kind === "parenthesized_expression") {
      const inner = this.named(x);
      const only = inner[0];
      // `(yield)` and `(*a)` stay as tree-sitter wraps them; any other shape is a parse oddity.
      if (inner.length !== 1 || !only)
        return fail(x, "unsupported parentheses");
      parens.push({
        open: this.need(x, "("),
        close: this.need(x, ")"),
        wrapper: x,
      });
      x = only;
    }
    const e = this.bare(x, parens);
    return this.link(e);
  }

  bare(n: FormatNode, parens: Paren[]): Expr {
    const base = {
      ts: n,
      start: n.start,
      end: n.end,
      parent: undefined,
      parens,
    };
    const leaf = (kind: Leaf["kind"]): Leaf => ({ ...base, kind, kids: [] });
    switch (n.kind) {
      case "identifier":
        return leaf("Name");
      case "integer":
      case "float":
        return leaf("Number");
      case "true":
      case "false":
        return leaf("Bool");
      case "none":
        return leaf("None");
      case "ellipsis":
        return leaf("Ellipsis");
      case "string":
        return this.str(n, [n], parens);
      case "concatenated_string":
        return this.str(n, this.named(n), parens);
      case "attribute": {
        const value = this.expr(this.needField(n, "object"));
        return {
          ...base,
          kind: "Attribute",
          kids: [value],
          value,
          dot: this.need(n, "."),
          attr: this.needField(n, "attribute"),
        };
      }
      case "call": {
        const func = this.expr(this.needField(n, "function"));
        const argNode = this.needField(n, "arguments");
        const args =
          argNode.kind === "generator_expression"
            ? this.soleGenerator(argNode)
            : this.arguments(argNode);
        return { ...base, kind: "Call", kids: [func, args], func, args };
      }
      case "subscript": {
        const value = this.expr(this.needField(n, "value"));
        const subs = this.fields(n, "subscript");
        const open = this.need(n, "[");
        const close = this.need(n, "]");
        const commas = n.children.filter((c) => !c.named && c.kind === ",");
        const slice =
          subs.length === 1 && commas.length === 0
            ? this.expr(subs[0] as FormatNode)
            : this.link(
                this.tupleOf(
                  n,
                  subs,
                  undefined,
                  undefined,
                  open.end,
                  close.start,
                ),
              );
        return {
          ...base,
          kind: "Subscript",
          kids: [value, slice],
          value,
          open,
          slice,
          close,
        };
      }
      case "list_splat":
      case "dictionary_splat": {
        const value = this.expr(this.named(n)[0] ?? fail(n, "empty splat"));
        return {
          ...base,
          kind: "Starred",
          kids: [value],
          op: n.children[0] ?? fail(n, "no star"),
          value,
        };
      }
      case "generic_type": {
        // tree-sitter reads `list[int]` in an annotation as a generic type, ruff as a subscript.
        const [id, tp] = this.named(n);
        if (!id || tp?.kind !== "type_parameter")
          return fail(n, "unsupported generic type");
        const value = this.expr(id);
        const subs = this.named(tp);
        const open = this.need(tp, "[");
        const close = this.need(tp, "]");
        const commas = tp.children.filter((c) => !c.named && c.kind === ",");
        const slice =
          subs.length === 1 && commas.length === 0
            ? this.expr(subs[0] as FormatNode)
            : this.link(
                this.tupleOf(
                  tp,
                  subs,
                  undefined,
                  undefined,
                  open.end,
                  close.start,
                ),
              );
        return {
          ...base,
          kind: "Subscript",
          kids: [value, slice],
          value,
          open,
          slice,
          close,
        };
      }
      case "splat_type": {
        const value = this.expr(this.named(n)[0] ?? fail(n, "empty splat"));
        return {
          ...base,
          kind: "Starred",
          kids: [value],
          op: n.children[0] ?? fail(n, "no star"),
          value,
        };
      }
      case "parenthesized_list_splat": {
        // `(*a)` inside a call's arguments: a starred expression in parentheses.
        return this.expr(this.named(n)[0] ?? fail(n, "empty splat"));
      }
      case "unary_operator":
      case "not_operator": {
        const operand = this.expr(this.needField(n, "argument"));
        const op =
          n.kind === "not_operator"
            ? this.need(n, "not")
            : this.needField(n, "operator");
        return { ...base, kind: "UnaryOp", kids: [operand], op, operand };
      }
      case "binary_operator": {
        const left = this.expr(this.needField(n, "left"));
        const right = this.expr(this.needField(n, "right"));
        return {
          ...base,
          kind: "BinOp",
          kids: [left, right],
          left,
          op: this.needField(n, "operator"),
          right,
        };
      }
      case "boolean_operator": {
        // Ruff lists `a and b and c` as one node; tree-sitter nests it to the left.
        const op = this.needField(n, "operator");
        const values: Expr[] = [];
        const ops: FormatNode[] = [];
        const walk = (x: FormatNode) => {
          const left = this.needField(x, "left");
          if (
            left.kind === "boolean_operator" &&
            this.needField(left, "operator").kind === op.kind
          )
            walk(left);
          else values.push(this.expr(left));
          ops.push(this.needField(x, "operator"));
          values.push(this.expr(this.needField(x, "right")));
        };
        walk(n);
        return { ...base, kind: "BoolOp", kids: values, values, ops };
      }
      case "comparison_operator": {
        const named = this.named(n);
        const [first, ...rest] = named.map((c) => this.expr(c));
        return {
          ...base,
          kind: "Compare",
          kids: named.length ? [first as Expr, ...rest] : [],
          left: first ?? fail(n, "empty comparison"),
          ops: this.fields(n, "operators"),
          comparators: rest,
        };
      }
      case "conditional_expression": {
        const [body, test, orelse] = this.named(n).map((c) => this.expr(c));
        if (!body || !test || !orelse) return fail(n, "bad conditional");
        return {
          ...base,
          kind: "IfExp",
          kids: [body, test, orelse],
          body,
          ifTok: this.need(n, "if"),
          test,
          elseTok: this.need(n, "else"),
          orelse,
        };
      }
      case "lambda": {
        const p = this.field(n, "parameters");
        const params = p && this.parameters(p);
        const body = this.expr(this.needField(n, "body"));
        return {
          ...base,
          kind: "Lambda",
          kids: [...(params ? [params] : []), body],
          lambdaTok: this.need(n, "lambda"),
          params,
          colon: this.need(n, ":"),
          body,
        };
      }
      case "named_expression": {
        const target = this.expr(this.needField(n, "name"));
        const value = this.expr(this.needField(n, "value"));
        return {
          ...base,
          kind: "Named",
          kids: [target, value],
          target,
          op: this.need(n, ":="),
          value,
        };
      }
      case "await": {
        const value = this.expr(this.named(n)[0] ?? fail(n, "empty await"));
        return {
          ...base,
          kind: "Await",
          kids: [value],
          kw: this.need(n, "await"),
          value,
        };
      }
      case "yield": {
        const v = this.named(n);
        const from = this.tok(n, "from");
        const value =
          v.length > 1 || this.tok(n, ",")
            ? this.link(this.tupleOf(n, v, undefined, undefined))
            : v[0] && this.expr(v[0]);
        return {
          ...base,
          kind: "Yield",
          kids: value ? [value] : [],
          kws: [this.need(n, "yield"), from].filter((k) => k !== undefined),
          from: from !== undefined,
          value,
        };
      }
      case "tuple":
      case "expression_list":
      case "pattern_list":
      case "tuple_pattern": {
        const open = this.tok(n, "(");
        const close = this.tok(n, ")");
        const t = this.tupleOf(n, this.named(n), open, close);
        return { ...t, parens };
      }
      case "list":
      case "set":
      case "list_pattern": {
        const elts = this.named(n).map((c) => this.expr(c));
        return {
          ...base,
          kind: n.kind === "set" ? "Set" : "List",
          kids: elts,
          open: this.need(n, n.kind === "set" ? "{" : "["),
          elts,
          commas: n.children.filter((c) => !c.named && c.kind === ","),
          close: this.need(n, n.kind === "set" ? "}" : "]"),
        };
      }
      case "dictionary": {
        const items = this.named(n).map((c): DictItem => {
          if (c.kind === "pair")
            return {
              key: this.expr(this.needField(c, "key")),
              colon: this.need(c, ":"),
              value: this.expr(this.needField(c, "value")),
            };
          if (c.kind === "dictionary_splat")
            return { key: undefined, colon: undefined, value: this.expr(c) };
          return fail(c, "bad dict item");
        });
        return {
          ...base,
          kind: "Dict",
          kids: items.flatMap((i) => (i.key ? [i.key, i.value] : [i.value])),
          open: this.need(n, "{"),
          items,
          close: this.need(n, "}"),
        };
      }
      case "list_comprehension":
      case "set_comprehension":
      case "generator_expression": {
        const elt = this.expr(this.needField(n, "body"));
        const generators = this.comprehensions(n);
        return {
          ...base,
          kind:
            n.kind === "list_comprehension"
              ? "ListComp"
              : n.kind === "set_comprehension"
                ? "SetComp"
                : "Generator",
          kids: [elt, ...generators],
          open: n.children[0],
          elt,
          generators,
          close: n.children.at(-1),
        };
      }
      case "dictionary_comprehension": {
        const pair = this.needField(n, "body");
        const key = this.expr(this.needField(pair, "key"));
        const value = this.expr(this.needField(pair, "value"));
        const generators = this.comprehensions(n);
        return {
          ...base,
          kind: "DictComp",
          kids: [key, value, ...generators],
          open: this.need(n, "{"),
          key,
          colon: this.need(pair, ":"),
          value,
          generators,
          close: this.need(n, "}"),
        };
      }
      case "slice": {
        const parts: (Expr | undefined)[] = [undefined];
        const colons: FormatNode[] = [];
        for (const c of n.children) {
          if (c.kind === "comment" || c.kind === "line_continuation") continue;
          if (c.kind === "ERROR" || c.missing) fail(c, "parse error");
          if (!c.named && c.kind === ":") {
            colons.push(c);
            parts.push(undefined);
          } else if (c.named) parts[parts.length - 1] = this.expr(c);
        }
        const [lower, upper, step] = parts;
        return {
          ...base,
          kind: "Slice",
          kids: parts.filter((p) => p !== undefined),
          lower,
          upper,
          step,
          colons,
        };
      }
      case "keyword_argument":
        return fail(n, "keyword outside a call");
      case "type":
        return this.expr(this.typeExpr(n));
      case "case_pattern":
      case "splat_pattern":
      case "list_splat_pattern":
      case "dictionary_splat_pattern":
        return fail(n, "unsupported pattern");
      default:
        return fail(n, "unsupported expression");
    }
  }

  str(n: FormatNode, parts: FormatNode[], parens: Paren[]): Str {
    const first = parts[0] ?? fail(n, "empty string");
    const start = first.children[0] ?? fail(first, "no string start");
    const prefix = this.text(start).toLowerCase();
    if (prefix.includes("`")) fail(n, "Python 2 backticks");
    const flavor = prefix.includes("b")
      ? "bytes"
      : prefix.includes("f")
        ? "f"
        : prefix.includes("t")
          ? "t"
          : "str";
    for (const p of parts) this.dotted(p);
    return {
      kind: "Str",
      ts: n,
      start: n.start,
      end: n.end,
      kids: [],
      parent: undefined,
      parens,
      parts,
      flavor,
    };
  }

  tupleOf(
    n: FormatNode,
    items: FormatNode[],
    open: FormatNode | undefined,
    close: FormatNode | undefined,
    from = n.start,
    to = n.end,
  ): Sequence {
    const elts = items.map((c) => this.expr(c));
    const commas = n.children.filter((c) => !c.named && c.kind === ",");
    // Without parentheses, ruff's tuple runs from its first item to its last comma or item.
    const start = open
      ? n.start
      : Math.max(
          from,
          Math.min(elts[0]?.start ?? from, commas[0]?.start ?? to),
        );
    const end = close
      ? n.end
      : Math.min(
          to,
          Math.max(elts.at(-1)?.end ?? start, commas.at(-1)?.end ?? start),
        );
    const outerStart = open
      ? start
      : Math.min(start, ...elts.map((e) => outer(e).start));
    const outerEnd = close
      ? end
      : Math.max(end, ...elts.map((e) => outer(e).end));
    return {
      kind: "Tuple",
      ts: n,
      start: outerStart,
      end: outerEnd,
      kids: elts,
      parent: undefined,
      parens: [],
      open,
      elts,
      commas,
      close,
    };
  }

  comprehensions(n: FormatNode): Comprehension[] {
    const out: Comprehension[] = [];
    for (const c of this.named(n)) {
      if (c.kind === "for_in_clause") {
        const target = this.expr(this.needField(c, "left"));
        const rights = this.fields(c, "right");
        const iter =
          rights.length > 1 ||
          c.children.some((x) => x.kind === "," && !x.named)
            ? this.link(
                this.tupleOf(
                  c,
                  rights,
                  undefined,
                  undefined,
                  this.need(c, "in").end,
                ),
              )
            : this.expr(rights[0] ?? fail(c, "no iter"));
        out.push({
          kind: "Comprehension",
          ts: c,
          start: c.start,
          end: iter.end,
          kids: [target, iter],
          parent: undefined,
          kws: [
            this.tok(c, "async"),
            this.need(c, "for"),
            this.need(c, "in"),
          ].filter((k) => k !== undefined),
          target,
          iter,
          ifs: [],
        });
      } else if (c.kind === "if_clause") {
        const last = out.at(-1) ?? fail(c, "if before for");
        const test = this.expr(this.named(c)[0] ?? fail(c, "empty if"));
        last.ifs.push({ kw: this.need(c, "if"), test });
        last.kids.push(test);
        (last as { end: number }).end = outer(test).end;
      }
    }
    for (const c of out) this.link(c);
    return out;
  }

  /** `f(x for x in y)`: the generator's parentheses are the call's. */
  soleGenerator(g: FormatNode): Arguments {
    const open = this.need(g, "(");
    const close = this.need(g, ")");
    const elt = this.expr(this.needField(g, "body"));
    const generators = this.comprehensions(g);
    const gen: Comp = this.link({
      kind: "Generator",
      ts: g,
      start: outer(elt).start,
      end: generators.at(-1)?.end ?? elt.end,
      kids: [elt, ...generators],
      parent: undefined,
      parens: [],
      open: undefined,
      elt,
      generators,
      close: undefined,
    });
    return this.link({
      kind: "Arguments",
      ts: g,
      start: g.start,
      end: g.end,
      kids: [gen],
      parent: undefined,
      open,
      items: [gen],
      close,
    });
  }

  arguments(n: FormatNode): Arguments {
    const items = this.named(n).map((c): Expr | Keyword => {
      if (c.kind === "keyword_argument") {
        const value = this.expr(this.needField(c, "value"));
        return this.link({
          kind: "Keyword",
          ts: c,
          start: c.start,
          end: c.end,
          kids: [value],
          parent: undefined,
          name: this.needField(c, "name"),
          op: this.need(c, "="),
          value,
        });
      }
      if (c.kind === "dictionary_splat") {
        const value = this.expr(this.named(c)[0] ?? fail(c, "empty splat"));
        return this.link({
          kind: "Keyword",
          ts: c,
          start: c.start,
          end: c.end,
          kids: [value],
          parent: undefined,
          name: undefined,
          op: this.need(c, "**"),
          value,
        });
      }
      return this.expr(c);
    });
    return this.link({
      kind: "Arguments",
      ts: n,
      start: n.start,
      end: n.end,
      kids: items,
      parent: undefined,
      open: this.need(n, "("),
      items,
      close: this.need(n, ")"),
    });
  }

  parameters(n: FormatNode): Parameters {
    const items = this.named(n).map((c): Parameter | Separator => {
      if (c.kind === "positional_separator" || c.kind === "keyword_separator")
        return {
          kind: "Separator",
          tok: c.children[0] ?? c,
          start: c.start,
          end: c.end,
        };
      return this.parameter(c);
    });
    return this.link({
      kind: "Parameters",
      ts: n,
      start: n.start,
      end: n.end,
      kids: items.filter((i): i is Parameter => i.kind === "Parameter"),
      parent: undefined,
      open: this.tok(n, "("),
      items,
      close: this.tok(n, ")"),
    });
  }

  parameter(c: FormatNode): Parameter {
    const base = {
      kind: "Parameter" as const,
      ts: c,
      start: c.start,
      end: c.end,
      parent: undefined,
    };
    const plain = (name: FormatNode, star?: FormatNode): Parameter => ({
      ...base,
      kids: [],
      star,
      name,
      colon: undefined,
      annotation: undefined,
      eq: undefined,
      default: undefined,
    });
    switch (c.kind) {
      case "identifier":
        return plain(c);
      case "list_splat_pattern":
      case "dictionary_splat_pattern":
        return plain(this.named(c)[0] ?? fail(c, "no name"), c.children[0]);
      case "typed_parameter": {
        const inner = this.named(c)[0] ?? fail(c, "no name");
        const p =
          inner.kind === "identifier"
            ? plain(inner)
            : plain(
                this.named(inner)[0] ?? fail(inner, "no name"),
                inner.children[0],
              );
        const annotation = this.expr(this.typeExpr(this.needField(c, "type")));
        return this.link({
          ...p,
          kids: [annotation],
          colon: this.need(c, ":"),
          annotation,
        });
      }
      case "default_parameter":
      case "typed_default_parameter": {
        const type = this.field(c, "type");
        const annotation = type && this.expr(this.typeExpr(type));
        const value = this.expr(this.needField(c, "value"));
        return this.link({
          ...base,
          kids: [...(annotation ? [annotation] : []), value],
          star: undefined,
          name: this.needField(c, "name"),
          colon: this.tok(c, ":"),
          annotation,
          eq: this.need(c, "="),
          default: value,
        });
      }
      default:
        return fail(c, "unsupported parameter");
    }
  }
}

/** An expression's extent with its parentheses. */
export function outer(e: Expr): { start: number; end: number } {
  const p = e.parens[0];
  return p ? { start: p.wrapper.start, end: p.wrapper.end } : e;
}

export const isExpr = (p: Py): p is Expr => "parens" in p;

/** Reads one expression on its own: an f-string interpolation's, which the module's AST keeps as a string. */
export function exprAst(n: FormatNode, source: string): Expr {
  return new Reader(source).expr(n);
}
