import type {
  CodeFragment,
  Diffset,
  Engine,
  Host,
  LinePair,
  SerializedDiffsetId,
} from "@hihyou/engine";
import type { CommentStore } from "./comments.js";
import type { DiffFile } from "./rows.js";

/** One change set a panel shows, from whichever backend; the panel knows nothing else about where it came from. */
export interface ReviewSource {
  title: string;
  /** Resolves and diffs afresh; a working-tree or index source reads the disk again on every call. */
  load(): Promise<DiffFile[]>;
  /** `count` lines (absent: to the end) of the last `load`'s file `path` from `lines`, as the engine colours them. */
  expand(
    path: string,
    lines: LinePair,
    count?: number,
  ): Promise<(CodeFragment & { kind: "unchanged" }) | undefined>;
  /** Content can move under the same source (the working tree, the index), so the panel offers Refresh. */
  refreshable: boolean;
  /** A saved editor changes this source's content (the working tree), so a visible panel refreshes itself. */
  refreshOnSave?: boolean;
  /** A host that keeps comments (a pull request on GitHub) gives each panel a store; absent, they stay in the view. */
  comments?: () => CommentStore;
}

/** `load` and `expand` over one engine; `id` is read on every load, so a moving source can hand out a new one. */
export function engineReview<H extends Host>(
  engine: Engine<H>,
  id: () => SerializedDiffsetId<H>,
): Pick<ReviewSource, "load" | "expand"> & {
  /** The paths `load` will diff, in the change set's order. */
  paths(): Promise<string[]>;
  /**
   * One file of the change set `load` reads, diffed alone so it draws before `load` is done; what other files
   * take part in arrives with `load`. Undefined when `path` is not in it.
   */
  preview(path: string): Promise<DiffFile | undefined>;
} {
  let latest: Promise<Diffset<H>> | undefined;
  return {
    paths: async () => {
      latest = engine.diffset(id());
      return (await latest).changes.map((c) => c.path);
    },
    preview: async (path) => {
      latest ??= engine.diffset(id());
      const diffset = await latest;
      const d = await diffset.preview(path);
      const change = diffset.changes.find((c) => c.path === path);
      return d && (change ? { ...d, change } : d);
    },
    load: async () => {
      const diffset = engine.diffset(id());
      latest = diffset;
      return diffFiles(await diffset);
    },
    expand: async (path, lines, count) =>
      (await latest)?.expand(path, lines, count),
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
