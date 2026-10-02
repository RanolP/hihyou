// Launches VS Code three times with the bundled extension (build first: `pnpm --filter hihyou-vscode test:e2e`):
// on this repository with one tracked file edited, on a fresh `git init` repository with no remote, and on a
// repository with a two-commit branch off main.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const here = import.meta.dirname;
const extensionDevelopmentPath = resolve(here, "..");
const extensionTestsPath = join(here, "suite.cjs");
const repoRoot = resolve(here, "../../..");
// A short user-data dir: VS Code's IPC socket lives there, and a socket path past 103 characters fails to bind.
const userData = mkdtempSync(join(tmpdir(), "hihyou-ud-"));
const launch = (workspace) => [
  workspace,
  "--disable-extensions",
  "--disable-workspace-trust",
  `--user-data-dir=${userData}`,
];

const touched = "packages/ui/src/review.ts";
const touchedPath = join(repoRoot, touched);
const original = readFileSync(touchedPath, "utf8");
const bare = mkdtempSync(join(tmpdir(), "hihyou-e2e-"));
const branched = mkdtempSync(join(tmpdir(), "hihyou-branch-"));
try {
  writeFileSync(touchedPath, `${original}\nexport const e2eTouch = 1;\n`);
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: launch(repoRoot),
    extensionTestsEnv: { HIHYOU_EXPECT_GITHUB: "1", HIHYOU_TOUCHED: touched },
  });

  execFileSync("git", ["init", "--quiet", bare]);
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: launch(bare),
    extensionTestsEnv: { HIHYOU_EXPECT_GITHUB: "0" },
  });

  // main with one commit, then a branch with two commits on top of it.
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-C",
        branched,
        "-c",
        "user.name=e2e",
        "-c",
        "user.email=e2e@example.com",
        ...args,
      ],
      { stdio: "pipe" },
    );
  const write = (path, text) => {
    mkdirSync(dirname(join(branched, path)), { recursive: true });
    writeFileSync(join(branched, path), text);
  };
  git("init", "--quiet", "--initial-branch=main");
  write("a.txt", "a\n");
  write("keep.txt", "keep\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "init");
  git("checkout", "--quiet", "-b", "feature");
  write("a.txt", "a2\n");
  write("src/deep/nested/one.ts", "export const one = 1;\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "first on branch");
  write("docs/b.md", "# b\n");
  write("src/two.ts", "export const two = 2;\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "second on branch");
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: launch(branched),
    extensionTestsEnv: {
      HIHYOU_EXPECT_GITHUB: "0",
      HIHYOU_BRANCH_COMMITS: JSON.stringify([
        { subject: "second on branch", paths: ["docs/b.md", "src/two.ts"] },
        {
          subject: "first on branch",
          paths: ["a.txt", "src/deep/nested/one.ts"],
        },
      ]),
    },
  });
} finally {
  writeFileSync(touchedPath, original);
  rmSync(bare, { recursive: true, force: true });
  rmSync(branched, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
}
