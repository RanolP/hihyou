import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { language as css } from "../grammars/css/index.js";
import { language as javascript } from "../grammars/javascript/index.js";
import { language as json } from "../grammars/json/index.js";
import { language as python } from "../grammars/python/index.js";
import { language as tsx } from "../grammars/tsx/index.js";
import { language as typescript } from "../grammars/typescript/index.js";
import { NO_NODE } from "./arena.js";
import {
  benchFiles,
  brokenInputs,
  FETCHED,
  type GrammarName,
} from "./corpus.node.js";
import { parseTree } from "./index.js";
import type { Language } from "./language.js";

/**
 * Each accessor's answer for every node against what a postorder walk over `count` and `child` and the source
 * say: the parent, the ordinal both ways, a leaf's text, an inner node's empty label, and the lf re-derived from
 * the source; one line per disagreement. Kinds, fields, flags, ranges and labels are pinned against native
 * tree-sitter by parity.test.ts.
 */
function divergences(lang: Language, text: string): string[] {
  const t = parseTree(lang, text);
  const out: string[] = [];
  const check = (h: number, what: string, got: unknown, want: unknown) => {
    if (got !== want)
      out.push(
        `${t.kindName(h)}@${t.start(h)} ${what}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`,
      );
  };
  // Newlines before each leaf back to the previous one, counted with a regex rather than the builder's loop;
  // an inner node takes its first child's, which leaves before it.
  const lf = new Map<number, number>();
  let prevEnd = 0;
  // Postorder, iteratively: broken inputs nest deeper than the call stack allows.
  let ord = 0;
  const handles: number[] = [t.root];
  const next: number[] = [0];
  check(t.root, "parent", t.parent(t.root), NO_NODE);
  while (handles.length > 0) {
    const d = handles.length - 1;
    const h = handles[d] as number;
    const i = next[d] as number;
    if (i < t.count(h)) {
      next[d] = i + 1;
      const c = t.child(h, i);
      check(c, "parent", t.parent(c), h);
      handles.push(c);
      next.push(0);
      continue;
    }
    handles.pop();
    next.pop();
    if (t.count(h) === 0) {
      const gap = text.slice(prevEnd, t.start(h));
      lf.set(h, Math.min(3, gap.match(/\r\n|\r|\n/g)?.length ?? 0));
      prevEnd = t.end(h);
      check(h, "text", t.text(h), text.slice(t.start(h), t.end(h)));
    } else {
      lf.set(h, lf.get(t.child(h, 0)) as number);
      check(h, "label", t.label(h), "");
    }
    check(h, "lf", t.lf(h), lf.get(h));
    check(h, "ord", t.ord(h), ord);
    check(h, "at", t.at(ord), h);
    ord++;
    if (out.length >= 20) break;
  }
  if (out.length < 20 && ord !== t.nodeCount)
    out.push(`nodeCount ${t.nodeCount} vs ${ord} reached`);
  return out;
}

// Snippets that reach every head bit and record shape: fields, MISSING and ERROR nodes, aliases, comments
// between blank lines, CRLF and more than three newlines (lf clamps at 3), fixed and variable tokens, a
// CSS float_value whose number no child covers, and JSX text whose label collapses.
const CASES: [GrammarName, Language, string[]][] = [
  [
    "json",
    json,
    ['// c\r\n\r\n{"a": [1, -2.5e3,, true],\n\n\n\n\n /* b */ "b" 4}\n', ""],
  ],
  [
    "css",
    css,
    [
      "a b > c:hover, #x .y[z='1'] {\n  margin: 1.5em auto;\n\n  /* c */\n  top: calc(1px + 2%)\n}\n@media (min-width: 10px) { a { color: ; } }\n",
    ],
  ],
  [
    "javascript",
    javascript,
    [
      "let a = b\n++c\n\n\n\n// x\nconst o = { a: 1,, b }\nconst j = <div>\n  hi {a} &amp;\n</div>\nif (a { b }\n",
    ],
  ],
  [
    "typescript",
    typescript,
    [
      "type F = ({a}: {a: number}) => number\r\n\r\ninterface I { x?: string }\nlet x: = 1\n",
    ],
  ],
  [
    "tsx",
    tsx,
    [
      "const a = <A<T> b={1}>\n  text  {d}\n  <>frag</>\n</A>\nconst b = <div>unclosed {x</div>\n",
    ],
  ],
  [
    "python",
    python,
    [
      'def f(a,\n      b):\n    # c\n\n\n\n    return f"{a!r}"\nclass C:\n\tpass\ndef g(:\n',
    ],
  ],
];

// A regression here is an accessor that misreads the record the builder wrote: a field id spilling into the
// flag bits, a parent patched to the wrong record, a fixed token answering the wrong text, an lf off by a
// CRLF, or an ordinal that is not the node's postorder index. The formatter and the diff would then read a
// different tree from the one the parser built, with no error.
for (const [grammar, lang, texts] of CASES) {
  test(`the ${grammar} arena answers every accessor as its source and shape say, for every node`, () => {
    for (const text of texts)
      expect(divergences(lang, text), JSON.stringify(text)).toEqual([]);
  });

  // The corpus is gitignored, so this runs where research/parser-bench/fetch-inputs.sh and fetch-corpus.sh
  // have run: large real files and broken windows of them. The repo's own files, which `corpus()` adds, would
  // triple the run for shapes these already cover.
  describe.skipIf(!FETCHED[grammar].every((f) => existsSync(f)))(
    `the ${grammar} arena over the fetched corpus`,
    () => {
      test("answers every accessor as its source and shape say, for every node", () => {
        const whole = benchFiles(grammar);
        for (const input of [...whole, ...brokenInputs(whole, 20)])
          expect(divergences(lang, input.text), input.name).toEqual([]);
      }, 60_000);
    },
  );
}
