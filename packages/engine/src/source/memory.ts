import { type ChangedFile, type FileSource, sameBytes } from "./file-source.js";

type Tree = Record<string, string | Uint8Array>;

/** A FileSource over two in-memory trees, labelled `before` and `after`. A rename is detected only when the content is byte-identical. */
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
      return exactRenames(changes, (path, side) =>
        bytes((side === "base" ? before : after)[path] ?? ""),
      );
    },
    async read(side, path) {
      const v = (side === "base" ? before : after)[path];
      if (v === undefined)
        throw new Error(`memorySource: ${side}:${path} does not exist`);
      return bytes(v);
    },
  };
}

/** Pairs a deleted and an added file whose bytes are identical, when exactly one such pair exists for that content. */
function exactRenames(
  changes: ChangedFile[],
  content: (path: string, side: "base" | "head") => Uint8Array,
): ChangedFile[] {
  const key = (v: Uint8Array) => v.join(",");
  const byContent = (status: ChangedFile["status"], side: "base" | "head") => {
    const map = new Map<string, ChangedFile[]>();
    for (const c of changes.filter((c) => c.status === status)) {
      const k = key(content(c.path, side));
      map.set(k, [...(map.get(k) ?? []), c]);
    }
    return map;
  };
  const added = byContent("added", "head");
  const renamed = new Map<ChangedFile, ChangedFile>();
  for (const [k, [gone, ...more]] of byContent("deleted", "base")) {
    const [target, ...others] = added.get(k) ?? [];
    // Empty files all share one content, so like git they are never paired.
    if (k !== "" && gone && target && more.length === 0 && others.length === 0)
      renamed.set(gone, target);
  }
  const targets = new Set(renamed.values());
  return changes
    .filter((c) => !targets.has(c))
    .map((c) => {
      const target = renamed.get(c);
      return target
        ? { status: "renamed" as const, path: target.path, oldPath: c.path }
        : c;
    })
    .sort((p, q) => (p.path < q.path ? -1 : p.path > q.path ? 1 : 0));
}
