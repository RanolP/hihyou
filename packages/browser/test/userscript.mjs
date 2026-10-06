// Runs the built userscript (.output/userscript/hihyou.user.js) on a public pull request in a headless Chromium
// with a fresh, throwaway profile, logged out, and no userscript manager: a stand-in GM_xmlhttpRequest answers
// through Playwright's own request client and, as a manager does, refuses any hop (redirects included) to a
// host the script's @connect lines do not list. Checks the metadata block, that the toggle appears, and that
// turning it on draws hihyou's diff. Never headed: nothing appears on screen.
//   node test/userscript.mjs
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const dir = join(import.meta.dirname, "../.output/userscript");
const url = "https://github.com/vitejs/vite/pull/21626/files";
const script = await readFile(join(dir, "hihyou.user.js"), "utf8");
const meta = await readFile(join(dir, "hihyou.meta.js"), "utf8");

// The metadata block must open the file, parse as `// @key value` lines, and match hihyou.meta.js exactly.
const block =
  /^\/\/ ==UserScript==\n((?:\/\/ @\S+(?: +.*)?\n)+)\/\/ ==\/UserScript==\n/.exec(
    script,
  );
if (!block)
  throw new Error("hihyou.user.js does not open with a metadata block");
if (meta !== block[0])
  throw new Error(
    "hihyou.meta.js differs from hihyou.user.js's metadata block",
  );
const keys = block[1]
  .trimEnd()
  .split("\n")
  .map((line) => /^\/\/ @(\S+)\s*(.*)$/.exec(line).slice(1));
const values = (key) => keys.filter(([k]) => k === key).map(([, v]) => v);
for (const key of [
  "name",
  "version",
  "match",
  "grant",
  "connect",
  "updateURL",
  "downloadURL",
])
  if (values(key).length === 0) throw new Error(`metadata lacks @${key}`);
if (keys.some(([k]) => k === "require" || k === "resource"))
  throw new Error("metadata pulls remote code (@require or @resource)");
const connect = new Set(values("connect"));
console.log(
  `metadata: ${keys.length} keys, @version ${values("version")[0]}, @connect ${[...connect].join(", ")}`,
);

// Chrome refuses a script holding one; a manager may too.
const nonCharacter = /[﷐-﷯￾￿]/u.exec(script);
if (nonCharacter)
  throw new Error(
    `Unicode noncharacter U+${nonCharacter[0].charCodeAt(0).toString(16)} at ${nonCharacter.index}`,
  );
// Everything is bundled: nothing is evaluated from a string or loaded at run time.
const dynamic = /\beval\s*\(|\bnew Function\s*\(|\bimportScripts\s*\(/.exec(
  script,
);
if (dynamic) throw new Error(`dynamic code in the script: ${dynamic[0]}`);
console.log(
  `script: ${(script.length / 1024 / 1024).toFixed(2)} MB, no noncharacters, no eval`,
);

const profile = await mkdtemp(join(tmpdir(), "hihyou-userscript-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
const started = performance.now();
const step = (what) =>
  console.log(
    `[${((performance.now() - started) / 1000).toFixed(1)}s] ${what}`,
  );
const requested = [];
try {
  const page = await context.newPage();
  page.on(
    "console",
    (m) => m.type() === "error" && console.log(`  page error: ${m.text()}`),
  );
  await page.exposeBinding("__hihyouRequest", async (_, target, accept) => {
    requested.push(target);
    let at = target;
    for (let hop = 0; hop < 10; hop++) {
      const host = new URL(at).hostname;
      if (!connect.has(host))
        return { error: `@connect does not list ${host} (${at})` };
      const response = await context.request.get(at, {
        maxRedirects: 0,
        ...(accept && { headers: { Accept: accept } }),
      });
      const location = response.headers()["location"];
      if (response.status() >= 300 && response.status() < 400 && location) {
        at = new URL(location, at).href;
        continue;
      }
      return {
        status: response.status(),
        statusText: response.statusText(),
        body: (await response.body()).toString("base64"),
        finalUrl: at,
      };
    }
    return { error: `too many redirects from ${target}` };
  });
  // The stand-in for a manager's GM_xmlhttpRequest, with the fields src/userscript.ts reads.
  await page.addInitScript(() => {
    window.GM_xmlhttpRequest = (details) => {
      window.__hihyouRequest(details.url, details.headers?.Accept).then(
        (r) => {
          if (r.error) return details.onerror({ error: r.error });
          const binary = atob(r.body);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
          details.onload({
            status: r.status,
            statusText: r.statusText,
            response: bytes.buffer,
            finalUrl: r.finalUrl,
          });
        },
        (e) => details.onerror({ error: String(e) }),
      );
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // @run-at document-idle. Evaluated over the DevTools protocol, which GitHub's CSP does not govern, as a
  // manager's injection is not.
  await page.evaluate(script);
  step("userscript injected");

  const toggle = page.locator(".hihyou-bar button");
  await toggle.waitFor({ timeout: 30_000 });
  step("toggle shown");
  const clicked = performance.now();
  await toggle.click();
  await page
    .locator(".hihyou-view .hh-file")
    .first()
    .waitFor({ timeout: 60_000 });
  const status = await page
    .locator(".hihyou-view .hh-meta.message")
    .textContent();
  const hidden = await page.locator("#files_bucket diff-layout").isHidden();
  step(
    `hihyou drew the diff in ${(performance.now() - clicked).toFixed(0)} ms: "${status}"; GitHub's diff hidden: ${hidden}`,
  );
  if (!/\d+ files? changed/.test(status ?? ""))
    throw new Error(`unexpected status: ${status}`);
  if (!hidden)
    throw new Error("GitHub's diff area stayed visible with hihyou on");
  step(
    `requests through GM_xmlhttpRequest: ${requested.length}, e.g. ${requested.slice(0, 2).join(", ")}`,
  );
  if (requested.length === 0)
    throw new Error("the diff drew without a GM_xmlhttpRequest");
  console.log("userscript: passed");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
