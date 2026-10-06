// Headless check that hihyou leaves GitHub's PR header and tab bar alone: with hihyou on, the tabs stay visible,
// the Conversation tab opens GitHub's own conversation with no hihyou left over, and Files changed mounts it again.
// Runs on both layouts GitHub serves a Files changed tab in:
// - classic: what a logged-out visitor gets, header and tabs inside #files_bucket;
// - react: the React PR layout (header and tabs in a PageLayout header inside the react-app root). Logged out,
//   GitHub serves no React Files changed page, so the Conversation page's React document is served at the /files
//   URL; the content script then meets that layout on a Files changed URL.
// Never headed. Run after `wxt build`: node test/tabs.mjs
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const pr = "https://github.com/vitejs/vite/pull/21626";
const dist = join(import.meta.dirname, "../.output/chrome-mv3");
const content = '[class*="PageLayout-PageLayoutContent"]';
const layouts = {
  classic: {
    header: "#partial-discussion-header",
    diff: "#files_bucket diff-layout",
  },
  react: { header: 'header[class*="PageLayout-Header"]', diff: content },
};

async function run(name) {
  const { header, diff } = layouts[name];
  const step = (...a) => console.log(`tabs [${name}]:`, ...a);
  const profile = await mkdtemp(join(tmpdir(), "hh-tabs-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => step("pageerror:", e.message));
    if (name === "react")
      await page.route(`${pr}/files`, async (route) =>
        route.fulfill({ response: await route.fetch({ url: pr }) }),
      );
    await page.goto(`${pr}/files`, { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".hihyou-bar button");
    await toggle.waitFor({ timeout: 30_000 });
    await toggle.click();
    await page
      .locator(".hihyou-view .hh-file")
      .first()
      .waitFor({ timeout: 60_000 });
    const tab = page.locator(`nav a[href$="/pull/21626"]`).first();
    const tabVisible = await tab.isVisible();
    const headerVisible = await page.locator(header).first().isVisible();
    const diffHidden = await page.locator(diff).first().isHidden();
    step(
      `hihyou on: Conversation tab visible ${tabVisible}, header visible ${headerVisible}, GitHub's diff hidden ${diffHidden}`,
    );
    if (!tabVisible)
      throw new Error(
        `[${name}] the Conversation tab is hidden with hihyou on`,
      );
    if (!headerVisible)
      throw new Error(`[${name}] the PR header is hidden with hihyou on`);
    if (!diffHidden)
      throw new Error(`[${name}] GitHub's diff stayed visible with hihyou on`);

    await tab.click();
    await page.waitForURL(/\/pull\/21626$/, { timeout: 30_000 });
    await page
      .locator(content, { hasText: "commented" })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const leftover = await page.locator(".hihyou-bar, .hihyou-view").count();
    step(`Conversation: timeline visible, hihyou elements left ${leftover}`);
    if (leftover)
      throw new Error(`[${name}] hihyou stayed on the Conversation tab`);

    await page.locator(`a[href$="/pull/21626/files"]`).first().click();
    await page.waitForURL(/\/pull\/21626\/files/, { timeout: 30_000 });
    // The reviewer turned hihyou on, so it comes back on by itself.
    await page
      .locator(".hihyou-view .hh-file")
      .first()
      .waitFor({ timeout: 60_000 });
    const back = await page
      .locator(`nav a[href$="/pull/21626"]`)
      .first()
      .isVisible();
    step(
      `back on Files changed: hihyou drawn, Conversation tab visible ${back}`,
    );
    if (!back)
      throw new Error(`[${name}] the tab bar is hidden after coming back`);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

// `node test/tabs.mjs react` runs one layout.
for (const name of process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(layouts))
  await run(name);
console.log("tabs: passed");
