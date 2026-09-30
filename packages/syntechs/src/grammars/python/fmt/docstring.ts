import type { PyOptions } from "./builders.js";
import type { Flags, Quote } from "./strings.js";

/**
 * Ruff's `docstring::format` (string/docstring.rs): a docstring's lines re-indented, and with
 * `docstring-code-format` the code examples in it (doctests, Markdown fences, reStructuredText literal and
 * `code-block` blocks) formatted as Python.
 */

/**
 * Formats a code example's code as a module at `width`, inside a docstring quoted by `quote`; undefined when
 * it does not parse, or its output would not parse inside such a docstring. The printer cannot format while
 * it prints, so the module rule formats every example ahead (fmt.ts) and this reads the results.
 */
export type CodeFormatter = (
  code: string,
  width: number,
  quote: Quote,
) => string | undefined;

/** Ruff's `DocstringCodeLineWidth`, by its `ruff.toml` name. */
export type CodeLineLength = number | "dynamic";

// --- Indentation ---

const TAB = 8;

/** Ruff's `Indentation`: a line's leading whitespace as spaces, tabs, tabs then spaces, spaces then tabs, or mixed. */
interface Indentation {
  readonly k: "spaces" | "tabs" | "tabSpaces" | "spacesTabs" | "mixed";
  readonly spaces: number;
  readonly tabs: number;
  /** For `mixed`: the columns and the length in characters. */
  readonly width: number;
  readonly len: number;
}

const tabOffset = (col: number) => TAB - (col % TAB);

function ind(
  k: Indentation["k"],
  spaces: number,
  tabs: number,
  width = 0,
  len = 0,
): Indentation {
  return { k, spaces, tabs, width, len };
}

const isWs = (c: string) => /\s/.test(c);
const utf8Len = (c: string) => {
  const p = c.codePointAt(0) ?? 0;
  return p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
};

function indentation(s: string): Indentation {
  let i = 0;
  const run = (c: string) => {
    const from = i;
    while (s[i] === c) i++;
    return i - from;
  };
  const spaces = run(" ");
  const tabs = run("\t");
  if (tabs === 0) return ind("spaces", spaces, 0);
  const align = run(" ");
  if (spaces === 0) {
    if (align === 0) return ind("tabs", 0, tabs);
    if (s[i] !== "\t") return ind("tabSpaces", align, tabs);
  } else if (align === 0) return ind("spacesTabs", spaces, tabs);
  let width = spaces + tabs * TAB + align;
  let len = spaces + tabs + align;
  for (; i < s.length; i++) {
    const c = s[i] as string;
    if (c === "\t") width += tabOffset(width);
    else if (isWs(c)) width += utf8Len(c);
    else break;
    len++;
  }
  return ind("mixed", 0, 0, width, len);
}

function columns(i: Indentation): number {
  switch (i.k) {
    case "spaces":
      return i.spaces;
    case "tabs":
      return i.tabs * TAB;
    case "tabSpaces":
      return i.tabs * TAB + i.spaces;
    case "spacesTabs":
      return i.spaces + tabOffset(i.spaces) + (i.tabs - 1) * TAB;
    case "mixed":
      return i.width;
  }
}

const textLen = (i: Indentation) =>
  i.k === "mixed" ? i.len : i.spaces + i.tabs;

/** Ruff's `Indentation::trim_start`: `self` with `rhs` taken off its start, or undefined when `rhs` is no prefix. */
function trimStart(self: Indentation, rhs: Indentation): Indentation | undefined {
  if (self.k === "mixed") return undefined;
  if (self.k === "spacesTabs") {
    if (rhs.k === "spaces") {
      const spaces = self.spaces - rhs.spaces;
      if (spaces < 0) return undefined;
      return spaces === 0
        ? ind("tabs", 0, self.tabs)
        : ind("spacesTabs", spaces, self.tabs);
    }
    if (rhs.k === "spacesTabs") {
      const spaces = self.spaces - rhs.spaces;
      const tabs = self.tabs - rhs.tabs;
      if (spaces < 0 || tabs < 0) return undefined;
      if (spaces === 0)
        return tabs === 0 ? ind("spaces", 0, 0) : ind("tabs", 0, tabs);
      return ind("spacesTabs", spaces, tabs);
    }
    return undefined;
  }
  if (rhs.k === "spacesTabs" || rhs.k === "mixed") return undefined;
  const tabs = self.tabs - rhs.tabs;
  const spaces = self.spaces - rhs.spaces;
  if (tabs < 0 || spaces < 0) return undefined;
  if (tabs === 0) return ind("spaces", spaces, 0);
  if (spaces === 0) return ind("tabs", 0, tabs);
  return ind("tabSpaces", spaces, tabs);
}

