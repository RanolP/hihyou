import type { FileDiff, FileSource, ReviewDoc } from "@hihyou/engine";
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
  return `${file.edits.length} edit${file.edits.length === 1 ? "" : "s"}`;
}
