// Prettier's own format tests (tests/format/**), read the way its jest harness (tests/config/format-test) runs
// them: each directory's format.test.js calls runFormatTest(import.meta, parsers, options) once per option set,
// and its __snapshots__/format.test.js.snap holds the expected output of every file under each call.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { Excluded } from "./report.node.js";

export interface CaseRun {
  /** The options as the spec wrote them, `{}` for prettier's defaults. */
  label: string;
  options: Record<string, unknown>;
  expected: string;
  /**
   * An output as the reference's snapshot records it: prettier's writes each line break as `<LF>`/`<CRLF>`/`<CR>`
   * when the spec sets `endOfLine`; insta (ruff) stores every `
` as `
`.
   */
  asRecorded: (output: string) => string;
}

export interface Case {
  /** The fixture's path under the suite root, as the reports name it. */
  fixture: string;
  file: string;
  text: string;
  runs: CaseRun[];
}

export interface Suite {
  cases: Case[];
  excluded: Excluded[];
}

interface SpecCall {
  parsers: string[];
  options: Record<string, unknown>;
}

/**
 * Runs the spec with a stub `runFormatTest` that records its calls. Specs are plain calls, some behind a
 * `const parsers = [...]`; the few that import a helper (`outdent`) use it only for snippets.
 */
export function readSpec(specPath: string): SpecCall[] {
  const calls: SpecCall[] = [];
  const source = readFileSync(specPath, "utf8")
    .replace(/^import\s[^;]*;/gm, "")
    .replaceAll("import.meta", "__importMeta");
  // A call with `{ importMeta, snippets }` runs the directory's files too; its inline snippets have no
  // snapshot file of their own to read and are not counted.
  const record = (
    _fixtures: unknown,
    parsers: string[],
    options: Record<string, unknown> = {},
  ) => {
    calls.push({ parsers, options });
  };
  const outdent = (s: TemplateStringsArray, ...v: unknown[]) =>
    String.raw(s, ...v);
  new Function("runFormatTest", "__importMeta", "outdent", source)(
    record,
    { url: pathToFileURL(specPath).href },
    outdent,
  );
  return calls;
}

// tests/config/format-test/stringify-options-for-title.js
export function titleOptions(options: Record<string, unknown>): string {
  const s = JSON.stringify(options, (key, value) =>
    key === "plugins" || key === "errors"
      ? undefined
      : value === Number.POSITIVE_INFINITY
        ? "Infinity"
        : value,
  );
  return s === "{}" ? "" : s;
}

/** Evaluates a jest snapshot file (`exports[\`name\`] = \`...\`;`) into its entries. */
export function readSnapshots(snapText: string): Record<string, string> {
  const exports: Record<string, string> = {};
  new Function("exports", snapText)(exports);
  return exports;
}

const separator = (title = "") => {
  const left = Math.floor((80 - title.length) / 2);
  return "=".repeat(left) + title + "=".repeat(80 - left - title.length);
};

/** The formatted output inside one snapshot entry (tests/config/format-test/create-snapshot.js). */
export function snapshotOutput(entry: string): string | undefined {
  const head = `${separator("output")}\n`;
  const start = entry.indexOf(head);
  const end = entry.lastIndexOf(`\n${separator()}`);
  if (start === -1 || end < start + head.length - 1) return undefined;
  return entry.slice(start + head.length, end);
}

// tests/config/format-test/visualize-end-of-line.js
export const visualizeEndOfLine = (text: string) =>
  text.replace(
    /\r\n?|\n/g,
    (eol) => `${eol === "\n" ? "<LF>" : eol === "\r\n" ? "<CRLF>" : "<CR>"}\n`,
  );

// tests/config/format-test/utilities.js shouldThrowOnFormat
function expectsError(
  options: Record<string, unknown>,
  parser: string,
  file: string,
): boolean {
  const errors = options.errors as
    | true
    | Record<string, true | string[]>
    | undefined;
  if (errors === true) return true;
  const files = errors?.[parser];
  return files === true || (Array.isArray(files) && files.includes(file));
}

const PLACEHOLDERS = [
  "<|>",
  "<<<PRETTIER_RANGE_START>>>",
  "<<<PRETTIER_RANGE_END>>>",
];

