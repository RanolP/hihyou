import { NO_NODE } from "../../core/arena.js";
import type { Normalize } from "../../fmt/check.js";
import {
  type ImportOptions,
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { docCommentWords, kdoc } from "../../fmt/dsl/doc-comment.js";
import type { ImportRule, PredicateRule } from "../../fmt/dsl/runtime.js";
import { newlineBetween } from "../../fmt/text.js";
import { type FormatTree, firstLeaf, prevLeaf } from "../../fmt/tree.js";
import type { StreamCtx, StreamRules } from "../../fmt/stream-format.js";
import { grammar } from "./bundle.js";
import { binary, binaryKinds } from "./binary.js";
import { chained } from "./chain.js";
import { enumBody } from "./enum-body.js";
import { lambdas } from "./lambda.js";
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
const closers = new Set([")", "]", "}", ">", ";"]);
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
 * A collection literal's elements. tree-sitter-kotlin 0.3.8 takes no trailing comma there, and recovers the one
 * before a comment or a line break as an empty identifier after it, which is no element.
 */
const collectionItems = <O>(ctx: StreamCtx<O>, node: number) =>
  ctx.items(node).filter((c) => ctx.tree.text(c) !== "");

/** The rules `when` names in format.ts. */
export const customs = {
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
   * one line, and breaks the line before the expression they annotate where the source breaks one among them.
   */
  annotationLineBroken: (node, ctx) => {
    const t = ctx.tree;
    const annotated = (n: number) =>
      t.kindName(n) === "prefix_expression" && t.kindName(t.child(n, 0)) === "annotation";
    const operand = t.child(node, t.count(node) - 1);
    if (!annotated(node) || annotated(operand)) return false;
    let top = node;
    while (top !== t.root && annotated(t.parent(top))) top = t.parent(top);
    return newlineBetween(t, firstLeaf(t, top), firstLeaf(t, operand));
  },
  /**
   * ktfmt (its trailing-comma pass) breaks a parenthesized list of two or more items that the source writes across
   * lines, and gives it a trailing comma; a single item never forces the break, nor does a trailing comma.
   */
  writtenBroken: (node, ctx) => {
    const t = ctx.tree;
    if (!t.text(node).includes("\n")) return false;
    if (t.kindName(node) === "collection_literal") return ctx.items(node).length > 1;
    let items = 0;
    for (let i = 0; i < t.count(node); i++) if (listed.has(t.kindName(t.child(node, i)))) items++;
    return items > 1;
  },
  backingField:(node, ctx) => backingField(ctx.tree, node),
  /** Of a class or its primary constructor: a comment comes before the constructor, which ktfmt puts on a line of its own. */
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
  /** ktfmt gives a broken argument list a trailing comma only when it holds two or more arguments. */
  manyArguments: (node, ctx) => ctx.items(node).length > 1,
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

/**
 * The generated rules, but a member chain prints from its root as ktfmt lays one out (chain.ts), a trimmed
 * multiline string is re-indented as ktfmt does (trimmed-string.ts), a lambda with no statements prints its
 * comments as its body (lambda.ts), and a line comment past the width wraps.
 */
function withChains<O>(stream: StreamRules<O>): StreamRules<O> {
  const rules = new Map(stream.rules);
  for (const kind of ["navigation_expression", "call_expression", "indexing_expression", "postfix_expression"])
    rules.set(kind, chained(stream.rules.get(kind), hugsDeclaration));
  rules.set("string_literal", trimmedStrings(stream.rules.get("string_literal")));
  rules.set("lambda_literal", lambdas(stream.rules.get("lambda_literal")));
  for (const kind of binaryKinds) rules.set(kind, binary(stream.rules.get(kind)));
  const collection = stream.rules.get("collection_literal");
  if (collection !== undefined)
    rules.set("collection_literal", (node, ctx) => {
      // The comments around the empty identifier a trailing comma leaves print after the elements, as the list's own.
      const items = collectionItems(ctx, node);
      const dangling = [
        ...ctx.danglingComments(node),
        ...ctx
          .items(node)
          .filter((c) => !items.includes(c))
          .flatMap((c) => [...ctx.leadingComments(c), ...ctx.trailingComments(c)]),
      ].sort((a, b) => a - b);
      collection(
        node,
        Object.assign(Object.create(ctx) as typeof ctx, {
          items: (n: number) => (n === node ? items : ctx.items(n)),
          danglingComments: (n: number) => (n === node ? dangling : ctx.danglingComments(n)),
        }),
      );
    });
  return { ...stream, rules, wrapsLineComments: true };
}

/** Kotlin as ktfmt 0.64 `--kotlinlang-style` lays it out; the layouts are format.ts, generated into fmt.gen.ts. */
export const kotlin: Language<KotlinOptions> = {
  ...defineLanguage(grammar, {
    parser: language,
    lineComments: { line_comment: "//" },
    // The parser puts an import's comment inside its import_header, where at the list's first import the core
    // would hoist it to lead the whole list.
    handleComment: ({ tree, comment }) =>
      endsImport(tree, comment) ? { node: tree.parent(comment), as: "trailing" } : undefined,
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
  stream: withChains(gen.kotlin({ ...customs, imports, enumBody })),
};
