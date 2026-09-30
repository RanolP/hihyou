import { describe, expect, it } from "vitest";
import {
  readSnapshots,
  snapshotOutput,
  titleOptions,
  visualizeEndOfLine,
} from "./prettier.node.js";
import { lineRatio, readHeader, renderSnapshot } from "./report.node.js";
import { oxfmt } from "./references.node.js";
import { pythonFrameAfter } from "./ruff.node.js";

describe("conformance harness", () => {
  it("scores line similarity the way oxc's match ratio does, so the committed percentages stay comparable", () => {
    expect(lineRatio("a\nb\n", "a\nb\n")).toBe(1);
    expect(lineRatio("a\nb\nc\nd\n", "a\nX\nc\nd\n")).toBe(0.75);
    expect(lineRatio("", "")).toBe(1);
  });

  it("reads prettier's expected output out of a snapshot entry, not its input or options block", () => {
    // tests/config/format-test/create-snapshot.js, for an `endOfLine` spec with an input that holds `=` rules.
    const sep = (t = "") => {
      const l = Math.floor((80 - t.length) / 2);
      return "=".repeat(l) + t + "=".repeat(80 - l - t.length);
    };
    const input = `a {}<CRLF>\n/* ${"=".repeat(80)} */<CRLF>\n`;
    const output = "a {\n}<LF>\n";
    const snap = `exports[\`x.css - {"endOfLine":"lf"} format 1\`] = \`
${sep("options")}
endOfLine: "lf"
parsers: ["css"]
${"printWidth: 80 (default) |".padStart(80)}
${sep("input")}
${input}${sep("output")}
${output}
${sep()}
\`;
`;
    const entry =
      readSnapshots(snap)[
        `x.css - ${titleOptions({ endOfLine: "lf" })} format 1`
      ];
    expect(entry && snapshotOutput(entry)).toBe(output);
    expect(visualizeEndOfLine("a {\r\n}\n")).toBe("a {<CRLF>\n}<LF>\n");
  });

  it("titles a spec's options as prettier's jest titles do, or every such fixture misses its snapshot entry", () => {
    expect(titleOptions({})).toBe("");
    expect(
      titleOptions({
        printWidth: Number.POSITIVE_INFINITY,
        errors: { css: true },
      }),
    ).toBe('{"printWidth":"Infinity"}');
  });

  it("keeps a ruff output frame whole when a docstring inside it holds a ``` fence", () => {
    const code = 'x = """\n```python\ny = 1\n```\n\n## Output\n"""\n';
    const snap = `## Input\n\`\`\`python\nx\n\`\`\`\n\n## Outputs\n### Output 1\n\`\`\`\nopts\n\`\`\`\n\n\`\`\`python\n${code}\`\`\`\n\n\n### Output 2\n\`\`\`\nopts\n\`\`\`\n\n\`\`\`python\n\`\`\`\n\n`;
    expect(pythonFrameAfter(snap, "### Output 1\n")).toBe(code);
    expect(pythonFrameAfter(snap, "### Output 2\n")).toBe("");
  });

  it("reads back the scores a snapshot states, so the matrix never drops or misreads a language or a reference column", () => {
    const references = [
      { name: "oxfmt 0.70.0", passed: 2, total: 3 },
      { name: "dprint dprint-plugin-json 0.24.0", passed: 0, total: 3 },
    ];
    const snapshot = renderSnapshot({
      id: "css",
      source: "s",
      results: [
        { fixture: "a", runs: [{ label: "{}", outcome: "pass", ratio: 1 }] },
        { fixture: "b", runs: [{ label: "{}", outcome: "fail", ratio: 0.5 }] },
        {
          fixture: "c",
          runs: [{ label: "{}", outcome: "refused", ratio: 0.1, why: "x" }],
        },
      ],
      excluded: [{ fixture: "d", reason: "r" }],
      references,
    });
    expect(readHeader(snapshot)).toEqual({
      score: { passed: 1, total: 3, refused: 1, excluded: 1 },
      references,
    });
    expect(
      readHeader(
        renderSnapshot({
          id: "js",
          source: "s",
          results: "not implemented",
          excluded: [],
          references: [],
        }),
      ),
    ).toEqual({ references: [] });
  });

  it("runs oxfmt at prettier's printWidth and under prettier's parser, or its column scores oxfmt's defaults instead of its formatting", async () => {
    // 90 columns: prettier's 80 breaks it, oxfmt's own default of 100 would not.
    const wide = `[${"1234567890, ".repeat(7)}1]\n`;
    expect(await oxfmt.format("a.json", wide, {})).not.toBe(wide);
    expect(
      await oxfmt.format("a.json", '{\n"k": 1}\n', {
        parser: "jsonc",
        trailingComma: "all",
      }),
    ).toBe('{\n  "k": 1,\n}\n');
    expect(
      await oxfmt.format("a.json", "[[1]]\n", { parser: "json-stringify" }),
    ).toBe("[\n  [\n    1\n  ]\n]\n");
  });
});
