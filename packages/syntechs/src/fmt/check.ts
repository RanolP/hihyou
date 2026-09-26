import { parseTree, type Tree } from "../core/index.js";
import type { Language } from "./rules.js";

/** One code token of a parsed text, as `check` compares it. */
export interface Lexeme {
  /** The token's node: a handle into the side's `Tree`, which `Normalize` receives. */
  readonly node: number;
  /** The node's slice of the text. */
  readonly text: string;
  /** Where `text` starts in the whole text. */
  readonly at: number;
}

/**
 * Maps one side's code tokens, in order, to what must match between input and output: a form per token, or
 * `undefined` for a token whose presence cannot change the meaning where it stands (a trailing `,`, an ASI `;`,
 * redundant parens). It runs once over each parsed side, so it must judge both alike: from the neighbouring
 * lexemes, or from `tree` through `node`. `at` and `text` expose layout, so a language whose meaning rides on
 * it (Python's indentation) folds that into the forms, as the first token of a logical line prefixed with its
 * indent depth.
 */
export type Normalize = (
  lexemes: readonly Lexeme[],
  text: string,
  tree: Tree,
) => readonly (string | undefined)[];

export const identity: Normalize = (lexemes) => lexemes.map((l) => l.text);

/**
 * A plain decimal literal's exact value as `[-]digitsEexponent`, so `1.50`, `15e-1` and `0.15E+1` compare equal
 * and `1.5` and `1.6` never do; `undefined` when `raw` is not one (hex, a suffix, separators).
 */
export function decimalValue(raw: string): string | undefined {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m || (m[2] === "" && !m[3])) return undefined;
  const fraction = m[3] ?? "";
  let digits = (m[2] + fraction).replace(/^0+/, "");
  let exponent = Number(m[4] ?? 0) - fraction.length;
  const zeros = /0*$/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(0, digits.length - zeros);
  exponent += zeros;
  return `${m[1] === "-" ? "-" : ""}${digits || "0"}e${digits ? exponent : 0}`;
}

/**
 * Checks that `formatted` says what `prev` says, as `language` judges meaning. It parses both texts, so a
 * formatter bug that glues two tokens into one or splits one shows up as the tokens the parser reads back. The
 * normalized code tokens of both sides match one for one in order, the comments match as a multiset (a rule may
 * move a comment past a comma), and `formatted` has no syntax error when `prev` had none, except one holding
 * only tokens `normalize` drops: the grammar may lack a form the formatter prints on purpose (tree-sitter-json has
 * no trailing comma, which `jsonc` prints). Returns what broke, or undefined.
 *
 * `format` never runs this: a failure means a parser or formatter bug, which the tests and the conformance
 * harness catch by checking every output they format.
 */
export function check<O>(
  language: Language<O>,
  prev: string,
  formatted: string,
): string | undefined {
  const before = read(language, prev);
  const after = read(language, formatted);
  const problem = sameComments(before.comments, after.comments);
  if (problem) return problem;

  const input = before.lexemes;
  const output = after.lexemes;
  const newErrors = before.errors.length === 0 ? after.errors : [];
  if (
    newErrors.length === 0 &&
    language.layoutBlind &&
    sameTexts(input, output)
  )
    return undefined;
  const inForms = forms(input, prev, before.tree, language);
  const outForms = forms(output, formatted, after.tree, language);
  for (const e of newErrors)
    for (let o = firstAtOrAfter(output, e.start); o < output.length; o++) {
      if ((output[o] as Lexeme).at >= e.end) break;
      if (outForms[o] !== undefined)
        return `the output has a syntax error at ${e.start}, which the input has not`;
    }
  // Walks the tokens each side keeps (a defined form) in step.
  for (let i = 0, o = 0; ; i++, o++) {
    while (i < input.length && inForms[i] === undefined) i++;
    while (o < output.length && outForms[o] === undefined) o++;
    const s = input[i];
    const out = output[o];
    if (!out) {
      if (s) return `input ${describe(s)} is missing from the output`;
      return undefined;
    }
    if (!s) return `output ${describe(out)} matches no input token`;
    if (outForms[o] !== inForms[i])
      return `input ${describe(s)} is output as ${describe(out)}, which means ${JSON.stringify(outForms[o])}, not ${JSON.stringify(inForms[i])}`;
  }
}

