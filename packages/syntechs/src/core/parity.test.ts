import { expect, test } from "vitest";
import { language as css } from "../grammars/css/index.js";
import { language as javascript } from "../grammars/javascript/index.js";
import { language as json } from "../grammars/json/index.js";
import { language as python } from "../grammars/python/index.js";
import { language as tsx } from "../grammars/tsx/index.js";
import { language as typescript } from "../grammars/typescript/index.js";
import { type GrammarName, referenceMissing } from "./corpus.node.js";
import { parse } from "./index.js";
import type { Language } from "./language.js";
import { checkParity } from "./parity.node.js";

// Small inputs that exercise the lexer, the tables and error recovery (MISSING insertion, ERROR wrapping,
// `recover`, `condenseStack`, stack `popError`/merging), each compared with native tree-sitter on its nodes, its
// SyntaxTree and its errorChars. The corpus is gitignored, so these committed cases are what CI checks; the
// fetched corpus runs through `node dist/parity.node.js`.
// Generated modules are imported statically: vitest cannot resolve a template dynamic import to a .ts file.
const CASES: Partial<Record<GrammarName, [Language, string[]]>> = {
  json: [
    json,
    [
      '// c\n{"aé\n": [1, -2.5e3, true, false, null, "\u{1F600}x", {}, []], /* block */ "b": {"c": ""}}\n',
      '{"a": [1, 2,, 3], "b" 4}',
      '{"a": {"b": [1, 2}',
      '[1, 2 3, "x\\q", @, ]',
      "",
      // Recovery that skips a stray comma and then closes an array and an object that never closed.
      '{"a": [1,, }',
      // Several recoveries in one object: missing colons and a key with no value, costed against each other.
      '{"a" 1 "b" 2 "c"}',
      // MISSING insertion down a chain of unclosed containers at end of input.
      '[[[{"a": [{"b":',
      // Garbage before and after a value: ERROR at the root, errorChars counted once for nested ERRORs.
      '}} x {"a": 1} ]] y',
    ],
  ],
  css: [
    css,
    [
      "a b > c:hover::before, #x .y[z='1'] { color: red !important; margin: 0 auto; }\n@media (min-width: 10px) { a:not(.b) { top: calc(1px + 2%); } }\n",
      "a { color: red; b:hover { x: 1 } }\n/* c */ @import url(x.css);",
      "a { color: ; } b { : red } c:",
      "a:hover /* { */ { x: y }",
      // An unclosed block at end of input: MISSING `}` after a declaration with no `;`.
      "a { color: red",
      // An unclosed at-rule wrapping an unclosed rule, then stray closers.
      "@media screen { a { b: c }\n}} d { e: f }",
      // The descendant-operator scanner before a pseudo-class that is really a declaration.
      "a b:hover { c: d } e f:g; h",
    ],
  ],
  javascript: [
    javascript,
    [
      // Automatic semicolons, template chars, regex vs division, ternary `?` vs `?.`, JSX text, HTML comments.
      "let a = b\n++c\nconst t = `x${a}y\\n`\nconst r = a / 2 / 3, s = /re[/]g/.test(t)\nx = a ? .5 : b?.c\n<!-- old\nconst j = <div>\n  hi {a} &amp; <b/>\n</div>\nif (a) b\nelse c\nfor (const k in o) {}\n",
      "function f( { return 1 }\nclass { #x = 1; static { y() } }\nconst o = { a: 1,, b }",
      "a\ninstanceof B\na\nin b\n/* c\n */ d",
      // U+0363 is alphabetic to JS but not to musl: `in` stays a keyword, as in web-tree-sitter.
      "a\nin\u0363 b",
      // U+0660 is alphabetic to musl only: `in٠` is one identifier, so no semicolon is inserted.
      "a\nin\u0660 b\na\ninstanceof\u0660 c",
      // An unclosed template substitution runs the template-chars scanner into end of input.
      "const t = `a${b + `c${d`\n",
      // ASI branches: a newline before `(`, `[`, `++`, `-`, `.`, `?`, `!=` and a `return` with no value.
      "a\n(b)\nc\n[d]\ne\n++f\ng\n-h\ni\n.j\nk\n? l : m\nn\n!= o\nfunction p() { return\nq }\n",
      // Recovery inside nested statements: an unclosed condition and a stray `else`.
      "if (a { b } else }\nwhile (c) { d(\n",
    ],
  ],
  typescript: [
    typescript,
    [
      // Optional `?:` vs ternary, object-pattern annotations, signatures without bodies, generics vs `<`.
      "type F = ({a}: {a: number}) => number\ninterface I { x?: string; m(a?, b?): void }\nfunction f(a: number): void\nfunction f(a) {}\nconst y = a ? b : c\nconst z = f<T>(1) < 2\nabstract class C<T extends {}> implements I { private readonly x?: T; }\n",
      "let x: = 1\nfunction g(a: , b) { return }\nenum E { A = 1,, B }\n",
      // musl's iswalpha, not \p{Alphabetic}, decides whether `in`/`instanceof` end at the next character.
      "a\nin\u0363 b\na\nin\u0660 b",
      // An unclosed template literal: template chars reach end of input inside a substitution.
      "let s = `x${y}` + `unterminated ${z",
      // Function-signature ASI inside a class body, and a broken generic parameter list.
      "class C { m(): void\n  n() {} }\nfunction f<T(a: T): {\n",
    ],
  ],
  tsx: [
    tsx,
    [
      "const a = <A<T> b={1} {...c}>\n  text {d}\n  <>frag</>\n</A>\nconst g = <T,>(x: T) => x\n",
      "const b = <div>unclosed {x</div>\n",
      // An unclosed template inside a JSX expression, then a mismatched closing tag.
      "const c = <div>{`a${</span>\n",
      // Multi-line JSX text becomes one collapsed label in the SyntaxTree; `in٠` stays one identifier.
      "const d = <a>\n  <b/>\n  x  y\n</a>\na\nin\u0660 b",
    ],
  ],
  python: [
    python,
    [
      // Indent and dedent around comments, line continuations, f-strings with {{ escapes, raw and bytes strings.
      'def f(a,\n      b):\n    if a:\n        return b\n  # odd comment\n    x = 1 \\\n        + 2\n    return f"{a!r:>{b}} {{lit}}" + rb"\\q" + b"\\N" + """\ntriple "" x"""\n\nclass C:\n\tpass\n',
      "def g(:\n    x = [1, 2\ny = 'unterminated\n  z = f'{a'\n",
      // A broken parameter list followed by a dedent to a column no open block started at.
      "def f(:\n  x\n y\n",
      // A dedent mismatch inside nested blocks, then a return to the outer level.
      "if a:\n    if b:\n        c\n      d\n    e\nf\n",
      // An open bracket spanning a dedent: the scanner must not emit INDENT/DEDENT inside it.
      "class C:\n    def f(self):\n        return (\n    x = 1\n",
      // Tabs and spaces mixed, and an unterminated f-string replacement field.
      'if a:\n\tb\n        c\nd = f"{e"\n',
    ],
  ],
};

