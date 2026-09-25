import { type CrossEdit, crossFileMoves } from "../match/cross-file.js";
import { editScript, type RawEdit, type Span } from "../match/edit-script.js";
import { indentIsSyntax, lineDiff } from "../match/line-diff.js";
import {
  defaultMatchOptions,
  type Mapping,
  MatchBudgetExceeded,
  type MatchOptions,
  match,
} from "../match/matcher.js";
import { type LanguageId, languageForPath } from "../parse/languages.js";
import type { SyntaxParser } from "../parse/tree.js";
import {
  type ChangedFile,
  type FileSource,
  isBinary,
  sameBytes,
} from "../source/file-source.js";
import { foldReason, producedBy } from "./fold.js";
import { groupEdits } from "./groups.js";
import { riskOf, signalsOf } from "./risk.js";
import {
  type Edit,
  type FallbackReason,
  type FileDiff,
  type Group,
  type Position,
  type ReviewDoc,
  schemaVersion,
} from "./schema.js";

export interface BuildOptions {
  parser: SyntaxParser;
  /**
   * Past either limit a file gets line mode before it is parsed. The matcher's own work budget
   * catches what slips under them, since its bottom-up phase is cubic on deeply nested input.
   */
  maxChars?: number;
  maxNodes?: number;
  /** Share of a side's text inside ERROR nodes past which the tree is too broken to diff structurally. */
  maxErrorRatio?: number;
  match?: MatchOptions;
}

const defaults = { maxChars: 500_000, maxNodes: 50_000, maxErrorRatio: 0.1 };
const concurrency = 8;

/**
 * A file that cannot be read or diffed becomes an `error` entry naming the cause, and the rest still build.
 * Rejects only when the list of changes itself cannot be read.
 */
