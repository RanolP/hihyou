// Headless, fresh-profile check of the modal review editor: click selects a node, o/i/x/j move it, v marks it viewed
// (drawn through the CSS Custom Highlight API), Enter expands a cross-file move and an elided run. Never headed.
//   node test/modal.mjs fixture [--shots <dir>]  -> packages/ui/fixture/index.html (run `pnpm --filter @hihyou/ui fixture` first)
//   node test/modal.mjs ext [--shots <dir>]      -> vitejs/vite#21626 with the built extension (.output/chrome-mv3) loaded
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const ui = join(import.meta.dirname, "../../ui");
const at = process.argv.indexOf("--shots");
const out =
  at > 0
    ? process.argv[at + 1]
    : await mkdtemp(join(tmpdir(), "hihyou-modal-shots-"));
const mode = process.argv[2] ?? "fixture";
const log = (...a) => console.log(`[${mode}]`, ...a);

let context;
let page;
if (mode === "ext") {
  const dist = join(import.meta.dirname, "../.output/chrome-mv3");
  context = await chromium.launchPersistentContext(
    await mkdtemp(join(tmpdir(), "hh-modal-")),
    {
      channel: "chromium",
      headless: true,
      viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    },
  );
  page = await context.newPage();
} else {
  const browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
}
page.on("console", (m) => m.type() === "error" && log("page error:", m.text()));
page.on("pageerror", (e) => log("pageerror:", e.message));

// In-page helpers: the hihyou root (possibly in a shadow root) and the highlight contents.
const helpers = () => {
  window.__hh = {
    root() {
      const host = document.querySelector(".hihyou-view");
      const scope = host?.shadowRoot ?? document;
      return scope.querySelector(".hh-review");
    },
    ranges(name) {
      const h = CSS.highlights.get(name);
      return h
        ? [...h].map((r) => ({
            text: r.toString(),
            file: r.startContainer.parentElement?.closest(".hh-scroll")?.dataset
              .path,
          }))
        : [];
    },
    active() {
      const r = this.root();
      const scope = r?.getRootNode();
      return scope?.activeElement === r;
    },
  };
};

if (mode === "ext") {
  await page.goto("https://github.com/vitejs/vite/pull/21626/files", {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".hihyou-bar button").waitFor({ timeout: 30_000 });
  await page.locator(".hihyou-bar button").click();
  await page
    .locator(".hihyou-view .hh-file")
    .first()
    .waitFor({ timeout: 60_000 });
} else {
  await page.goto(`file://${ui}/fixture/index.html`);
  await page.locator(".hh-file").first().waitFor();
}
await page.evaluate(helpers);
log("highlight API:", await page.evaluate(() => typeof CSS.highlights));
log(
  "root tabindex:",
  await page.evaluate(() => __hh.root()?.getAttribute("tabindex")),
);

/** Clicks the middle of the first character of a changed span inside `scope` (a CSS selector inside the root). */
const clickChanged = async (selector) => {
  const point = await page.evaluate((selector) => {
    const root = __hh.root();
    for (const el of root.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement.closest(".hh-sign, .hh-sr")) continue;
        if (n.data.trim() === "") continue;
        el.scrollIntoView({ block: "center" });
        const i = n.data.search(/\S/);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        return {
          x: b.left + b.width / 2,
          y: b.top + b.height / 2,
          text: n.data,
        };
      }
    }
    return null;
  }, selector);
  if (!point) throw new Error(`nothing to click for ${selector}`);
  log(`click on "${point.text.trim().slice(0, 40)}"`);
  await page.mouse.click(point.x, point.y);
};
const show = async (what) => {
  const selected = await page.evaluate(() => __hh.ranges("hh-selection"));
  const viewed = await page.evaluate(() => __hh.ranges("hh-viewed"));
  const byFile = {};
  for (const v of viewed) byFile[v.file] = (byFile[v.file] ?? 0) + 1;
  log(
    `${what}: focused=${await page.evaluate(() => __hh.active())} selected=${JSON.stringify(
      selected
        .map((p) => p.text)
        .join("")
        .slice(0, 80),
    )} (${selected.length} ranges, file ${selected[0]?.file}) viewed ranges per file=${JSON.stringify(byFile)}`,
  );
  return { selected, viewed, byFile };
};
const shot = async (name) => {
  const path = join(out, `modal-${mode}-${name}.png`);
  await page.screenshot({ path });
  log("screenshot", path);
};

