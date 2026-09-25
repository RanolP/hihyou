import type { Placed } from "./printer.js";
import type { FormatNode } from "./tree.js";

/** One code token as the self-check compares it: read from the input tree, or as printed. */
export interface Lexeme {
  /** The token's source node; for a synthetic token, the node it anchors to. */
  readonly node: FormatNode;
  /** The source slice on the input side, the printed text on the output side. */
  readonly text: string;
  /** Where `text` starts in that side's whole text (the output's line breaks are still `\n` here). */
  readonly at: number;
  /** Inserted by a rule (`synthetic()`); never on the input side. */
  readonly synthetic: boolean;
}

/**
 * Maps one side's code tokens, in order, to what must match between input and output: a form per token, or
 * `undefined` for a token whose presence cannot change the meaning where it stands (a trailing `,`, an ASI `;`,
 * redundant parens). It runs once over the input and once over the output, so it must judge both alike: from
 * the neighbouring lexemes, or from the tree through `node`. `at` and `text` expose layout, so a language whose
 * meaning rides on it (Python's indentation) folds that into the forms, as the first token of a logical line
 * prefixed with its indent depth.
 */
export type Normalize = (
  lexemes: readonly Lexeme[],
  text: string,
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
 * Checks that `placed` (printed as `text`) says what `root` (of `source`) says: the normalized code tokens of
 * both sides match one for one, in order and by node, and every non-blank input character is printed exactly
 * once or belongs to a token normalized away. Returns what broke, or undefined.
 */
export function check(
  root: FormatNode,
  source: string,
  text: string,
  placed: readonly Placed[],
  normalize: Normalize,
  isComment: (n: FormatNode) => boolean,
): string | undefined {
  const printed = new Set<FormatNode>();
  for (const { token: t } of placed) if (!t.synthetic) printed.add(t.node);

  // The input's code tokens, in source order: each node a rule printed whole, else each leaf. Comments are
  // left to the coverage check, because prettier moves them (a trailing comment past a comma).
  const input: Lexeme[] = [];
  const stack = [root];
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (isComment(n)) continue;
    if (printed.has(n) || n.children.length === 0) {
      if (n.end > n.start)
        input.push({
          node: n,
          text: source.slice(n.start, n.end),
          at: n.start,
          synthetic: false,
        });
      continue;
    }
    for (let i = n.children.length - 1; i >= 0; i--) {
      const c = n.children[i];
      if (c) stack.push(c);
    }
  }
  const output: Lexeme[] = placed.flatMap(({ token: t, at }) =>
    t.text === "" || (!t.synthetic && isComment(t.node))
      ? []
      : [{ node: t.node, text: t.text, at, synthetic: t.synthetic === true }],
  );

  const inForms = forms(input, source, normalize);
  const outForms = forms(output, text, normalize);
  const inKept = input.filter((_, i) => inForms[i] !== undefined);
  const outKept = output.filter((_, i) => outForms[i] !== undefined);
  const inKeptForms = inForms.filter((f) => f !== undefined);
  const outKeptForms = outForms.filter((f) => f !== undefined);
  for (let i = 0; i < Math.max(inKept.length, outKept.length); i++) {
    const s = inKept[i];
    const o = outKept[i];
    if (!o) return s && `input ${describe(s)} is missing from the output`;
    if (!s) return `output ${describe(o)} matches no input token`;
    if (o.synthetic)
      return `inserted ${describe(o)} is not optional where it stands (normalized to ${JSON.stringify(outKeptForms[i])})`;
    if (o.node !== s.node)
      return `output ${describe(o)} stands where input ${describe(s)} was`;
    if (outKeptForms[i] !== inKeptForms[i])
      return `input ${describe(s)} printed as "${o.text}", which means ${JSON.stringify(outKeptForms[i])}, not ${JSON.stringify(inKeptForms[i])}`;
  }

  // Normalizing drops nothing from the page: an input token normalized away must still be printed or be
  // optional, and every other input character (comments included) printed once.
  const ranges = placed.flatMap(
    ({ token: t }): (readonly [number, number])[] =>
      t.synthetic ? [] : [[t.node.start, t.node.end]],
  );
  for (const [i, l] of input.entries())
    if (inForms[i] === undefined && !printed.has(l.node))
      ranges.push([l.node.start, l.node.end]);
  return coverage(source, ranges);
}

function forms(
  lexemes: readonly Lexeme[],
  text: string,
  normalize: Normalize,
): readonly (string | undefined)[] {
  const out = normalize(lexemes, text);
  if (out.length !== lexemes.length)
    throw new Error(
      `normalize returned ${out.length} forms for ${lexemes.length} tokens`,
    );
  return out;
}

const describe = (l: Lexeme) =>
  `"${l.text}" at ${l.at}${l.synthetic ? " (synthetic)" : ""}`;

/**
 * Checks that `ranges` cover every non-blank character of the input exactly once: a dropped token leaves a
 * gap, a repeated one (or a node printed along with its own child) overlaps. Tree-sitter puts every character
 * outside whitespace into some leaf, so this is "each leaf printed once" without walking the tree.
 */
function coverage(
  source: string,
  ranges: (readonly [number, number])[],
): string | undefined {
  // Output order is source order but for the few comments a rule moves, so this sort is near linear.
  ranges.sort((x, y) => x[0] - y[0]);
  let covered = 0;
  for (const [start, end] of ranges) {
    if (start < covered) return `input at ${start} printed twice`;
    if (/\S/.test(source.slice(covered, start)))
      return `input at ${covered} dropped`;
    covered = end;
  }
  if (/\S/.test(source.slice(covered))) return `input at ${covered} dropped`;
  return undefined;
}
