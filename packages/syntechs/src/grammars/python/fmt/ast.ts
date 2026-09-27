import type { FormatTree } from "../../../fmt/tree.js";
import { byteOffsetOf, endOf, startOf } from "./trivia.js";

/**
 * Ruff's AST, read off tree-sitter-python's tree, because ruff's layout rules and comment placement are written
 * against it: parentheses are not nodes but a count on the expression they wrap (its range excludes them), a
 * chain of `and`s is one node, a statement's range ends with its last body statement, and a decorated
 * definition starts at its first decorator. Every token a rule prints is still a tree-sitter leaf, reached
 * through `ts`, so the self-check sees the input's own nodes. A `number` naming a node is a `FormatTree` handle
 * (handle 0 is a real node, so test one with `!== undefined`, never for truthiness); `start` and `end` are
 * positions (trivia.ts), not source offsets.
 */
export type Py = Expr | Stmt | Other;

interface Base {
  /** The node this one was read from; for an expression, inside its parentheses. */
  readonly ts: number;
  readonly start: number;
  readonly end: number;
  /** Children in source order, as ruff's comment visitor walks them. */
  readonly kids: Py[];
  parent: Py | undefined;
}

/** A pair of parentheses around an expression, outermost first. */
export interface Paren {
  readonly open: number;
  readonly close: number;
  readonly wrapper: number;
  /** `wrapper`'s positions: the expression's extent with these parentheses. */
  readonly start: number;
  readonly end: number;
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
  readonly parts: readonly number[];
  readonly flavor: "str" | "bytes" | "f" | "t";
}
export interface Attribute extends ExprBase {
  readonly kind: "Attribute";
  readonly value: Expr;
  readonly dot: number;
  readonly attr: number;
}
export interface Call extends ExprBase {
  readonly kind: "Call";
  readonly func: Expr;
  readonly args: Arguments;
}
export interface Subscript extends ExprBase {
  readonly kind: "Subscript";
  readonly value: Expr;
  readonly open: number;
  readonly slice: Expr;
  readonly close: number;
}
/** `*x` or, in a dict or call, `**x`. */
export interface Starred extends ExprBase {
  readonly kind: "Starred";
  readonly op: number;
  readonly value: Expr;
}
export interface UnaryOp extends ExprBase {
  readonly kind: "UnaryOp";
  readonly op: number;
  readonly operand: Expr;
}
export interface BinOp extends ExprBase {
  readonly kind: "BinOp";
  readonly left: Expr;
  readonly op: number;
  readonly right: Expr;
}
export interface BoolOp extends ExprBase {
  readonly kind: "BoolOp";
  readonly values: Expr[];
  /** `ops[i]` stands between `values[i]` and `values[i + 1]`. */
  readonly ops: number[];
}
export interface Compare extends ExprBase {
  readonly kind: "Compare";
  readonly left: Expr;
  /** Each operator is one or two tokens (`not in` is one token in tree-sitter, `is not` too). */
  readonly ops: number[];
  readonly comparators: Expr[];
}
export interface IfExp extends ExprBase {
  readonly kind: "IfExp";
  readonly body: Expr;
  readonly ifTok: number;
  readonly test: Expr;
  readonly elseTok: number;
  readonly orelse: Expr;
}
export interface Lambda extends ExprBase {
  readonly kind: "Lambda";
  readonly lambdaTok: number;
  readonly params: Parameters | undefined;
  readonly colon: number;
  readonly body: Expr;
}
export interface Named extends ExprBase {
  readonly kind: "Named";
  readonly target: Expr;
  readonly op: number;
  readonly value: Expr;
}
export interface Await extends ExprBase {
  readonly kind: "Await";
  readonly kw: number;
  readonly value: Expr;
}
export interface Yield extends ExprBase {
  readonly kind: "Yield";
  /** `yield`, then `from` for `yield from`. */
  readonly kws: number[];
  readonly from: boolean;
  readonly value: Expr | undefined;
}
/** A tuple, list or set; a tuple without its own parentheses has none of `open` and `close`. */
export interface Sequence extends ExprBase {
  readonly kind: "Tuple" | "List" | "Set";
  readonly open: number | undefined;
  readonly elts: Expr[];
  readonly commas: number[];
  readonly close: number | undefined;
}
export interface DictItem {
  /** Absent for `**value`. */
  readonly key: Expr | undefined;
  readonly colon: number | undefined;
  readonly value: Expr;
}
export interface Dict extends ExprBase {
  readonly kind: "Dict";
  readonly open: number;
  readonly items: DictItem[];
  readonly close: number;
}
export interface Comp extends ExprBase {
  readonly kind: "ListComp" | "SetComp" | "Generator";
  /** Absent for a generator that shares its parentheses with the call around it. */
  readonly open: number | undefined;
  readonly elt: Expr;
  readonly generators: Comprehension[];
  readonly close: number | undefined;
}
export interface DictComp extends ExprBase {
  readonly kind: "DictComp";
  readonly open: number;
  readonly key: Expr;
  readonly colon: number;
  readonly value: Expr;
  readonly generators: Comprehension[];
  readonly close: number;
}
export interface Slice extends ExprBase {
  readonly kind: "Slice";
  readonly lower: Expr | undefined;
  readonly upper: Expr | undefined;
  readonly step: Expr | undefined;
  readonly colons: number[];
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
  readonly open: number;
  /** Positional and keyword arguments in source order. */
  readonly items: (Expr | Keyword)[];
  readonly close: number;
}
/** `name=value`, or `**value` when `name` is absent. */
export interface Keyword extends Base {
  readonly kind: "Keyword";
  readonly name: number | undefined;
  /** `=`, or `**`. */
  readonly op: number;
  readonly value: Expr;
}
export interface Comprehension extends Base {
  readonly kind: "Comprehension";
  /** `async`? `for`, then `in`. */
  readonly kws: number[];
  readonly target: Expr;
  readonly iter: Expr;
  readonly ifs: { readonly kw: number; readonly test: Expr }[];
}
export interface Parameters extends Base {
  readonly kind: "Parameters";
  readonly open: number | undefined;
  /** Parameters and the `/` and `*` separators, in source order. */
  readonly items: (Parameter | Separator)[];
  readonly close: number | undefined;
}
export interface Separator {
  readonly kind: "Separator";
  readonly tok: number;
  readonly start: number;
  readonly end: number;
}
export interface Parameter extends Base {
  readonly kind: "Parameter";
  readonly star: number | undefined;
  readonly name: number;
  readonly colon: number | undefined;
  readonly annotation: Expr | undefined;
  readonly eq: number | undefined;
  readonly default: Expr | undefined;
}
/** `name as asname` of an import; `name` is the dotted name's tokens. */
export interface Alias extends Base {
  readonly kind: "Alias";
  readonly name: number[];
  readonly asTok: number | undefined;
  readonly asname: number | undefined;
}
export interface WithItem extends Base {
  readonly kind: "WithItem";
  readonly context: Expr;
  readonly asTok: number | undefined;
  readonly vars: Expr | undefined;
}
export interface Decorator extends Base {
  readonly kind: "Decorator";
  readonly at: number;
  readonly expr: Expr;
}
/** `elif test:` or `else:` of an `if`. */
export interface Clause extends Base {
  readonly kind: "ElifElse";
  readonly kw: number;
  readonly test: Expr | undefined;
  readonly colon: number;
  readonly body: Stmt[];
}
export interface ExceptHandler extends Base {
  readonly kind: "ExceptHandler";
  /** `except`, then `*` for `except*`. */
  readonly kws: number[];
  readonly type: Expr | undefined;
  readonly asTok: number | undefined;
  readonly name: number | undefined;
  readonly colon: number;
  readonly body: Stmt[];
}
export interface MatchCase extends Base {
  readonly kind: "MatchCase";
  readonly kw: number;
  readonly pattern: Pattern;
  readonly guardKw: number | undefined;
  readonly guard: Expr | undefined;
  readonly colon: number;
  readonly body: Stmt[];
}
/** A match pattern, printed from its tokens with Python's usual spacing. */
export interface Pattern extends Base {
  readonly kind: "Pattern";
}
export interface TypeParams extends Base {
  readonly kind: "TypeParams";
  readonly open: number;
  readonly params: TypeParam[];
  readonly close: number;
}
/** `T`, `T: bound`, `*Ts` or `**P`. */
export interface TypeParam extends Base {
  readonly kind: "TypeParam";
  /** `*` or `**`. */
  readonly star: number | undefined;
  readonly name: number;
  readonly colon: number | undefined;
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
  readonly ops: number[];
  readonly value: Expr;
}
export interface AnnAssign extends Base {
  readonly kind: "AnnAssign";
  readonly target: Expr;
  readonly colon: number;
  readonly annotation: Expr;
  readonly eq: number | undefined;
  readonly value: Expr | undefined;
}
export interface AugAssign extends Base {
  readonly kind: "AugAssign";
  readonly target: Expr;
  readonly op: number;
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
  readonly kw: number;
  /** `Raise`: exc, cause; `Assert`: test, msg; `Return`, `Delete`: the one value. */
  readonly values: (Expr | undefined)[];
  /** `from` of `raise`, `,` of `assert`. */
  readonly sep: number | undefined;
  /** `Global`/`Nonlocal`: the names; the commas are `commas`. */
  readonly names: number[];
  readonly commas: number[];
}
export interface Import extends Base {
  readonly kind: "Import";
  readonly kw: number;
  readonly names: Alias[];
}
export interface ImportFrom extends Base {
  readonly kind: "ImportFrom";
  readonly fromKw: number;
  /** The dots and the module name's tokens. */
  readonly module: number[];
  readonly importKw: number;
  readonly open: number | undefined;
  readonly names: Alias[];
  readonly star: number | undefined;
  readonly close: number | undefined;
}
export interface If extends Base {
  readonly kind: "If";
  readonly kw: number;
  readonly test: Expr;
  readonly colon: number;
  readonly body: Stmt[];
  readonly clauses: Clause[];
}
/** A body after the main one, which ruff keeps as a plain list, with its header's tokens. */
export interface OrElse {
  readonly kw: number;
  readonly colon: number;
  readonly body: Stmt[];
}
export interface For extends Base {
  readonly kind: "For";
  /** `async`? `for`, then `in`. */
  readonly kws: number[];
  readonly target: Expr;
  readonly iter: Expr;
  readonly colon: number;
  readonly body: Stmt[];
  readonly orelse: OrElse | undefined;
}
export interface While extends Base {
  readonly kind: "While";
  readonly kw: number;
  readonly test: Expr;
  readonly colon: number;
  readonly body: Stmt[];
  readonly orelse: OrElse | undefined;
}
export interface With extends Base {
  readonly kind: "With";
  /** `async`? `with`. */
  readonly kws: number[];
  /** The parentheses around the items, when the source has them and they are not an item's own. */
  readonly open: number | undefined;
  readonly items: WithItem[];
  readonly close: number | undefined;
  readonly colon: number;
  readonly body: Stmt[];
}
export interface Try extends Base {
  readonly kind: "Try";
  readonly kw: number;
  readonly colon: number;
  readonly body: Stmt[];
  readonly handlers: ExceptHandler[];
  readonly orelse: OrElse | undefined;
  readonly finalbody: OrElse | undefined;
}
export interface FunctionDef extends Base {
  readonly kind: "FunctionDef";
  readonly decorators: Decorator[];
  /** `async`? `def`. */
  readonly kws: number[];
  readonly name: number;
  readonly typeParams: TypeParams | undefined;
  readonly params: Parameters;
  readonly arrow: number | undefined;
  readonly returns: Expr | undefined;
  readonly colon: number;
  readonly body: Stmt[];
}
export interface ClassDef extends Base {
  readonly kind: "ClassDef";
  readonly decorators: Decorator[];
  readonly kw: number;
  readonly name: number;
  readonly typeParams: TypeParams | undefined;
  readonly args: Arguments | undefined;
  readonly colon: number;
  readonly body: Stmt[];
}
export interface Match extends Base {
  readonly kind: "Match";
  readonly kw: number;
  readonly subject: Expr;
  readonly colon: number;
  readonly cases: MatchCase[];
}
export interface TypeAlias extends Base {
  readonly kind: "TypeAlias";
  readonly kw: number;
  readonly name: Expr;
  readonly typeParams: TypeParams | undefined;
  readonly eq: number;
  readonly value: Expr;
}

