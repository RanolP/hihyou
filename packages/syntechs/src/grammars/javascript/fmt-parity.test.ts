import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Language, parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { oxfmt } from "../../fmt/conformance/references.node.js";
import { format } from "../../fmt/format.js";
import { language as tsxParser } from "../tsx/index.js";
import { tsx, typescript } from "../typescript/fmt.js";
import { language as tsParser } from "../typescript/index.js";
import { javascript } from "./fmt.js";
import { language as jsParser } from "./index.js";
import type { JsOptions as AllJsOptions } from "./print/util.js";

// Byte parity with oxfmt 0.70.0 over prettier's defaults for JavaScript, TypeScript and TSX, under those and
// under a set a person would write in a `.prettierrc`. Not covered: syntax tree-sitter-typescript reads as
// an ERROR.

type Target = "js" | "ts" | "tsx";
/** The parser is the target's own, so a case sets only layout options. */
type JsOptions = Omit<AllJsOptions, "parser">;

const targets = {
  js: { parser: jsParser, lang: javascript, filepath: "x.js" },
  ts: { parser: tsParser, lang: typescript, filepath: "x.ts" },
  tsx: { parser: tsxParser, lang: tsx, filepath: "x.tsx" },
} satisfies Record<
  Target,
  { parser: Language; lang: unknown; filepath: string }
>;

const optionSets: [string, Partial<JsOptions>][] = [
  ["defaults", {}],
  [
    "no semi, singleQuote, tabWidth 4, printWidth 100, arrowParens avoid, trailingComma es5",
    {
      semi: false,
      singleQuote: true,
      tabWidth: 4,
      printWidth: 100,
      arrowParens: "avoid",
      trailingComma: "es5",
    },
  ],
];

const long = (name: string) => `${name}${"x".repeat(30)}`;