/** Ruff's `Indentation::trim_start_str`: `line` without at most `i`'s columns of leading whitespace. */
function trimStartStr(i: Indentation, line: string): string {
  const want = columns(i);
  let seen = 0;
  let at = 0;
  for (const c of line) {
    if (seen >= want) break;
    if (c === "\t") seen += tabOffset(seen);
    else if (isWs(c)) seen += utf8Len(c);
    else break;
    at += c.length;
  }
  return line.slice(at);
}

/** Ruff's `indent_with_suffix`: a line's leading Python whitespace (space, tab, form feed), and the rest. */
function indentWithSuffix(line: string): [string, string] {
  const rest = line.replace(/^[ \t\f]+/, "");
  return [line.slice(0, line.length - rest.length), rest];
}

// --- Code examples ---

interface InputLine {
  readonly line: string;
  /** The line after this one; undefined for the docstring's last line. */
  readonly next: string | undefined;
}

interface OutputLine {
  readonly line: string;
  readonly last: boolean;
}

interface CodeLine {
  readonly original: InputLine;
  code: string;
}

interface Doctest {
  readonly k: "doctest";
  readonly lines: CodeLine[];
  /** The whitespace before the first line's `>>> `. */
  readonly ps1: string;
}

interface Rst {
  readonly k: "rst";
  lines: CodeLine[];
  readonly opening: Indentation;
  min: Indentation | undefined;
  readonly directive: boolean;
}

interface Markdown {
  readonly k: "markdown";
  readonly lines: CodeLine[];
  readonly opening: Indentation;
  readonly fence: "`" | "~";
  readonly fenceLen: number;
}

type Example = Doctest | Rst | Markdown;

type Action =
  | { readonly k: "print"; readonly original: InputLine }
  | { readonly k: "kept" }
  | { readonly k: "format"; readonly example: Example }
  | { readonly k: "reset"; readonly code: readonly CodeLine[] };

const isLast = (l: InputLine) => l.next === undefined;
const asOutput = (l: InputLine): OutputLine => ({
  line: l.line,
  last: isLast(l),
});

function newDoctest(original: InputLine): Doctest | undefined {
  const trimmed = original.line.trimStart();
  if (!trimmed.startsWith(">>> ")) return undefined;
  const ps1 = original.line.slice(0, original.line.length - trimmed.length);
  return {
    k: "doctest",
    lines: [{ original, code: trimmed.slice(4) }],
    ps1,
  };
}

const DIRECTIVE =
  /^\s*\.\. \s*(?:code-block|sourcecode)::\s*(?:python|py|python3|py3)$/im;

function newRst(original: InputLine): Rst | undefined {
  const [opening, rest] = indentWithSuffix(original.line);
  if (rest.startsWith(".. ")) {
    if (!DIRECTIVE.test(original.line)) return undefined;
    return {
      k: "rst",
      lines: [],
      opening: indentation(original.line),
      min: undefined,
      directive: true,
    };
  }
  if (!rest.trimEnd().endsWith("::")) return undefined;
  return {
    k: "rst",
    lines: [],
    opening: indentation(opening),
    min: undefined,
    directive: false,
  };
}

const FENCE =
  /(?:(`{3,})(?:\s*(?:python|py|python3|py3)[^`]*)?|(~{3,})(?:\s*(?:python|py|python3|py3)[^]*)?)$/i;