export interface PrettierTarget {
  /** Directories under tests/format whose specs are read, recursively. */
  dirs: string[];
  /** A spec call counts when it lists one of these parsers; the first it lists decides `errors`. */
  parsers: string[];
  /** Fixture paths (under tests/format) that contain one of these are excluded as `ignored syntax`. */
  ignore: readonly string[];
}

/**
 * Every fixture file × every spec call of `target`'s parsers, with its expected output. Excluded, each with its
 * reason: fixtures in `target.ignore`; fixtures carrying a cursor or range placeholder (prettier formats only
 * part of those); fixtures the spec expects our parser to reject (`errors`); fixtures with no snapshot entry;
 * specs that cannot be evaluated. Specs that list none of the target's parsers (flow-only, scss, less) and
 * inline snippets are not the target's and are not counted at all.
 */
export function prettierSuite(
  formatRoot: string,
  target: PrettierTarget,
): Suite {
  const cases: Case[] = [];
  const excluded: Excluded[] = [];
  const specDirs = target.dirs.flatMap((d) =>
    specDirectories(join(formatRoot, d)),
  );
  for (const dir of specDirs) {
    const name = (f: string) =>
      relative(formatRoot, join(dir, f)).replaceAll("\\", "/");
    const files = readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          !e.name.startsWith(".") &&
          e.name !== "format.test.js" &&
          e.name !== "debug.log" &&
          !e.name.endsWith(".snap"),
      )
      .map((e) => e.name)
      .sort();
    let calls: SpecCall[];
    try {
      calls = readSpec(join(dir, "format.test.js"));
    } catch (e) {
      for (const f of files)
        excluded.push({
          fixture: name(f),
          reason: `spec not evaluable (${String(e)})`,
        });
      continue;
    }
    const ours = calls.filter((c) =>
      c.parsers.some((p) => target.parsers.includes(p)),
    );
    // tests/config/format-test/run-format-test.js: every call in an `_errors_` directory expects a throw.
    const errorDir = /[\\/]_errors_(?:[\\/]|$)/.test(dir);
    if (ours.length === 0 || files.length === 0) continue;
    const snapPath = join(dir, "__snapshots__", "format.test.js.snap");
    const snaps = existsSync(snapPath)
      ? readSnapshots(readFileSync(snapPath, "utf8"))
      : {};
    for (const f of files) {
      const fixture = name(f);
      if (target.ignore.some((s) => fixture.includes(s))) {
        excluded.push({
          fixture,
          reason: "ignored syntax (not in the grammar or not the parser's)",
        });
        continue;
      }
      const text = readFileSync(join(dir, f), "utf8");
      if (PLACEHOLDERS.some((p) => text.includes(p))) {
        excluded.push({ fixture, reason: "cursor or range formatting" });
        continue;
      }
      const runs: CaseRun[] = [];
      let skip: string | undefined;
      // Jest numbers repeated titles: a second call with the same options is `... format 2`.
      const seen = new Map<string, number>();
      for (const call of calls) {
        const title = titleOptions(call.options);
        const n = (seen.get(title) ?? 0) + 1;
        seen.set(title, n);
        if (!ours.includes(call)) continue;
        const parser = call.parsers.find((p) =>
          target.parsers.includes(p),
        ) as string;
        if (errorDir || expectsError(call.options, parser, f)) {
          skip = "the spec expects the parser to reject it";
          continue;
        }
        const entry = snaps[`${f}${title ? ` - ${title}` : ""} format ${n}`];
        const expected =
          entry === undefined ? undefined : snapshotOutput(entry);
        if (expected === undefined) {
          skip = "no snapshot entry";
          continue;
        }
        const { errors: _, ...options } = call.options;
        runs.push({
          label: title || "{}",
          options,
          expected,
          asRecorded:
            "endOfLine" in call.options ? visualizeEndOfLine : (s) => s,
        });
      }
      if (runs.length === 0)
        excluded.push({ fixture, reason: skip ?? "no snapshot entry" });
      else cases.push({ fixture, file: join(dir, f), text, runs });
    }
  }
  return { cases, excluded };
}

function specDirectories(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    if (existsSync(join(dir, "format.test.js"))) out.push(dir);
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory() && e.name !== "__snapshots__")
        walk(join(dir, e.name));
  };
  walk(root);
  return out.sort();
}
