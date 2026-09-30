import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { localHost } from "./host.js";
import { openRepo } from "./node.js";
import type { Repo } from "./repo.js";
import type { ChangedFile } from "./tree-diff.js";
import { vscodeLikeFileSystem } from "./vscode-like-fs.js";
import { webRepo } from "./web.js";

// Oracle tests: every answer is checked against the real git CLI, on this repository and on a
// fixture repository built for the cases this one does not hold (dirty files, index v3/v4, ref deltas).
// Both adapters run the whole suite. The web one gets DecompressionStream, SubtleCrypto and a file
// system with only millisecond mtimes and no mode bits, so its git oracle runs with core.filemode off.
const adapters = [
  { name: "node", open: (path: string) => openRepo(path), gitConfig: [] },
  {
    name: "web",
    open: (path: string) => webRepo({ fs: vscodeLikeFileSystem, path }),
    gitConfig: ["-c", "core.filemode=false"],
  },
];

const zero = "0".repeat(40);
const isolated = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: isolated,
    ...(input !== undefined && { input }),
  });
}

/**
 * `git diff --raw -z --no-abbrev` output as one comparable line per file. Git prints a zero id for a
 * working-tree side it did not hash; `hashFromDisk` fills it in with `git hash-object`.
 */
function parseRawZ(out: string, hashFromDisk?: string): string[] {
  const parts = out.split("\0");
  const lines: string[] = [];
  for (let i = 0; i + 1 < parts.length;) {
    const [srcMode, dstMode, srcSha, raw, status] = (parts[i++] as string)
      .slice(1)
      .split(" ") as [string, string, string, string, string];
    let dstSha = raw;
    const letter = status[0] as string;
    const first = parts[i++] as string;
    const second = letter === "R" ? (parts[i++] as string) : undefined;
    if (hashFromDisk && dstSha === zero && letter !== "D") {
      const path = join(hashFromDisk, second ?? first);
      dstSha = lstatSync(path).isSymbolicLink()
        ? git(hashFromDisk, ["hash-object", "--stdin"], readlinkSync(path))
        : git(hashFromDisk, ["hash-object", "--", second ?? first]);
      dstSha = dstSha.trim();
    }
    lines.push(
      [
        { A: "added", D: "deleted", R: "renamed" }[letter] ?? "modified",
        second ?? first,
        second ? first : "-",
        srcSha === zero ? "-" : srcSha,
        dstSha === zero ? "-" : dstSha,
        letter === "D" ? srcMode : dstMode,
        letter !== "A" && letter !== "D" && srcMode !== dstMode ? srcMode : "-",
      ].join(" "),
    );
  }
  return lines.sort();
}

function lines(changes: ChangedFile[]): string[] {
  const octal = (m: number) => m.toString(8).padStart(6, "0");
  return changes
    .map((c) =>
      [
        c.status,
        c.path,
        c.oldPath ?? "-",
        c.oldSha ?? "-",
        c.newSha ?? "-",
        octal(c.mode),
        c.oldMode === undefined ? "-" : octal(c.oldMode),
      ].join(" "),
    )
    .sort();
}

/** A diff whose new side is the working tree gets its ids from disk, since git leaves them zero. */
const rawDiff = (
  cwd: string,
  args: string[],
  renames: boolean,
  config: string[],
) =>
  parseRawZ(
    git(cwd, [
      ...config,
      "diff",
      "--raw",
      "-z",
      "--no-abbrev",
      "--no-ext-diff",
      renames ? "-M100%" : "--no-renames",
      ...args,
    ]),
    args.includes("--cached") || args.length > 1 ? undefined : cwd,
  );

/** `git cat-file --batch` for many ids at once: id -> bytes. */
function catFile(cwd: string, shas: string[]): Map<string, Buffer> {
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd,
    input: shas.join("\n") + "\n",
    maxBuffer: 1 << 30,
  });
  const found = new Map<string, Buffer>();
  let p = 0;
  while (p < out.length) {
    const nl = out.indexOf(10, p);
    const [sha, , size] = out.toString("latin1", p, nl).split(" ");
    const start = nl + 1;
    found.set(sha as string, out.subarray(start, start + Number(size)));
    p = start + Number(size) + 1;
  }
  return found;
}

