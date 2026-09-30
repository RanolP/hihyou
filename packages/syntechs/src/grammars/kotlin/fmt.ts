import { NO_NODE } from "../../core/arena.js";
import type { Normalize } from "../../fmt/check.js";
import {
  type ImportOptions,
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import { defineLanguage, type Language, type PrintArgs } from "../../fmt/rules.js";
import { close, INDENT, open, sHardline, sText, sToken } from "../../fmt/stream.js";
import { docCommentWords, kdoc } from "../../fmt/dsl/doc-comment.js";
import type { ImportRule, PredicateRule } from "../../fmt/dsl/runtime.js";
import { newlineBetween, nextLineEmpty } from "../../fmt/text.js";
import { type FormatTree, firstLeaf, prevLeaf } from "../../fmt/tree.js";
import { printLeadingComments } from "../../fmt/stream-format.js";
import type { StreamCtx, StreamRule, StreamRules } from "../../fmt/stream-format.js";
import { grammar } from "./bundle.js";
import { binary, binaryKinds } from "./binary.js";
import { chained } from "./chain.js";
import { enumBody } from "./enum-body.js";
import { property, typedName } from "./property.js";
import { lambdaParameters, lambdas } from "./lambda.js";
import * as gen from "./fmt.gen.js";
import { language } from "./index.js";
import { trimmedString, trimmedStrings } from "./trimmed-string.js";

/**
 * ktfmt's `--kotlinlang-style`: 100 columns, 4-space indent; it takes no other layout option. It sorts the
 * imports and drops duplicate and unused ones, which `keepImports` turns off.
 */
export type KotlinOptions = PrettierOptions & ImportOptions;

const defaults: KotlinOptions = { ...prettierDefaults, printWidth: 100, tabWidth: 4, keepImports: false };

/** Whether `node` lies inside an `import_list`, whose imports the formatter may reorder and drop. */
const inImports = (tree: FormatTree, node: number) => {
  for (let n = node; ; n = tree.parent(n)) {
    if (tree.kindName(n) === "import_list") return true;
    if (n === tree.root) return false;
  }
};

// ktfmt drops `;` between statements and adds a trailing comma to a broken list; neither changes meaning. It
// sorts the imports and drops unused ones, so `check` compares only the code around them.
const closers = new Set([")", "]", "}", ">", ";", "->"]);
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    if (inImports(tree, l.node)) return undefined;
    if (l.text === ";") return undefined;
    const trimmed = trimmedString(tree, l.node);
    if (trimmed !== undefined) return trimmed.prefix + (trimmed.margin ? "|" : "") + trimmed.lines.join("\n");
    const next = lexemes[i + 1]?.text;
    if (l.text === "," && next !== undefined && closers.has(next)) return undefined;
    return l.text;
  });

/** An annotated expression: one `prefix_expression` per annotation, nested. */
const annotated = (t: FormatTree, n: number) =>
  t.kindName(n) === "prefix_expression" && t.kindName(t.child(n, 0)) === "annotation";

/** The outermost of the annotated expressions nesting `n`. */
const annotatedTop = (t: FormatTree, n: number) => {
  let top = n;
  while (top !== t.root && annotated(t, t.parent(top))) top = t.parent(top);
  return top;
};

/** Kotlin reads an annotation before a binary expression on its line as annotating the first operand alone. */
const binaryOperand = (kind: string) => binaryKinds.has(kind) || kind === "as_expression" || kind === "range_expression";

const annotationCount = (node: number, tree: FormatTree) => {
  let n = 0;
  for (let i = 0; i < tree.count(node); i++) if (tree.kindName(tree.child(node, i)) === "annotation") n++;
  return n;
};

/** The texts of `node`'s leaves, joined. */
const spelled = (tree: FormatTree, node: number): string => {
  if (tree.count(node) === 0) return tree.text(node);
  let s = "";
  for (let i = 0; i < tree.count(node); i++) s += spelled(tree, tree.child(node, i));
  return s;
};
const childOf = (tree: FormatTree, node: number, kind: string) => {
  for (let i = 0; i < tree.count(node); i++) if (tree.kindName(tree.child(node, i)) === kind) return tree.child(node, i);
  return -1;
};

/**
 * Of a primary constructor: a line comment trails it before its class's body (handleComment gives it the ones on
 * lines of their own there too), so the body's `{` goes on the next line, as ktfmt puts it.
 */
