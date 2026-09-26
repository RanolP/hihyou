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
  layoutBlind: boolean,
): string | undefined {
  // The printed source nodes by start offset: output order is source order but for the few comments a rule
  // moves, so this is usually sorted already. A tree walk in preorder asks about nodes by growing start, so
  // one cursor answers "was this node printed" without hashing every node of a large file.
  const printed: FormatNode[] = [];
  for (const { token: t } of placed) if (!t.synthetic) printed.push(t.node);
  if (!sortedByStart(printed)) printed.sort((x, y) => x.start - y.start);
  let cursor = 0;
  const isPrinted = (n: FormatNode) => {
    while (
      cursor < printed.length &&
      (printed[cursor] as FormatNode).start < n.start
    )
      cursor++;
    for (let i = cursor; i < printed.length; i++) {
      const p = printed[i] as FormatNode;
      if (p.start !== n.start) break;
      if (p === n) return true;
    }
    return false;
  };

  if (layoutBlind && printsInputAsIs(root, source, placed, isPrinted, isComment))
    return coverage(source, printed, []);
  cursor = 0;

  // The input's code tokens, in source order: each node a rule printed whole, else each leaf. Comments are
  // left to the coverage check, because prettier moves them (a trailing comment past a comma).
  const input: Lexeme[] = [];
  const inputPrinted: boolean[] = [];
  const stack = [root];
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (isComment(n)) continue;
    const whole = isPrinted(n);
    if (whole || n.children.length === 0) {
      if (n.end > n.start) {
        input.push({
          node: n,
          text: source.slice(n.start, n.end),
          at: n.start,
          synthetic: false,
        });
        inputPrinted.push(whole);
      }
      continue;
    }
    for (let i = n.children.length - 1; i >= 0; i--) {
      const c = n.children[i];
      if (c) stack.push(c);
    }
  }
  const output: Lexeme[] = [];
  for (const { token: t, at } of placed)
    if (t.text !== "" && (t.synthetic || !isComment(t.node)))
      output.push({
        node: t.node,
        text: t.text,
        at,
        synthetic: t.synthetic === true,
      });

  const inForms = forms(input, source, normalize);
  const outForms = forms(output, text, normalize);
  // Walks the tokens each side keeps (a defined form) in step.
  for (let i = 0, o = 0; ; i++, o++) {
    while (i < input.length && inForms[i] === undefined) i++;
    while (o < output.length && outForms[o] === undefined) o++;
    const s = input[i];
    const out = output[o];
    if (!out) {
      if (s) return `input ${describe(s)} is missing from the output`;
      break;
    }
    if (!s) return `output ${describe(out)} matches no input token`;
    if (out.synthetic)
      return `inserted ${describe(out)} is not optional where it stands (normalized to ${JSON.stringify(outForms[o])})`;
    if (out.node !== s.node)
      return `output ${describe(out)} stands where input ${describe(s)} was`;
    if (outForms[o] !== inForms[i])
      return `input ${describe(s)} printed as "${out.text}", which means ${JSON.stringify(outForms[o])}, not ${JSON.stringify(inForms[i])}`;
  }

  // Normalizing drops nothing from the page: an input token normalized away must still be printed or be
  // optional, and every other input character (comments included) printed once.
  const optional: FormatNode[] = [];
  for (const [i, l] of input.entries())
    if (inForms[i] === undefined && !inputPrinted[i]) optional.push(l.node);
  return coverage(source, printed, optional);
}

/**
 * Whether the output's code tokens are the input's, in order, by node and unrespelled, none synthetic. Then a
 * normalize that reads only nodes and texts maps both sides to the same forms, and every input token is printed,
 * so the comparison `check` would build lexemes for can only pass. Walks the input exactly as `check` does.
 */
function printsInputAsIs(
  root: FormatNode,
  source: string,
  placed: readonly Placed[],
  isPrinted: (n: FormatNode) => boolean,
  isComment: (n: FormatNode) => boolean,
): boolean {
  let o = 0;
  const stack = [root];
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (isComment(n)) continue;
    const children = n.children;
    if (isPrinted(n) || children.length === 0) {
      if (n.end === n.start) continue;
      let t = (placed[o] as Placed | undefined)?.token;
      while (t && (t.text === "" || (!t.synthetic && isComment(t.node))))
        t = (placed[++o] as Placed | undefined)?.token;
      if (
        !t ||
        t.synthetic ||
        t.node !== n ||
        t.text.length !== n.end - n.start ||
        !source.startsWith(t.text, n.start)
      )
        return false;
      o++;
      continue;
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const c = children[i];
      if (c) stack.push(c);
    }
  }
  for (; o < placed.length; o++) {
    const t = (placed[o] as Placed).token;
    if (t.text !== "" && (t.synthetic || !isComment(t.node))) return false;
  }
  return true;
}

function sortedByStart(nodes: readonly FormatNode[]): boolean {
  for (let i = 1; i < nodes.length; i++)
    if ((nodes[i] as FormatNode).start < (nodes[i - 1] as FormatNode).start)
      return false;
  return true;
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
 * Checks that the ranges of `printed` and `optional` (each sorted by start) cover every non-blank character of
 * the input exactly once: a dropped token leaves a gap, a repeated one (or a node printed along with its own
 * child) overlaps. Tree-sitter puts every character outside whitespace into some leaf, so this is "each leaf
 * printed once" without walking the tree. On a tie `printed` goes first.
 */
function coverage(
  source: string,
  printed: readonly FormatNode[],
  optional: readonly FormatNode[],
): string | undefined {
  let covered = 0;
  for (let p = 0, o = 0; p < printed.length || o < optional.length; ) {
    const a = printed[p];
    const b = optional[o];
    let n: FormatNode;
    if (a && (!b || a.start <= b.start)) {
      n = a;
      p++;
    } else {
      n = b as FormatNode;
      o++;
    }
    if (n.start < covered) return `input at ${n.start} printed twice`;
    if (hasNonBlank(source, covered, n.start))
      return `input at ${covered} dropped`;
    covered = n.end;
  }
  if (hasNonBlank(source, covered, source.length))
    return `input at ${covered} dropped`;
  return undefined;
}

/** `/\S/.test(source.slice(from, to))`, without the slice. */
function hasNonBlank(source: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = source.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13)) continue;
    if (c < 128 || !/\s/.test(source.charAt(i))) return true;
  }
  return false;
}
