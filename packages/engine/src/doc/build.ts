import { editScript, type RawEdit, type Span } from "../match/edit-script.js";
import { lineDiff } from "../match/line-diff.js";
import {
  defaultMatchOptions,
  type MatchOptions,
  match,
} from "../match/matcher.js";
import { type LanguageId, languageForPath } from "../parse/languages.js";
import type { SyntaxParser } from "../parse/tree.js";
import {
  type ChangedFile,
  type FileSource,
  isBinary,
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
  /** Past either limit a file gets line mode: the matcher is O(n²) in the worst case. */
  maxChars?: number;
  maxNodes?: number;
  /** Share of a side's text inside ERROR nodes past which the tree is too broken to diff structurally. */
  maxErrorRatio?: number;
  match?: MatchOptions;
}

const defaults = { maxChars: 500_000, maxNodes: 50_000, maxErrorRatio: 0.1 };
const concurrency = 8;

export async function buildReviewDoc(
  source: FileSource,
  opts: BuildOptions,
): Promise<ReviewDoc> {
  const changes = await source.listChanges();
  const files: FileDiff[] = new Array(changes.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < changes.length; i = next++)
      files[i] = await diffFile(source, changes[i] as ChangedFile, opts);
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
  const language: LanguageId | null = languageForPath(change.path) ?? null;
  const file = {
    path: change.path,
    ...(change.oldPath !== undefined && { oldPath: change.oldPath }),
    status: change.status,
    language,
  };
  const empty = new Uint8Array();
  const [oldBytes, newBytes] = await Promise.all([
    change.status === "added"
      ? empty
      : source.read("base", change.oldPath ?? change.path),
    change.status === "deleted" ? empty : source.read("head", change.path),
  ]);
  if (isBinary(oldBytes) || isBinary(newBytes))
    return { ...file, diffMode: "binary", edits: [] };

  const decoder = new TextDecoder();
  const oldText = decoder.decode(oldBytes);
  const newText = decoder.decode(newBytes);
  const toDoc = (raw: RawEdit[]) => toEdits(raw, oldText, newText);
  const line = (fallbackReason: FallbackReason): FileDiff => ({
    ...file,
    diffMode: "line",
    fallbackReason,
    edits: toDoc(lineDiff(oldText, newText)),
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
  return {
    ...file,
    diffMode: "ast",
    edits: toDoc(editScript(match(a, b, opts.match ?? defaultMatchOptions))),
  };
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
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (starts[lo] as number) + 1 };
  };
}