export async function buildReviewDoc(
  source: FileSource,
  opts: BuildOptions,
): Promise<ReviewDoc> {
  const changes = await source.listChanges();
  const analyses: Analysis[] = new Array(changes.length);
  // One iterator shared by every worker hands each file to exactly one of them.
  const queue = changes.entries();
  const worker = async () => {
    for (const [i, change] of queue) {
      try {
        analyses[i] = await analyze(source, change, opts);
      } catch (error) {
        analyses[i] = {
          file: {
            path: change.path,
            ...(change.oldPath !== undefined && { oldPath: change.oldPath }),
            status: change.status,
            language: languageForPath(change.path) ?? null,
            diffMode: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const cross = crossFileMoves(
    analyses.map((a) => a.mapping),
    opts.match ?? defaultMatchOptions,
  );
  const located: CrossEdit[][] = analyses.map((a, i) =>
    (a.mapping ? editScript(a.mapping, cross.claimed[i]) : (a.raw ?? [])).map(
      (edit) => ({ edit, from: i, to: i }),
    ),
  );
  for (const c of cross.edits) {
    if ("old" in c.edit) located[c.from]?.push(c);
    if ("new" in c.edit) located[c.to]?.push(c);
  }
  const { edits: docEdits, ids } = toDocEdits(analyses, located);
  const files = analyses.map(({ file, text }, i): FileDiff => {
    const edits = docEdits[i] ?? [];
    const fold = foldReason({ ...file, edits }, producedBy(file.path, text));
    const risk = riskOf(
      file.diffMode === "error"
        ? [["error"]]
        : (located[i] ?? []).map((l) => signalsOf(l.edit)),
    );
    return { ...file, ...(fold && { fold }), edits, risk };
  });
  // Groups are an overlay on complete per-file edits; a fault in grouping loses the overlay, never the review.
  let groups: Group[] = [];
  try {
    groups = groupEdits(
      analyses.map((a) => a.file),
      located,
      ids,
    );
  } catch {}
  files.sort(
    (p, q) =>
      Number(p.fold !== undefined) - Number(q.fold !== undefined) ||
      q.risk.score - p.risk.score ||
      (p.path < q.path ? -1 : p.path > q.path ? 1 : 0),
  );
  return { schemaVersion, diffset: source.diffset, files, groups };
}

/** One file's diff before cross-file matching, keeping what that matching and the doc edits need. */
interface Analysis {
  file: Omit<FileDiff, "edits" | "fold" | "risk">;
  /** Both sides' text; absent when the file has no text to diff. */
  texts?: [string, string];
  /** The text that tells whether a tool produced the file: head, or base for a deleted file. */
  text?: string;
  /** Set in ast mode. */
  mapping?: Mapping;
  /** Set in line mode. */
  raw?: RawEdit[];
}

async function analyze(
  source: FileSource,
  change: ChangedFile,
  opts: BuildOptions,
): Promise<Analysis> {
  const { maxChars, maxNodes, maxErrorRatio } = { ...defaults, ...opts };
  const file = {
    path: change.path,
    ...(change.oldPath !== undefined && { oldPath: change.oldPath }),
    status: change.status,
  };
  if (change.submodule)
    return { file: { ...file, language: null, diffMode: "submodule" } };
  const language: LanguageId | null = languageForPath(change.path) ?? null;
  const empty = new Uint8Array();
  const [oldBytes, newBytes] = await Promise.all([
    change.status === "added"
      ? empty
      : source.read("base", change.oldPath ?? change.path),
    change.status === "deleted" ? empty : source.read("head", change.path),
  ]);
  if (isBinary(oldBytes) || isBinary(newBytes))
    return { file: { ...file, language, diffMode: "binary" } };
  const texts = decode(oldBytes, newBytes);
  if (!texts)
    return {
      file: {
        ...file,
        language,
        diffMode: "binary",
        fallbackReason: "undecodable",
      },
    };

  const [oldText, newText] = texts;
  const text = change.status === "deleted" ? oldText : newText;
  const line = (fallbackReason: FallbackReason): Analysis => ({
    file: { ...file, language, diffMode: "line", fallbackReason },
    texts,
    text,
    raw: lineDiff(oldText, newText, indentIsSyntax(change.path)),
  });

  if (!language) return line("unsupported-language");
  if (Math.max(oldText.length, newText.length) > maxChars)
    return line("too-large");
  const [a, b] = [
    await opts.parser.parse(language, oldText),
    await opts.parser.parse(language, newText),
  ];
  if (Math.max(a.nodes.length, b.nodes.length) > maxNodes)
    return line("too-large");
  if (
    a.errorChars > maxErrorRatio * oldText.length ||
    b.errorChars > maxErrorRatio * newText.length
  )
    return line("parse-error");
  let mapping: Mapping;
  try {
    mapping = match(a, b, opts.match ?? defaultMatchOptions);
  } catch (error) {
    if (error instanceof MatchBudgetExceeded) return line("too-large");
    throw error;
  }
  return { file: { ...file, language, diffMode: "ast" }, texts, text, mapping };
}

/** Both sides as UTF-8 text, or undefined when they differ and either is not valid UTF-8. */
function decode(
  oldBytes: Uint8Array,
  newBytes: Uint8Array,
): [string, string] | undefined {
  try {
    const strict = new TextDecoder("utf-8", { fatal: true });
    return [strict.decode(oldBytes), strict.decode(newBytes)];
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // A lossy decoding maps distinct bytes to one replacement character, so it is safe only when nothing changed.
    if (!sameBytes(oldBytes, newBytes)) return undefined;
    const lossy = new TextDecoder();
    return [lossy.decode(oldBytes), lossy.decode(newBytes)];
  }
}

/**
 * Each file's edits in document order, with line/column ranges. An edit spanning two files appears in
 * both under one id, and names the other file on the side that lies there.
 */
function toDocEdits(
  analyses: Analysis[],
  located: CrossEdit[][],
): { edits: Edit[][]; ids: Map<CrossEdit, number> } {
  const cache = new Map<string, (offset: number) => Position>();
  const range = (file: number, side: 0 | 1, s: Span) => {
    const key = `${file}:${side}`;
    let at = cache.get(key);
    if (!at) {
      at = positions(analyses[file]?.texts?.[side] ?? "");
      cache.set(key, at);
    }
    return { start: at(s.start), end: at(s.end) };
  };
  const ids = new Map<CrossEdit, number>();
  const edits = located.map((list, i) => {
    const here = ({ edit, to }: CrossEdit) =>
      "new" in edit && to === i
        ? edit.new.start
        : "old" in edit
          ? edit.old.start
          : 0;
    return list
      .toSorted((p, q) => here(p) - here(q))
      .map((l): Edit => {
        let id = ids.get(l);
        if (id === undefined) {
          id = ids.size;
          ids.set(l, id);
        }
        const { edit: e, from, to } = l;
        const common = { id, ...(e.node !== undefined && { node: e.node }) };
        switch (e.kind) {
          case "insert":
            return { kind: e.kind, new: range(to, 1, e.new), ...common };
          case "delete":
            return { kind: e.kind, old: range(from, 0, e.old), ...common };
          default: {
            const fromFile = analyses[from]?.file;
            const toFile = analyses[to]?.file;
            return {
              kind: e.kind,
              old: range(from, 0, e.old),
              new: range(to, 1, e.new),
              ...common,
              ...(from !== i &&
                fromFile && { from: fromFile.oldPath ?? fromFile.path }),
              ...(to !== i && toFile && { to: toFile.path }),
            };
          }
        }
      });
  });
  return { edits, ids };
}

function positions(text: string): (offset: number) => Position {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    starts.push(i + 1);
  return (offset) => {
    // The last line start at or before `offset`.
    let lo = 0;
    let loStart = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const start = starts[mid];
      if (start !== undefined && start <= offset) {
        lo = mid;
        loStart = start;
      } else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - loStart + 1 };
  };
}