/** Thrown for input the formatter must not touch: a parse error, or Python 2. */
export class Unformattable extends Error {}

const fail = (tree: FormatTree, n: number, why: string): never => {
  throw new Unformattable(
    `${why}: ${tree.kindName(n)} at ${byteOffsetOf(tree, n)}`,
  );
};

/** Converts `root` (a tree-sitter `module`) to ruff's AST, rejecting any parse error first. */
export function toAst(tree: FormatTree): Module {
  return new Reader(tree).module(tree.root);
}

class Reader {
  constructor(readonly tree: FormatTree) {}

  fail(n: number, why: string): never {
    return fail(this.tree, n, why);
  }

  kind(n: number): string {
    return this.tree.kindName(n);
  }

  kids(n: number): number[] {
    const out: number[] = [];
    for (let i = 0, count = this.tree.count(n); i < count; i++)
      out.push(this.tree.child(n, i));
    return out;
  }

  start(n: number): number {
    return startOf(this.tree, n);
  }

  end(n: number): number {
    return endOf(this.tree, n);
  }

  missing(n: number): boolean {
    return this.tree.missing(n);
  }

  text(n: number): string {
    return this.tree.text(n);
  }

  /** The named children that carry code: not comments, not line continuations. */
  named(n: number): number[] {
    const out: number[] = [];
    for (const c of this.kids(n)) {
      const kind = this.kind(c);
      if (kind === "ERROR" || this.missing(c)) this.fail(c, "parse error");
      if (
        this.tree.named(c) &&
        kind !== "comment" &&
        kind !== "line_continuation"
      )
        out.push(c);
    }
    return out;
  }

