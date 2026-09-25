import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReviewDoc } from "../doc/build.js";
import { nodeGrammarLocator } from "../parse/grammars.node.js";
import { createSyntaxParser } from "../parse/parser.js";
import { gitVcs } from "./git.node.js";
import {
  diffsetFromCommit,
  diffsetFromPr,
  diffsetFromRange,
  emptyRevision,
  vcsFileSource,
} from "./vcs.js";

const parser = createSyntaxParser({ locateGrammar: nodeGrammarLocator });
const renamedBody = `def greet(name):\n    message = "hello " + name\n    print(message)\n    return message\n`;
let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const write = (path: string, content: string | Uint8Array) =>
  writeFileSync(join(dir, path), content);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hihyou-git-"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "hihyou test");
  git("config", "user.email", "test@hihyou.invalid");
  git("config", "core.autocrlf", "false");

  write("app.ts", "export const retries = 3;\n");
  write("greet.py", renamedBody);
  write("notes.md", "old notes\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  git("branch", "feature");

  write("app.ts", "export const retries = 5;\n");
  git("mv", "greet.py", "hello.py");
  unlinkSync(join(dir, "notes.md"));
  write("logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  git("add", "-A");
  git("commit", "-q", "-m", "second");

  git("checkout", "-q", "feature");
  write("feature.json", '{ "on": true }\n');
  git("add", ".");
  git("commit", "-q", "-m", "feature work");

  // A submodule bump, recorded as a gitlink entry without cloning anything.
  git("checkout", "-q", "-b", "bump", "main");
  git(
    "update-index",
    "--add",
    "--cacheinfo",
    "160000,1234567890abcdef1234567890abcdef12345678,vendor/lib",
  );
  write("app.ts", "export const retries = 7;\n");
  git("add", "app.ts");
  git("commit", "-q", "-m", "bump submodule");
  git("checkout", "-q", "main");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("git source", () => {
  it("range diff reports modified, renamed, deleted and binary files with the right diff mode", async () => {
    const vcs = gitVcs(dir);
    const diffset = await diffsetFromRange(vcs, "main~1", "main");
    expect(diffset).toEqual({
      base: git("rev-parse", "main~1"),
      head: git("rev-parse", "main"),
    });

    const doc = await buildReviewDoc(vcsFileSource(vcs, diffset), { parser });
    expect(doc.diffset).toEqual(diffset);
    const byPath = Object.fromEntries(doc.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual([
      "app.ts",
      "hello.py",
      "logo.png",
      "notes.md",
    ]);
    expect(byPath["app.ts"]).toMatchObject({
      status: "modified",
      diffMode: "ast",
    });
    expect(byPath["app.ts"]?.edits).toEqual([
      expect.objectContaining({ kind: "update", node: "number" }),
    ]);
    // Content unchanged, so a pure rename must carry no edits and keep its old path.
    expect(byPath["hello.py"]).toMatchObject({
      status: "renamed",
      oldPath: "greet.py",
      language: "python",
      diffMode: "ast",
      edits: [],
    });
    expect(byPath["notes.md"]).toMatchObject({
      status: "deleted",
      diffMode: "line",
    });
    expect(byPath["notes.md"]?.edits).toEqual([
      {
        kind: "delete",
        old: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
      },
    ]);
    expect(byPath["logo.png"]).toMatchObject({
      status: "added",
      diffMode: "binary",
      edits: [],
    });
  });

  it("commit diffset is the commit against its parent, and a root commit diffs against the empty revision", async () => {
    const vcs = gitVcs(dir);
    expect(await diffsetFromCommit(vcs, "main")).toEqual(
      await diffsetFromRange(vcs, "main~1", "main"),
    );

    const root = await diffsetFromCommit(vcs, "main~1");
    expect(root.base).toBe(emptyRevision);
    const doc = await buildReviewDoc(vcsFileSource(vcs, root), { parser });
    expect(doc.files.map((f) => [f.path, f.status])).toEqual([
      ["app.ts", "added"],
      ["greet.py", "added"],
      ["notes.md", "added"],
    ]);
  });

  it("PR diffset bases on the merge-base, so commits that landed on the base branch are not shown as reverted", async () => {
    const vcs = gitVcs(dir);
    const diffset = await diffsetFromPr(vcs, "main", "feature");
    expect(diffset.base).toBe(git("rev-parse", "main~1"));
    const doc = await buildReviewDoc(vcsFileSource(vcs, diffset), { parser });
    expect(doc.files.map((f) => [f.path, f.status])).toEqual([
      ["feature.json", "added"],
    ]);
  });

  it("a submodule bump is reported as a submodule entry without reading it, instead of failing the whole review", async () => {
    const vcs = gitVcs(dir);
    const doc = await buildReviewDoc(
      vcsFileSource(vcs, await diffsetFromCommit(vcs, "bump")),
      { parser },
    );
    expect(doc.files).toEqual([
      expect.objectContaining({ path: "app.ts", diffMode: "ast" }),
      {
        path: "vendor/lib",
        status: "added",
        language: null,
        diffMode: "submodule",
        edits: [],
      },
    ]);
  });

  it("a revision id shaped like an option is rejected before git runs, so it cannot make git write a file", async () => {
    const vcs = gitVcs(dir);
    const sha = git("rev-parse", "main");
    const out = join(dir, "..", `${dir.split(/[\\/]/).at(-1)}-injected.txt`);
    const bad = `--output=${out}`;
    await expect(vcs.changes(bad, sha)).rejects.toThrow(JSON.stringify(bad));
    await expect(vcs.changes(sha, bad)).rejects.toThrow(JSON.stringify(bad));
    await expect(vcs.parents(bad)).rejects.toThrow(JSON.stringify(bad));
    await expect(vcs.mergeBase(sha, bad)).rejects.toThrow(JSON.stringify(bad));
    await expect(vcs.read(bad, "app.ts")).rejects.toThrow(JSON.stringify(bad));
    expect(existsSync(out)).toBe(false);
  });
});
