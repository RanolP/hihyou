/** One file's section of a `git diff` as github.com serves it (`.diff`): headers parsed, hunk lines kept raw. */
export interface FilePatch {
  /** The `a/` path; equals `newPath` unless renamed. */
  oldPath: string;
  newPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  /** Abbreviated blob ids from the `index` line; absent for a pure rename or a mode-only change. */
  oldBlob?: string;
  newBlob?: string;
  /** The mode on the `index` line, or the new file's mode; `160000` is a submodule. */
  mode?: string;
  binary: boolean;
  hunks: Hunk[];
}

export interface Hunk {
  /** 1-based first line on the new side; 0 when the new side of the hunk is empty. */
  newStart: number;
  newLines: number;
  /** Each line with its one-character prefix (` `, `-`, `+`, `\`), the newline stripped. */
  lines: string[];
}

const nullBlob = /^0+$/;

/** Splits `text` (a whole `.diff`) into file patches; a line it cannot place throws, naming the line. */
export function parseDiff(text: string): FilePatch[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const files: FilePatch[] = [];
  let file: FilePatch | undefined;
  let hunk: Hunk | undefined;
  let oldLeft = 0;
  let newLeft = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("diff --git ")) {
      const paths = splitGitPaths(line.slice("diff --git ".length));
      if (!paths)
        throw new Error(`diff line ${i + 1}: cannot read paths: ${line}`);
      file = {
        oldPath: paths[0],
        newPath: paths[1],
        status: paths[0] === paths[1] ? "modified" : "renamed",
        binary: false,
        hunks: [],
      };
      hunk = undefined;
      files.push(file);
      continue;
    }
    if (!file)
      throw new Error(`diff line ${i + 1}: text before any file: ${line}`);
    if (hunk && (oldLeft > 0 || newLeft > 0 || line.startsWith("\\"))) {
      const c = line[0];
      // An empty line is a context line whose leading space was stripped along the way.
      if (c === " " || c === "" || c === undefined) {
        hunk.lines.push(` ${line.slice(1)}`);
        oldLeft--;
        newLeft--;
      } else if (c === "-") {
        hunk.lines.push(line);
        oldLeft--;
      } else if (c === "+") {
        hunk.lines.push(line);
        newLeft--;
      } else if (c === "\\") hunk.lines.push(line);
      else throw new Error(`diff line ${i + 1}: expected a hunk line: ${line}`);
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      hunk = {
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = hunk.newLines;
      file.hunks.push(hunk);
      continue;
    }
    hunk = undefined;
    let m: RegExpExecArray | null;
    if ((m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/.exec(line))) {
      if (!nullBlob.test(m[1] as string)) file.oldBlob = m[1] as string;
      if (!nullBlob.test(m[2] as string)) file.newBlob = m[2] as string;
      if (m[3] !== undefined) file.mode = m[3];
    } else if ((m = /^new file mode (\d+)$/.exec(line))) {
      file.status = "added";
      file.mode = m[1] as string;
    } else if (/^deleted file mode (\d+)$/.test(line)) {
      file.status = "deleted";
    } else if (
      line.startsWith("Binary files ") ||
      line === "GIT binary patch"
    ) {
      file.binary = true;
    }
    // Other extended headers (mode changes, similarity, rename from/to, ---/+++) carry nothing the paths above miss.
  }
  return files;
}

/** `a/x b/y` into its two paths, honouring git's quoting of paths with spaces or special characters. */
function splitGitPaths(rest: string): [string, string] | undefined {
  if (rest.startsWith('"')) {
    const [a, after] = readQuoted(rest);
    const b = after.trimStart();
    const second = b.startsWith('"') ? readQuoted(b)[0] : b;
    return strip(a, second);
  }
  // Unquoted: both paths are the same length when not renamed; otherwise split at " b/".
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3))
    return strip(rest.slice(0, half), rest.slice(half + 1));
  const at = rest.indexOf(" b/");
  if (at < 0) return undefined;
  const b = rest.slice(at + 1);
  return strip(rest.slice(0, at), b.startsWith('"') ? readQuoted(b)[0] : b);
}

function strip(a: string, b: string): [string, string] | undefined {
  return a.startsWith("a/") && b.startsWith("b/")
    ? [a.slice(2), b.slice(2)]
    : undefined;
}

/** A C-style quoted path git writes for unusual names, decoded as UTF-8; returns the rest of the line too. */
function readQuoted(s: string): [string, string] {
  const bytes: number[] = [];
  let i = 1;
  for (; i < s.length && s[i] !== '"'; i++) {
    const c = s[i] as string;
    if (c !== "\\") {
      bytes.push(...new TextEncoder().encode(c));
      continue;
    }
    const n = s[++i] as string;
    if (/[0-7]/.test(n)) {
      bytes.push(Number.parseInt(s.slice(i, i + 3), 8));
      i += 2;
    } else
      bytes.push(
        ({ n: 10, t: 9, '"': 34, "\\": 92 } as Record<string, number>)[n] ??
          n.charCodeAt(0),
      );
  }
  return [new TextDecoder().decode(new Uint8Array(bytes)), s.slice(i + 1)];
}

/**
 * The old side's text, rebuilt from the new side's `after` text and `hunks` by undoing them. Every context and
 * added line is checked against `after`, so a diff from a different revision than `after` throws instead of
 * yielding a wrong file.
 */
export function reverseApply(
  after: string,
  hunks: readonly Hunk[],
  where: string,
): string {
  const newLines = after.split("\n");
  // A trailing newline leaves one empty element that is not a line.
  const afterEndsWithNewline = after === "" || after.endsWith("\n");
  if (afterEndsWithNewline) newLines.pop();
  const out: string[] = [];
  let cursor = 0; // 0-based index into newLines of the next line not yet copied
  let beforeEndsWithNewline = afterEndsWithNewline;
  let touchesEnd = false;
  for (const hunk of hunks) {
    // A hunk adding nothing names the line *before* which it sits as `newStart` (0 at the top of the file).
    const start = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
    if (start < cursor || start > newLines.length)
      throw new Error(
        `${where}: hunk at +${hunk.newStart} is out of order or past the end`,
      );
    out.push(...newLines.slice(cursor, start));
    cursor = start;
    let last: string | undefined;
    let oldNoNewline = false;
    for (const line of hunk.lines) {
      const c = line[0];
      const body = line.slice(1);
      if (c === "\\") {
        if (last === " " || last === "-") oldNoNewline = true;
        continue;
      }
      last = c;
      if (c === "-") {
        out.push(body);
        continue;
      }
      if (newLines[cursor] !== body)
        throw new Error(
          `${where}: line ${cursor + 1} is ${JSON.stringify(newLines[cursor])}, the diff expects ${JSON.stringify(body)}; the diff and the file are from different revisions`,
        );
      if (c === " ") out.push(body);
      cursor++;
    }
    if (cursor === newLines.length) {
      touchesEnd = true;
      beforeEndsWithNewline = !oldNoNewline;
    }
  }
  out.push(...newLines.slice(cursor));
  if (cursor < newLines.length || !touchesEnd)
    beforeEndsWithNewline = afterEndsWithNewline;
  if (out.length === 0) return "";
  return out.join("\n") + (beforeEndsWithNewline ? "\n" : "");
}
