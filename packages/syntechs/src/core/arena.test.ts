import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { language as css } from "../grammars/css/index.js";
import { language as javascript } from "../grammars/javascript/index.js";
import { language as json } from "../grammars/json/index.js";
import { language as python } from "../grammars/python/index.js";
import { language as tsx } from "../grammars/tsx/index.js";
import { language as typescript } from "../grammars/typescript/index.js";
import { fromSyntaxTree, NO_NODE, type Tree } from "./arena.js";
import { benchFiles, brokenInputs, FETCHED, type GrammarName } from "./corpus.node.js";
import { parse, type SyntaxNode } from "./index.js";
import type { Language } from "./language.js";
import { parseSubtree } from "./parser.js";
import { buildTree } from "./tree.js";

/** Each accessor's answer for `h` against the SyntaxNode `n` it was converted from, with the lf and ordinal re-derived from the source and the object tree; one line per disagreement. */
function divergences(lang: Language, text: string): string[] {
  const tree = parse(lang, text);
  const t: Tree = fromSyntaxTree(lang, tree, text);
  const out: string[] = [];
  if (t.nodeCount !== tree.nodes.length)
    out.push(`nodeCount ${t.nodeCount} vs ${tree.nodes.length}`);
  if (t.errorChars !== tree.errorChars)
    out.push(`errorChars ${t.errorChars} vs ${tree.errorChars}`);

  // buildTree, straight from the parser, writes the same words as the conversion from the object tree.
  const built = buildTree(lang, parseSubtree(lang, text), text);
  if (built.errorChars !== t.errorChars)
    out.push(`buildTree errorChars ${built.errorChars} vs ${t.errorChars}`);
  if (built.root !== t.root) out.push(`buildTree root ${built.root} vs ${t.root}`);
  const words = (x: Tree) => (x as unknown as { data: Uint32Array }).data;
  const a = words(built);
  const b = words(t);
  for (let w = 0; w <= t.root + 5 + t.count(t.root); w++)
    if (a[w] !== b[w]) {
      out.push(`buildTree word ${w}: ${a[w]} vs ${b[w]}`);
      break;
    }

  // Newlines before each leaf back to the previous one, counted with a regex rather than the builder's loop;
  // by preorder id, where an inner node's first leaf comes after it.
  const lf = new Int8Array(tree.nodes.length);
  let prevEnd = 0;
  for (const n of tree.nodes)
    if (n.children.length === 0) {
      const gap = text.slice(prevEnd, n.start);
      lf[n.id] = Math.min(3, gap.match(/\r\n|\r|\n/g)?.length ?? 0);
      prevEnd = n.end;
    }
  for (let id = tree.nodes.length - 1; id >= 0; id--) {
    const first = (tree.nodes[id] as SyntaxNode).children[0];
    if (first) lf[id] = lf[first.id] as number;
  }

  const check = (n: SyntaxNode, what: string, got: unknown, want: unknown) => {
    if (got !== want)
      out.push(`${n.kind}@${n.start} ${what}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
  };
  // Postorder over both trees at once, iteratively: broken inputs nest deeper than the call stack allows.
  let ord = 0;
  const nodes: SyntaxNode[] = [tree.nodes[0] as SyntaxNode];
  const handles: number[] = [t.root];
  const next: number[] = [0];
  while (nodes.length > 0) {
    const d = nodes.length - 1;
    const n = nodes[d] as SyntaxNode;
    const h = handles[d] as number;
    const i = next[d] as number;
    if (i === 0) check(n, "count", t.count(h), n.children.length);
    if (i < n.children.length && i < t.count(h)) {
      next[d] = i + 1;
      nodes.push(n.children[i] as SyntaxNode);
      handles.push(t.child(h, i));
      next.push(0);
      continue;
    }
    nodes.pop();
    handles.pop();
    next.pop();
    check(n, "parent", t.parent(h), d === 0 ? NO_NODE : handles[d - 1]);
    check(n, "kindName", t.kindName(h), n.kind);
    check(n, "named", t.named(h), n.named);
    check(n, "missing", t.missing(h), n.missing);
    check(n, "fieldName", t.fieldName(h), n.field);
    check(n, "start", t.start(h), n.start);
    check(n, "end", t.end(h), n.end);
    check(n, "label", t.label(h), n.label);
    // An inner node's text is the same slice as its start and end, already checked; comparing two long
    // slices char by char at every level would make the check quadratic in depth.
    if (n.children.length === 0) check(n, "text", t.text(h), text.slice(n.start, n.end));
    check(n, "lf", t.lf(h), lf[n.id]);
    check(n, "ord", t.ord(h), ord);
    check(n, "at", t.at(ord), h);
    ord++;
    if (out.length >= 20) break;
  }
  return out;
}

// Snippets that reach every head bit and record shape: fields, MISSING and ERROR nodes, aliases, comments
// between blank lines, CRLF and more than three newlines (lf clamps at 3), fixed and variable tokens, a
// CSS float_value whose number no child covers, and JSX text whose label collapses.
const CASES: [GrammarName, Language, string[]][] = [
  ["json", json, ['// c\r\n\r\n{"a": [1, -2.5e3,, true],\n\n\n\n\n /* b */ "b" 4}\n', ""]],
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
    ["type F = ({a}: {a: number}) => number\r\n\r\ninterface I { x?: string }\nlet x: = 1\n"],
  ],
  [
    "tsx",
    tsx,
    ["const a = <A<T> b={1}>\n  text  {d}\n  <>frag</>\n</A>\nconst b = <div>unclosed {x</div>\n"],
  ],
  [
    "python",
    python,
    ['def f(a,\n      b):\n    # c\n\n\n\n    return f"{a!r}"\nclass C:\n\tpass\ndef g(:\n'],
  ],
];

// A regression here is an accessor that misreads the record the builder wrote: a field id spilling into the
// flag bits, a parent patched to the wrong record, a fixed token answering the wrong text, an lf off by a
// CRLF, or an ordinal that is not the node's postorder index. The formatter and the diff would then read a
// different tree from the one they read through SyntaxNode, with no error.
for (const [grammar, lang, texts] of CASES) {
  test(`the ${grammar} arena answers every accessor as its SyntaxTree does, for every node`, () => {
    for (const text of texts) expect(divergences(lang, text), JSON.stringify(text)).toEqual([]);
  });

  // The corpus is gitignored, so this runs where research/parser-bench/fetch-inputs.sh and fetch-corpus.sh
  // have run: large real files and broken windows of them. The repo's own files, which `corpus()` adds, would
  // triple the run for shapes these already cover.
  describe.skipIf(!FETCHED[grammar].every((f) => existsSync(f)))(
    `the ${grammar} arena over the fetched corpus`,
    () => {
      test("answers every accessor as its SyntaxTree does, for every node", () => {
        const whole = benchFiles(grammar);
        for (const input of [...whole, ...brokenInputs(whole, 20)])
          expect(divergences(lang, input.text), input.name).toEqual([]);
      }, 60_000);
    },
  );
}
