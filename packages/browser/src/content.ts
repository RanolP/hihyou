import type { App, Mounted } from "./app-api.js";
import { type PullFilesPage, pullFilesPage } from "./page.js";
import type { Privileged } from "./privileged.js";

/**
 * Where GitHub draws a PR's Files changed tab, most specific first: the classic page's `#files_bucket`, then the
 * root a React page renders into. Either can hold the PR header and its tab bar too, so hihyou hides only what
 * follows the tab bar there (see `diffParts`) and draws in its place.
 */
const tabRoots = [
  "#files_bucket",
  'react-app [data-target="react-app.reactRoot"]',
];
const storageKey = "hihyou:on";

interface Current {
  key: string;
  page: PullFilesPage;
  bar: HTMLElement;
  view: HTMLElement;
  /** GitHub's diff, hidden while hihyou is on, with each element's own inline `display` to restore. */
  areas: { element: HTMLElement; display: string }[];
  mounted?: Mounted;
  /** Bumped on every toggle, so a mount that finishes after the reviewer turned hihyou off again is dropped. */
  generation: number;
}
let current: Current | undefined;
let privileged: Privileged;
let loaded: Promise<App> | undefined;

function remembered(): boolean {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    localStorage.setItem(storageKey, on ? "1" : "0");
  } catch {
    // A page with storage blocked just forgets the choice.
  }
}

function teardown() {
  if (!current) return;
  current.mounted?.dispose();
  current.bar.remove();
  current.view.remove();
  show(current, true);
  current = undefined;
}

function show(state: Current, visible: boolean) {
  for (const { element, display } of state.areas)
    element.style.display = visible ? display : "none";
}

/**
 * The elements of `root` that draw the diff. When `root` also holds the PR's tab bar (found by its Commits tab,
 * which every PR page links), that is everything after the tab bar: from the link, the outermost ancestor inside
 * `root` that has a following sibling, and those siblings. Hiding `root` whole would take the tabs with it.
 */
function diffParts(root: HTMLElement, page: PullFilesPage): HTMLElement[] {
  const tab = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
    (a) => a.pathname.endsWith(`/pull/${page.pull}/commits`),
  );
  if (!tab) return [root];
  let after: HTMLElement[] = [];
  for (let e: HTMLElement | null = tab; e && e !== root; e = e.parentElement) {
    const siblings: HTMLElement[] = [];
    for (let s = e.nextElementSibling; s; s = s.nextElementSibling)
      if (s instanceof HTMLElement) siblings.push(s);
    if (siblings.length > 0) after = siblings;
  }
  return after;
}

async function setOn(state: Current, on: boolean) {
  const generation = ++state.generation;
  const button = state.bar.querySelector("button") as HTMLButtonElement;
  const note = state.bar.querySelector(".hihyou-note") as HTMLElement;
  button.setAttribute("aria-pressed", String(on));
  remember(on);
  if (!on) {
    state.mounted?.dispose();
    delete state.mounted;
    state.view.hidden = true;
    show(state, true);
    note.textContent = "";
    return;
  }
  show(state, false);
  state.view.hidden = false;
  if (state.mounted) return;
  try {
    if (!loaded) {
      note.textContent = "Loading hihyou…";
      // A failed load is forgotten, so the next toggle tries again.
      loaded = privileged.loadApp().catch((error: unknown) => {
        loaded = undefined;
        throw error;
      });
    }
    const app = await loaded;
    if (generation !== state.generation || current !== state) return;
    note.textContent = "";
    state.mounted = app.mount(state.view, {
      page: state.page,
      fetch: privileged.fetch,
    });
  } catch (error) {
    note.textContent = `hihyou could not start: ${String(error)}`;
    console.error("hihyou: could not start", error);
  }
}

function sync() {
  const page = pullFilesPage(location.href);
  const key = page && `${page.owner}/${page.repo}#${page.pull}`;
  if (
    current &&
    (current.key !== key ||
      !current.bar.isConnected ||
      !current.areas.every((a) => a.element.isConnected))
  )
    teardown();
  if (!page || !key || current) return;
  const root = tabRoots
    .map((s) => document.querySelector<HTMLElement>(s))
    .find((e) => e);
  if (!root) return;
  const parts = diffParts(root, page);
  const first = parts[0];
  // The tab bar is drawn but nothing after it yet: the next DOM change checks again.
  if (!first) return;

  const bar = document.createElement("div");
  bar.className = "hihyou-bar";
  bar.style.cssText = "display:flex;align-items:center;gap:8px;margin:8px 0;";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-sm";
  button.textContent = "hihyou";
  button.title = "Review this pull request's changes with hihyou";
  const note = document.createElement("span");
  note.className = "hihyou-note color-fg-muted";
  bar.append(button, note);
  const view = document.createElement("div");
  view.className = "hihyou-view";
  view.hidden = true;
  first.before(bar, view);

  const state: Current = {
    key,
    page,
    bar,
    view,
    areas: parts.map((element) => ({
      element,
      display: element.style.display,
    })),
    generation: 0,
  };
  current = state;
  button.addEventListener(
    "click",
    () => void setOn(state, button.getAttribute("aria-pressed") !== "true"),
  );
  button.setAttribute("aria-pressed", "false");
  if (remembered()) void setOn(state, true);
}

// GitHub navigates without reloading (Turbo, and React's own router), and draws the diff area after load, so
// every DOM change re-checks; `sync` returns at once when nothing moved.
// Small on purpose: it runs on every github.com page, and loads the app only once a reviewer turns hihyou on.
export function start(host: Privileged) {
  privileged = host;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  addEventListener("turbo:load", schedule);
  addEventListener("popstate", schedule);
  sync();
}