describe.each(adapters)("$name adapter", ({ open, gitConfig }) => {
  const diff = (cwd: string, args: string[], renames = true) =>
    rawDiff(cwd, args, renames, gitConfig);

  describe("this repository", () => {
    const root = resolve(import.meta.dirname, "../../..");
    let repo: Repo;
    beforeAll(async () => {
      repo = await open(root);
    });
    afterAll(() => repo.close());

    // Catches a wrong ref lookup order, a broken `~`/`^` walk, or a short-SHA expansion that misses packs.
    test("resolveRev agrees with git rev-parse", async () => {
      const merge = git(root, ["rev-list", "--merges", "-n1", "HEAD"]).trim();
      const specs = [
        "HEAD",
        "@",
        "HEAD~3",
        "HEAD^",
        "HEAD~2^",
        "main",
        "origin/main",
      ];
      if (merge) specs.push(`${merge}^2`, `${merge}^1~2`, merge.slice(0, 9));
      for (const spec of specs) {
        const expected = git(root, [
          "rev-parse",
          "--verify",
          "-q",
          `${spec}^{commit}`,
        ]).trim();
        expect(await repo.resolveRev(spec), spec).toBe(expected);
      }
    });

    // Catches a loose ref that fails to override its packed-refs entry, or a ref missed under nested dirs.
    test("listRefs agrees with git for-each-ref", async () => {
      const expected = git(root, [
        "for-each-ref",
        "--format=%(objectname) %(refname) %(symref)",
      ])
        .split("\n")
        .filter((l) => l && l.endsWith(" "))
        .map((l) => l.trim())
        .sort();
      expect(
        (await repo.listRefs()).map((r) => `${r.sha} ${r.name}`).sort(),
      ).toEqual(expected);
    });

    // Catches a merge-base walk that stops at the first common commit it meets instead of the best one.
    test("mergeBase agrees with git merge-base", async () => {
      const branches = (await repo.listRefs())
        .filter((r) => r.kind === "branch")
        .slice(0, 12)
        .map((r) => r.short);
      for (let i = 0; i + 1 < branches.length; i += 2) {
        const [a, b] = [branches[i] as string, branches[i + 1] as string];
        let expected: string | undefined;
        try {
          expected = git(root, ["merge-base", a, b]).trim();
        } catch {
          expected = undefined;
        }
        expect(await repo.mergeBase(a, b), `${a} ${b}`).toBe(expected);
      }
    });

    // Catches a subtree skipped though it changed, a tree/blob swap, or a bad exact-rename pairing.
    test("tree diffs agree with git diff --raw", async () => {
      const pairs: [string, string][] = [
        ["HEAD~1", "HEAD"],
        ["HEAD~10", "HEAD"],
        ["HEAD~60", "HEAD~5"],
      ];
      for (const sha of git(root, [
        "log",
        "--diff-filter=R",
        "-M100%",
        "--format=%H",
        "-n3",
        "HEAD",
      ])
        .split("\n")
        .filter(Boolean))
        pairs.push([`${sha}^`, sha]);
      for (const [a, b] of pairs) {
        const [sa, sb] = [await repo.resolveRev(a), await repo.resolveRev(b)];
        expect(lines(await repo.diffTrees(sa, sb)), `${a}..${b}`).toEqual(
          diff(root, [sa, sb]),
        );
        expect(
          lines(await repo.diffTrees(sa, sb, { renames: false })),
          `${a}..${b}`,
        ).toEqual(diff(root, [sa, sb], false));
      }
    });

    // Catches a wrong OFS_DELTA base offset or copy/insert decoding: most blobs here are packed deltas.
    test("blobs, delta-packed ones included, are byte-identical to git cat-file", async () => {
      const all = git(root, [
        "cat-file",
        "--batch-all-objects",
        "--batch-check=%(objectname) %(objecttype) %(deltabase)",
      ])
        .split("\n")
        .map((l) => l.split(" "))
        .filter((f) => f[1] === "blob");
      const deltas = all
        .filter((f) => f[2] !== zero)
        .map((f) => f[0] as string);
      const fulls = all.filter((f) => f[2] === zero).map((f) => f[0] as string);
      expect(deltas.length).toBeGreaterThan(0);
      const headBlobs = git(root, [
        "ls-tree",
        "-r",
        "--format=%(objecttype) %(objectname)",
        "HEAD",
      ])
        .split("\n")
        .filter((l) => l.startsWith("blob "))
        .map((l) => l.slice(5));
      const shas = [
        ...new Set([
          ...deltas.slice(0, 300),
          ...fulls.slice(0, 50),
          ...headBlobs,
        ]),
      ];
      const expected = catFile(root, shas);
      for (const sha of shas)
        expect(
          Buffer.from(await repo.readBlob(sha)).equals(
            expected.get(sha) as Buffer,
          ),
          sha,
        ).toBe(true);
    });

    // Catches a stat check that trusts a changed file, or reports a clean one; prints ours against git.
    test("HEAD-vs-worktree agrees with git diff HEAD, and its timing", async () => {
      const expected = diff(root, ["HEAD"]);
      const t0 = performance.now();
      const cold = await open(root);
      const ours = await cold.diffWorktree();
      const t1 = performance.now();
      await cold.diffWorktree();
      const t2 = performance.now();
      cold.close();
      expect(lines(ours)).toEqual(expected);
      const time = (args: string[]) => {
        const s = performance.now();
        execFileSync("git", args, { cwd: root, maxBuffer: 1 << 30 });
        return performance.now() - s;
      };
      const status = time(["status", "--porcelain"]);
      const gitDiff = time(["diff", "--raw", "HEAD"]);
      console.log(
        `HEAD-vs-worktree: ours cold ${(t1 - t0).toFixed(1)}ms, warm ${(t2 - t1).toFixed(1)}ms; ` +
          `git status --porcelain ${status.toFixed(1)}ms; git diff --raw HEAD ${gitDiff.toFixed(1)}ms`,
      );
    });

    // Catches a remote dropped or a url read with its quoting or comment left on.
    test("readRemotes agrees with git remote -v", () => {
      const expected = git(root, ["remote", "-v"])
        .split("\n")
        .filter((l) => l.endsWith("(fetch)"))
        .map((l) => l.replace(/ \(fetch\)$/, "").replace("\t", " "))
        .sort();
      expect(
        repo
          .readRemotes()
          .map((r) => `${r.name} ${r.url}`)
          .sort(),
      ).toEqual(expected);
    });
  });

  describe("fixture repository", () => {
    let dir: string;
    let work: string;
    const bigText = (salt: string) =>
      Array.from(
        { length: 400 },
        (_, i) => `line ${i} of a file long enough to deltify ${salt}\n`,
      ).join("");

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "hihyou-git-"));
      work = join(dir, "main");
      mkdirSync(work);
      const g = (...args: string[]) => git(work, args);
      g("init", "-q", "-b", "main");
      mkdirSync(join(work, "dir/deep"), { recursive: true });
      writeFileSync(join(work, "a.txt"), "a\n");
      writeFileSync(join(work, "big.txt"), bigText("one"));
      writeFileSync(join(work, "dir/b.txt"), "b\n");
      writeFileSync(join(work, "dir/deep/c.txt"), "c\n");
      writeFileSync(join(work, "moved.txt"), "moved content\n");
      writeFileSync(join(work, "run.sh"), "#!/bin/sh\n");
      writeFileSync(join(work, "touched.txt"), "same\n");
      writeFileSync(join(work, "gone.txt"), "gone\n");
      chmodSync(join(work, "run.sh"), 0o755);
      symlinkSync("a.txt", join(work, "link"));
      g("add", "-A");
      g("commit", "-qm", "one");
      writeFileSync(join(work, "big.txt"), bigText("two"));
      g("commit", "-qam", "two");
      g("tag", "-a", "v1", "-m", "tag");
      // Without delta-base-offset, pack-objects writes REF_DELTA entries instead of OFS_DELTA.
      g("-c", "repack.useDeltaBaseOffset=false", "repack", "-adfq");
      g("remote", "add", "origin", "https://example.com/a.git");
      g("config", "remote.origin.pushurl", "git@example.com:a.git");
      g("remote", "add", "up", "/local/path");

      writeFileSync(join(work, "a.txt"), "a staged\n");
      g("add", "a.txt");
      writeFileSync(join(work, "a.txt"), "a staged then edited\n");
      writeFileSync(join(work, "dir/b.txt"), "b unstaged\n");
      unlinkSync(join(work, "gone.txt"));
      chmodSync(join(work, "run.sh"), 0o644);
      g("mv", "moved.txt", "dir/moved.txt");
      writeFileSync(join(work, "new.txt"), "new staged\n");
      g("add", "new.txt");
      writeFileSync(join(work, "later.txt"), "intent to add\n");
      g("add", "-N", "later.txt");
      unlinkSync(join(work, "link"));
      symlinkSync("dir/b.txt", join(work, "link"));
      rmSync(join(work, "dir/deep"), { recursive: true });
      writeFileSync(join(work, "dir/deep"), "a file where a directory was\n");
      const later = new Date(Date.now() + 5000);
      utimesSync(join(work, "touched.txt"), later, later);
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    // Catches a v3 extended-flag entry or a v4 prefix-compressed path read at the wrong offset.
    test.each([2, 3, 4])(
      "staged, unstaged and HEAD-vs-worktree agree with git at index v%i",
      async (v) => {
        git(work, ["update-index", "--index-version", String(v)]);
        const repo = await open(join(work, "dir"));
        expect(lines(await repo.diffStaged()), "staged").toEqual(
          diff(work, ["--cached"]),
        );
        expect(lines(await repo.diffUnstaged()), "unstaged").toEqual(
          diff(work, []),
        );
        expect(lines(await repo.diffWorktree()), "worktree").toEqual(
          diff(work, ["HEAD"]),
        );
        repo.close();
      },
    );

    // Catches a REF_DELTA base looked up by the wrong id, or a tag not peeled to its commit.
    test("reads REF_DELTA packs and peels an annotated tag", async () => {
      const packDir = join(work, ".git/objects/pack");
      const idx = readdirSync(packDir).find((n) =>
        n.endsWith(".idx"),
      ) as string;
      const pack = readFileSync(join(packDir, idx.replace(/\.idx$/, ".pack")));
      const offsets = git(work, ["verify-pack", "-v", join(packDir, idx)])
        .split("\n")
        .map((l) => l.split(/\s+/))
        .filter((f) => /^[0-9a-f]{40}$/.test(f[0] as string) && f.length >= 5)
        .map((f) => Number(f[4]));
      expect(offsets.some((o) => (((pack[o] as number) >> 4) & 7) === 7)).toBe(
        true,
      );

      const repo = await open(work);
      expect(await repo.resolveRev("v1")).toBe(
        git(work, ["rev-parse", "v1^{commit}"]).trim(),
      );
      const big = git(work, ["rev-parse", "HEAD:big.txt"]).trim();
      const old = git(work, ["rev-parse", "HEAD~1:big.txt"]).trim();
      const bytes = catFile(work, [big, old]);
      expect(
        Buffer.from(await repo.readBlob(big)).equals(bytes.get(big) as Buffer),
      ).toBe(true);
      expect(
        Buffer.from(await repo.readBlob(old)).equals(bytes.get(old) as Buffer),
      ).toBe(true);
      repo.close();
    });

    // Catches a working-tree id that differs from git's, which would make readBlob miss the file.
    test("readBlob returns working-tree bytes under the id the worktree diff reported", async () => {
      const repo = await open(work);
      const b = (await repo.diffUnstaged()).find((c) => c.path === "dir/b.txt");
      expect(
        new TextDecoder().decode(await repo.readBlob(b?.newSha as string)),
      ).toBe("b unstaged\n");
      repo.close();
    });

    // Catches a linked worktree reading HEAD or the index from the common dir instead of its own.
    test("a linked worktree resolves its own HEAD and index", async () => {
      const wt = join(dir, "linked");
      git(work, ["worktree", "add", "-q", "-b", "side", wt, "HEAD~1"]);
      writeFileSync(join(wt, "a.txt"), "edited in the linked worktree\n");
      const repo = await open(wt);
      expect(await repo.resolveRev("HEAD")).toBe(
        git(wt, ["rev-parse", "HEAD"]).trim(),
      );
      expect((await repo.head()).branch).toBe("refs/heads/side");
      expect(lines(await repo.diffWorktree())).toEqual(diff(wt, ["HEAD"]));
      repo.close();
    });

    // Catches a pushurl or a second remote lost while parsing .git/config.
    test("readRemotes lists every remote with its push url", async () => {
      const repo = await open(work);
      expect(repo.readRemotes()).toEqual([
        {
          name: "origin",
          url: "https://example.com/a.git",
          pushUrl: "git@example.com:a.git",
        },
        { name: "up", url: "/local/path" },
      ]);
      repo.close();
    });

    // Catches a Host whose change refs point at ids readBlob cannot serve, or a worktree id that is not content-addressed.
    test("localHost resolves each diffset kind to refs whose blobs it can read", async () => {
      const repo = await open(work);
      const host = localHost(repo);
      const head = await repo.resolveRev("HEAD");
      for (const data of [
        { kind: "worktree" as const },
        { kind: "staged" as const },
        { kind: "commit" as const, sha: head },
        { kind: "range" as const, base: `${head}~1`, head },
      ]) {
        const { id, changes } = await host.resolveDiffset(data);
        expect(changes.length, data.kind).toBeGreaterThan(0);
        for (const c of changes)
          for (const blob of [c.before, c.after])
            if (blob) await host.readBlob(blob);
        expect((await host.resolveDiffset(data)).id).toBe(id);
      }
      expect(
        (await host.resolveDiffset({ kind: "commit", sha: head })).changes,
      ).toEqual([
        {
          path: "big.txt",
          before: git(work, ["rev-parse", "HEAD~1:big.txt"]).trim(),
          after: git(work, ["rev-parse", "HEAD:big.txt"]).trim(),
        },
      ]);
      repo.close();
    });
  });
});
