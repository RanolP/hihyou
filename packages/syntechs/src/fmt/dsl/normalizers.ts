// The normalizers `text(name)` names (dsl.ts): pure functions from a node's source text to its printed spelling,
// given the options they read. The generated rules import them by name and call them directly; hand-written
// rules that respell the same way call them too, so one spelling has one implementation.

const DOUBLE = '"';
const SINGLE = "'";

/** Prettier's getPreferredQuote: the preferred quote unless the text holds more of it than of the other. */
export function preferredQuote(content: string, preferSingle: boolean): string {
  const [preferred, alternate] = preferSingle ? [SINGLE, DOUBLE] : [DOUBLE, SINGLE];
  let p = 0;
  let a = 0;
  for (const ch of content) {
    if (ch === preferred) p++;
    else if (ch === alternate) a++;
  }
  return p > a ? alternate : preferred;
}

/** Prettier's makeString: `content` between `quote`, unescaping the other quote and escaping this one. */
export function makeString(content: string, quote: string): string {
  const other = quote === DOUBLE ? SINGLE : DOUBLE;
  const body = content.replaceAll(
    /\\(["'\\])|(["'])/g,
    (match, escaped: string | undefined, unescaped: string | undefined) => {
      if (escaped) return escaped === other ? other : match;
      return unescaped === quote ? `\\${unescaped}` : (unescaped ?? "");
    },
  );
  return quote + body + quote;
}

/** Prettier's printString over a string literal's raw text, quotes included. */
export function printString(raw: string, singleQuote: boolean): string {
  const content = raw.slice(1, -1);
  const quote = preferredQuote(content, singleQuote);
  return raw.charAt(0) === quote ? raw : makeString(content, quote);
}

/** Prettier's printNumber (utilities/print-number.js), and printBigInt for a literal ending in `n`. */
export function printNumber(raw: string): string {
  if (/n$/i.test(raw)) return raw.toLowerCase();
  if (raw.length === 1) return raw;
  return raw
    .toLowerCase()
    .replace(/^([+-]?[\d.]+e)(?:\+|(-))?0*(?=\d)/, "$1$2")
    .replace(/^([+-]?[\d.]+)e[+-]?0+$/, "$1")
    .replace(/^([+-])?\./, "$10.")
    .replace(/(\.\d+?)0+(?=e|$)/, "$1")
    .replace(/\.(?=e|$)/, "");
}

/** Ruff's number normalization: lower-case prefixes and exponents, upper-case hex digits, no bare dots. */
export function ruffNumber(raw: string): string {
  const complex = /[jJ]$/.test(raw);
  const body = complex ? raw.slice(0, -1) : raw;
  if (/^0[bBoOxX]/.test(body)) {
    const hex = /^0[xX]/.test(body);
    const digits = body.slice(2);
    return `0${(body[1] as string).toLowerCase()}${hex ? digits.replace(/[a-f]/g, (c) => c.toUpperCase()) : digits}${complex ? "j" : ""}`;
  }
  if (!complex && !/[.eE]/.test(body)) return body;
  let out = body.startsWith(".") ? `0${body}` : body;
  out = out
    .replace(/\.(?=[eE]|$)/, ".0")
    .replace(/E/, "e")
    .replace(/e\+/, "e");
  return complex ? `${out}j` : out;
}

export const lower = (t: string): string => t.toLowerCase();

/** Prettier's `maybeToLowerCase` (postcss utils): lower case unless it could be a preprocessor's or a custom name. */
export const maybeLower = (t: string): string =>
  /[$@#]/.test(t) ||
  t.startsWith("%") ||
  t.startsWith("--") ||
  t.startsWith(":--") ||
  (t.includes("(") && t.includes(")"))
    ? t
    : t.toLowerCase();

/** An at-rule's `@name`, its name through `maybeLower`. */
export const atName = (t: string): string => `@${maybeLower(t.slice(1))}`;

const units = new Map(
  (
    "em rem ex rex cap rcap ch rch ic ric lh rlh vw svw lvw dvw vh svh lvh dvh vi svi lvi dvi vb svb lvb dvb " +
    "vmin svmin lvmin dvmin vmax svmax lvmax dvmax cm mm Q in pt pc px deg grad rad turn s ms Hz kHz dpi dpcm " +
    "dppx x cqw cqh cqi cqb cqmin cqmax fr"
  )
    .split(" ")
    .map((u) => [u.toLowerCase(), u]),
);
/** A dimension's number, unit and whatever follows them. */
export const numberParts = /^([+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?)([a-z]*)(.*)$/is;
/**
 * Prettier's `printCssNumber` and unit table (utils/print-number.js, print-unit.js): a dimension's number through
 * `printNumber` less a trailing `.0`, a known unit in its canonical case; anything else as written.
 */
export function unitCase(t: string): string {
  const m = numberParts.exec(t);
  if (!m) return t;
  const [, num = "", unit = "", rest = ""] = m;
  const lowerUnit = unit.toLowerCase();
  if (unit !== "" && lowerUnit !== "n" && !units.has(lowerUnit)) return t;
  return printNumber(num).replace(/\.0(?=$|e)/, "") + (units.get(lowerUnit) ?? unit) + rest;
}

/** A string literal in the preferred quote (`singleQuote`), unless the other one needs fewer escapes. */
export const requote = (raw: string, o: { readonly singleQuote?: unknown }): string =>
  printString(raw, o.singleQuote === true);

/** Bare text in the preferred quote (`singleQuote`); text holding a quote as written. Prettier's attribute values. */
export const quote = (t: string, o: { readonly singleQuote?: unknown }): string => {
  if (/["']/.test(t)) return t;
  const q = o.singleQuote === true ? SINGLE : DOUBLE;
  return q + t + q;
};

/** A `+` between two operands spaced (`2n+1` as `2n + 1`), a sign left as written: postcss-selector-parser's `an+b`. */
export const spacePlus = (t: string): string => t.replace(/(?<=[^\s+-])\+(?=\S)/g, " + ");

const cssWideKeywords = new Set(["initial", "inherit", "unset", "revert"]);
/** A CSS-wide keyword lowercased, anything else as written. */
export const cssWide = (t: string): string => (cssWideKeywords.has(t.toLowerCase()) ? t.toLowerCase() : t);

/** A regex's flags in code-point order, as prettier prints them. */
export const sortRegexFlags = (t: string): string => [...t].sort().join("");

export const trimEnd = (t: string): string => t.trimEnd();

/** Every normalizer `text` can name. */
export const normalizers = {
  printNumber,
  ruffNumber,
  lower,
  maybeLower,
  atName,
  unitCase,
  requote,
  quote,
  spacePlus,
  cssWide,
  sortRegexFlags,
  trimEnd,
} satisfies Record<string, (t: string, o: never) => string>;

export type NormalizerName = keyof typeof normalizers;

/** The options each normalizer reads, which a spec using it then requires. */
export const normalizerOptions: { readonly [N in NormalizerName]?: readonly string[] } = {
  requote: ["singleQuote"],
  quote: ["singleQuote"],
};
