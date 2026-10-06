// Headless check that hihyou leaves GitHub's PR header and tab bar alone: with hihyou on, the tabs stay visible,
// the Conversation tab opens GitHub's own conversation with no hihyou left over, and Files changed mounts it again.
// Never headed. Run after `wxt build`: node test/tabs.mjs
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const pr = "https://github.com/vitejs/vite/pull/21626";
const dist = join(import.meta.dirname, "../.output/chrome-mv3");
const profile = await mkdtemp(join(tmpdir(), "hh-tabs-"));
const step = (...a) => console.log("tabs:", ...a);
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  const page = await context.newPage();
  page.on("pageerror", (e) => step("pageerror:", e.message));
  await page.goto(`${pr}/files`, { waitUntil: "domcontentloaded" });
  const toggle = page.locator(".hihyou-bar button");
  await toggle.waitFor({ timeout: 30_000 });
  await toggle.click();
  await page
    .locator(".hihyou-view .hh-file")
    .first()
    .waitFor({ timeout: 60_000 });
  const tab = page.locator(`.tabnav-tab[href$="/pull/21626"]`).first();
  const header = page.locator("#partial-discussion-header");
  const diffHidden = await page.locator("#files_bucket diff-layout").isHidden();
  step(
    `hihyou on: tab bar visible ${await tab.isVisible()}, header visible ${await header.isVisible()}, GitHub's diff hidden ${diffHidden}`,
  );
  if (!(await tab.isVisible()))
    throw new Error("the Conversation tab is hidden with hihyou on");
  if (!(await header.isVisible()))
    throw new Error("the PR header is hidden with hihyou on");
  if (!diffHidden)
    throw new Error("GitHub's diff stayed visible with hihyou on");

  await tab.click();
  await page.waitForURL(/\/pull\/21626$/, { timeout: 30_000 });
  const timeline = page.locator(".js-discussion").first();
  await timeline.waitFor({ state: "visible", timeout: 30_000 });
  const leftover = await page.locator(".hihyou-bar, .hihyou-view").count();
  step(`Conversation: timeline visible, hihyou elements left ${leftover}`);
  if (leftover) throw new Error("hihyou stayed on the Conversation tab");

  await page.locator(`a[href$="/pull/21626/files"]`).first().click();
  await page.waitForURL(/\/pull\/21626\/files/, { timeout: 30_000 });
  // The reviewer turned hihyou on, so it comes back on by itself.
  await page
    .locator(".hihyou-view .hh-file")
    .first()
    .waitFor({ timeout: 60_000 });
  const back = await page
    .locator(`.tabnav-tab[href$="/pull/21626"]`)
    .first()
    .isVisible();
  step(`back on Files changed: hihyou drawn, tab bar visible ${back}`);
  if (!back) throw new Error("the tab bar is hidden after coming back");
  console.log("tabs: passed");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
