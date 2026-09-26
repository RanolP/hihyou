import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { ruffSuite } from "../../fmt/conformance/ruff.node.js";
import { format } from "../../fmt/format.js";
import { type PythonOptions, python } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with ruff 0.16.8, measured on ruff's own formatter fixtures (fetched by fetch-corpus.sh, so this
// runs where the corpus is). `fmt-parity.passing.json` pins every `fixture#options` run whose output is
// byte-identical to ruff's recorded one: a regression drops a run from it and fails, and a newly passing run
// fails too until the list is regenerated with `UPDATE_RATCHET=1`, so the count only moves on purpose.

const formatterRoot = join(
  import.meta.dirname,
  "../../../corpus/ruff-0.16.8/crates/ruff_python_formatter",
);
const present = existsSync(formatterRoot);
const pinnedFile = join(import.meta.dirname, "fmt-parity.passing.json");

function ours(text: string, options: Partial<PythonOptions>): string {
  const root = parse(language, text).nodes[0];
  if (!root) throw new Error("empty tree");
  const out = format(root, text, python, options);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  return out.text;
}

describe.skipIf(!present)(
  "ruff's formatter fixtures keep their pinned set of byte-identical runs, so a Python layout regression fails",
  () => {
    it("matches the pinned passing list, and each passing output keeps the input's meaning", () => {
      const passing: string[] = [];
      const broken: string[] = [];
      for (const c of ruffSuite(formatterRoot).cases)
        for (const r of c.runs) {
          let out: string;
          try {
            out = ours(c.text, r.options as Partial<PythonOptions>);
          } catch {
            continue;
          }
          if (r.asRecorded(out) !== r.expected) continue;
          const id = `${c.fixture}#${r.label}`;
          passing.push(id);
          const problem = check(python, c.text, out);
          if (problem) broken.push(`${id}: ${problem}`);
        }
      passing.sort();
      if (process.env.UPDATE_RATCHET)
        writeFileSync(pinnedFile, `${JSON.stringify(passing, null, 1)}\n`);
      const pinned: string[] = JSON.parse(readFileSync(pinnedFile, "utf8"));
      expect(broken).toEqual([]);
      expect(passing).toEqual(pinned);
    }, 120_000);
  },
);

// Meaning the normalizer must keep apart: a dedent that moves a statement out of its block.
describe("check tells indentation apart, so a re-indent that changes a block's extent is refused", () => {
  it("`c` inside and outside the `if`", () => {
    expect(
      check(python, "if a:\n    b\nc\n", "if a:\n    b\n    c\n"),
    ).toBeTruthy();
  });
  it("a body moved off its header line", () => {
    expect(check(python, "if a: b\nc\n", "if a:\n    b\nc\n")).toBeUndefined();
  });
});

const edgeCases: [string, string, string][] = [
  [
    "simple statements",
    "import os\nfrom a import (b,c)\npass\n",
    "import os\nfrom a import b, c\n\npass\n",
  ],
  ["return tuple", "return 1,2\n", "return 1, 2\n"],
  ["only comments", "# a\n", "# a\n"],
];

describe("small inputs lay out as ruff does", () => {
  it.each(edgeCases)("%s", (_, text, expected) => {
    const out = ours(text, {});
    expect(out).toBe(expected);
    expect(check(python, text, out)).toBeUndefined();
  });
});
