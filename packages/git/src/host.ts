import { createHash } from "node:crypto";
import {
  type BlobId,
  type ChangedFileRef,
  type GrammarLoader,
  type Host,
  type HostPreferences,
  syntechsGrammars,
} from "@hihyou/engine";
import type { Repo } from "./repo.js";
import type { ChangedFile } from "./tree-diff.js";

/**
 * A change set in a local repository. The engine caches a resolve by this value, so `worktree` and
 * `staged`, whose content moves under the same value, take a `snapshot` token: pass a new one (a file
 * watcher's counter, a timestamp) to read the disk again.
 */
export type LocalDiffsetId =
  /** HEAD to the working tree: every uncommitted change, staged or not. Untracked files are not included. */
  | { kind: "worktree"; snapshot?: string }
  /** HEAD to the index. */
  | { kind: "staged"; snapshot?: string }
  /** A commit against its first parent; a root commit against the empty tree. */
  | { kind: "commit"; sha: string }
  /** `base`'s tree to `head`'s tree, directly. For a PR-style range pass `repo.mergeBase(base, head)` as `base`. */
  | { kind: "range"; base: string; head: string };

export interface LocalHostOptions {
  /** Defaults to the grammars syntechs ships, with no formatting. */
  grammars?: GrammarLoader;
  preferences?: HostPreferences;
}

export interface LocalHost extends Host {
  resolveDiffset(data: LocalDiffsetId): {
    id: string;
    changes: ChangedFileRef[];
  };
  readBlob(id: BlobId): Uint8Array;
}

/** The engine's `Host` over a repository on the local disk. */
export function localHost(
  repo: Repo,
  options: LocalHostOptions = {},
): LocalHost {
  return {
    grammars: options.grammars ?? syntechsGrammars(),
    ...(options.preferences && { preferences: options.preferences }),
    resolveDiffset(data) {
      switch (data.kind) {
        case "worktree":
          return contentAddressed("worktree", repo.diffWorktree());
        case "staged":
          return contentAddressed("staged", repo.diffStaged());
        case "commit": {
          const sha = repo.resolveRev(data.sha);
          const parent = repo.readCommit(sha).parents[0];
          return {
            id: `commit:${sha}`,
            changes: repo.diffTrees(parent, sha).map(toRef),
          };
        }
        case "range": {
          const base = repo.resolveRev(data.base);
          const head = repo.resolveRev(data.head);
          return {
            id: `range:${base}..${head}`,
            changes: repo.diffTrees(base, head).map(toRef),
          };
        }
      }
    },
    readBlob: (id) => repo.readBlob(id),
  };
}

/** Same changes -> same id, so two reads of an unchanged working tree share the engine's cached diff. */
function contentAddressed(kind: string, files: ChangedFile[]) {
  const changes = files.map(toRef);
  const digest = createHash("sha1")
    .update(JSON.stringify(changes))
    .digest("hex");
  return { id: `${kind}:${digest}`, changes };
}

function toRef(f: ChangedFile): ChangedFileRef {
  return {
    path: f.path,
    ...(f.oldPath !== undefined && { oldPath: f.oldPath }),
    before: f.oldSha ?? null,
    after: f.newSha ?? null,
    ...(f.submodule && { kind: "submodule" as const }),
  };
}
