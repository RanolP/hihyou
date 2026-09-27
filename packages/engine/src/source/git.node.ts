import { execFile } from "node:child_process";
import type { ChangedFile } from "./file-source.js";
import { emptyRevision, type Vcs } from "./vcs.js";

const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const gitlinkMode = "160000";

/**
 * Every method but `resolve` takes only ids `resolve` returned (or `emptyRevision`), and rejects anything
 * else before git sees it, so an id can never be read as an option such as `--output=<file>`.
 */
export function gitVcs(cwd: string): Vcs {
  const run = (args: string[], input = ""): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        ["-c", "core.quotepath=off", ...args],
        { cwd, encoding: "buffer", maxBuffer: 1 << 30 },
        (error, stdout, stderr) => {
          if (error) {
            const detail = stderr.toString().trim() || error.message;
            reject(
              new Error(
                `git ${args.join(" ")} (in ${cwd}) exited ${error.code}: ${detail}`,
              ),
            );
          } else resolve(stdout);
        },
      );
      child.stdin?.end(input);
    });
  const line = async (args: string[], input?: string) =>
    (await run(args, input)).toString().trim();

  const revision = (id: string) => {
    if (!objectId.test(id))
      throw new Error(
        `gitVcs: expected a full hex object id, got ${JSON.stringify(id)}`,
      );
    return id;
  };
  // The empty tree's id depends on the repo's hash algorithm, so ask git rather than hardcode it.
  let emptyTree: Promise<string> | undefined;
  const treeish = (id: string) => {
    if (id !== emptyRevision) return revision(id);
    emptyTree ??= line(["hash-object", "-t", "tree", "--stdin"]);
    return emptyTree;
  };
  // Blob ids `changes` saw, keyed by revision and path, so `read` needs no second lookup.
  const blobs = new Map<string, string>();
  const blobKey = (id: string, path: string) => `${id}\0${path}`;

  return {
    resolve: (expr) =>
      line(["rev-parse", "--verify", "--end-of-options", `${expr}^{commit}`]),
    parents: async (id) =>
      (
        await line([
          "rev-list",
          "--parents",
          "-n",
          "1",
          "--end-of-options",
          revision(id),
        ])
      )
        .split(" ")
        .slice(1),
    mergeBase: async (a, b) =>
      line(["merge-base", "--end-of-options", revision(a), revision(b)]),
    changes: async (base, head) => {
      const entries = parseRawDiff(
        (
          await run([
            "diff",
            "--raw",
            "-z",
            "-M",
            "-C",
            "--no-abbrev",
            "--end-of-options",
            await treeish(base),
            await treeish(head),
          ])
        ).toString(),
      );
      for (const { change, oldBlob, newBlob } of entries) {
        if (oldBlob)
          blobs.set(blobKey(base, change.oldPath ?? change.path), oldBlob);
        if (newBlob) blobs.set(blobKey(head, change.path), newBlob);
      }
      return entries.map(({ change }) => change);
    },
    read: async (id, path) =>
      run([
        "cat-file",
        "blob",
        blobs.get(blobKey(revision(id), path)) ?? `${id}:${path}`,
      ]),
  };
}

interface RawEntry {
  change: ChangedFile;
  /** Set only for a side that exists and holds file content. */
  oldBlob?: string;
  newBlob?: string;
}

/**
 * Parses `git diff --raw -z`: a `:<old mode> <new mode> <old id> <new id> <status>` field, then one
 * path, or two for renames and copies. A side that does not exist has mode 000000.
 */
function parseRawDiff(out: string): RawEntry[] {
  const fields = out.split("\0");
  const entries: RawEntry[] = [];
  for (let i = 0; i + 1 < fields.length;) {
    const [oldMode, newMode, oldId, newId, status = ""] = (fields[i++] ?? "")
      .slice(1)
      .split(" ");
    const code = status[0];
    const a = fields[i++] ?? "";
    const b = code === "R" || code === "C" ? (fields[i++] ?? "") : a;
    const submodule = oldMode === gitlinkMode || newMode === gitlinkMode;
    const change: ChangedFile =
      code === "R"
        ? { status: "renamed", path: b, oldPath: a }
        : code === "C"
          ? { status: "copied", path: b, oldPath: a }
          : code === "A"
            ? { status: "added", path: b }
            : code === "D"
              ? { status: "deleted", path: a }
              : { status: "modified", path: a };
    if (submodule) {
      entries.push({ change: { ...change, submodule } });
      continue;
    }
    entries.push({
      change,
      ...(code !== "A" && oldId && { oldBlob: oldId }),
      ...(code !== "D" && newId && { newBlob: newId }),
    });
  }
  return entries;
}