const edgeCases: [string, Target, string][] = [
  ["empty-statement-list", "js", "let a = 1;;\n\n\n\nlet b = 2"],
  // An array keeps the blank line after an item's comma.
  ["blank-after-comma", "js", "y = [1\n,\n\n2];"],
  // A blank line after an item's comma breaks an array and stays; one between an item and its comma goes, in an
  // object too, but one before an own-line comment there stays.
  [
    "blank-after-comma-breaks",
    "js",
    `x = [${long("a")}\n,\n\nb, c\n\n,d];\nz = { ${long("a")}\n,\n\nb, c\n\n,d };\nf([a,\n\nb]);\nw = {a\n\n// c\n,b};`,
  ],
  // Tree-sitter leaves the `;` after a comment's line break a statement of its own; the gap after the last stray
  // `;` counts, not one before it.
  ["semi-after-comment", "js", "for (;;) continue // c\n;\n\nx;\na;\n;\n\nb;\nc;\n\n;\nd;\n\n// e\n;(f)"],
  // A comment ending the line after a computed-member callee stays on the callee, past the call.
  ["subscript-callee-comment", "js", "a[0] // c\n(1)\nf // c\n(1)\nb[0] // c\n(x, // d\n2)"],
  // Any comment trailing a chain's member broke the chain; oxfmt breaks it only for one between a `.` member's object
  // and property or ending its line, so a computed member's stays past the one-line chain.
  [
    "chain-member-comment",
    "js",
    "a[0] // c\n(1).b()\na[0] /* c */\n(1).b()\na // c\n.b().c()\na /* c */ .b().c().d()\na[0](1) // c\n.b()\na.x // c\n(1).b()",
  ],
  // A comment in a computed-member callee's call broke after `=`, flushed into the arguments before a `.` member, and
  // split `a.b` from `[0]`; oxfmt keeps the call poorly breakable only without a comment in it, sets no line-suffix
  // boundary after a member's object, and merges a computed member with a trailing comment into the chain's head.
  [
    "callee-comment-chain",
    "js",
    "x = a[0] // c\n(1)\nconst y = a[0] // c\n(1)\nx = a[0] // c\n(1).b\nx = a.b[0] // c\n(1).c()\nx = a.b[i] // c\n(1)\na.b[0][1] // c\n(1).c()",
  ],
  // oxfmt counts the blank lines just before the next statement, so one before a statement's own `;` on a later line
  // drops, unless that `;` is glued to the next statement as its ASI guard.
  [
    "stray-semi-blank-line",
    "js",
    "a // c\n\n;\nb\na\n\n;\nc\nd\n\n;[]\ne\n\n; f\ng // c\n// d\n\n;\nh",
  ],
  ["quotes", "js", `const a = "it's", b = 'say "hi"', c = 'plain';`],
  ["numbers", "js", "x = [0XAB, 1E5, .5, 5., 0.50, 1_000n, 0B11, 0O7];"],
  [
    "object-preserved-break",
    "js",
    "const o = {\n  a: 1, b: 2 };\nconst p = { a: 1, b: 2 };",
  ],
  ["quote-props", "js", `const o = { "a": 1, b: 2, "c-d": 3 };`],
  [
    "long-call",
    "js",
    `${long("callee")}(${long("first")}, ${long("second")}, ${long("third")});`,
  ],
  [
    "last-arg-arrow",
    "js",
    `useEffect(() => { ${long("doSomething")}(); ${long("andMore")}(); }, [dep]);`,
  ],
  [
    "arrow-chain",
    "js",
    `const f = (a) => (b) => (c) => ${long("a")} + ${long("b")};`,
  ],
  [
    "member-chain",
    "js",
    `promise.then(${long("r")} => r.json()).then(data => console.log(data)).catch(${long("e")} => {});`,
  ],
  [
    "binary-break",
    "js",
    `const ok = ${long("first")} && ${long("second")} || ${long("third")};`,
  ],
  [
    "ternary-chain",
    "js",
    `const t = ${long("a")} ? ${long("b")} : ${long("c")} ? ${long("d")} : e;`,
  ],
  ["template", "js", "const s = `a ${b + c} d ${ e }`;"],
  [
    "class",
    "js",
    "class A extends B { static #x = 1; get y() { return this.#x } constructor() { super() } }",
  ],
  [
    "control-flow",
    "js",
    "if (a) b(); else if (c) { d() } else e()\nfor (const x of y) z(x)\nwhile(1) break",
  ],
  ["switch", "js", "switch (a) { case 1: case 2: b(); break; default: c() }"],
  ["try", "js", "try { a() } catch { b() } finally { c() }"],
  [
    "imports",
    "js",
    `import a, { b as c, d } from "e";\nexport * from "f";\nexport { g as default };`,
  ],
  [
    "long-import",
    "js",
    `import { ${long("alpha")}, ${long("beta")}, ${long("gamma")} } from "m";`,
  ],
  ["no-semi-hazard", "js", "a\n;[1, 2].forEach(f)\n;(b || c).d()"],
  [
    "comments",
    "js",
    "// head\nconst a = 1; // trail\n\n/* block */\nfunction f(/* none */) {}\n",
  ],
  ["directives", "js", "'use strict'\nfunction f() { \"use asm\"; return 1 }"],
  ["regex-and-division", "js", "const r = /ab+c/gi, d = a / b / c;"],
  [
    "async-generators",
    "js",
    "async function* g() { yield* h(); await i; for await (const x of y) {} }",
  ],
  [
    "types",
    "ts",
    "type A = { a: string; b?: number };\ntype U = 'a' | 'b';\nlet x: Array<string> = [];",
  ],
  [
    "long-union",
    "ts",
    `type U = ${Array.from({ length: 8 }, (_, i) => `"variant${i}"`).join(" | ")};`,
  ],
  [
    "interface",
    "ts",
    "interface A<T> extends B { readonly a: T; b(x: number): void; [k: string]: unknown }",
  ],
  ["enum", "ts", "enum E { A = 1, B, C = 'c' }\nconst enum F { X }"],
  ["generics", "ts", "function f<T extends object = {}>(x: T): T { return x }"],
  [
    "casts",
    "ts",
    "const a = b as unknown as C, d = e!, f = g satisfies H, i = <J>k;",
  ],
  [
    "class-members",
    "ts",
    "class A implements B { private readonly a = 1; protected abstract b(): void; constructor(public c: string) { super() } }",
  ],
  [
    "namespaces",
    "ts",
    "declare module 'm' { export const a: number }\nnamespace N.M { export type T = 1 }",
  ],
  [
    "decorators",
    "ts",
    "@Component({ a: 1 })\nclass A { @Input() b: string; m(@Inject(C) c: C) {} }",
  ],
  [
    "conditional-type",
    "ts",
    `type C<T> = T extends string ? ${long("A")} : T extends number ? ${long("B")} : never;`,
  ],
  ["mapped-type", "ts", "type M = { readonly [K in keyof T]?: T[K] };"],
  [
    "tsx-without-jsx",
    "tsx",
    "const f = <T,>(x: T) => x;\nexport default function g(): number { return 1 }",
  ],
  ["jsx-element", "tsx", 'const a = <div   className="x">{ y }</div>;'],
  [
    "jsx-multiline-parens",
    "tsx",
    `const a = <div className="${long("c")}" id="${long("i")}"><span>{b}</span> text</div>;`,
  ],
  [
    "jsx-text-fill",
    "js",
    `const a = <p>${"lorem ipsum dolor ".repeat(8)}<b>sit</b> amet {x} consectetur.</p>;`,
  ],
  [
    "jsx-fragment-attrs",
    "tsx",
    `const a = <><Foo {...props} bar="it's" baz={() => 1} disabled /></>;`,
  ],
  // Embedded CSS is SCSS to prettier, so a `//` there opens a comment rather than dividing: the template stays as written.
  ["css-embed-line-comment", "js", "css`a{b: a // e;}`;\n"],
  // Nor does prettier space a `:` in an embedded value (`a :b`, `x(a:b)`), which oxfmt does in a CSS file.
  ["css-embed-value-colon", "js", "css`\n  b: a :b;\n  c: x(a:b);\n`;\n"],
  // A `//` inside a word (`x(http://a)`) is a line comment to SCSS too, which leaves the value broken: source kept.
  ["css-embed-url-in-word", "js", "css`b: x(http://a);`;\ncss`b: url(http://a);`;\n"],
  // SCSS ends the template's last declaration and a block's with the `;` it adds, before a trailing comment; the
  // missing `;` failed the embed, which printed the template as written, and the added one failed the check.
  ["css-embed-inserted-semicolon", "js", "css`b: a`;\ncss`b: a /*e;*/`;\ncss`a{b: a}`;\ncss`b: ${x}; c: ${y}`;\n"],
  // A substitution alone as a statement did not parse as CSS, so the template kept its source; oxfmt reads it as a
  // statement, `;` only where written, and keeps a statement after it on its line.
  [
    "css-embed-placeholder-statement",
    "js",
    "css`${x}; b: a`;\ncss`${x}`;\ncss`${x}\n  b: a;`;\ncss`b: a; ${x};`;\ncss`a{${x}; b: a}`;\ncss`${x}${y}\n${z}; /* c */ d: e`;\ncss`${x}: a;`;\n",
  ],
  [
    "comments-prettier-moves",
    "ts",
    "const a = 1 as const /* c */;\nfunction f() {} // after\ntype U =\n  | A // a\n  // b\n  | B;\nclass K { m /* m */ () {} }",
  ],
  // A prettier-ignore ending a union member's line kept the next member as written, dropped the comment, and kept a
  // parenthesized member before it as written; oxfmt keeps only an unparenthesized member it trails.
  [
    "union-member-trailing-ignore",
    "ts",
    "type A =\n  | (foo1&foo2) // prettier-ignore\n  | (bar1&bar2)\n  | baz;\ntype B =\n  | foo1&foo2 // prettier-ignore\n  | {a:1}\n  | baz;\ntype C =\n  | foo\n  | bar1&bar2 // prettier-ignore\n  | baz;\n",
  ],
  // A script's `await (x, y)(z)` printed as oxfmt's `await(x, y)(z)`, but the check flattened only a one-argument
  // call of `await`, so it refused the output.
  [
    "await-call-many-arguments",
    "js",
    `await (${"x".repeat(40)}, ${"y".repeat(40)})(c);\nconst v = await (a, b, c)(d).e;\n`,
  ],
];

