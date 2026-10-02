// Loads WXT's Chrome build (.output/chrome-mv3) unpacked into a headless Chromium with a fresh, throwaway profile and walks a public pull request
// logged out: the toggle appears on the Files changed tab, turning it on draws hihyou's diff, a commit opens,
// turning it off restores GitHub's own view. Never headed: nothing appears on screen.
//   node test/e2e.mjs [--screenshot <path>]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const dist = join(import.meta.dirname, "../.output/chrome-mv3");
const url = "https://github.com/vitejs/vite/pull/21626/files";
const at = process.argv.indexOf("--screenshot");
const screenshot =
  at > 0 ? process.argv[at + 1] : join(tmpdir(), "hihyou-browser-ext.png");

const profile = await mkdtemp(join(tmpdir(), "hihyou-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const step = (what) =>
  console.log(
    `[${((performance.now() - started) / 1000).toFixed(1)}s] ${what}`,
  );
const started = performance.now();
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  step(`extension worker up: ${worker.url()}`);
  const page = await context.newPage();
  page.on(
    "console",
    (m) => m.type() === "error" && console.log(`  page error: ${m.text()}`),
  );
  // Every task over 50 ms on the page's main thread, which is where the engine runs (no worker).
  await page.addInitScript(() => {
    window.__longtasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__longtasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const toggle = page.locator(".hihyou-bar button");
  await toggle.waitFor({ timeout: 30_000 });
  step("toggle shown");

  const clicked = await page.evaluate(() => performance.now());
  await toggle.click();
  const file = page.locator(".hihyou-view .hh-file").first();
  await file.waitFor({ timeout: 60_000 });
  const drawn = await page.evaluate(() => performance.now());
  const status = await page
    .locator(".hihyou-view .hh-meta.message")
    .textContent();
  const hidden = await page.locator("#files_bucket").isHidden();
  step(
    `hihyou drew the diff in ${(drawn - clicked).toFixed(0)} ms: "${status}"; GitHub's diff hidden: ${hidden}`,
  );
  if (!hidden)
    throw new Error("GitHub's diff area stayed visible with hihyou on");
  if (!/\d+ files? changed/.test(status ?? ""))
    throw new Error(`unexpected status: ${status}`);
  const rows = await page.locator(".hihyou-view .hh-set > .hh-row").count();
  step(`diffsets panel: ${rows} rows`);

  const tasks = await page.evaluate(
    (from) => window.__longtasks.filter((t) => t.start >= from),
    clicked,
  );
  const longest = Math.max(0, ...tasks.map((t) => t.duration));
  step(
    `long tasks after the click: ${tasks.length}, longest ${longest.toFixed(0)} ms, total ${tasks.reduce((s, t) => s + t.duration, 0).toFixed(0)} ms`,
  );
  await page.screenshot({ path: screenshot });
  step(`screenshot: ${screenshot}`);

  // A commit diffset goes through commit/<sha>.diff instead of the pull request's .diff.
  const commit = page.locator(".hihyou-view .hh-set .hh-label").nth(1);
  const subject = await commit.textContent();
  await commit.click();
  await page
    .locator(".hihyou-view .hh-title", { hasText: subject ?? "" })
    .waitFor({ timeout: 30_000 });
  await page
    .locator(".hihyou-view .hh-meta.message", { hasText: /changed|No changes/ })
    .waitFor({ timeout: 60_000 });
  step(
    `commit "${subject}": ${await page.locator(".hihyou-view .hh-meta.message").textContent()}`,
  );

  await toggle.click();
  await page
    .locator("#files_bucket")
    .waitFor({ state: "visible", timeout: 5_000 });
  const viewHidden = await page.locator(".hihyou-view").isHidden();
  step(`off: GitHub's diff visible again, hihyou hidden: ${viewHidden}`);
  if (!viewHidden)
    throw new Error("hihyou stayed visible after turning it off");
  console.log("e2e: passed");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