  tok(n: number, kind: string): number | undefined {
    for (const c of this.kids(n))
      if (!this.tree.named(c) && this.kind(c) === kind) return c;
    return undefined;
  }

  need(n: number, kind: string): number {
    return this.tok(n, kind) ?? this.fail(n, `no ${kind}`);
  }

  field(n: number, name: string): number | undefined {
    for (const c of this.kids(n)) if (this.tree.fieldName(c) === name) return c;
    return undefined;
  }

  fields(n: number, name: string): number[] {
    return this.kids(n).filter((c) => this.tree.fieldName(c) === name);
  }

  needField(n: number, name: string): number {
    return this.field(n, name) ?? this.fail(n, `no ${name}`);
  }

  module(n: number): Module {
    if (this.kind(n) !== "module") this.fail(n, "not a module");
    const body = this.body(n);
    return this.link({
      kind: "Module",
      ts: n,
      start: this.start(n),
      end: this.end(n),
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

  body(block: number): Stmt[] {
    return this.named(block).map((s) => this.stmt(s));
  }

  /** The end of a statement: its last body statement's, or its own. */
  stmtEnd(body: readonly Stmt[], fallback: number): number {
    return body.at(-1)?.end ?? fallback;
  }

  stmt(n: number): Stmt {
    const kind = this.kind(n);
    switch (kind) {
      case "expression_statement":
        return this.exprStmt(n);
      case "return_statement":
      case "delete_statement": {
        const kw = this.need(n, kind === "return_statement" ? "return" : "del");
        const value = this.named(n)[0];
        const values = [value !== undefined ? this.expr(value) : undefined];
        return this.simple(
          n,
          kind === "return_statement" ? "Return" : "Delete",
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
          [
            exc !== undefined ? this.expr(exc) : undefined,
            cause !== undefined ? this.expr(cause) : undefined,
          ],
          this.tok(n, "from"),
        );
      }
      case "assert_statement": {
        const [test, msg] = this.named(n);
        return this.simple(
          n,
          "Assert",
          this.need(n, "assert"),
          [
            test !== undefined ? this.expr(test) : undefined,
            msg !== undefined ? this.expr(msg) : undefined,
          ],
          this.tok(n, ","),
        );
      }
      case "global_statement":
      case "nonlocal_statement": {
        const global = kind === "global_statement";
        const s = this.simple(
          n,
          global ? "Global" : "Nonlocal",
          this.need(n, global ? "global" : "nonlocal"),
          [],
        );
        s.names.push(...this.named(n));
        s.commas.push(...this.kids(n).filter((c) => this.kind(c) === ","));
        return s;
      }
      case "import_statement": {
        const names = this.fields(n, "name").map((a) => this.alias(a));
        return this.link({
          kind: "Import",
          ts: n,
          start: this.start(n),
          end: this.end(n),
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
          start: this.start(n),
          end: this.stmtEnd(orelse?.body ?? body, this.end(n)),
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
        return this.functionDef(n, [], this.start(n));
      case "class_definition":
        return this.classDef(n, [], this.start(n));
      case "decorated_definition": {
        const decorators = this.named(n)
          .filter((c) => this.kind(c) === "decorator")
          .map((d): Decorator => {
            const expr = this.expr(
              this.named(d)[0] ?? this.fail(d, "empty decorator"),
            );
            return this.link({
              kind: "Decorator",
              ts: d,
              start: this.start(d),
              end: this.end(d),
              kids: [expr],
              parent: undefined,
              at: this.need(d, "@"),
              expr,
            });
          });
        const def = this.needField(n, "definition");
        return this.kind(def) === "class_definition"
          ? this.classDef(def, decorators, this.start(n))
          : this.functionDef(def, decorators, this.start(n));
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
        const generic = this.kind(head) === "generic_type";
        const name = this.expr(
          generic ? (this.named(head)[0] as number) : head,
        );
        const tp = generic
          ? this.named(head).find((c) => this.kind(c) === "type_parameter")
          : undefined;
        const typeParams = tp !== undefined ? this.typeParams(tp) : undefined;
        const value = this.expr(this.typeExpr(right));
        return this.link({
          kind: "TypeAlias",
          ts: n,
          start: this.start(n),
          end: this.end(n),
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
        return this.fail(n, "unsupported statement");
    }
  }

  simple(
    n: number,
    kind: Simple["kind"],
    kw: number,
    values: (Expr | undefined)[],
    sep?: number,
  ): Simple {
    return this.link({
      kind,
      ts: n,
      start: this.start(n),
      end: this.end(n),
      kids: values.filter((v) => v !== undefined),
      parent: undefined,
      kw,
      values,
      sep,
      names: [],
      commas: [],
    });
  }

  exprStmt(n: number): Stmt {
    const named = this.named(n);
    const first = named[0] ?? this.fail(n, "empty statement");
    // `a, b` as a statement is one tuple; tree-sitter lists its items in the statement.
    if (named.length > 1 || this.tok(n, ",") !== undefined)
      return this.wrapExpr(n, this.tupleOf(n, named, undefined, undefined));
    const inner = this.unparen(first);
    if (this.kind(inner) === "assignment") return this.assignment(n, first);
    if (this.kind(inner) === "augmented_assignment" && inner === first) {
      const target = this.expr(this.needField(first, "left"));
      const value = this.expr(this.needField(first, "right"));
      return this.link({
        kind: "AugAssign",
        ts: n,
        start: this.start(n),
        end: this.end(n),
        kids: [target, value],
        parent: undefined,
        target,
        op: this.needField(first, "operator"),
        value,
      });
    }
    return this.wrapExpr(n, this.expr(first));
  }

  wrapExpr(n: number, value: Expr): ExprStmt {
    return this.link({
      kind: "Expr",
      ts: n,
      start: this.start(n),
      end: this.end(n),
      kids: [value],
      parent: undefined,
      value,
    });
  }

  assignment(n: number, a: number): Stmt {
    if (this.kind(a) !== "assignment") this.fail(a, "parenthesized assignment");
    const type = this.field(a, "type");
    const left = this.expr(this.needField(a, "left"));
    if (type !== undefined) {
      const annotation = this.expr(this.typeExpr(type));
      const right = this.field(a, "right");
      const value = right !== undefined ? this.expr(right) : undefined;
      return this.link({
        kind: "AnnAssign",
        ts: n,
        start: this.start(n),
        end: this.end(n),
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
    while (
      this.kind(right) === "assignment" &&
      this.field(right, "type") === undefined
    ) {
      targets.push(this.expr(this.needField(right, "left")));
      ops.push(this.need(right, "="));
      right = this.needField(right, "right");
    }
    const value = this.expr(right);
    return this.link({
      kind: "Assign",
      ts: n,
      start: this.start(n),
      end: this.end(n),
      kids: [...targets, value],
      parent: undefined,
      targets,
      ops,
      value,
    });
  }

  /** A `type` node's expression. */
  typeExpr(t: number): number {
    if (this.kind(t) !== "type") return t;
    const named = this.named(t);
    if (named.length !== 1) this.fail(t, "unsupported type");
    return named[0] as number;
  }

  alias(a: number): Alias {
    const aliased = this.kind(a) === "aliased_import";
    const nameNode = aliased ? this.needField(a, "name") : a;
    const name = this.dotted(nameNode);
    const asname = aliased ? this.needField(a, "alias") : undefined;
    return {
      kind: "Alias",
      ts: a,
      start: this.start(a),
      end: this.end(a),
      kids: [],
      parent: undefined,
      name,
      asTok: aliased ? this.need(a, "as") : undefined,
      asname,
    };
  }

  /** The leaves of a dotted name or relative import. */
  dotted(n: number): number[] {
    const out: number[] = [];
    const walk = (x: number) => {
      const kind = this.kind(x);
      if (kind === "comment" || kind === "line_continuation") return;
      if (kind === "ERROR" || this.missing(x)) this.fail(x, "parse error");
      if (this.tree.count(x) === 0 || kind === "identifier") out.push(x);
      else for (const c of this.kids(x)) walk(c);
    };
    walk(n);
    return out;
  }

  importFrom(n: number): ImportFrom {
    const module =
      this.kind(n) === "future_import_statement"
        ? [this.need(n, "__future__")]
        : this.dotted(this.needField(n, "module_name"));
    const names = this.fields(n, "name").map((a) => this.alias(a));
    const wildcard = this.named(n).find(
      (c) => this.kind(c) === "wildcard_import",
    );
    const node: ImportFrom = {
      kind: "ImportFrom",
      ts: n,
      start: this.start(n),
      end: this.end(n),
      kids: names,
      parent: undefined,
      fromKw: this.need(n, "from"),
      module,
      importKw: this.need(n, "import"),
      open: this.tok(n, "("),
      names,
      star:
        wildcard === undefined
          ? undefined
          : this.tree.count(wildcard) > 0
            ? this.tree.child(wildcard, 0)
            : wildcard,
      close: this.tok(n, ")"),
    };
    return this.link(node);
  }

  ifStmt(n: number): If {
    const test = this.expr(this.needField(n, "condition"));
    const body = this.body(this.needField(n, "consequence"));
    const clauses = this.fields(n, "alternative").map((c): Clause => {
      const elif = this.kind(c) === "elif_clause";
      const cbody = this.body(this.needField(c, elif ? "consequence" : "body"));
      const ctest = elif
        ? this.expr(this.needField(c, "condition"))
        : undefined;
      return this.link({
        kind: "ElifElse",
        ts: c,
        start: this.start(c),
        end: this.stmtEnd(cbody, this.end(c)),
        kids: [...(ctest ? [ctest] : []), ...cbody],
        parent: undefined,
        kw: this.need(c, elif ? "elif" : "else"),
        test: ctest,
        colon: this.need(c, ":"),
        body: cbody,
      });
    });
    return this.link({
      kind: "If",
      ts: n,
      start: this.start(n),
      end: clauses.at(-1)?.end ?? this.stmtEnd(body, this.end(n)),
      kids: [test, ...body, ...clauses],
      parent: undefined,
      kw: this.need(n, "if"),
      test,
      colon: this.need(n, ":"),
      body,
      clauses,
    });
  }

  orelse(c: number | undefined): OrElse | undefined {
    if (c === undefined) return undefined;
    const block =
      this.field(c, "body") ??
      this.named(c).find((x) => this.kind(x) === "block");
    return {
      kw: this.need(c, this.kind(c) === "finally_clause" ? "finally" : "else"),
      colon: this.need(c, ":"),
      body: block !== undefined ? this.body(block) : [],
    };
  }

  forStmt(n: number): For {
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
      start: this.start(n),
      end: this.stmtEnd(orelse?.body ?? body, this.end(n)),
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

  withStmt(n: number): With {
    const clause =
      this.named(n).find((c) => this.kind(c) === "with_clause") ??
      this.fail(n, "no with clause");
    // `with (a as b):` parses as one item whose value is a parenthesized `as`; the parentheses are the statement's.
    let parens: number | undefined;
    const items = this.named(clause).map((item): WithItem => {
      let value = this.needField(item, "value");
      const inner = this.named(value)[0];
      if (
        this.kind(value) === "parenthesized_expression" &&
        inner !== undefined &&
        this.kind(inner) === "as_pattern"
      ) {
        parens = value;
        value = inner;
      }
      let context: Expr;
      let asTok: number | undefined;
      let vars: Expr | undefined;
      if (this.kind(value) === "as_pattern") {
        const [ctx, target] = this.named(value);
        context = this.expr(ctx ?? this.fail(value, "no context"));
        asTok = this.need(value, "as");
        const t =
          target !== undefined ? (this.named(target)[0] ?? target) : undefined;
        vars = t !== undefined ? this.expr(t) : undefined;
      } else context = this.expr(value);
      return this.link({
        kind: "WithItem",
        ts: item,
        start: this.start(value),
        end: this.end(value),
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
      start: this.start(n),
      end: this.stmtEnd(body, this.end(n)),
      kids: [...items, ...body],
      parent: undefined,
      kws: [this.tok(n, "async"), this.need(n, "with")].filter(
        (k) => k !== undefined,
      ),
      open:
        parens !== undefined ? this.need(parens, "(") : this.tok(clause, "("),
      items,
      close:
        parens !== undefined ? this.need(parens, ")") : this.tok(clause, ")"),
      colon: this.need(n, ":"),
      body,
    });
  }

  tryStmt(n: number): Try {
    const body = this.body(this.needField(n, "body"));
    const handlers: ExceptHandler[] = [];
    let orelse: OrElse | undefined;
    let finalbody: OrElse | undefined;
    for (const c of this.named(n)) {
      const kind = this.kind(c);
      if (kind === "except_clause") {
        const block = this.named(c).find((x) => this.kind(x) === "block");
        const hbody = block !== undefined ? this.body(block) : [];
        const value = this.field(c, "value");
        let type: Expr | undefined;
        let asTok: number | undefined;
        let name: number | undefined;
        if (value !== undefined && this.kind(value) === "as_pattern") {
          const [t, target] = this.named(value);
          type = this.expr(t ?? this.fail(value, "no type"));
          asTok = this.need(value, "as");
          name =
            target !== undefined
              ? (this.named(target)[0] ?? target)
              : undefined;
        } else if (value !== undefined) type = this.expr(value);
        // `except A, B:` is Python 2 unless it is `except (A, B)`; tree-sitter reads the second as the alias.
        const alias = this.field(c, "alias");
        if (alias !== undefined) this.fail(c, "Python 2 except");
        handlers.push(
          this.link({
            kind: "ExceptHandler",
            ts: c,
            start: this.start(c),
            end: this.stmtEnd(hbody, this.end(c)),
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
      } else if (kind === "else_clause") orelse = this.orelse(c);
      else if (kind === "finally_clause") finalbody = this.orelse(c);
    }
    const last =
      finalbody?.body ?? orelse?.body ?? handlers.at(-1)?.body ?? body;
    return this.link({
      kind: "Try",
      ts: n,
      start: this.start(n),
      end: this.stmtEnd(last, this.end(n)),
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

  functionDef(n: number, decorators: Decorator[], start: number): FunctionDef {
    const tp = this.field(n, "type_parameters");
    const typeParams = tp !== undefined ? this.typeParams(tp) : undefined;
    const params = this.parameters(this.needField(n, "parameters"));
    const ret = this.field(n, "return_type");
    const returns =
      ret !== undefined ? this.expr(this.typeExpr(ret)) : undefined;
    const body = this.body(this.needField(n, "body"));
    return this.link({
      kind: "FunctionDef",
      ts: n,
      start,
      end: this.stmtEnd(body, this.end(n)),
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

  classDef(n: number, decorators: Decorator[], start: number): ClassDef {
    const tp = this.field(n, "type_parameters");
    const typeParams = tp !== undefined ? this.typeParams(tp) : undefined;
    const sup = this.field(n, "superclasses");
    const args = sup !== undefined ? this.arguments(sup) : undefined;
    const body = this.body(this.needField(n, "body"));
    return this.link({
      kind: "ClassDef",
      ts: n,
      start,
      end: this.stmtEnd(body, this.end(n)),
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

  typeParams(n: number): TypeParams {
    const params = this.named(n).map((t) => this.typeParam(t));
    return this.link({
      kind: "TypeParams",
      ts: n,
      start: this.start(n),
      end: this.end(n),
      kids: params,
      parent: undefined,
      open: this.need(n, "["),
      params,
      close: this.need(n, "]"),
    });
  }

  typeParam(t: number): TypeParam {
    const p = this.typeExpr(t);
    const base = {
      ts: p,
      start: this.start(p),
      end: this.end(p),
      parent: undefined,
    };
    switch (this.kind(p)) {
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
          star:
            this.tree.count(p) > 0
              ? this.tree.child(p, 0)
              : this.fail(p, "no star"),
          name: this.named(p)[0] ?? this.fail(p, "no name"),
          colon: undefined,
          bound: undefined,
        };
      case "constrained_type": {
        const [nameType, boundType] = this.named(p);
        const name =
          nameType !== undefined ? this.typeExpr(nameType) : undefined;
        if (
          name === undefined ||
          this.kind(name) !== "identifier" ||
          boundType === undefined
        )
          return this.fail(p, "unsupported type parameter");
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
        return this.fail(p, "unsupported type parameter");
    }
  }

  matchStmt(n: number): Match {
    const subject = this.expr(this.needField(n, "subject"));
    const block = this.needField(n, "body");
    const cases = this.named(block).map((c): MatchCase => {
      const patternNode =
        this.named(c).find((x) => this.kind(x) === "case_pattern") ??
        this.fail(c, "no pattern");
      this.dotted(patternNode);
      const guardClause = this.field(c, "guard");
      const guardExpr =
        guardClause !== undefined ? this.named(guardClause)[0] : undefined;
      const guard = guardExpr !== undefined ? this.expr(guardExpr) : undefined;
      const body = this.body(this.needField(c, "consequence"));
      // Every pattern after `case`, up to the guard or the colon, as one node.
      const last =
        this.named(c)
          .filter((x) => this.kind(x) === "case_pattern")
          .at(-1) ?? patternNode;
      const pattern: Pattern = {
        kind: "Pattern",
        ts: c,
        start: this.start(patternNode),
        end: this.end(last),
        kids: [],
        parent: undefined,
      };
      return this.link({
        kind: "MatchCase",
        ts: c,
        start: this.start(c),
        end: this.stmtEnd(body, this.end(c)),
        kids: [pattern, ...(guard ? [guard] : []), ...body],
        parent: undefined,
        kw: this.need(c, "case"),
        pattern,
        guardKw:
          guardClause !== undefined ? this.need(guardClause, "if") : undefined,
        guard,
        colon: this.need(c, ":"),
        body,
      });
    });
    return this.link({
      kind: "Match",
      ts: n,
      start: this.start(n),
      end: cases.at(-1)?.end ?? this.end(n),
      kids: [subject, ...cases],
      parent: undefined,
      kw: this.need(n, "match"),
      subject,
      colon: this.need(n, ":"),
      cases,
    });
  }

  /** Whether `n` is parentheses around one expression; a target `(x)` reads as a one-element `tuple_pattern`. */
  isParens(n: number): boolean {
    const kind = this.kind(n);
    return (
      kind === "parenthesized_expression" ||
      (kind === "tuple_pattern" &&
        this.named(n).length === 1 &&
        this.tok(n, ",") === undefined)
    );
  }

  /** The node inside any parentheses around `n`. */
  unparen(n: number): number {
    let x = n;
    for (;;) {
      if (!this.isParens(x)) return x;
      const inner = this.named(x);
      if (inner.length !== 1) return x;
      x = inner[0] as number;
    }
  }

  expr(n: number): Expr {
    const parens: Paren[] = [];
    let x = n;
    while (this.isParens(x)) {
      const inner = this.named(x);
      const only = inner[0];
      // `(yield)` and `(*a)` stay as tree-sitter wraps them; any other shape is a parse oddity.
      if (inner.length !== 1 || only === undefined)
        return this.fail(x, "unsupported parentheses");
      parens.push({
        open: this.need(x, "("),
        close: this.need(x, ")"),
        wrapper: x,
        start: this.start(x),
        end: this.end(x),
      });
      x = only;
    }
    const e = this.bare(x, parens);
    return this.link(e);
  }

  /** The unnamed `,` children of `n`. */
  commas(n: number): number[] {
    return this.kids(n).filter(
      (c) => !this.tree.named(c) && this.kind(c) === ",",
    );
  }

  bare(n: number, parens: Paren[]): Expr {
    const base = {
      ts: n,
      start: this.start(n),
      end: this.end(n),
      parent: undefined,
      parens,
    };
    const leaf = (kind: Leaf["kind"]): Leaf => ({ ...base, kind, kids: [] });
    const kind = this.kind(n);
    switch (kind) {
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
          this.kind(argNode) === "generator_expression"
            ? this.soleGenerator(argNode)
            : this.arguments(argNode);
        return { ...base, kind: "Call", kids: [func, args], func, args };
      }
      case "subscript": {
        const value = this.expr(this.needField(n, "value"));
        const subs = this.fields(n, "subscript");
        const open = this.need(n, "[");
        const close = this.need(n, "]");
        const commas = this.commas(n);
        const slice =
          subs.length === 1 && commas.length === 0
            ? this.expr(subs[0] as number)
            : this.link(
                this.tupleOf(
                  n,
                  subs,
                  undefined,
                  undefined,
                  this.end(open),
                  this.start(close),
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
        const value = this.expr(
          this.named(n)[0] ?? this.fail(n, "empty splat"),
        );
        return {
          ...base,
          kind: "Starred",
          kids: [value],
          op: this.kids(n)[0] ?? this.fail(n, "no star"),
          value,
        };
      }
      case "generic_type": {
        // tree-sitter reads `list[int]` in an annotation as a generic type, ruff as a subscript.
        const [id, tp] = this.named(n);
        if (
          id === undefined ||
          tp === undefined ||
          this.kind(tp) !== "type_parameter"
        )
          return this.fail(n, "unsupported generic type");
        const value = this.expr(id);
        const subs = this.named(tp);
        const open = this.need(tp, "[");
        const close = this.need(tp, "]");
        const commas = this.commas(tp);
        const slice =
          subs.length === 1 && commas.length === 0
            ? this.expr(subs[0] as number)
            : this.link(
                this.tupleOf(
                  tp,
                  subs,
                  undefined,
                  undefined,
                  this.end(open),
                  this.start(close),
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
        const value = this.expr(
          this.named(n)[0] ?? this.fail(n, "empty splat"),
        );
        return {
          ...base,
          kind: "Starred",
          kids: [value],
          op: this.kids(n)[0] ?? this.fail(n, "no star"),
          value,
        };
      }
      case "parenthesized_list_splat": {
        // `(*a)` inside a call's arguments: a starred expression in parentheses.
        return this.expr(this.named(n)[0] ?? this.fail(n, "empty splat"));
      }
      case "unary_operator":
      case "not_operator": {
        const operand = this.expr(this.needField(n, "argument"));
        const op =
          kind === "not_operator"
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
        const opKind = this.kind(this.needField(n, "operator"));
        const values: Expr[] = [];
        const ops: number[] = [];
        const walk = (x: number) => {
          const left = this.needField(x, "left");
          if (
            this.kind(left) === "boolean_operator" &&
            this.kind(this.needField(left, "operator")) === opKind
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
          left: first ?? this.fail(n, "empty comparison"),
          ops: this.fields(n, "operators"),
          comparators: rest,
        };
      }
      case "conditional_expression": {
        const [body, test, orelse] = this.named(n).map((c) => this.expr(c));
        if (!body || !test || !orelse) return this.fail(n, "bad conditional");
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
        const params = p !== undefined ? this.parameters(p) : undefined;
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
        const value = this.expr(
          this.named(n)[0] ?? this.fail(n, "empty await"),
        );
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
        const first = v[0];
        const value =
          v.length > 1 || this.tok(n, ",") !== undefined
            ? this.link(this.tupleOf(n, v, undefined, undefined))
            : first !== undefined
              ? this.expr(first)
              : undefined;
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
          kind: kind === "set" ? "Set" : "List",
          kids: elts,
          open: this.need(n, kind === "set" ? "{" : "["),
          elts,
          commas: this.commas(n),
          close: this.need(n, kind === "set" ? "}" : "]"),
        };
      }
      case "dictionary": {
        const items = this.named(n).map((c): DictItem => {
          const ck = this.kind(c);
          if (ck === "pair")
            return {
              key: this.expr(this.needField(c, "key")),
              colon: this.need(c, ":"),
              value: this.expr(this.needField(c, "value")),
            };
          if (ck === "dictionary_splat")
            return { key: undefined, colon: undefined, value: this.expr(c) };
          return this.fail(c, "bad dict item");
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
        const all = this.kids(n);
        return {
          ...base,
          kind:
            kind === "list_comprehension"
              ? "ListComp"
              : kind === "set_comprehension"
                ? "SetComp"
                : "Generator",
          kids: [elt, ...generators],
          open: all[0],
          elt,
          generators,
          close: all.at(-1),
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
        const colons: number[] = [];
        for (const c of this.kids(n)) {
          const ck = this.kind(c);
          if (ck === "comment" || ck === "line_continuation") continue;
          if (ck === "ERROR" || this.missing(c)) this.fail(c, "parse error");
          const named = this.tree.named(c);
          if (!named && ck === ":") {
            colons.push(c);
            parts.push(undefined);
          } else if (named) parts[parts.length - 1] = this.expr(c);
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
        return this.fail(n, "keyword outside a call");
      case "type":
        return this.expr(this.typeExpr(n));
      case "case_pattern":
      case "splat_pattern":
      case "list_splat_pattern":
      case "dictionary_splat_pattern":
        return this.fail(n, "unsupported pattern");
      default:
        return this.fail(n, "unsupported expression");
    }
  }

  str(n: number, parts: number[], parens: Paren[]): Str {
    // One f- or t-string part makes the whole concatenation one, as in Python's AST.
    if (parts.length === 0) this.fail(n, "empty string");
    let prefix = "";
    for (const p of parts) {
      const start = this.kids(p)[0] ?? this.fail(p, "no string start");
      prefix += this.text(start).toLowerCase();
    }
    if (prefix.includes("`")) this.fail(n, "Python 2 backticks");
    const flavor = prefix.includes("b")
      ? "bytes"
      : prefix.includes("f")
        ? "f"
        : prefix.includes("t")
          ? "t"
          : "str";
    if (flavor === "f" && prefix.includes("t"))
      this.fail(n, "f and t parts mixed");
    for (const p of parts) this.dotted(p);
    return {
      kind: "Str",
      ts: n,
      start: this.start(n),
      end: this.end(n),
      kids: [],
      parent: undefined,
      parens,
      parts,
      flavor,
    };
  }

  tupleOf(
    n: number,
    items: number[],
    open: number | undefined,
    close: number | undefined,
    from = this.start(n),
    to = this.end(n),
  ): Sequence {
    const elts = items.map((c) => this.expr(c));
    const commas = this.commas(n);
    const firstComma = commas[0];
    const lastComma = commas.at(-1);
    // Without parentheses, ruff's tuple runs from its first item to its last comma or item.
    const start =
      open !== undefined
        ? this.start(n)
        : Math.max(
            from,
            Math.min(
              elts[0]?.start ?? from,
              firstComma !== undefined ? this.start(firstComma) : to,
            ),
          );
    const end =
      close !== undefined
        ? this.end(n)
        : Math.min(
            to,
            Math.max(
              elts.at(-1)?.end ?? start,
              lastComma !== undefined ? this.end(lastComma) : start,
            ),
          );
    const outerStart =
      open !== undefined
        ? start
        : Math.min(start, ...elts.map((e) => outer(e).start));
    const outerEnd =
      close !== undefined
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

  comprehensions(n: number): Comprehension[] {
    const out: Comprehension[] = [];
    for (const c of this.named(n)) {
      const ck = this.kind(c);
      if (ck === "for_in_clause") {
        const target = this.expr(this.needField(c, "left"));
        const rights = this.fields(c, "right");
        const iter =
          rights.length > 1 || this.commas(c).length > 0
            ? this.link(
                this.tupleOf(
                  c,
                  rights,
                  undefined,
                  undefined,
                  this.end(this.need(c, "in")),
                ),
              )
            : this.expr(rights[0] ?? this.fail(c, "no iter"));
        out.push({
          kind: "Comprehension",
          ts: c,
          start: this.start(c),
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
      } else if (ck === "if_clause") {
        const last = out.at(-1) ?? this.fail(c, "if before for");
        const test = this.expr(this.named(c)[0] ?? this.fail(c, "empty if"));
        last.ifs.push({ kw: this.need(c, "if"), test });
        last.kids.push(test);
        (last as { end: number }).end = outer(test).end;
      }
    }
    for (const c of out) this.link(c);
    return out;
  }

  /** `f(x for x in y)`: the generator's parentheses are the call's. */
  soleGenerator(g: number): Arguments {
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
      start: this.start(g),
      end: this.end(g),
      kids: [gen],
      parent: undefined,
      open,
      items: [gen],
      close,
    });
  }

  arguments(n: number): Arguments {
    const items = this.named(n).map((c): Expr | Keyword => {
      const ck = this.kind(c);
      if (ck === "keyword_argument") {
        const value = this.expr(this.needField(c, "value"));
        return this.link({
          kind: "Keyword",
          ts: c,
          start: this.start(c),
          end: this.end(c),
          kids: [value],
          parent: undefined,
          name: this.needField(c, "name"),
          op: this.need(c, "="),
          value,
        });
      }
      if (ck === "dictionary_splat") {
        const value = this.expr(
          this.named(c)[0] ?? this.fail(c, "empty splat"),
        );
        return this.link({
          kind: "Keyword",
          ts: c,
          start: this.start(c),
          end: this.end(c),
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
      start: this.start(n),
      end: this.end(n),
      kids: items,
      parent: undefined,
      open: this.need(n, "("),
      items,
      close: this.need(n, ")"),
    });
  }

  parameters(n: number): Parameters {
    const items = this.named(n).map((c): Parameter | Separator => {
      const ck = this.kind(c);
      if (ck === "positional_separator" || ck === "keyword_separator")
        return {
          kind: "Separator",
          tok: this.kids(c)[0] ?? c,
          start: this.start(c),
          end: this.end(c),
        };
      return this.parameter(c);
    });
    return this.link({
      kind: "Parameters",
      ts: n,
      start: this.start(n),
      end: this.end(n),
      kids: items.filter((i): i is Parameter => i.kind === "Parameter"),
      parent: undefined,
      open: this.tok(n, "("),
      items,
      close: this.tok(n, ")"),
    });
  }

  parameter(c: number): Parameter {
    const base = {
      kind: "Parameter" as const,
      ts: c,
      start: this.start(c),
      end: this.end(c),
      parent: undefined,
    };
    const plain = (name: number, star?: number): Parameter => ({
      ...base,
      kids: [],
      star,
      name,
      colon: undefined,
      annotation: undefined,
      eq: undefined,
      default: undefined,
    });
    switch (this.kind(c)) {
      case "identifier":
        return plain(c);
      case "list_splat_pattern":
      case "dictionary_splat_pattern":
        return plain(
          this.named(c)[0] ?? this.fail(c, "no name"),
          this.kids(c)[0],
        );
      case "typed_parameter": {
        const inner = this.named(c)[0] ?? this.fail(c, "no name");
        const p =
          this.kind(inner) === "identifier"
            ? plain(inner)
            : plain(
                this.named(inner)[0] ?? this.fail(inner, "no name"),
                this.kids(inner)[0],
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
        const annotation =
          type !== undefined ? this.expr(this.typeExpr(type)) : undefined;
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
        return this.fail(c, "unsupported parameter");
    }
  }
}

/** An expression's extent with its parentheses. */
export function outer(e: Expr): { start: number; end: number } {
  const p = e.parens[0];
  return p ? { start: p.start, end: p.end } : e;
}

export const isExpr = (p: Py): p is Expr => "parens" in p;

/** Reads one expression on its own: an f-string interpolation's, which the module's AST keeps as a string. */
export function exprAst(tree: FormatTree, n: number): Expr {
  return new Reader(tree).expr(n);
}
