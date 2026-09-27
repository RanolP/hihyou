import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type Language as Parser, parseTree } from "../core/index.js";
import { javascript } from "../grammars/javascript/fmt.js";
import { language as jsParser } from "../grammars/javascript/index.js";
import { python } from "../grammars/python/fmt.js";
import { language as pyParser } from "../grammars/python/index.js";
import { language as tsxParser } from "../grammars/tsx/index.js";
import { tsx, typescript } from "../grammars/typescript/fmt.js";
import { language as tsParser } from "../grammars/typescript/index.js";
import { ruffSuite } from "./conformance/ruff.node.js";
import type { Doc } from "./doc.js";
import { format } from "./format.js";
import type * as Printer from "./printer.js";
import type { Layout } from "./printer.js";
import { printStream, resetStream } from "./stream.js";
import { sDoc, Unsupported } from "./stream-doc.js";

// Every Doc a Doc-based formatter prints is also lowered by `sDoc` and printed by `printStream`, before the
// printer sees it (printing marks the Doc's groups broken). The two must agree on the text and on where each
// token landed. A Doc using a construct the stream lacks is skipped and counted, and each count is pinned, so
// supporting a construct raises it on purpose and a regression that breaks lowering lowers it.

type Printed = ReturnType<typeof Printer.print>;
let onPrint:
  | ((doc: Doc, layout: Layout) => ((want: Printed) => void) | undefined)
  | undefined;
vi.mock("./printer.js", async (importOriginal) => {
  const real = await importOriginal<typeof Printer>();
  return {
    ...real,
    print(doc: Doc, layout: Layout) {
      const then = onPrint?.(doc, layout);
      const want = real.print(doc, layout);
      then?.(want);
      return want;
    },
  };
});

interface Tally {
  docs: number;
  covered: number;
  skipped: Map<string, number>;
  differ: string[];
}

function compare(name: string, tally: Tally, run: () => void) {
  onPrint = (doc, layout) => {
    tally.docs++;
    let stream: ReturnType<typeof printStream>;
    try {
      resetStream(layout.ruff);
      sDoc(doc);
      stream = printStream(layout);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      tally.skipped.set(e.message, (tally.skipped.get(e.message) ?? 0) + 1);
      return undefined;
    }
    tally.covered++;
    return (want) => {
      const same =
        stream.text === want.text &&
        stream.at.length === want.placed.at.length &&
        want.placed.tokens.every(
          (t, i) =>
            stream.nodes[i] === t.node &&
            stream.lengths[i] === t.text.length &&
            Boolean(stream.synthetic[i]) === t.synthetic &&
            stream.at[i] === want.placed.at[i],
        );
      if (!same) tally.differ.push(name);
    };
  };
  try {
    run();
  } finally {
    onPrint = undefined;
  }
}

const corpus = join(import.meta.dirname, "../../corpus");

function jsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (/\.(js|ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts"))
      out.push(p);
  }
  return out;
}

const jsTargets = {
  js: { parser: jsParser, lang: javascript },
  ts: { parser: tsParser, lang: typescript },
  tsx: { parser: tsxParser, lang: tsx },
} as const;

function jsCorpus(): [keyof typeof jsTargets, string, string][] {
  const out: [keyof typeof jsTargets, string, string][] = [];
  for (const f of ["jquery.js", "lodash.js", "App.tsx", "LayerUI.tsx"]) {
    const p = join(corpus, f);
    if (existsSync(p))
      out.push([f.endsWith(".tsx") ? "tsx" : "js", f, readFileSync(p, "utf8")]);
  }
  const format = join(corpus, "prettier-3.9.9/tests/format");
  for (const [dir, target] of [
    ["js", "js"],
    ["jsx", "js"],
    ["typescript", "ts"],
  ] as const)
    for (const p of jsFiles(join(format, dir)))
      out.push([
        p.endsWith(".tsx") ? "tsx" : target,
        p,
        readFileSync(p, "utf8"),
      ]);
  return out;
}

function report(label: string, t: Tally) {
  const skipped = [...t.skipped].sort((a, b) => b[1] - a[1]);
  console.log(
    `${label}: ${t.covered}/${t.docs} docs lowered, ${t.differ.length} differ; skipped: ${skipped.map(([k, v]) => `${k} ${v}`).join(", ")}`,
  );
  if (t.differ.length) console.log(`${label} differ:`, t.differ.slice(0, 20));
}

const newTally = (): Tally => ({
  docs: 0,
  covered: 0,
  skipped: new Map(),
  differ: [],
});

const present = existsSync(corpus);

describe.skipIf(!present)(
  "a Doc and the stream sDoc lowers it to print the same text and anchors, so a formatter can move onto the stream without a layout change",
  () => {
    it("JS/TS/TSX corpus", () => {
      const tally = newTally();
      for (const [target, name, text] of jsCorpus()) {
        const t = jsTargets[target];
        let tree: ReturnType<typeof parseTree>;
        try {
          tree = parseTree(t.parser as Parser, text);
        } catch {
          continue;
        }
        compare(name, tally, () => format(tree, t.lang, {}));
      }
      report("js", tally);
      expect(tally.differ).toEqual([]);
      expect([tally.covered, tally.docs]).toEqual(JS_COVERED);
    }, 600_000);

    it("Python corpus", () => {
      const tally = newTally();
      const root = join(corpus, "ruff-0.16.8/crates/ruff_python_formatter");
      const cases: [string, string, object][] = [];
      for (const f of ["base_events.py", "dataclasses.py", "typing.py"]) {
        const p = join(corpus, f);
        if (existsSync(p)) cases.push([f, readFileSync(p, "utf8"), {}]);
      }
      if (existsSync(root))
        for (const c of ruffSuite(root).cases)
          for (const r of c.runs)
            cases.push([`${c.fixture}#${r.label}`, c.text, r.options]);
      for (const [name, text, options] of cases) {
        const tree = parseTree(pyParser, text);
        compare(name, tally, () => format(tree, python, options));
      }
      report("python", tally);
      expect(tally.differ).toEqual([]);
      expect([tally.covered, tally.docs]).toEqual(PY_COVERED);
    }, 600_000);
  },
);

// [lowered, printed]: the Docs the stream prints, of all the formatter printed.
const JS_COVERED = [1067, 2260];
const PY_COVERED = [13, 286];
