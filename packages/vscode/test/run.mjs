// Launches VS Code twice with the bundled extension (build first: `pnpm --filter hihyou-vscode test:e2e`):
// on this repository with one tracked file edited, and on a fresh `git init` repository with no remote.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const touched = "packages/vscode/src/review.ts";
const touchedPath = join(repoRoot, touched);
const original = readFileSync(touchedPath, "utf8");
const bare = mkdtempSync(join(tmpdir(), "hihyou-e2e-"));
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
} finally {
  writeFileSync(touchedPath, original);
  rmSync(bare, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
}
