import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { type Language, parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { format } from "../../fmt/format.js";
import { language as tsxParser } from "../tsx/index.js";
import { tsx, typescript } from "../typescript/fmt.js";
import { language as tsParser } from "../typescript/index.js";
import { javascript } from "./fmt.js";
import { language as jsParser } from "./index.js";
import type { JsOptions as AllJsOptions } from "./print/util.js";

// Byte parity with prettier 3.9.9 for JavaScript, TypeScript and TSX, under its defaults and under a set a
// person would write in a `.prettierrc`. Not covered: syntax tree-sitter-typescript reads as
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
  // An array keeps the blank line after an item's comma, an object the one after the item.
  [
    "blank-after-comma",
    "js",
    `x = [${long("a")}\n,\n\nb, c\n\n,d];\ny = [1\n,\n\n2];\nz = { ${long("a")}\n,\n\nb, c\n\n,d };`,
  ],
  // Tree-sitter leaves the `;` after a comment's line break a statement of its own; babel reads it as the
  // statement's, so the blank line after it stays.
  ["semi-after-comment", "js", "for (;;) continue // c\n;\n\nx;\na;\n;\n\nb;"],
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
  // Modifiers written out of prettier's order must parse, print in its order, and pass `check`.
  [
    "member-modifiers-any-order",
    "ts",
    "class A { override public readonly x = 1; readonly static declare y: number; constructor(readonly private a: string) { super() } }",
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
  [
    "comments-prettier-moves",
    "ts",
    "const a = 1 as const /* c */;\nfunction f() {} // after\ntype U =\n  | A // a\n  // b\n  | B;\nclass K { m /* m */ () {} }",
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
  prettier.format(text, {
    ...options,
    filepath: targets[target].filepath,
  });

describe.each(optionSets)(
  "a JS/TS/TSX file lays out byte-identical to prettier 3.9.9 (%s), so the reviewer sees the layout their tools write",
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
  ["js", "jquery.js", 1405, 1406],
  ["js", "lodash.js", 2816, 2817],
  ["tsx", "App.tsx", 1560, 1562],
  ["tsx", "LayerUI.tsx", 152, 152],
];

describe("the fetched JS/TSX corpus keeps its count of chunks byte-identical to prettier, so a layout regression cannot hide in a large file", () => {
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
