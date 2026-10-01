import type {
  CodeFragment,
  Diffset,
  Engine,
  Host,
  SerializedDiffsetId,
} from "@hihyou/engine";
import type { DiffFile, ElidedRef } from "@hihyou/ui";

/** One change set a panel shows, from whichever backend; the panel knows nothing else about where it came from. */
export interface ReviewSource {
  title: string;
  /** Resolves and diffs afresh; a working-tree or index source reads the disk again on every call. */
  load(): Promise<DiffFile[]>;
  /** The lines an elided run of the last `load`'s file `path` hid, as the engine colours them. */
  expand(
    path: string,
    ref: ElidedRef,
  ): Promise<(CodeFragment & { kind: "unchanged" }) | undefined>;
  /** Content can move under the same source (the working tree, the index), so the panel offers Refresh. */
  refreshable: boolean;
  /** A saved editor changes this source's content (the working tree), so a visible panel refreshes itself. */
  refreshOnSave?: boolean;
}

/** `load` and `expand` over one engine; `id` is read on every load, so a moving source can hand out a new one. */
export function engineReview<H extends Host>(
  engine: Engine<H>,
  id: () => SerializedDiffsetId<H>,
): Pick<ReviewSource, "load" | "expand"> {
  let latest: Promise<Diffset<H>> | undefined;
  return {
    load: async () => {
      const diffset = engine.diffset(id());
      latest = diffset;
      return diffFiles(await diffset);
    },
    expand: async (path, ref) =>
      (await latest)?.expand(path, ref.lines, ref.count),
  };
}

export async function diffFiles<H extends Host>(
  diffset: Diffset<H>,
): Promise<DiffFile[]> {
  const diffs = await diffset.diff();
  return diffs.map((d, i) => {
    const change = diffset.changes[i];
    return change ? { ...d, change } : d;
  });
}
