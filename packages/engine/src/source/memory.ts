import { type ChangedFile, type FileSource, sameBytes } from "./file-source.js";

type Tree = Record<string, string | Uint8Array>;

/** A FileSource over two in-memory trees, labelled `before` and `after`. Detects no renames. */
export function memorySource(before: Tree, after: Tree): FileSource {
  const encoder = new TextEncoder();
  const bytes = (v: string | Uint8Array) =>
    typeof v === "string" ? encoder.encode(v) : v;

  return {
    diffset: { base: "before", head: "after" },
    async listChanges() {
      const changes: ChangedFile[] = [];
      for (const path of [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ].sort()) {
        const b = before[path];
        const a = after[path];
        if (b === undefined) changes.push({ status: "added", path });
        else if (a === undefined) changes.push({ status: "deleted", path });
        else if (!sameBytes(bytes(b), bytes(a)))
          changes.push({ status: "modified", path });
      }
      return changes;
    },
    async read(side, path) {
      const v = (side === "base" ? before : after)[path];
      if (v === undefined)
        throw new Error(`memorySource: ${side}:${path} does not exist`);
      return bytes(v);
    },
  };
}