// Fixture: the moved block in src/util.ts, whose other half is src/text.ts. Extension: the first changed node.
const target =
  mode === "ext"
    ? ".hh-code ins.hh-changed, .hh-code del.hh-changed, .hh-code.hh-moved"
    : '.hh-scroll[data-path="src/util.ts"] .hh-code.hh-moved';
await clickChanged(target);
const s1 = await show("after click");
await shot("1-click");
await page.keyboard.press("o");
const s2 = await show("after o");
await shot("2-o");
if (JSON.stringify(s1.selected) === JSON.stringify(s2.selected))
  log("WARN: o did not move the selection");
await page.keyboard.press("v");
const s3 = await show("after v");
await shot("3-v");
const after = await page.evaluate(() => {
  const r = __hh.root();
  return [...r.querySelectorAll(".hh-file-viewed, .hh-viewed")].length;
});
log("elements with hh-viewed / hh-file-viewed classes:", after);
await page.keyboard.press("j");
await show("after j");
await page.keyboard.press("Escape");
await show("after Escape");
// An update in a merged unified row: each side's changed text selects that side's node.
for (const sel of ["del.hh-changed", "ins.hh-changed"]) {
  const scope =
    mode === "ext"
      ? ""
      : '.hh-scroll[data-path="packages/engine/src/interdiff.ts"] ';
  await clickChanged(scope + sel);
  const s = await show(`after click on ${sel}`);
  await shot(`4-${sel.split(".")[0]}`);
  if (s.selected.length === 0) log(`WARN: click on ${sel} selected no node`);
}
for (const key of ["o", "o", "o", "x", "i", "i"]) {
  await page.keyboard.press(key);
  await show(`after ${key}`);
}
const failures = [];
const count = (name, where) =>
  page.evaluate(
    ([name, where]) =>
      __hh.ranges(name).length &&
      [...CSS.highlights.get(name)].filter((r) => {
        const e = r.startContainer.parentElement;
        return where === "outside-change"
          ? !e?.closest("del, ins")
          : e?.closest(where);
      }).length,
    [name, where],
  );

// Fix 2: a before node in a merged unified row lights its unchanged text too, not only its del text.
{
  const scope =
    mode === "ext"
      ? ""
      : '.hh-scroll[data-path="packages/engine/src/interdiff.ts"] ';
  await page.keyboard.press("Escape");
  // A del inside a merged row whose code also holds shared (unmarked) text.
  const sel = await page.evaluate((scope) => {
    const rows = [...__hh.root().querySelectorAll(`${scope}tr.hh-line`)];
    let i = 0;
    for (const tr of rows) {
      const code = tr.querySelector(".hh-code");
      const del = code?.querySelector("del.hh-changed");
      if (!del || !code.querySelector("ins.hh-changed")) continue;
      const shared = [...code.childNodes].some(
        (n) =>
          !(n instanceof Element && n.matches("del, ins, .hh-sign, .hh-sr")) &&
          n.textContent.trim() !== "",
      );
      if (!shared) continue;
      tr.dataset.e2e = String(i++);
      return `tr[data-e2e="0"] del.hh-changed`;
    }
    return null;
  }, scope);
  if (!sel) failures.push("no merged row with del, ins and shared text");
  else {
    await clickChanged(sel);
    await show("fix2: click on del in a merged row");
    let outside = 0;
    for (let k = 0; k < 4 && outside === 0; k++) {
      await page.keyboard.press("o");
      outside = await count("hh-selection", "outside-change");
      await show(
        `fix2: after o #${k + 1} (${outside} selected ranges on shared text)`,
      );
    }
    await shot("5-before-ancestor");
    if (outside === 0)
      failures.push("fix2: o on a before node never lit shared text");
  }
}