const commentedBeforeBody = <O>(ctor: number, ctx: StreamCtx<O>) =>
  ctx.tree.kindName(ctor) === "primary_constructor" &&
  childOf(ctx.tree, ctx.tree.parent(ctor), "class_body") !== -1 &&
  ctx.trailingComments(ctor).some((c) => ctx.isLineComment(c));

/**
 * Once `commentedBeforeBody` holds, the constructor prints its own comments: its leading ones as usual, and the ones
 * before its class's body one on its line after it, the rest indented on their own.
 */
const ctorComments = <O>(generated: StreamRule<O> | undefined): StreamRule<O> => (node, ctx) => {
  const own = commentedBeforeBody(node, ctx);
  if (own) printLeadingComments(ctx as StreamCtx<unknown>, node);
  generated?.(node, ctx);
  if (!own) return;
  const t = ctx.tree;
  open(INDENT);
  for (const c of ctx.trailingComments(node)) {
    if (t.lf(c) > 0) sHardline();
    else sText(" ");
    ctx.comment(c);
  }
  close();
};

// ktfmt 0.64's RedundantImportDetector keeps an import named by an operator convention, since a call through the
// operator never spells the name.
const operators = new Set(
  (
    "unaryPlus unaryMinus not inc dec plus minus times div rem mod rangeTo rangeUntil contains get set invoke " +
    "plusAssign minusAssign timesAssign divAssign remAssign modAssign equals compareTo iterator next hasNext " +
    "getValue setValue provideDelegate assign and or xor shl shr ushr inv"
  ).split(" "),
);

/**
 * The names a KDoc comment refers to: the first segment of its `[links]` and of the subject of `@see`, `@throws`
 * and the like. ktfmt counts neither `[R.layout.test]`'s later segments nor `@param`'s and `@property`'s subject,
 * which names a parameter, not an import.
 */