function newMarkdown(original: InputLine): Markdown | undefined {
  const [opening, rest] = indentWithSuffix(original.line);
  if (!rest.startsWith("```") && !rest.startsWith("~~~")) return undefined;
  const m = FENCE.exec(rest);
  if (!m) return undefined;
  const ticks = m[1];
  return {
    k: "markdown",
    lines: [],
    opening: indentation(opening),
    fence: ticks !== undefined ? "`" : "~",
    fenceLen: (ticks ?? (m[2] as string)).length,
  };
}

/**
 * Ruff's `is_rst_option`, for a line like `:name: value` in a directive's field list. Its colon search starts at
 * the line's own first colon, so any line starting with one counts.
 */
const isRstOption = (line: string) => line.trimStart().startsWith(":");

/** Ruff's `CodeExample`: the example being collected, fed one docstring line at a time. */
class Examples {
  current: Example | undefined;
  readonly queue: Action[] = [];

  add(original: InputLine): void {
    const ex = this.current;
    this.current = undefined;
    if (ex === undefined) return this.start(original);
    const kept =
      ex.k === "doctest"
        ? this.addDoctest(ex, original)
        : ex.k === "rst"
          ? this.addRst(ex, original)
          : this.addMarkdown(ex, original);
    if (kept) this.current = ex;
    // A Markdown fence's closing line prints as it is, rather than opening another fence.
    else if (ex.k !== "markdown") this.start(original);
  }

  finish(): void {
    const ex = this.current;
    this.current = undefined;
    if (ex) this.queue.push({ k: "format", example: ex });
  }

  private start(original: InputLine): void {
    const doctest = newDoctest(original);
    if (doctest) {
      this.current = doctest;
      this.queue.push({ k: "kept" });
      return;
    }
    const ex = newRst(original) ?? newMarkdown(original);
    if (ex) this.current = ex;
    this.queue.push({ k: "print", original });
  }

  private addDoctest(ex: Doctest, original: InputLine): boolean {
    const at = original.line.indexOf("...");
    const ps2 = at < 0 ? undefined : original.line.slice(0, at);
    const after = original.line.slice(at + 3);
    let code: string | undefined;
    if (ps2 === ex.ps1) {
      if (after.startsWith(" ")) code = after.slice(1);
      else if (after === "") code = "";
    }
    if (code === undefined) {
      this.queue.push({ k: "format", example: ex });
      return false;
    }
    ex.lines.push({ original, code });
    this.queue.push({ k: "kept" });
    return true;
  }

  private addRst(ex: Rst, original: InputLine): boolean {
    const [indent, rest] = indentWithSuffix(original.line);
    if (ex.min === undefined) {
      // Blank lines, and a directive's options, come before the block's first line.
      if (rest === "" || (ex.directive && isRstOption(rest))) {
        this.queue.push({ k: "print", original });
        return true;
      }
      const min = indentation(indent);
      if (columns(min) <= columns(ex.opening)) {
        this.queue.push({ k: "reset", code: ex.lines });
        return false;
      }
      ex.min = min;
      ex.lines.push({ original, code: original.line });
      this.queue.push({ k: "kept" });
      return true;
    }
    if (rest === "") {
      // A block ends at a blank line followed by a line indented no more than its opening line.
      const next = original.next;
      if (next === undefined) {
        this.pushRstFormat(ex);
        return false;
      }
      const [nextIndent, nextRest] = indentWithSuffix(next);
      if (
        nextRest !== "" &&
        columns(indentation(nextIndent)) <= columns(ex.opening)
      ) {
        this.pushRstFormat(ex);
        return false;
      }
      ex.lines.push({ original, code: original.line });
      this.queue.push({ k: "kept" });
      return true;
    }
    const own = indentation(indent);
    if (columns(own) <= columns(ex.opening)) {
      this.queue.push({ k: "reset", code: ex.lines });
      return false;
    }
    if (columns(own) < columns(ex.min)) ex.min = own;
    ex.lines.push({ original, code: original.line });
    this.queue.push({ k: "kept" });
    return true;
  }

