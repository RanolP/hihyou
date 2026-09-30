// Launches VS Code for the Web in headless Chromium with the browser bundle (build first:
// `pnpm --filter hihyou-vscode test:web`), on this repository mounted as a virtual file system with one tracked
// file edited.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-web";

const here = import.meta.dirname;
const repoRoot = resolve(here, "../../..");
const touchedPath = join(repoRoot, "packages/vscode/src/review.ts");
const original = readFileSync(touchedPath, "utf8");
try {
  writeFileSync(touchedPath, `${original}\nexport const e2eTouch = 1;\n`);
  await runTests({
    browserType: "chromium",
    headless: true,
    quality: "stable",
    extensionDevelopmentPath: resolve(here, ".."),
    extensionTestsPath: join(here, "web-suite.cjs"),
    folderPath: repoRoot,
  });
} finally {
  writeFileSync(touchedPath, original);
}