function ours(target: Target, text: string, options: Partial<JsOptions>) {
  const t = targets[target];
  const tree = parseTree(t.parser, text);
  const out = format(tree, t.lang, options as Partial<AllJsOptions>);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  const problem = check(t.lang, text, out.text);
  if (problem) throw new Error(`check: ${problem}`);
  return out.text;
}
const theirs = (target: Target, text: string, options: Partial<JsOptions>) =>
  oxfmt.format(targets[target].filepath, text, options);

describe.each(optionSets)(
  "a JS/TS/TSX file lays out byte-identical to oxfmt 0.70.0 (%s), so the reviewer sees the layout their tools write",
  (_, options) => {
    it.each(edgeCases)("%s (%s)", async (_, target, text) => {
      expect(ours(target, text, options)).toBe(
        await theirs(target, text, options),
      );
    });
  },
);

/** Chunks: a new one starts at each line indented at most two levels that begins with anything but a closer (the libraries wrap the whole file in a function or two). */
const chunks = (s: string) => s.split(/\n(?= {0,4}[^\s})\]])/);

const corpusDir = join(import.meta.dirname, "../../../corpus");

// The fetched corpus is gitignored, so this runs where `fetch-corpus.sh` has run. Each count is pinned exactly:
// a regression lowers it, and closing a gap raises it, which shows up as a test change.
const ratchet: [Target, string, number, number][] = [
  ["js", "jquery.js", 1406, 1406],
  ["js", "lodash.js", 2817, 2817],
  ["tsx", "App.tsx", 1560, 1562],
  ["tsx", "LayerUI.tsx", 152, 152],
];

