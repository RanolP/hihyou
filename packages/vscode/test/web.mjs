// Launches VS Code for the Web in headless Chromium with the browser bundle (build first:
// `pnpm --filter hihyou-vscode test:web`). The workspace is mounted as a virtual file system that reaches only
// the mounted folder, so it is a fresh repository rather than this checkout, whose `.git` may point outside it
// (a linked worktree). Its objects are packed, since the web file system reads packs differently from loose
// objects, and it has a github.com origin and one edited tracked file.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-web";

const here = import.meta.dirname;
const repo = mkdtempSync(join(tmpdir(), "hihyou-web-"));
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
try {
  git("init", "--quiet");
  git("remote", "add", "origin", "https://github.com/RanolP/hihyou.git");
  writeFileSync(
    join(repo, "hello.ts"),
    'export function hello() {\n  return "hello";\n}\n',
  );
  git("add", "hello.ts");
  git(
    "-c",
    "user.name=e2e",
    "-c",
    "user.email=e2e@example.com",
    "commit",
    "--quiet",
    "-m",
    "init",
  );
  git("repack", "-adq");
  writeFileSync(
    join(repo, "hello.ts"),
    "export function hello(name: string) {\n  return `hello ${name}`;\n}\n",
  );
  await runTests({
    browserType: "chromium",
    headless: true,
    quality: "stable",
    extensionDevelopmentPath: resolve(here, ".."),
    extensionTestsPath: join(here, "web-suite.cjs"),
    folderPath: repo,
  });
} finally {
  rmSync(repo, { recursive: true, force: true });
}
