import type {
  FileDiff,
  FileSource,
  Group,
  ReviewDoc,
  Risk,
} from "@hihyou/engine";
import { type FileView, type Formatter, presentFile } from "@hihyou/present";

/** Loads one file's formatted view; each file is read and formatted at most once. */
export type ViewLoader = (index: number) => Promise<FileView>;

export function viewLoader(
  doc: ReviewDoc,
  source: FileSource,
  formatter: Formatter,
): ViewLoader {
  const cache = new Map<number, Promise<FileView>>();
  const decoder = new TextDecoder();
  const read = async (side: "base" | "head", path: string) =>
    decoder.decode(await source.read(side, path));
  return (index) => {
    let view = cache.get(index);
    if (!view) {
      const file = doc.files[index];
      if (!file) throw new Error(`no file at index ${index}`);
      view = (async () => {
        const [oldText, newText] = await Promise.all([
          file.status === "added"
            ? ""
            : read("base", file.oldPath ?? file.path),
          file.status === "deleted" ? "" : read("head", file.path),
        ]);
        return presentFile(file, { old: oldText, new: newText }, formatter);
      })();
      cache.set(index, view);
    }
    return view;
  };
}

export const statusLetter: Record<FileDiff["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
};

export function fileLabel(file: FileDiff): string {
  return file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
}

export function editCount(file: FileDiff): string {
  return count(file.edits.length);
}

const count = (n: number) => `${n} edit${n === 1 ? "" : "s"}`;

/** `risk 14 (exported-api +10, literal +2, 2x moved +2)`; empty for a file with no risk. */
export function riskLabel(risk: Risk): string {
  if (risk.score === 0) return "";
  const reasons = risk.reasons.map(
    (r) => `${r.count > 1 ? `${r.count}x ` : ""}${r.signal} +${r.points}`,
  );
  return `risk ${risk.score} (${reasons.join(", ")})`;
}

export function groupLabel(group: Group): string {
  const edits = count(group.edits.length);
  switch (group.kind) {
    case "rename-symbol":
      return `rename ${group.from} -> ${group.to} (declared in ${group.path}), ${edits}`;
    case "move":
      return `move ${group.names.join(", ") || "code"}: ${group.fromPath} -> ${group.toPath}, ${edits}`;
    case "rename-file":
      return `${group.copy ? "copy" : "rename"} ${group.fromPath} -> ${group.toPath}, ${edits}`;
    case "signature":
      return `signature of ${group.name} in ${group.path}, ${edits}`;
  }
}

/** The groups holding any of `file`'s edits, in doc order. */
export function groupsOf(doc: ReviewDoc, file: FileDiff): Group[] {
  const ids = new Set(file.edits.map((e) => e.id));
  return doc.groups.filter((g) => g.edits.some((id) => ids.has(id)));
}
