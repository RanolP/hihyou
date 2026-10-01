// Ruff's formatter fixtures (crates/ruff_python_formatter/tests/fixtures.rs): `fixtures/black/**` expects
// Black's output (`<file>.expect`) unless an insta snapshot records where ruff deliberately differs, and
// `fixtures/ruff/**` expects the output its insta snapshot records, once per option set of `<file>.options.json`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Case, CaseRun, Suite } from "./prettier.node.js";
import type { Excluded } from "./report.node.js";

/** `PyFormatOptions` as the fixtures' `.options.json` spell it (serde names). */
type RuffTestOptions = Record<string, unknown>;

/**
 * The same option by the name `ruff.toml`'s `[format]` (and top-level `target-version`) gives it, which is
 * how the python formatter reads its options. Undefined for an option set this suite cannot run.
 */
export function ruffConfigOptions(o: RuffTestOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(o)) {
    switch (key) {
      case "line_width":
        out["line-length"] = value;
        break;
      case "indent_width":
        out["indent-width"] = value;
        break;
      case "indent_style":
        out["indent-style"] = value;
        break;
      case "quote_style":
        out["quote-style"] = value;
        break;
      case "line_ending":
        out["line-ending"] =
          value === "CarriageReturnLineFeed" ? "cr-lf" : "lf";
        break;
      case "magic_trailing_comma":
        out["skip-magic-trailing-comma"] = value === "ignore";
        break;
      case "docstring_code":
        out["docstring-code-format"] = value === "enabled";
        break;
      case "docstring_code_line_width":
        out["docstring-code-line-length"] = value;
        break;
      case "preview":
        out.preview = value === "enabled";
        break;
      case "target_version":
        out["target-version"] = `py${String(value).replace(".", "")}`;
        break;
      case "nested_string_quote_style":
        out["nested-string-quote-style"] = value;
        break;
      case "source_type":
        out["source-type"] = String(value).toLowerCase();
        break;
      default:
        throw new Error(`unknown ruff test option ${key}`);
    }
  }
  return out;
}

/**
 * The code of the ```python frame right after `heading` (fixtures.rs `CodeFrame`: "```python\n" + code +
 * "```\n\n"). The code can hold ``` lines itself (docstring examples), so the frame ends at the first fence
 * that a snapshot section or the end of the file follows.
 */
export function pythonFrameAfter(
  snapshot: string,
  heading: string,
  from = 0,
): string | undefined {
  const at = snapshot.indexOf(heading, from);
  if (at === -1) return undefined;
  const open = "```python\n";
  const start = snapshot.indexOf(open, at + heading.length);
  if (start === -1) return undefined;
  const body = start + open.length;
  const end =
    /(?:^|\n)```\n?(?=\n*(?:#{2,4} (?:Black Output|Preview changes|Output \d+|Unsupported Syntax Errors|New Unsupported Syntax Errors)\n|$))/g;
  end.lastIndex = body - 1;
  const m = end.exec(snapshot);
  if (!m) return undefined;
  return snapshot.slice(body, m.index + (m[0].startsWith("\n") ? 1 : 0));
}

/** Both ruff suites under `formatterRoot` (crates/ruff_python_formatter), each fixture named by its path there. */
export function ruffSuite(formatterRoot: string): Suite {
  const fixtures = join(formatterRoot, "resources", "test", "fixtures");
  const snapshots = join(formatterRoot, "tests", "snapshots");
  const cases: Case[] = [];
  const excluded: Excluded[] = [];
  const name = (file: string) => relative(fixtures, file).replaceAll("\\", "/");
  const readSnapshot = (file: string) =>
    existsSync(file) ? readFileSync(file, "utf8") : undefined;

  for (const file of pythonFiles(join(fixtures, "black"))) {
    const fixture = name(file);
    const test = relative(join(fixtures, "black"), file).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    const firstLine = text.split("\n", 1)[0] ?? "";
    if (
      firstLine.startsWith("# flags:") &&
      firstLine.includes("--line-ranges=")
    ) {
      excluded.push({ fixture, reason: "range formatting (the expected output formats only the range)" });
      continue;
    }
    const optionsFile = file.replace(/\.pyi?$/, ".options.json");
    const options: RuffTestOptions = existsSync(optionsFile)
      ? JSON.parse(readFileSync(optionsFile, "utf8"))
      : {};
    const snapshot = readSnapshot(
      join(snapshots, `black_compatibility@${test.replaceAll("/", "__")}.snap`),
    );
    const expected =
      snapshot === undefined
        ? readSnapshot(`${file}.expect`)
        : pythonFrameAfter(snapshot, "## Ruff Output\n");
    if (expected === undefined) {
      excluded.push({ fixture, reason: "no expected output" });
      continue;
    }
    cases.push({
      fixture,
      file,
      text,
      runs: [run(options, expected, file)],
    });
  }

  for (const file of pythonFiles(join(fixtures, "ruff"))) {
    const fixture = name(file);
    const test = relative(join(fixtures, "ruff"), file).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    if (text.includes("<RANGE_START>")) {
      excluded.push({ fixture, reason: "range formatting (the expected output formats only the range)" });
      continue;
    }
    const optionsFile = file.replace(/\.pyi?$/, ".options.json");
    const sets: RuffTestOptions[] | undefined = existsSync(optionsFile)
      ? JSON.parse(readFileSync(optionsFile, "utf8"))
      : undefined;
    const snapshot = readSnapshot(
      join(snapshots, `format@${test.replaceAll("/", "__")}.snap`),
    );
    if (snapshot === undefined) {
      excluded.push({ fixture, reason: "no expected output" });
      continue;
    }
    const runs: CaseRun[] = [];
    if (sets === undefined) {
      const expected = pythonFrameAfter(snapshot, "## Output\n");
      if (expected !== undefined) runs.push(run({}, expected, file));
    } else {
      let from = 0;
      for (const [i, options] of sets.entries()) {
        const heading = `### Output ${i + 1}\n`;
        from = snapshot.indexOf(heading, from);
        const expected =
          from === -1 ? undefined : pythonFrameAfter(snapshot, heading, from);
        if (expected === undefined) break;
        runs.push(run(options, expected, file));
      }
    }
    if (runs.length !== (sets?.length ?? 1)) {
      excluded.push({ fixture, reason: "no expected output" });
      continue;
    }
    cases.push({ fixture, file, text, runs });
  }
  return { cases, excluded };
}

const run = (options: RuffTestOptions, expected: string, file: string): CaseRun => ({
  label: Object.keys(options).length === 0 ? "{}" : JSON.stringify(options),
  // Ruff reads a `.pyi` file as a stub unless the option set names another source type.
  options: ruffConfigOptions(file.endsWith(".pyi") ? { source_type: "Stub", ...options } : options),
  expected,
  asRecorded: (s) => s.replaceAll("\r\n", "\n"),
});

function pythonFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (/\.pyi?$/.test(e.name)) out.push(join(dir, e.name));
    }
  };
  walk(root);
  return out.sort();
}
