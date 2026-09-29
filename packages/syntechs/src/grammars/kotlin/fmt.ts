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
import type { FormatTree } from "../../fmt/tree.js";
import { grammar } from "./bundle.js";
import * as gen from "./fmt.gen.js";
import { language } from "./index.js";

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
    const next = lexemes[i + 1]?.text;
    if (l.text === "," && next !== undefined && closers.has(next)) return undefined;
    return l.text;
  });

const annotationCount = (node: number, tree: { count(n: number): number; child(n: number, i: number): number; kindName(n: number): string }) => {
  let n = 0;
  let args = false;
  for (let i = 0; i < tree.count(node); i++) {
    const c = tree.child(node, i);
    if (tree.kindName(c) !== "annotation") continue;
    n++;
    for (let j = 0; j < tree.count(c); j++)
      if (tree.kindName(tree.child(c, j)) === "constructor_invocation") args = true;
  }
  return { n, args };
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

/** The names a KDoc comment refers to: its `[links]` and the subject of `@see`, `@throws` and the like. */
function kdocNames(text: string): string[] {
  if (!text.startsWith("/**")) return [];
  const names: string[] = [];
  for (const m of text.matchAll(/\[([\w.`]+)\]|@(?:see|throws|exception|sample|param|property)\s+([\w.`]+)/g))
    for (const part of (m[1] ?? m[2] ?? "").split(".")) if (part) names.push(part.replaceAll("`", ""));
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
};

/** The items of the lists `writtenBroken` asks about: call arguments, and function and constructor parameters. */
const listed = new Set(["value_argument", "parameter", "class_parameter"]);

/** The rules `when` names in format.ts. */
export const customs = {
  /** ktfmt puts each annotation of a declaration on its own line once there are two or more and one has arguments. */
  annotationsBreak: (node, ctx) => {
    const { n, args } = annotationCount(node, ctx.tree);
    return n > 1 && args;
  },
  /**
   * ktfmt (its trailing-comma pass) breaks a parenthesized list of two or more items that the source writes across
   * lines, and gives it a trailing comma; a single item never forces the break, nor does a trailing comma.
   */
  writtenBroken: (node, ctx) => {
    const t = ctx.tree;
    if (!t.text(node).includes("\n")) return false;
    let items = 0;
    for (let i = 0; i < t.count(node); i++) if (listed.has(t.kindName(t.child(node, i)))) items++;
    return items > 1;
  },
} satisfies Record<string, PredicateRule<KotlinOptions>>;

/** Kotlin as ktfmt 0.64 `--kotlinlang-style` lays it out; the layouts are format.ts, generated into fmt.gen.ts. */
export const kotlin: Language<KotlinOptions> = {
  ...defineLanguage(grammar, {
    parser: language,
    lineComments: { line_comment: "//" },
    defaults,
    settings: prettierSettings,
    normalize,
    // KDoc is reflowed, which changes only the whitespace between its words.
    comment: (t) => docCommentWords(t, kdoc),
    layoutBlind: true,
    hiddenTokens: true,
    atoms: ["string_literal", "character_literal"],
  }),
  stream: gen.kotlin({ ...customs, imports }),
};
