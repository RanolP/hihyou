import type { BlobId, Engine, Host, SerializedDiffsetId } from "@hihyou/engine";
import type { DiffFile } from "@hihyou/ui";

/** One change set a panel shows, from whichever backend; the panel knows nothing else about where it came from. */
export interface ReviewSource {
  title: string;
  /** Resolves and diffs afresh; a working-tree or index source reads the disk again on every call. */
  load(): Promise<DiffFile[]>;
  readBlob(id: BlobId): Promise<Uint8Array>;
  /** Content can move under the same source (the working tree, the index), so the panel offers Refresh. */
  refreshable: boolean;
  /** A saved editor changes this source's content (the working tree), so a visible panel refreshes itself. */
  refreshOnSave?: boolean;
}

export async function diffFiles<H extends Host>(
  engine: Engine<H>,
  id: SerializedDiffsetId<H>,
): Promise<DiffFile[]> {
  const diffset = await engine.diffset(id);
  const diffs = await diffset.diff();
  return diffs.map((d, i) => {
    const change = diffset.changes[i];
    return change ? { ...d, change } : d;
  });
}