// Fix 1 + expandMove: Enter on a cross-file move expands the pair, whose rows then carry the highlights.
{
  await page.keyboard.press("Escape");
  const moveSel =
    mode === "ext"
      ? await page.evaluate(() =>
          __hh
            .root()
            .querySelector(".hh-pair-toggle .hh-code, .hh-code.hh-pair-toggle")
            ? ".hh-code.hh-moved"
            : null,
        )
      : '.hh-scroll[data-path="src/util.ts"] .hh-code.hh-moved';
  if (!moveSel) log("expandMove: no cross-file move on this page, skipped");
  else {
    await clickChanged(moveSel);
    const before = await page.evaluate(
      () => __hh.root().querySelectorAll(".hh-pair-row").length,
    );
    await page.keyboard.press("Enter");
    await page
      .waitForFunction(
        (n) => __hh.root().querySelectorAll(".hh-pair-row").length > n,
        before,
        { timeout: 5000 },
      )
      .catch(() => {});
    const rows = await page.evaluate(
      () => __hh.root().querySelectorAll(".hh-pair-row").length,
    );
    const sel = await count("hh-selection", ".hh-pair-row");
    await page.keyboard.press("v");
    const viewedIn = await count("hh-viewed", ".hh-pair-row");
    await page.keyboard.press("v");
    const viewedOff = await count("hh-viewed", ".hh-pair-row");
    log(
      `expandMove: pair rows ${before} -> ${rows}; selected ranges in pair rows ${sel}; hh-viewed in pair rows after v ${viewedIn}, after v again ${viewedOff}`,
    );
    await shot("6-expand-move");
    if (rows <= before)
      failures.push("expandMove: Enter did not expand the pair");
    if (!sel) failures.push("fix1: pair rows carry no selection");
    if (!viewedIn && !viewedOff)
      failures.push("fix1: pair rows carry no hh-viewed ranges");
  }
}

// expandElided: Enter on a hunk beside an elided run asks the host for the lines.
{
  await page.keyboard.press("Escape");
  const expands = [];
  page.on(
    "console",
    (m) => m.text().startsWith("expand") && expands.push(m.text()),
  );
  const sel = await page.evaluate(() => {
    const rows = [...__hh.root().querySelectorAll("tr")];
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].querySelector(".hh-elided-cell button, .hh-expander"))
        continue;
      for (let d = 1; d < 40; d++)
        for (const j of [i + d, i - d]) {
          const tr = rows[j];
          if (tr?.closest(".hh-scroll") !== rows[i].closest(".hh-scroll"))
            continue;
          if (
            tr?.matches("tr.hh-line") &&
            tr.querySelector("ins.hh-changed, del.hh-changed")
          ) {
            tr.dataset.e2eElided = "1";
            return 'tr[data-e2e-elided="1"] ins.hh-changed, tr[data-e2e-elided="1"] del.hh-changed';
          }
        }
    }
    return null;
  });
  if (!sel) failures.push("expandElided: no hunk next to an elided run");
  else {
    await clickChanged(sel);
    await page.keyboard.press("x");
    await show("expandElided: hunk selected");
    const lines = await page.evaluate(
      () => __hh.root().querySelectorAll("tr.hh-line").length,
    );
    await page.keyboard.press("Enter");
    if (mode === "ext")
      await page
        .waitForFunction(
          (n) => __hh.root().querySelectorAll("tr.hh-line").length > n,
          lines,
          { timeout: 15000 },
        )
        .catch(() => {});
    else await page.waitForTimeout(300);
    const after = await page.evaluate(
      () => __hh.root().querySelectorAll("tr.hh-line").length,
    );
    const s = await show(
      `expandElided: after Enter (lines ${lines} -> ${after}, host calls ${JSON.stringify(expands)})`,
    );
    await shot("7-expand-elided");
    if (mode === "ext" ? after <= lines : expands.length === 0)
      failures.push("expandElided: Enter expanded nothing");
    if (s.selected.length === 0)
      failures.push("expandElided: the selection did not survive the redraw");
  }
}