interface Read {
  tree: Tree;
  lexemes: Lexeme[];
  /**
   * Each comment's text with its line breaks as `\n` and no blanks at either end of a line, which a formatter
   * may rewrite: prettier re-indents a JSDoc block's lines with the code around it.
   */
  comments: string[];
  /** The ERROR nodes, by start; a MISSING node is no error here (see `read`). */
  errors: { start: number; end: number }[];
}

/**
 * The code tokens of `text` in order: each leaf, each node of an atom kind, and each node holding text of its
 * own besides its children, taken whole. With the tree's nodes nested in order inside a root that spans every
 * non-blank character (the parser test pins that), each non-blank character lands in exactly one lexeme or
 * comment. A MISSING node is zero width, so it is no lexeme and no error: it stands for no text, and a token the
 * recovery skipped for it is still compared (`[1,2,]` reads as a MISSING value after an optional `,`).
 */
function read<O>(language: Language<O>, text: string): Read {
  const tree = parseTree(language.parser, text);
  const out: Read = { tree, lexemes: [], comments: [], errors: [] };
  const stack: number[] = [tree.root];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    const kind = tree.kindName(n);
    const start = tree.start(n);
    const end = tree.end(n);
    if (language.comments.has(kind)) {
      const raw = text.slice(start, end);
      const spelled = language.comment ? language.comment(raw) : raw;
      for (const c of typeof spelled === "string" ? [spelled] : spelled)
        out.comments.push(
          c
            .replace(/\r\n?/g, "\n")
            .replace(/^[ \t]+|[ \t]+$/gm, "")
            .trimEnd(),
        );
      continue;
    }
    if (kind === "ERROR") out.errors.push({ start, end });
    const count = tree.count(n);
    if (count === 0 || language.atoms.has(kind) || ownsText(tree, n, text)) {
      if (end > start)
        out.lexemes.push({ node: n, text: text.slice(start, end), at: start });
      continue;
    }
    for (let i = count - 1; i >= 0; i--) stack.push(tree.child(n, i));
  }
  return out;
}

/** Whether `n` has a non-blank character outside all of its children. */
function ownsText(tree: Tree, n: number, text: string): boolean {
  let at = tree.start(n);
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (hasNonBlank(text, at, tree.start(c))) return true;
    at = tree.end(c);
  }
  return hasNonBlank(text, at, tree.end(n));
}

function sameComments(
  before: readonly string[],
  after: readonly string[],
): string | undefined {
  const count = new Map<string, number>();
  for (const c of before) count.set(c, (count.get(c) ?? 0) + 1);
  for (const c of after) {
    const left = count.get(c);
    if (!left)
      return `output comment ${JSON.stringify(c)} matches no input comment`;
    count.set(c, left - 1);
  }
  for (const [c, left] of count)
    if (left > 0)
      return `input comment ${JSON.stringify(c)} is missing from the output`;
  return undefined;
}

/** The index of the first lexeme at or after `at`, or `lexemes.length`. */
function firstAtOrAfter(lexemes: readonly Lexeme[], at: number): number {
  let lo = 0;
  let hi = lexemes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((lexemes[mid] as Lexeme).at < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sameTexts(a: readonly Lexeme[], b: readonly Lexeme[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++)
    if ((a[i] as Lexeme).text !== (b[i] as Lexeme).text) return false;
  return true;
}

function forms<O>(
  lexemes: readonly Lexeme[],
  text: string,
  tree: Tree,
  language: Language<O>,
): readonly (string | undefined)[] {
  const out = language.normalize(lexemes, text, tree);
  if (out.length !== lexemes.length)
    throw new Error(
      `normalize returned ${out.length} forms for ${lexemes.length} tokens`,
    );
  return out;
}

const describe = (l: Lexeme) => `${JSON.stringify(l.text)} at ${l.at}`;

/** `/\S/.test(text.slice(from, to))`, without the slice. */
function hasNonBlank(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13)) continue;
    // A backslash line continuation some parsers (Python's) skip as blank rather than keep as a node.
    const next = text.charCodeAt(i + 1);
    if (c === 92 && (next === 10 || next === 13)) continue;
    if (c < 128 || !/\s/.test(text.charAt(i))) return true;
  }
  return false;
}
