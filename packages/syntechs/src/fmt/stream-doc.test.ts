import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type Language as Parser, parseTree } from "../core/index.js";
import { javascript } from "../grammars/javascript/fmt.js";
import { language as jsParser } from "../grammars/javascript/index.js";
import { language as tsxParser } from "../grammars/tsx/index.js";
import { tsx, typescript } from "../grammars/typescript/fmt.js";
import { language as tsParser } from "../grammars/typescript/index.js";
import type * as Util from "../grammars/javascript/print/util.js";
import type { Doc } from "./doc.js";
import { format } from "./format.js";
import type * as Printer from "./printer.js";
import type { Layout } from "./printer.js";
import type * as Stream from "./stream.js";
import { closeDead, openDead, printStream, resetStream } from "./stream.js";
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

// Each part the JS printer runs removeLines on, by the part removeLines rebuilt: `sDoc` appends the part itself
// in a flat interval, which must print what the rebuilt part prints.
const flattened = new Map<Doc, Doc>();
vi.mock("../grammars/javascript/print/util.js", async (importOriginal) => {
  const real = await importOriginal<typeof Util>();
  return {
    ...real,
    removeLines(doc: Doc) {
      const out = real.removeLines(doc);
      if (out !== doc) flattened.set(out, doc);
      return out;
    },
  };
});

// Parts abandoned mid-build, as the JS printer abandons an argument it printed expanded (ArgExpansionBailout),
// which must change nothing the live copy prints. Before its live copy each Doc is lowered twice inside a dead
// interval: whole, and abandoned halfway with its intervals left open (`sToken` counts the tokens sDoc writes
// and throws at `abortAt`). And before each live token goes a dead part a counter it leaked would show in: a
// wide text, a forced break, and a group and an indent left open.
class Abandoned extends Error {}
let tokens = 0;
let abortAt = -1;
let live = false;
vi.mock("./stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof Stream>();
  return {
    ...real,
    sToken(...a: Parameters<typeof real.sToken>) {
      if (tokens++ === abortAt) throw new Abandoned();
      if (live) {
        const d = real.openDead();
        real.open(real.GROUP);
        real.sText("x".repeat(100));
        real.sLine(real.HARD);
        real.sBreakParent();
        real.open(real.INDENT);
        real.sLine(real.SOFT);
        real.closeDead(d);
      }
      real.sToken(...a);
    },
  };
});

function lowerDead(doc: Doc, flat: ReadonlyMap<Doc, Doc>): boolean {
  tokens = 0;
  let d = openDead();
  sDoc(doc, flat);
  closeDead(d);
  if (tokens < 2) return false;
  abortAt = tokens >> 1;
  tokens = 0;
  d = openDead();
  try {
    sDoc(doc, flat);
    throw new Error("stream-doc.test: the abandoned copy ran to its end");
  } catch (e) {
    if (!(e instanceof Abandoned)) throw e;
  } finally {
    abortAt = -1;
  }
  closeDead(d);
  return true;
}

interface Tally {
  docs: number;
  covered: number;
  skipped: Map<string, number>;
  differ: string[];
  /** Parts removeLines rebuilt, which the stream printed flat instead. */
  flattened: number;
  /** Docs whose abandoned copy stopped halfway. */
  abandoned: number;
}

function compare(name: string, tally: Tally, run: () => void) {
  onPrint = (doc, layout) => {
    tally.docs++;
    const flat = new Map(flattened);
    flattened.clear();
    tally.flattened += flat.size;
    let stream: ReturnType<typeof printStream>;
    try {
      resetStream(layout.ruff);
      if (lowerDead(doc, flat)) tally.abandoned++;
      live = true;
      try {
        sDoc(doc, flat);
      } finally {
        live = false;
      }
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
    `${label}: ${t.covered}/${t.docs} docs lowered, ${t.flattened} flattened, ${t.abandoned} abandoned halfway, ${t.differ.length} differ; skipped: ${skipped.map(([k, v]) => `${k} ${v}`).join(", ")}`,
  );
  if (t.differ.length) console.log(`${label} differ:`, t.differ.slice(0, 20));
}

const newTally = (): Tally => ({
  docs: 0,
  covered: 0,
  skipped: new Map(),
  differ: [],
  flattened: 0,
  abandoned: 0,
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
      // The flat parts were compared at all: a removeLines call the mock no longer sees leaves none.
      expect(tally.flattened).toBeGreaterThan(0);
      expect(tally.abandoned).toBeGreaterThan(0);
    }, 600_000);
  },
);

// [lowered, printed]: the Docs the stream prints, of all the formatter printed.
const JS_COVERED = [2260, 2260];