// Cases native tree-sitter cannot judge, still run by the nesting test below. The port follows web-tree-sitter
// 0.27, whose scanners call musl's <wctype.h>; the CLI's grammar library calls the host libc's (the Windows CRT
// disagrees on both), so U+0363 and U+0660 classify per platform (wctype.test.ts pins musl's answer instead).
const NOT_NATIVE = /[ͣ٠]/;

// The reference is the tree-sitter CLI and a zig-built grammar, both pinned in mise.toml. A machine without them
// skips the comparison, loudly, rather than passing it.
const missing = referenceMissing();
if (missing) console.warn(`skipping the native parity tests: ${missing}`);

for (const [grammar, [lang, texts]] of Object.entries(CASES) as [
  GrammarName,
  [Language, string[]],
][]) {
  test(`the ${grammar} tree matches native tree-sitter node for node, broken inputs included`, async (ctx) => {
    if (missing) ctx.skip(missing);
    const r = await checkParity(
      grammar,
      texts.map((text, i) => ({ name: `case${i}`, text })).filter(({ text }) => !NOT_NATIVE.test(text)),
      lang,
    );
    expect(
      r.divergences.map(
        (d) =>
          `${d.input.name} ${d.stage} at ${d.index}: ${d.expected[d.index]} vs ${d.actual[d.index]}${d.error ? ` threw ${d.error}` : ""}`,
      ),
    ).toEqual([]);
  });

  // fmt's `check` reads each non-blank character as part of exactly one token (a leaf, or a node holding text of
  // its own); a node outside its parent, children out of order or overlapping, or text outside the root would
  // let a formatter drop or repeat that text unseen.
  test(`the ${grammar} tree nests every node inside its parent in order, under a root that holds every non-blank character`, () => {
    for (const text of texts) {
      const root = parse(lang, text).nodes[0];
      const broken: string[] = [];
      if (root) {
        if (/\S/.test(text.slice(0, root.start) + text.slice(root.end)))
          broken.push(`text outside the root ${root.start}-${root.end}`);
        const stack = [root];
        for (let n = stack.pop(); n; n = stack.pop()) {
          let at = n.start;
          for (const c of n.children) {
            if (c.start < at || c.end > n.end || c.end < c.start)
              broken.push(
                `${c.kind} ${c.start}-${c.end} in ${n.kind} ${n.start}-${n.end} after ${at}`,
              );
            at = c.end;
            stack.push(c);
          }
        }
      } else if (/\S/.test(text)) broken.push("no root");
      expect(broken, JSON.stringify(text)).toEqual([]);
    }
  });
}
