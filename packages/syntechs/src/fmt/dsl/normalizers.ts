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
/** Prettier's directive: requoted only where no quote inside would need escaping, or `use strict`. */
export const directive = (raw: string, o: { readonly singleQuote?: unknown }): string => {
  const content = raw.slice(1, -1);
  if (content !== "use strict" && (content.includes('"') || content.includes("'"))) return raw;
  const q = o.singleQuote === true ? SINGLE : DOUBLE;
  return q + content + q;
};

/** Prettier's JSX attribute string: requoted by `jsxSingleQuote`, its quotes as `&quot;` or `&apos;`. */
export const jsxString = (raw: string, o: { readonly jsxSingleQuote?: unknown }): string => {
  const content = raw.slice(1, -1).replaceAll("&apos;", SINGLE).replaceAll("&quot;", DOUBLE);
  const q = preferredQuote(content, o.jsxSingleQuote === true);
  return q + content.replaceAll(q, q === DOUBLE ? "&quot;" : "&apos;") + q;
};

/** A regex's flags in code-point order, as prettier prints them. */
export const sortRegexFlags = (t: string): string => [...t].sort().join("");

export const trimEnd = (t: string): string => t.trimEnd();

/** A string literal in double quotes, as prettier's JSON printers write every one; a double-quoted one as written. */
export const doubleQuote = (raw: string): string =>
  raw.startsWith(DOUBLE) ? raw : makeString(raw.slice(1, -1), DOUBLE);

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
};

/** A string literal's value from its source between the quotes, escapes resolved as the spec cooks them. */
export function cook(raw: string): string {
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = raw.charAt(++i);
    const simple = SIMPLE_ESCAPES[e];
    if (simple !== undefined) out += simple;
    else if (e === "x") {
      out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === "u") {
      if (raw.charAt(i + 1) === "{") {
        const close = raw.indexOf("}", i);
        out += String.fromCodePoint(
          Number.parseInt(raw.slice(i + 2, close), 16),
        );
        i = close;
      } else {
        out += String.fromCharCode(
          Number.parseInt(raw.slice(i + 1, i + 5), 16),
        );
        i += 4;
      }
    } else if (e >= "0" && e <= "7") {
      const m = /^[0-7]{1,3}/.exec(raw.slice(i, i + 3))?.[0] ?? e;
      const digits = Number.parseInt(m, 8) > 255 ? m.slice(0, 2) : m;
      out += String.fromCharCode(Number.parseInt(digits, 8));
      i += digits.length - 1;
    } else if (e === "\r") {
      if (raw.charAt(i + 1) === "\n") i++;
    } else if (e !== "\n" && e !== " " && e !== " ") out += e;
  }
  return out;
}

/** A template literal with no substitution as the JSON string of its value, as `json-stringify` prints one. */
export const jsonString = (raw: string): string => JSON.stringify(cook(raw.slice(1, -1)));

/** A bare object key quoted, as prettier's JSON printers quote one (`a: 1` as `"a": 1`). */
export const quoteKey = (t: string): string => DOUBLE + t + DOUBLE;

// Prettier's printPropertyKey quotes a numeric key in JSON where its spelling is a plain number that reads
// back as the same string (`0`, `0.1`), and leaves any other (`1e2`, `1.0`, `999...9`) a number.
const quotedNumber = (printed: string): string =>
  /^(?:\d+|\d+\.\d+)$/.test(printed) && String(Number(printed)) === printed
    ? DOUBLE + printed + DOUBLE
    : printed;

/** A numeric object key through `printNumber`, quoted where prettier's `json` and `jsonc` quote it. */
export const numberKey = (raw: string): string => quotedNumber(printNumber(raw));

/** A numeric object key as written, quoted where prettier's `json-stringify` quotes it. */
export const rawNumberKey = (raw: string): string => quotedNumber(raw);

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
  directive,
  jsxString,
  sortRegexFlags,
  trimEnd,
  doubleQuote,
  jsonString,
  quoteKey,
  numberKey,
  rawNumberKey,
} satisfies Record<string, (t: string, o: never) => string>;

export type NormalizerName = keyof typeof normalizers;

/** The options each normalizer reads, which a spec using it then requires. */
export const normalizerOptions: { readonly [N in NormalizerName]?: readonly string[] } = {
  requote: ["singleQuote"],
  quote: ["singleQuote"],
  directive: ["singleQuote"],
  jsxString: ["jsxSingleQuote"],
};