  /** The block formatted, its trailing blank lines printed as they are after it. */
  private pushRstFormat(ex: Rst): void {
    let keep = ex.lines.length;
    while (keep > 0 && !/[^ \t\f]/.test((ex.lines[keep - 1] as CodeLine).original.line))
      keep--;
    const trailing = ex.lines.slice(keep);
    ex.lines = ex.lines.slice(0, keep);
    this.queue.push({ k: "format", example: ex });
    for (const l of trailing) this.queue.push({ k: "print", original: l.original });
  }

  private addMarkdown(ex: Markdown, original: InputLine): boolean {
    if (isFenceEnd(ex, original.line)) {
      this.queue.push({ k: "format", example: ex });
      this.queue.push({ k: "print", original });
      return false;
    }
    if (
      original.line.trim() !== "" &&
      columns(indentation(original.line)) < columns(ex.opening)
    ) {
      this.queue.push({ k: "reset", code: ex.lines });
      this.queue.push({ k: "print", original });
      return false;
    }
    ex.lines.push({ original, code: trimStartStr(ex.opening, original.line) });
    this.queue.push({ k: "kept" });
    return true;
  }
}

function isFenceEnd(ex: Markdown, line: string): boolean {
  const [, rest] = indentWithSuffix(line);
  if (!rest.startsWith("```") && !rest.startsWith("~~~")) return false;
  let len = 0;
  while (rest[len] === ex.fence) len++;
  if (len < ex.fenceLen) return false;
  return /^[ \t\f]*$/.test(rest.slice(len));
}

/** The example's code lines; a reStructuredText block's with its least indentation taken off. */
function codeOf(ex: Example): readonly CodeLine[] {
  if (ex.k !== "rst") return ex.lines;
  const min = ex.min;
  if (min === undefined) return [];
  for (const l of ex.lines)
    l.code = l.original.line.trim() === "" ? "" : trimStartStr(min, l.original.line);
  return ex.lines;
}

function exampleIndent(ex: Example): Indentation {
  if (ex.k === "doctest") return indentation(ex.ps1);
  if (ex.k === "rst") return ex.min ?? ex.opening;
  return ex.opening;
}

/** Rust's `str::lines`. */
function rustLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

// --- The docstring ---

/** What formatting a docstring's code examples reads; undefined when `docstring-code-format` is off. */
export interface DocstringCode {
  readonly format: CodeFormatter;
  /** How many suites deep the docstring is. */
  readonly depth: number;
  readonly options: PyOptions;
}

/** Ruff's `needs_chaperone_space`: a space before the closing quotes so they do not join the content. */
function needsChaperone(fl: Flags, trimEnd: string): boolean {
  const slashes = (s: string) => s.length - s.replace(/\\+$/, "").length;
  if (slashes(trimEnd) % 2 === 1) return true;
  return (
    fl.triple &&
    trimEnd.endsWith(fl.quote) &&
    slashes(trimEnd.slice(0, -1)) % 2 === 0
  );
}

/**
 * Ruff's `docstring::format`, as the text of one token whose later lines carry `indent`; undefined to print as a
 * plain string.
 */
