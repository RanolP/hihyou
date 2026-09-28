import type { Normalize } from "../../fmt/check.js";
import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { docCommentWords, kdoc } from "../../fmt/dsl/doc-comment.js";
import type { PredicateRule } from "../../fmt/dsl/runtime.js";
import { grammar } from "./bundle.js";
import * as gen from "./fmt.gen.js";
import { language } from "./index.js";

/** ktfmt's `--kotlinlang-style`: 100 columns, 4-space indent; it takes no other layout option. */
export type KotlinOptions = PrettierOptions;

const defaults: KotlinOptions = { ...prettierDefaults, printWidth: 100, tabWidth: 4 };

// ktfmt drops `;` between statements and adds a trailing comma to a broken list; neither changes meaning.
const closers = new Set([")", "]", "}", ">", ";"]);
const normalize: Normalize = (lexemes) =>
  lexemes.map((l, i) => {
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

/** The rules `when` names in format.ts. */
export const customs = {
  /** ktfmt puts each annotation of a declaration on its own line once there are two or more and one has arguments. */
  annotationsBreak: (node, ctx) => {
    const { n, args } = annotationCount(node, ctx.tree);
    return n > 1 && args;
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
  stream: gen.kotlin(customs),
};