describe("the fetched JS/TSX corpus keeps its count of chunks byte-identical to oxfmt, so a layout regression cannot hide in a large file", () => {
  it.each(ratchet)("%s: %s", async (target, file, identical, total) => {
    const path = join(corpusDir, file);
    if (!existsSync(path)) return;
    const text = readFileSync(path, "utf8");
    const a = chunks(ours(target, text, {}));
    const b = chunks(await theirs(target, text, {}));
    const expected = new Set(b);
    expect([a.filter((c) => expected.has(c)).length, b.length]).toEqual([
      identical,
      total,
    ]);
  });
});

// Target, input, then today's output under the defaults, which differs from oxfmt's.
const divergences: [string, Target, string, string][] = [
  // Modifiers written out of TypeScript's order, which oxfmt rejects; syntechs prints them in order.
  [
    "member-modifiers-any-order",
    "ts",
    "class A { override public readonly x = 1; readonly static declare y: number; constructor(readonly private a: string) { super() } }",
    "class A {\n  public override readonly x = 1;\n  declare static readonly y: number;\n  constructor(private readonly a: string) {\n    super();\n  }\n}\n",
  ],
];

describe("a known gap from oxfmt stays pinned, so closing one shows up as a test change", () => {
  it.each(divergences)("%s (%s)", async (_, target, text, pinned) => {
    expect(ours(target, text, {})).toBe(pinned);
    expect(await theirs(target, text, {}).catch((e: unknown) => String(e))).not.toBe(pinned);
  });
});