// Whole units (fixture only): an added file says so in its badge and heads its declarations; a function added
// whole to a changed file gets a header that selects it, and viewing still goes leaf by leaf inside it.
if (mode === "fixture") {
  await page.keyboard.press("Escape");
  const file = (path) => `.hh-file:has(.hh-scroll[data-path="${path}"])`;
  const texts = (sel) => page.locator(sel).allInnerTexts();
  const badge = await texts(`${file("src/whole/added.ts")} .hh-status`);
  const addedHeads = await texts(
    `${file("src/whole/added.ts")} .hh-whole-label`,
  );
  const shop = `${file("src/whole/shop.ts")} .hh-whole`;
  const shopHeads = await texts(`${shop} .hh-whole-label`);
  log(
    `whole: badge ${JSON.stringify(badge)} added.ts heads ${JSON.stringify(addedHeads)} shop.ts heads ${JSON.stringify(shopHeads)}`,
  );
  if (badge.join() !== "added file")
    failures.push(`whole: badge reads ${JSON.stringify(badge)}`);
  if (addedHeads.join() !== "added function extra,added class Shop")
    failures.push(`whole: added.ts heads ${JSON.stringify(addedHeads)}`);
  if (shopHeads.join() !== "added function extra")
    failures.push(`whole: shop.ts heads ${JSON.stringify(shopHeads)}`);
  await page
    .locator(file("src/whole/added.ts"))
    .screenshot({ path: join(out, "whole-badge.png") });
  const state = () => page.locator(`${shop} .hh-whole-state`).innerText();
  const head = page.locator(`${shop} .hh-whole-label`);
  // The header selects the whole node; j then lands on the first leaf inside it, and v marks that leaf alone.
  await head.click();
  const whole = await show("whole: header clicked");
  if (
    !whole.selected
      .map((p) => p.text)
      .join("")
      .includes("return c")
  )
    failures.push("whole: header did not select the whole function");
  await page.keyboard.press("j");
  const leaf = await show("whole: j to a leaf");
  await page.keyboard.press("v");
  const partial = await state();
  log(
    `whole: after v on leaf "${leaf.selected.map((p) => p.text).join("")}" header state ${JSON.stringify(partial)}`,
  );
  if (partial !== "Partly viewed")
    failures.push(
      `whole: v on one leaf left the header ${JSON.stringify(partial)}`,
    );
  await head.click();
  await page.keyboard.press("v");
  const full = await state();
  log(
    `whole: after v on the header node, header state ${JSON.stringify(full)}`,
  );
  if (full !== "✓ Viewed")
    failures.push(
      `whole: v on the header node left it ${JSON.stringify(full)}`,
    );
  await page
    .locator(file("src/whole/shop.ts"))
    .screenshot({ path: join(out, "whole-declaration.png") });
  await page.keyboard.press("v");
  if ((await state()) !== "")
    failures.push("whole: v again did not unmark the function");
}

// Highlight colour actually painted: computed ::highlight colour on a viewed node's element.
log(
  "::highlight(hh-viewed) colour:",
  await page.evaluate(() => {
    const h = CSS.highlights.get("hh-viewed");
    const r = h && [...h][0];
    const e = r?.startContainer.parentElement;
    return e ? getComputedStyle(e, "::highlight(hh-viewed)").color : null;
  }),
);
await context.close();
if (mode === "fixture" && !Object.keys(s3.byFile).includes("src/text.ts"))
  throw new Error("viewing the move in src/util.ts did not dim src/text.ts");
if (s3.viewed.length === 0) throw new Error("v marked nothing viewed");
if (failures.length > 0) throw new Error(`failed: ${failures.join("; ")}`);
log("passed");
process.exit(0);