export function docstring(
  content: string,
  fl: Flags,
  indent: string,
  style: PyOptions["indent-style"],
  code: DocstringCode | undefined,
): string | undefined {
  if (/\\[ \t\f]*\n/.test(content)) return undefined;
  const q = fl.quote.repeat(fl.triple ? 3 : 1);
  const lines = content.split("\n");
  const first = lines[0] ?? "";
  let out = fl.prefix + q;
  let lineEmpty = false;
  const write = (s: string) => {
    if (lineEmpty) out += indent;
    out += s;
    lineEmpty = false;
  };
  const hardBreak = () => {
    if (!lineEmpty) out += "\n";
    lineEmpty = true;
  };
  const trimEnd = first.trimEnd();
  const trimBoth = trimEnd.trimStart();
  if (trimBoth.startsWith(fl.quote)) out += " ";
  if (trimEnd !== "") out += trimBoth;
  if (content.slice(first.length).trim() === "") {
    if (needsChaperone(fl, trimEnd) || (trimEnd === "" && content !== ""))
      out += " ";
    return out + q;
  }
  hardBreak();
  const rest = lines.slice(1);
  let stripped: Indentation | undefined;
  for (const l of rest) {
    if (l.trim() === "") continue;
    const i = indentation(l);
    if (!stripped || columns(i) < columns(stripped)) stripped = i;
  }
  const strip = stripped ?? ind("spaces", 0, 0);

  // Ruff's `DocstringLinePrinter::print_one`.
  const printOne = ({ line, last }: OutputLine) => {
    const te = line.trimEnd();
    if (te === "") {
      if (!last) {
        if (!lineEmpty) out += "\n";
        out += "\n";
        lineEmpty = true;
      }
      return;
    }
    const lead = /^\s*/.exec(te)?.[0] ?? "";
    let offset: number | undefined;
    if (style === "space") {
      if (!/[^ ]/.test(lead)) offset = textLen(strip);
    } else {
      const trimmed = trimStart(indentation(te), strip);
      if (!/[^ \t]/.test(lead) && trimmed && trimmed.k !== "spacesTabs")
        offset = textLen(strip);
    }
    if (offset !== undefined) write(te.slice(offset));
    else
      write(
        " ".repeat(Math.max(0, columns(indentation(te)) - columns(strip))) +
          te.trimStart(),
      );
    if (!last) hardBreak();
  };

  // Ruff's `DocstringLinePrinter::format`: the example's code formatted, as docstring lines.
  const formatted = (ex: Example): OutputLine[] | undefined => {
    if (!code) return undefined;
    const o = code.options;
    const setting = o["docstring-code-line-length"];
    const width =
      setting === "dynamic"
        ? Math.max(
            1,
            o["line-length"] -
              (code.depth * o["indent-width"] +
                (ex.k === "doctest" ? 4 : 0) +
                Math.max(0, columns(exampleIndent(ex)) - columns(strip))),
          )
        : setting;
    const lines = codeOf(ex);
    const last = lines.at(-1);
    if (!last) return undefined;
    const printed = code.format(
      lines.map((l) => l.code).join("\n"),
      width,
      fl.quote,
    );
    if (printed === undefined) return undefined;
    const out = rustLines(printed).map((line) => ({ line, last: false }));
    const end = out.at(-1);
    if (end) out[out.length - 1] = { ...end, last: isLast(last.original) };
    return out;
  };

  const examples = code ? new Examples() : undefined;
  const run = () => {
    const queue = (examples as Examples).queue;
    for (let action = queue.shift(); action; action = queue.shift()) {
      switch (action.k) {
        case "print":
          printOne(asOutput(action.original));
          break;
        case "kept":
          break;
        case "reset":
          for (const l of action.code) printOne(asOutput(l.original));
          break;
        case "format": {
          const ex = action.example;
          const lines = formatted(ex);
          if (lines === undefined) {
            queue.unshift({ k: "reset", code: ex.lines });
            break;
          }
          if (ex.k === "doctest")
            lines.forEach((l, i) =>
              printOne({ ...l, line: `${ex.ps1}${i === 0 ? ">>>" : "..."} ${l.line}` }),
            );
          else {
            const min = ex.k === "rst" ? ex.min : ex.opening;
            if (min === undefined) break;
            const pad = " ".repeat(columns(min));
            for (const l of lines) printOne({ ...l, line: pad + l.line });
          }
          break;
        }
      }
    }
  };
  for (const [i, line] of rest.entries()) {
    const input: InputLine = { line, next: rest[i + 1] };
    if (!examples) printOne(asOutput(input));
    else {
      examples.add(input);
      run();
    }
  }
  if (examples) {
    examples.finish();
    run();
  }
  const tail = content.replace(/[^\S\n]+$/, "");
  if (needsChaperone(fl, tail)) write(" ");
  write(q);
  return out;
}