function kdocNames(text: string): string[] {
  if (!text.startsWith("/**")) return [];
  const names: string[] = [];
  for (const m of text.matchAll(/\[([\w.`]+)\]|@(?:see|throws|exception|sample)\s+([\w.`]+)/g)) {
    const first = (m[1] ?? m[2] ?? "").split(".")[0];
    if (first) names.push(first.replaceAll("`", ""));
  }
  return names;
}

/** Kotlin's imports as ktfmt sorts and prunes them. */
const imports: ImportRule<KotlinOptions> = {
  key: (tree, imp) => {
    const path = childOf(tree, imp, "identifier");
    const alias = childOf(tree, imp, "import_alias");
    const wildcard = childOf(tree, imp, "wildcard_import") !== -1;
    return (
      (path === -1 ? "" : spelled(tree, path)) +
      (wildcard ? ".*" : "") +
      (alias === -1 ? "" : ` as ${spelled(tree, alias).replace(/^as/, "")}`)
    ).replaceAll("`", ""); // ktfmt sorts by the unescaped name.
  },
  binds: (tree, imp) => {
    if (childOf(tree, imp, "wildcard_import") !== -1) return undefined;
    const alias = childOf(tree, imp, "import_alias");
    if (alias !== -1) return spelled(tree, alias).replace(/^as/, "").replaceAll("`", "");
    const path = childOf(tree, imp, "identifier");
    if (path === -1) return undefined;
    // An escaped segment may hold dots (`com.example.Foo.bar`); ktfmt's FqName binds the part after the last one.
    return tree.text(tree.child(path, tree.count(path) - 1)).replaceAll("`", "").split(".").pop();
  },
  identifiers: new Set(["simple_identifier", "type_identifier"]),
  name: (text) => text.replaceAll("`", ""),
  skip: new Set(["import_list", "package_header"]),
  commentNames: kdocNames,
  implicit: (name) => operators.has(name) || /^component\d+$/.test(name),
  // ktfmt drops `import com.example.Sample` in `package com.example` (and `import Foo` in the root package), used
  // or not, since the name is in scope already; an alias, a wildcard, and an import whose name another import
  // binds too (it picks the overload) stay.
  redundant: (tree, imp) => {
    const path = childOf(tree, imp, "identifier");
    if (path === -1 || childOf(tree, imp, "import_alias") !== -1 || childOf(tree, imp, "wildcard_import") !== -1)
      return false;
    const header = childOf(tree, tree.root, "package_header");
    const pkg = header === -1 ? -1 : childOf(tree, header, "identifier");
    // ktfmt's FqName splits an escaped segment at its dots too.
    const name = spelled(tree, path).replaceAll("`", "");
    const parent = name.slice(0, Math.max(name.lastIndexOf("."), 0));
    if (parent !== (pkg === -1 ? "" : spelled(tree, pkg).replaceAll("`", ""))) return false;
    const bound = imports.binds(tree, imp);
    for (let i = 0; i < tree.count(tree.root); i++) {
      const list = tree.child(tree.root, i);
      if (tree.kindName(list) !== "import_list") continue;
      for (let j = 0; j < tree.count(list); j++) {
        const other = tree.child(list, j);
        if (other !== imp && tree.kindName(other) === "import_header" && imports.binds(tree, other) === bound)
          return false;
      }
    }
    return true;
  },
};

/**
 * Whether `comment` ends an import's line (`import a.B // note`): it trails the import, so it moves with the
 * import as the imports sort and goes with it when ktfmt drops the import. A comment on a line of its own (the
 * next import's, or the file's KDoc, which the parser may also put inside the import) stays where it stands.
 */
function endsImport(tree: FormatTree, comment: number): boolean {
  const header = tree.parent(comment);
  if (tree.kindName(header) !== "import_header" || tree.lf(comment) > 0) return false;
  for (let i = tree.count(header) - 1; ; i--) {
    const kid = tree.child(header, i);
    if (kid === comment) return true;
    if (!tree.kindName(kid).endsWith("comment")) return false;
  }
}

/**
 * A scoping function call, which ktfmt (its `isLambdaOrScopingFunction`) keeps on the line of the `=` before it:
 * a trailing lambda alone, unannotated, after a name or, where `member`, a name's member (`scope.launch label@{`).
 */
function scopingCall(tree: FormatTree, node: number, member: boolean): boolean {
  if (tree.kindName(node) !== "call_expression" || tree.count(node) !== 2) return false;
  const suffix = tree.child(node, 1);
  if (tree.count(suffix) !== 1 || tree.kindName(tree.child(suffix, 0)) !== "annotated_lambda") return false;
  const lambda = tree.child(suffix, 0);
  for (let i = 0; i < tree.count(lambda); i++) if (tree.kindName(tree.child(lambda, i)) === "annotation") return false;
  const callee = tree.child(node, 0);
  if (tree.kindName(callee) === "simple_identifier") return true;
  return (
    member &&
    tree.kindName(callee) === "navigation_expression" &&
    tree.kindName(tree.child(callee, 0)) === "simple_identifier"
  );
}

/** The first receiver of a member chain (`a` of `a.b(c).d`), or -1 when `node` is no chain. */
function chainHead(tree: FormatTree, node: number): number {
  let n = node;
  for (;;) {
    const kind = tree.kindName(n);
    if (kind === "navigation_expression") n = tree.child(n, 0);
    else if (kind === "call_expression" && tree.kindName(tree.child(n, 0)) === "navigation_expression")
      n = tree.child(n, 0);
    else return n === node ? -1 : n;
  }
}

/** Whether ktfmt keeps `node`, the right side of an `=`, on the `=`'s line: a lambda or a scoping function. */
function lambdaOrScoping(t: FormatTree, node: number, chained: boolean): boolean {
  // A line comment before it ends the line, so the right side cannot stay on it.
  const before = prevLeaf(t, node);
  if (before !== NO_NODE && t.kindName(before) === "line_comment") return false;
  if (t.kindName(node) === "lambda_literal" || scopingCall(t, node, true)) return true;
  if (!chained) return false;
  const head = chainHead(t, node);
  return head !== -1 && scopingCall(t, head, false);
}

/**
 * An explicit backing field (`val x: T` then `field = v` on its own line), which tree-sitter-kotlin 0.3.8 predates:
 * in a class body it recovers one as a property with a missing `val`, and at the top level it reads an assignment
 * to `field` after a property. ktfmt indents one under its property, as it does an accessor.
 */
function backingField(t: FormatTree, node: number): boolean {
  const kind = t.kindName(node);
  if (kind === "property_declaration") {
    const binding = t.child(node, 0);
    return t.kindName(binding) === "binding_pattern_kind" && t.missing(t.child(binding, 0));
  }
  if (kind !== "assignment" || t.text(t.child(node, 0)) !== "field") return false;
  const owner = t.parent(node);
  if (t.kindName(owner) !== "source_file" && t.kindName(owner) !== "class_body") return false;
  for (let i = 1; i < t.count(owner); i++)
    if (t.child(owner, i) === node) return /^(property_declaration|getter|setter)$/.test(t.kindName(t.child(owner, i - 1)));
  return false;
}

/** The items of the lists `writtenBroken` asks about: call arguments, and function and constructor parameters. */
const listed = new Set(["value_argument", "parameter", "class_parameter"]);

/**
 * A trailing comma as tree-sitter-kotlin 0.3.8 recovers it where it takes none: in a collection literal, a type
 * argument or parameter list, a function type's parameters or before a lambda's `->`. It reads the comma as an
 * ERROR, or keeps it as a separator and reads an empty item after it. ktfmt drops the comma where the list fits
 * (and always before `->`), so the formatter prints neither and lets the list add its own.
 */
const recoveredComma = (t: FormatTree, c: number) =>
  t.text(c) === "" || (t.kindName(c) === "ERROR" && t.count(c) === 1 && t.text(t.child(c, 0)) === ",");

/**
 * The last item of a `recovering` list whose recovered trailing comma a comment ends the line of (`[0, //`): the
 * comment trails that item, as it would after a comma the grammar reads as a separator, rather than the list.
 */
const itemBeforeComma = (t: FormatTree, comment: number) => {
  const comma = prevLeaf(t, comment);
  if (comma === NO_NODE || t.text(comma) !== ",") return undefined;
  const error = t.parent(comma);
  const list = t.kindName(error) === "ERROR" ? t.parent(error) : error;
  if (!(recovering as readonly string[]).includes(t.kindName(list))) return undefined;
  let last: number | undefined;
  let after = false;
  for (let i = 0; i < t.count(list); i++) {
    const c = t.child(list, i);
    if (c === comma || c === error) after = true;
    else if (!after && t.named(c) && !recoveredComma(t, c) && !t.kindName(c).endsWith("comment")) last = c;
    else if (after && t.named(c) && !recoveredComma(t, c) && !t.kindName(c).endsWith("comment")) return undefined;
  }
  return last;
};

/** The `(` and `)` of an accessor (`get()`, `set(value)`) that a comment lies between, else undefined. */
const commentedAccessorParens = (t: FormatTree, comment: number) => {
  const accessor = t.parent(comment);
  if (!/^[gs]etter$/.test(t.kindName(accessor))) return undefined;
  const open = childOf(t, accessor, "(");
  const close = childOf(t, accessor, ")");
  return open !== -1 && t.ord(open) < t.ord(comment) && t.ord(comment) < t.ord(close) ? accessor : undefined;
};

/**
 * An accessor with comments between its parentheses, which the accessor holds as dangling (see handleComment):
 * ktfmt breaks the parentheses and puts each comment and the parameter on a line of its own, dropping a trailing
 * comma. Otherwise the accessor prints by its generated rule.
 */
const accessor =
  <O>(generated: StreamRule<O> | undefined): StreamRule<O> =>
  (node, ctx) => {
    const t = ctx.tree;
    const inner = ctx.danglingComments(node).filter((c) => commentedAccessorParens(t, c) === node);
    if (inner.length === 0) return generated?.(node, ctx);
    let inside = false;
    let prev = false;
    for (let i = 0; i < t.count(node); i++) {
      const c = t.child(node, i);
      const kind = t.kindName(c);
      if (ctx.isComment(c) && !inner.includes(c)) continue;
      if (inside) {
        if (kind === ")") {
          inside = false;
          close();
          sHardline();
          sToken(c, ")");
        } else if (inner.includes(c)) {
          sHardline();
          ctx.comment(c);
        } else if (kind !== ",") {
          sHardline();
          ctx.print(c);
        }
      } else {
        if (prev && kind !== "(" && kind !== ":") sText(" ");
        if (kind === "(") {
          sToken(c, "(");
          open(INDENT);
          inside = true;
        } else if (t.named(c)) ctx.print(c);
        else sToken(c, t.text(c));
      }
      prev = true;
    }
  };

/** The kinds whose lists `recoveredComma` recovers a trailing comma in. */
const recovering = [
  "collection_literal",
  "type_arguments",
  "type_parameters",
  "function_type_parameters",
  "lambda_literal",
] as const;

/**
 * A type list the source keeps on one line, which ktfmt leaves there: it breaks the lists around one for width
 * first, which a group here would not. A trailing comma drops, as ktfmt drops it from a list that fits.
 */
const flatTypeList = <O>(node: number, ctx: StreamCtx<O>) => {
  const t = ctx.tree;
  const items = ctx.items(node).filter((c) => !recoveredComma(t, c));
  const last = items[items.length - 1] ?? -1;
  for (let i = 0; i < t.count(node); i++) {
    const c = t.child(node, i);
    if (t.named(c) && !items.includes(c)) continue;
    if (t.kindName(c) !== ",") ctx.print(c);
    else if (t.ord(c) < t.ord(last)) {
      sToken(c, ",");
      sText(" ");
    }
  }
};

/** The rules `when` names in format.ts. */
export const customs = {
  /** A prefix operator that would fuse with its operand's own into another token (`+ +a`, `- --a`, `! !a`). */
  operatorFuses: (node, ctx) => {
    const t = ctx.tree;
    const op = t.text(t.child(node, 0));
    return /^[-+!]+$/.test(op) && t.text(t.child(node, t.count(node) - 1)).startsWith(op.at(-1)!);
  },
  /**
   * Of a declaration's modifiers: ktfmt breaks the line after a bracketed annotation (`@field:[A B]`), and after the
   * annotations of a property whose accessors follow it on lines of their own.
   */
  annotationsBreak: (node, ctx) => {
    const t = ctx.tree;
    for (let i = 0; i < t.count(node); i++) {
      const c = t.child(node, i);
      if (t.kindName(c) === "annotation" && childOf(t, c, "[") !== -1) return true;
    }
    const decl = t.parent(node);
    if (t.kindName(decl) !== "property_declaration" || annotationCount(node, t) === 0) return false;
    const owner = t.parent(decl);
    for (let i = 0; i < t.count(owner) - 1; i++)
      if (t.child(owner, i) === decl) return /^[gs]etter$/.test(t.kindName(t.child(owner, i + 1)));
    return false;
  },
  /**
   * Of an annotated expression, which nests one `prefix_expression` per annotation: ktfmt keeps the annotations on
   * one line, and breaks the line before a `return` they annotate, and before a binary expression where the source
   * breaks one among them at the start of a statement (Kotlin then reads them as annotating the whole expression,
   * not its first operand).
   */
  annotationLineBroken: (node, ctx) => {
    const t = ctx.tree;
    const operand = t.child(node, t.count(node) - 1);
    if (!annotated(t, node) || annotated(t, operand)) return false;
    if (t.kindName(operand) === "jump_expression") return true;
    const top = annotatedTop(t, node);
    return (
      binaryOperand(t.kindName(operand)) &&
      t.kindName(t.parent(top)) === "statements" &&
      newlineBetween(t, firstLeaf(t, top), firstLeaf(t, operand))
    );
  },
  /**
   * Of an annotated expression whose annotations cover all of it (it is no binary expression, whose first operand
   * alone Kotlin reads them as annotating): ktfmt breaks the line after the annotations where the expression does
   * not fit on theirs. Not where the source has no gap after the annotation (see `prefix_expression`).
   */
  annotationHangs: (node, ctx) => {
    const t = ctx.tree;
    const operand = t.child(node, t.count(node) - 1);
    if (!annotated(t, node) || annotated(t, operand) || t.count(node) !== 2) return false;
    const kind = t.kindName(operand);
    if (binaryOperand(kind) || kind === "jump_expression" || kind === "lambda_literal") return false;
    return !t.adjoins(t.child(node, 0), operand);
  },
  /** An item of `statements` right after an annotation the grammar made a statement, on the annotation's line. */
  annotatedOnItsLine: (node, ctx) => {
    const t = ctx.tree;
    const p = t.parent(node);
    let prev = -1;
    for (let i = 0; i < t.count(p) && t.child(p, i) !== node; i++)
      if (!ctx.isComment(t.child(p, i))) prev = t.child(p, i);
    return prev !== -1 && t.kindName(prev) === "annotation" && !newlineBetween(t, firstLeaf(t, prev), firstLeaf(t, node));
  },
  /**
   * ktfmt (its trailing-comma pass) breaks a parenthesized list of two or more items that the source writes across
   * lines, and gives it a trailing comma; a single item never forces the break, nor does a trailing comma.
   */
  writtenBroken: (node, ctx) => {
    const t = ctx.tree;
    if (!t.text(node).includes("\n")) return false;
    if (/^(collection_literal|type_arguments|type_parameters)$/.test(t.kindName(node)))
      return ctx.items(node).length > 1;
    let items = 0;
    for (let i = 0; i < t.count(node); i++) if (listed.has(t.kindName(t.child(node, i)))) items++;
    return items > 1;
  },
  backingField:(node, ctx) => backingField(ctx.tree, node),
  /** Of a bracketed list: the source ends it with a comma before its closing bracket. */
  commaWritten: (node, ctx) => {
    const t = ctx.tree;
    const n = t.count(node);
    return n > 2 && t.kindName(t.child(node, n - 2)) === ",";
  },
  /** Of a class or its primary constructor: a comment comes before the constructor, which ktfmt puts on a line of its own. */
  /** Of a class: a line comment trails its primary constructor before its body (see `commentedBeforeBody`). */
  commentedBody: (node, ctx) => {
    const ctor = childOf(ctx.tree, node, "primary_constructor");
    return ctor !== -1 && commentedBeforeBody(ctor, ctx);
  },
  commentedConstructor: (node, ctx) => {
    const t = ctx.tree;
    const ctor = t.kindName(node) === "primary_constructor" ? node : childOf(t, node, "primary_constructor");
    if (ctor === -1) return false;
    const owner = t.parent(ctor);
    for (let i = 1; i < t.count(owner); i++)
      if (t.child(owner, i) === ctor) return t.kindName(t.child(owner, i - 1)).endsWith("comment");
    return false;
  },
  /**
   * Of a class: its `where` follows a delegation (`: Bar by bar`), which ktfmt puts on a line of its own, since
   * `bar where T` on one line would read as an infix call.
   */
  whereAfterDelegation: (node, ctx) => {
    const t = ctx.tree;
    for (let i = 1; i < t.count(node); i++) {
      if (t.kindName(t.child(node, i)) !== "type_constraints") continue;
      const prev = t.child(node, i - 1);
      return t.kindName(prev) === "delegation_specifier" && childOf(t, prev, "explicit_delegation") !== -1;
    }
    return false;
  },
  /** Of call arguments: one, unnamed, a lambda (`doIt({ })`), with no comment beside it but a trailing comma. */
  soleLambda: (node, ctx) => {
    const t = ctx.tree;
    const n = t.count(node);
    if (n !== 3 && !(n === 4 && t.kindName(t.child(node, 2)) === ",")) return false;
    const arg = t.child(node, 1);
    return (
      t.kindName(arg) === "value_argument" && t.count(arg) === 1 && t.kindName(t.child(arg, 0)) === "lambda_literal"
    );
  },
  /**
   * Of a class body, or a block's statements: the source leaves a blank line after the `{`, which ktfmt keeps but
   * in a lambda. Not before statements with a comment ahead of them, which prints before this rule runs.
   */
  blankAfterBrace: (node, ctx) => {
    const t = ctx.tree;
    const block = t.kindName(node) === "statements";
    const owner = block ? t.parent(node) : node;
    if (t.kindName(owner) === "lambda_literal" || (block && ctx.leadingComments(node).length > 0)) return false;
    const brace = childOf(t, owner, "{");
    return brace !== -1 && nextLineEmpty(t, brace);
  },
  /**
   * ktfmt gives a broken list a trailing comma only when it holds two or more items, and drops a written one from a
   * single item. A parameter's modifiers and default are the list's children too, so a parameter list counts only
   * its parameters.
   */
  manyItems: (node, ctx) => {
    const t = ctx.tree;
    const items = ctx.items(node).filter((c) => !recoveredComma(t, c));
    const params = items.filter((c) => listed.has(t.kindName(c)));
    return (params.length > 0 ? params : items).length > 1;
  },
  /** Of a declaration's initializer or delegate, or a function's `=` body: a lambda, a scoping function, or a chain on one. */
  huggedChain: (node, ctx) => lambdaOrScoping(ctx.tree, node, true),
  /** Of an assignment's right side: a lambda or a scoping function, but no chain on one. */
  hugged: (node, ctx) => lambdaOrScoping(ctx.tree, node, false),
  /** Of a lambda's `statements`: ktfmt keeps the lambda broken when the source breaks the line before them. */
  lambdaWrittenBroken: (node, ctx) => {
    const lambda = ctx.tree.parent(node);
    return (
      ctx.tree.kindName(lambda) === "lambda_literal" &&
      newlineBetween(ctx.tree, firstLeaf(ctx.tree, lambda), firstLeaf(ctx.tree, node))
    );
  },
} satisfies Record<string, PredicateRule<KotlinOptions>>;

/** Kinds whose `=` or `by` keeps a lambda, a scoping function or a chain on one on its line. */
const declarations = new Set(["property_declaration", "property_delegate", "function_body"]);
const hugsDeclaration = (node: number, ctx: { readonly tree: FormatTree }) =>
  node !== ctx.tree.root &&
  (declarations.has(ctx.tree.kindName(ctx.tree.parent(node))) || backingField(ctx.tree, ctx.tree.parent(node))) &&
  lambdaOrScoping(ctx.tree, node, true);

/** Whether statement `node` starts with a lambda, which a `;` must keep apart from the statement before it. */
const startsWithLambda = (tree: FormatTree, node: number) => {
  const leaf = firstLeaf(tree, node);
  return tree.text(leaf) === "{" && tree.kindName(tree.parent(leaf)) === "lambda_literal";
};

/**
 * Statements, but a `;` stays before one that starts with a lambda, which would otherwise become the trailing
 * lambda of a call before it (ktfmt's RedundantSemicolonDetector keeps it). The grammar hides the `;`.
 */
const statements =
  <O>(rule: StreamRule<O> | undefined): StreamRule<O> =>
  (node, ctx) => {
    const t = ctx.tree;
    const items = ctx.items(node);
    rule?.(
      node,
      Object.assign(Object.create(ctx) as typeof ctx, {
        print: (n: number, args?: PrintArgs) => {
          ctx.print(n, args);
          const i = items.indexOf(n);
          if (i !== -1 && i < items.length - 1 && startsWithLambda(t, items[i + 1] as number)) sToken(n, ";", true);
        },
      }),
    );
  };

/**
 * An `if` whose then branch is empty (`if (c) ; else x`, or none at all) as ktfmt prints it: the `;` goes and the
 * empty branch keeps its spaces, two between `)` and `else`.
 */
const ifExpression = <O>(node: number, ctx: StreamCtx<O>) => {
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (let i = 0; i < t.count(node); i++) {
    const c = t.child(node, i);
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    const next = i + 1 < t.count(node) ? t.child(node, i + 1) : -1;
    if (prev !== -1 && t.text(prev) !== "(" && t.text(c) !== ")") sText(" ");
    if (named) ctx.print(c);
    else if (t.text(c) === ";" && next !== -1 && t.text(next) === "else") {
      // The spaces around the empty branch are the joins on either side of it.
    } else {
      if (t.text(c) === "else" && t.text(prev) === ")") sText(" ");
      sToken(c, t.text(c));
    }
    prev = c;
  }
};

/**
 * The generated rules, but a member chain prints from its root as ktfmt lays one out (chain.ts), a trimmed
 * multiline string is re-indented as ktfmt does (trimmed-string.ts), a lambda with no statements prints its
 * comments as its body (lambda.ts), and a line comment past the width wraps.
 */
/**
 * A trailing comma after a `when` entry's last condition (`is A, is B, -> x`), which tree-sitter-kotlin 0.3.8
 * recovers as an ERROR after a lone condition, else as a separator before an empty one. ktfmt drops it, so the
 * generated rule sees a tree without them. A comment on the empty condition keeps both, as its only place to print.
 */
const whenEntry =
  <O>(generated: StreamRule<O> | undefined): StreamRule<O> =>
  (node, ctx) => {
    const t = ctx.tree;
    const kids = Array.from({ length: t.count(node) }, (_, i) => t.child(node, i));
    const empty = (n: number | undefined) =>
      n !== undefined &&
      t.kindName(n) === "when_condition" &&
      t.text(n) === "" &&
      ctx.leadingComments(n).length + ctx.trailingComments(n).length === 0;
    // ktfmt drops the trailing comma before the `->`.
    const beforeArrow = (i: number) => {
      while (i < kids.length && ctx.isComment(kids[i]!)) i++;
      return i < kids.length && t.kindName(kids[i]!) === "->";
    };
    const kept = kids.filter((c, i) =>
      t.kindName(c) === "ERROR"
        ? !recoveredComma(t, c)
        : !(empty(c) && t.kindName(kids[i - 1]!) === ",") &&
          !(t.kindName(c) === "," && (empty(kids[i + 1]) || beforeArrow(i + 1))),
    );
    if (kept.length === kids.length) return generated?.(node, ctx);
    const tree: FormatTree = Object.assign(Object.create(t) as FormatTree, {
      count: (n: number) => (n === node ? kept.length : t.count(n)),
      child: (n: number, i: number) => (n === node ? kept[i]! : t.child(n, i)),
    });
    generated?.(node, Object.assign(Object.create(ctx) as typeof ctx, { tree }));
  };

function withChains<O>(stream: StreamRules<O>): StreamRules<O> {
  const rules = new Map(stream.rules);
  for (const kind of ["navigation_expression", "call_expression", "indexing_expression", "postfix_expression"])
    rules.set(kind, chained(stream.rules.get(kind), hugsDeclaration));
  rules.set("statements", statements(stream.rules.get("statements")));
  rules.set("if_expression", ifExpression);
  rules.set("string_literal", trimmedStrings(stream.rules.get("string_literal")));
  rules.set("lambda_literal", lambdas(stream.rules.get("lambda_literal")));
  rules.set("lambda_parameters", lambdaParameters);
  rules.set("when_entry", whenEntry(stream.rules.get("when_entry")));
  for (const kind of ["getter", "setter"]) rules.set(kind, accessor(stream.rules.get(kind)));
  rules.set("primary_constructor", ctorComments(stream.rules.get("primary_constructor")));
  for (const kind of binaryKinds) rules.set(kind, binary(stream.rules.get(kind)));
  for (const kind of recovering) {
    const generated = rules.get(kind);
    if (generated === undefined) continue;
    const rule: StreamRule<O> =
      kind === "type_arguments" || kind === "type_parameters"
        ? (node, ctx) => (ctx.tree.text(node).includes("\n") ? generated(node, ctx) : flatTypeList(node, ctx))
        : generated;
    rules.set(kind, (node, ctx) => {
      // The comments around the empty item a trailing comma leaves print after the items, as the list's own.
      const items = ctx.items(node).filter((c) => !recoveredComma(ctx.tree, c));
      const dangling = [
        ...ctx.danglingComments(node),
        ...ctx
          .items(node)
          .filter((c) => !items.includes(c))
          .flatMap((c) => [...ctx.leadingComments(c), ...ctx.trailingComments(c)]),
      ].sort((a, b) => a - b);
      rule(
        node,
        Object.assign(Object.create(ctx) as typeof ctx, {
          items: (n: number) => (n === node ? items : ctx.items(n)),
          danglingComments: (n: number) => (n === node ? dangling : ctx.danglingComments(n)),
        }),
      );
    });
  }
  return {
    ...stream,
    rules,
    wrapsLineComments: true,
    printsOwnComments: commentedBeforeBody,
    recovered: (error, t) =>
      recoveredComma(t, error) &&
      (recovering as readonly string[]).concat("when_entry").includes(t.kindName(t.parent(error))),
  };
}

/** Kotlin as ktfmt 0.64 `--kotlinlang-style` lays it out; the layouts are format.ts, generated into fmt.gen.ts. */
export const kotlin: Language<KotlinOptions> = {
  ...defineLanguage(grammar, {
    parser: language,
    lineComments: { line_comment: "//" },
    // The parser puts an import's comment inside its import_header, where at the list's first import the core
    // would hoist it to lead the whole list.
    handleComment: ({ tree, comment, preceding, following, placement }) => {
      // A line comment ends its line even where the grammar's recovered empty item starts right after it.
      const endsLine = placement === "endOfLine" || tree.kindName(comment) === "line_comment";
      const item = endsLine ? itemBeforeComma(tree, comment) : undefined;
      if (item !== undefined) return { node: item, as: "trailing" };
      const accessor = commentedAccessorParens(tree, comment);
      if (accessor !== undefined) return { node: accessor, as: "dangling" };
      // A comment ending the line of a declaration's modifiers trails the last, which prints before the line the
      // modifiers end in, rather than the modifiers, which would carry it past that line.
      if (placement === "endOfLine" && preceding !== undefined && tree.kindName(preceding) === "modifiers")
        return { node: tree.child(preceding, tree.count(preceding) - 1), as: "trailing" };
      return endsImport(tree, comment)
        ? { node: tree.parent(comment), as: "trailing" }
        : preceding !== undefined &&
            following !== undefined &&
            tree.kindName(preceding) === "primary_constructor" &&
            tree.kindName(following) === "class_body"
          ? { node: preceding, as: "trailing" }
          : undefined;
    },
    defaults,
    settings: prettierSettings,
    normalize,
    // KDoc is reflowed, and a line comment past the width wraps into several, which changes only the whitespace
    // between their words.
    comment: (t) =>
      t.startsWith("//") ? t.slice(2).split(/\s+/).filter((w) => w !== "") : docCommentWords(t, kdoc),
    layoutBlind: true,
    hiddenTokens: true,
    atoms: ["string_literal", "character_literal"],
  }),
  ignoresComment: endsImport,
  stream: withChains(
    gen.kotlin({
      ...customs,
      imports,
      enumBody,
      typedName,
      property: property(customs.huggedChain, customs.backingField),
    }),
  ),
};
