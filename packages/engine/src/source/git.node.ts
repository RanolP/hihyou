import { execFile } from "node:child_process";
import type { ChangedFile } from "./file-source.js";
import { emptyRevision, type Vcs } from "./vcs.js";

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

  // The empty tree's id depends on the repo's hash algorithm, so ask git rather than hardcode it.
  let emptyTree: Promise<string> | undefined;
  const treeish = (id: string) => {
    if (id !== emptyRevision) return id;
    emptyTree ??= line(["hash-object", "-t", "tree", "--stdin"]);
    return emptyTree;
  };

  return {
    resolve: (expr) =>
      line(["rev-parse", "--verify", "--end-of-options", `${expr}^{commit}`]),
    parents: async (id) =>
      (await line(["rev-list", "--parents", "-n", "1", id]))
        .split(" ")
        .slice(1),
    mergeBase: (a, b) => line(["merge-base", a, b]),
    changes: async (base, head) =>
      parseNameStatus(
        (
          await run([
            "diff",
            "--name-status",
            "-M",
            "-z",
            await treeish(base),
            await treeish(head),
          ])
        ).toString(),
      ),
    read: (id, path) => run(["show", `${id}:${path}`]),
  };
}

/** Parses `git diff --name-status -z`: a status field followed by one path, or two for renames and copies. */
function parseNameStatus(out: string): ChangedFile[] {
  const fields = out.split("\0");
  const changes: ChangedFile[] = [];
  for (let i = 0; i + 1 < fields.length; ) {
    const code = fields[i++]?.[0];
    const a = fields[i++] ?? "";
    if (code === "R" || code === "C") {
      const b = fields[i++] ?? "";
      // A copy leaves its source untouched, so the reviewer sees only a new file.
      changes.push(
        code === "R"
          ? { status: "renamed", path: b, oldPath: a }
          : { status: "added", path: b },
      );
    } else if (code === "A") changes.push({ status: "added", path: a });
    else if (code === "D") changes.push({ status: "deleted", path: a });
    else changes.push({ status: "modified", path: a });
  }
  return changes;
}
