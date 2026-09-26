// Runs unsigned.html in headless Chrome and prints its results.
//
//   node research/tree-arena/browser.mjs [path to chrome]

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const chrome =
  process.argv[2] ??
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "google-chrome");
const page = pathToFileURL(resolve(import.meta.dirname, "unsigned.html")).href;
// A fresh profile, or Chrome hands the page to an already running instance and never exits.
const profile = mkdtempSync(join(tmpdir(), "tree-arena-"));
const dom = execFileSync(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    `--user-data-dir=${profile}`,
    "--allow-file-access-from-files",
    "--dump-dom",
    page,
  ],
  { encoding: "utf8", timeout: 300_000 },
);
rmSync(profile, { recursive: true, force: true });
const out = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)?.[1];
if (!out) {
  console.error("no results in the page; the DOM was:\n" + dom);
  process.exit(1);
}
console.log(execFileSync(chrome, ["--version"], { encoding: "utf8" }).trim());
console.log(out.replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&"));
