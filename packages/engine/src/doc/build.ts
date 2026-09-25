import { editScript, type RawEdit, type Span } from "../match/edit-script.js";
import { indentIsSyntax, lineDiff } from "../match/line-diff.js";
import {
  defaultMatchOptions,
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
import {
  type Edit,
  type FallbackReason,
  type FileDiff,
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
  const files: FileDiff[] = new Array(changes.length);
  // One iterator shared by every worker hands each file to exactly one of them.
  const queue = changes.entries();
  const worker = async () => {
    for (const [i, change] of queue) {
      try {
        files[i] = await diffFile(source, change, opts);
      } catch (error) {
        files[i] = {
          path: change.path,
          ...(change.oldPath !== undefined && { oldPath: change.oldPath }),
          status: change.status,
          language: languageForPath(change.path) ?? null,
          diffMode: "error",
          error: error instanceof Error ? error.message : String(error),
          edits: [],
        };
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { schemaVersion, diffset: source.diffset, files };
}

async function diffFile(
  source: FileSource,
  change: ChangedFile,
  opts: BuildOptions,
): Promise<FileDiff> {
  const { maxChars, maxNodes, maxErrorRatio } = { ...defaults, ...opts };
  const file = {
    path: change.path,
    ...(change.oldPath !== undefined && { oldPath: change.oldPath }),
    status: change.status,
  };
  if (change.submodule)
    return { ...file, language: null, diffMode: "submodule", edits: [] };
  const language: LanguageId | null = languageForPath(change.path) ?? null;
  const empty = new Uint8Array();
  const [oldBytes, newBytes] = await Promise.all([
    change.status === "added"
      ? empty
      : source.read("base", change.oldPath ?? change.path),
    change.status === "deleted" ? empty : source.read("head", change.path),
  ]);
  if (isBinary(oldBytes) || isBinary(newBytes))
    return { ...file, language, diffMode: "binary", edits: [] };
  const texts = decode(oldBytes, newBytes);
  if (!texts)
    return {
      ...file,
      language,
      diffMode: "binary",
      fallbackReason: "undecodable",
      edits: [],
    };

  const [oldText, newText] = texts;
  const toDoc = (raw: RawEdit[]) => toEdits(raw, oldText, newText);
  const line = (fallbackReason: FallbackReason): FileDiff => ({
    ...file,
    language,
    diffMode: "line",
    fallbackReason,
    edits: toDoc(lineDiff(oldText, newText, indentIsSyntax(change.path))),
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
  let mapping: ReturnType<typeof match>;
  try {
    mapping = match(a, b, opts.match ?? defaultMatchOptions);
  } catch (error) {
    if (error instanceof MatchBudgetExceeded) return line("too-large");
    throw error;
  }
  return {
    ...file,
    language,
    diffMode: "ast",
    edits: toDoc(editScript(mapping)),
  };
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

function toEdits(raw: RawEdit[], oldText: string, newText: string): Edit[] {
  const oldPos = positions(oldText);
  const newPos = positions(newText);
  const range = (at: (offset: number) => Position, s: Span) => ({
    start: at(s.start),
    end: at(s.end),
  });
  const anchor = (e: RawEdit) => ("new" in e ? e.new.start : e.old.start);
  return raw
    .toSorted((p, q) => anchor(p) - anchor(q))
    .map((e): Edit => {
      const node = e.node === undefined ? {} : { node: e.node };
      switch (e.kind) {
        case "insert":
          return { kind: e.kind, new: range(newPos, e.new), ...node };
        case "delete":
          return { kind: e.kind, old: range(oldPos, e.old), ...node };
        default:
          return {
            kind: e.kind,
            old: range(oldPos, e.old),
            new: range(newPos, e.new),
            ...node,
          };
      }
    });
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
